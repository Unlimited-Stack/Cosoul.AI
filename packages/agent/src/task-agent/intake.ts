import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { InteractionType, TaskDocument } from "./types";
import { Conversation } from "@repo/core/llm";
import { saveChatMessage } from "./storage";

export interface IntakeTaskResult {
  task: TaskDocument;
  transcript: string[];
}

/**
 * 针对用户第一次创建任务，通过 LLM 多轮对话提取结构化字段，生成 TaskDocument。
 * - collectInitialTaskFromUser：CLI 交互壳（仅本地开发/调试时使用）
 * - extractFromConversation：核心 LLM 提取逻辑（可被 API 路由直接调用）
 */

// ─── 提取结果类型 ─────────────────────────────────────────────────

interface ExtractedFields {
  interaction_type: "online" | "offline" | "any" | "";
  rawDescription: string;
  targetActivity: string;
  targetVibe: string;
  detailedPlan: string;
}

/** extractFromConversation 的返回值 */
export interface ExtractionResult {
  /** 当前提取到的字段（可能部分为空） */
  fields: ExtractedFields;
  /** 程序侧判定：所有必填字段是否已填充 */
  complete: boolean;
  /** 仍然缺失的字段名列表 */
  missingFields: MissingFieldName[];
  /** 如果 complete=false，LLM 生成的针对性追问 */
  followUpQuestion: string | null;
}

/** 对话持久化上下文（传入后每轮自动写 chat_messages） */
export interface IntakePersistCtx {
  taskId: string;
  personaId: string;
}

type MissingFieldName = "interaction_type" | "targetActivity" | "targetVibe";

/** 必填字段定义：字段名 → 中文描述（用于追问 prompt） */
const REQUIRED_FIELDS: { name: MissingFieldName; label: string }[] = [
  { name: "targetActivity", label: "具体想做什么活动" },
  { name: "targetVibe", label: "期望的氛围或对方特质" },
  { name: "interaction_type", label: "线上/线下/都行" },
];

/** 最大追问轮数，超过后强制结束 */
const MAX_FOLLOWUP_ROUNDS = 4;

// ─── System Prompts ───────────────────────────────────────────────

const EXTRACT_SYSTEM_PROMPT = `你是一个社交匹配需求分析助手。用户想要找人一起做某件事，你需要从对话中提取结构化信息。

请根据对话历史，提取以下字段并以**纯JSON**格式输出（不要输出任何其他内容）：

{
  "interaction_type": "online" | "offline" | "any" | "",
  "rawDescription": "用户核心需求的精炼描述，≤50字，必须用直白清晰全面朴素的形式描述",
  "targetActivity": "具体活动内容，≤50字",
  "targetVibe": "期望的氛围/对方特质，≤50字",
  "detailedPlan": "完整的需求详情，markdown格式"
}

## 核心原则：提取不到就留空
- 如果用户没有提供某个字段的信息，该字段必须返回空字符串 ""
- 绝对不要编造、猜测或脑补用户没说过的信息
- interaction_type 无法判断时返回 ""（空字符串），不要默认为 "any"

## interaction_type 判断规则（必须精确）
- 用户明确说"线下/面对面/出去/到场/约饭/约球" 等需要到场的活动 → "offline"
- 用户明确说"线上/网上/远程/打游戏/语音" 等远程活动 → "online"
- 用户明确说"都行/无所谓/线上线下都可以" → "any"
- 能从活动类型自然推断（如"打篮球"必然线下）→ 推断
- 无法判断 → ""

## targetActivity / targetVibe / rawDescription 的写法要求
- 每项≤50字
- 只基于用户明确说的内容提取
- 用发散性、包容性的语言描述，覆盖用户可能接受的相近活动和氛围
- 不要过度限定，用户没有明确限制的条件不要擅自加上
- 如果用户只说了模糊的意愿（如"想找人玩"），targetActivity 返回 ""

## detailedPlan 的写法要求
- 忠实记录用户**明确提到**的所有细节
- 用户没说的信息标注为"未限定"，不要编造

只输出JSON，不要任何解释文字`;

const FOLLOWUP_SYSTEM_PROMPT = `你是一个友好的社交匹配助手，正在帮用户创建任务。用户的需求描述缺少一些关键信息，你需要自然地追问。

## 追问风格
- 像朋友聊天一样自然口语化，不要像表单填写
- 一次只问一个问题，不要罗列多个问题
- 结合用户已有描述来追问，体现你理解了他说的内容
- 简短，不超过两句话

## 当前缺失的字段
{missingFields}

## 用户已提供的信息
{existingInfo}

请直接输出追问内容（纯文本，不要JSON，不要引号）`;

// ─── CLI 交互壳（仅本地开发调试使用）────────────────────────────

export async function collectInitialTaskFromUser(): Promise<IntakeTaskResult | null> {
  if (!input.isTTY) {
    return null;
  }

  const rl = createInterface({ input, output });
  const transcript: string[] = [];
  const conv = createExtractionConversation();

  try {
    const initialQuery = (await rl.question("\n你想做些什么？随便说说：\n> ")).trim();
    if (!initialQuery) return null;
    transcript.push(`用户: ${initialQuery}`);

    let result = await extractFromConversation(conv, initialQuery);
    let round = 0;

    // ── 多轮追问循环 ──
    while (!result.complete && result.followUpQuestion && round < MAX_FOLLOWUP_ROUNDS) {
      round++;
      console.log(`\n${result.followUpQuestion}`);

      const answer = (await rl.question("（输入 q/quit 取消）> ")).trim();
      if (!answer) break;
      if (isExitKeyword(answer)) return null;

      transcript.push(`助手: ${result.followUpQuestion}`);
      transcript.push(`用户: ${answer}`);

      result = await extractFromConversation(conv, answer);
    }

    // ── 确认环节 ──
    let confirmed = false;
    while (!confirmed) {
      printExtracted(result);
      const choice = (await rl.question("\n输入 [go] 开始匹配，[q/quit] 取消，或者继续说你想补充的内容：\n> ")).trim();

      if (!choice || choice.toLowerCase() === "go") {
        confirmed = true;
      } else if (isExitKeyword(choice)) {
        return null;
      } else {
        transcript.push(`用户(补充): ${choice}`);
        result = await extractFromConversation(conv, `用户补充说明: ${choice}`);
      }
    }

    // 对仍然缺失的字段填入合理默认值
    const fields = applyDefaults(result.fields);
    return { task: buildTaskDocument(fields), transcript };
  } finally {
    rl.close();
  }
}

// ─── 核心 LLM 提取逻辑（API 路由可直接调用）─────────────────────

/**
 * 创建一个提取用的 Conversation 实例。
 * API 路由应在会话开始时创建一次，后续每轮传入同一个实例。
 */
export function createExtractionConversation(): Conversation {
  return new Conversation({
    system: EXTRACT_SYSTEM_PROMPT,
    temperature: 0.3,
    maxTokens: 5000,
  });
}

/**
 * 从对话中提取结构化字段。
 * 使用有状态的 Conversation 实例维护多轮上下文。
 *
 * @param conv - 提取专用的 Conversation 实例（通过 createExtractionConversation 创建）
 * @param userMessage - 本轮用户输入
 * @param persistCtx - 可选，传入后每轮用户消息和 LLM 回复自动写入 chat_messages
 * @param round - 当前轮次（用于 metadata）
 * @returns ExtractionResult，包含字段、完整性判定、缺失字段列表和追问
 */
export async function extractFromConversation(
  conv: Conversation,
  userMessage: string,
  persistCtx?: IntakePersistCtx,
  round?: number,
): Promise<ExtractionResult> {
  // 持久化用户消息
  if (persistCtx) {
    await saveChatMessage({
      taskId: persistCtx.taskId,
      personaId: persistCtx.personaId,
      senderType: "human",
      senderId: persistCtx.personaId,
      content: userMessage,
      metadata: { phase: "intake", round: round ?? 0 },
    });
  }

  const response = await conv.say(userMessage);

  // 持久化 LLM 提取回复（原始 JSON）
  if (persistCtx) {
    await saveChatMessage({
      taskId: persistCtx.taskId,
      personaId: persistCtx.personaId,
      senderType: "agent",
      senderId: persistCtx.personaId,
      content: response.content,
      metadata: { phase: "intake", round: round ?? 0, role: "extractor" },
    });
  }

  const fields = parseExtractedFields(response.content);
  const missingFields = detectMissingFields(fields);
  const complete = missingFields.length === 0;

  let followUpQuestion: string | null = null;
  if (!complete) {
    followUpQuestion = await generateFollowUp(fields, missingFields);
    // 持久化追问
    if (persistCtx && followUpQuestion) {
      await saveChatMessage({
        taskId: persistCtx.taskId,
        personaId: persistCtx.personaId,
        senderType: "agent",
        senderId: persistCtx.personaId,
        content: followUpQuestion,
        metadata: { phase: "intake", round: round ?? 0, role: "followup" },
      });
    }
  }

  return { fields, complete, missingFields, followUpQuestion };
}

// ─── 追问生成 ─────────────────────────────────────────────────────

async function generateFollowUp(
  fields: ExtractedFields,
  missingFields: MissingFieldName[],
): Promise<string> {
  const missingLabels = missingFields
    .map((name) => {
      const def = REQUIRED_FIELDS.find((f) => f.name === name);
      return def ? `- ${def.label}` : `- ${name}`;
    })
    .join("\n");

  const existingParts: string[] = [];
  if (fields.rawDescription) existingParts.push(`需求描述: ${fields.rawDescription}`);
  if (fields.targetActivity) existingParts.push(`活动: ${fields.targetActivity}`);
  if (fields.targetVibe) existingParts.push(`氛围: ${fields.targetVibe}`);
  if (fields.interaction_type) existingParts.push(`互动方式: ${fields.interaction_type}`);
  const existingInfo = existingParts.length > 0
    ? existingParts.join("\n")
    : "（用户尚未提供明确信息）";

  const prompt = FOLLOWUP_SYSTEM_PROMPT
    .replace("{missingFields}", missingLabels)
    .replace("{existingInfo}", existingInfo);

  // 独立单次调用，不污染提取 Conversation 的上下文
  const { chatOnce } = await import("@repo/core/llm");
  const response = await chatOnce(
    `请针对缺失的信息生成一个追问（优先问: ${missingLabels}）`,
    { system: prompt, temperature: 0.7, maxTokens: 200 },
  );

  return response.content.trim().replace(/^["']|["']$/g, "");
}

// ─── 字段校验 ─────────────────────────────────────────────────────

function detectMissingFields(fields: ExtractedFields): MissingFieldName[] {
  const missing: MissingFieldName[] = [];

  if (!fields.targetActivity.trim()) {
    missing.push("targetActivity");
  }

  if (!fields.targetVibe.trim()) {
    missing.push("targetVibe");
  }

  if (!fields.interaction_type || !["online", "offline", "any"].includes(fields.interaction_type)) {
    missing.push("interaction_type");
  }

  return missing;
}

// ─── JSON 解析 ────────────────────────────────────────────────────

function parseExtractedFields(raw: string): ExtractedFields {
  try {
    let text = raw.trim();
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    const parsed = JSON.parse(text);

    return {
      interaction_type: normalizeInteractionType(parsed.interaction_type),
      rawDescription: truncate(String(parsed.rawDescription ?? ""), 50),
      targetActivity: truncate(String(parsed.targetActivity ?? ""), 50),
      targetVibe: truncate(String(parsed.targetVibe ?? ""), 50),
      detailedPlan: String(parsed.detailedPlan ?? ""),
    };
  } catch {
    return {
      interaction_type: "",
      rawDescription: "",
      targetActivity: "",
      targetVibe: "",
      detailedPlan: "",
    };
  }
}

function normalizeInteractionType(value: unknown): ExtractedFields["interaction_type"] {
  if (typeof value === "string" && ["online", "offline", "any"].includes(value)) {
    return value as "online" | "offline" | "any";
  }
  return "";
}

// ─── 默认值填充 ───────────────────────────────────────────────────

/**
 * 对追问结束后仍然为空的字段填入合理默认值，保证 TaskDocument 可用。
 */
function applyDefaults(fields: ExtractedFields): ExtractedFields {
  return {
    ...fields,
    interaction_type: fields.interaction_type || "any",
    targetVibe: fields.targetVibe || "轻松随和、开放友好",
    // targetActivity 和 rawDescription 如果仍然为空，取对方的值兜底
    targetActivity: fields.targetActivity || fields.rawDescription || "待定",
    rawDescription: fields.rawDescription || fields.targetActivity || "待定",
  };
}

// ─── 构建 TaskDocument ────────────────────────────────────────────

export function buildTaskDocument(extracted: ExtractedFields): TaskDocument {
  const nowIso = new Date().toISOString();
  return {
    frontmatter: {
      task_id: randomUUID(),
      status: "Drafting",
      interaction_type: (extracted.interaction_type || "any") as InteractionType,
      current_partner_id: null,
      entered_status_at: nowIso,
      created_at: nowIso,
      updated_at: nowIso,
      version: 1,
      pending_sync: false,
      hidden: false,
    },
    body: {
      rawDescription: extracted.rawDescription,
      targetActivity: extracted.targetActivity,
      targetVibe: extracted.targetVibe,
      detailedPlan: extracted.detailedPlan,
    },
  };
}

// ─── 内部辅助 ─────────────────────────────────────────────────────

function isExitKeyword(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t === "q" || t === "quit" || t === "exit" || t === "退出" || t === "取消";
}

function truncate(text: string, maxLen: number): string {
  if (!text) return "";
  return text.length <= maxLen ? text : text.slice(0, maxLen);
}

function printExtracted(result: ExtractionResult): void {
  const { fields, missingFields } = result;
  console.log("\n---------- 提取结果 ----------");
  console.log(`互动方式: ${fields.interaction_type || "⚠ 未确定"}`);
  console.log(`核心需求: ${fields.rawDescription || "⚠ 未提取到"}`);
  console.log(`目标活动: ${fields.targetActivity || "⚠ 未提取到"}`);
  console.log(`期望氛围: ${fields.targetVibe || "⚠ 未提取到"}`);
  if (fields.detailedPlan) {
    console.log(`\n详细计划:\n${fields.detailedPlan}`);
  }
  if (missingFields.length > 0) {
    const labels = missingFields.map((name) => {
      const def = REQUIRED_FIELDS.find((f) => f.name === name);
      return def?.label ?? name;
    });
    console.log(`\n⚠ 仍缺少: ${labels.join("、")}`);
  }
  console.log("------------------------------");
}
