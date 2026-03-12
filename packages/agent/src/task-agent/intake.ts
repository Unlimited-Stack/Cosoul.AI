import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { InteractionType, TaskDocument } from "./types";
import { chatOnce } from "@repo/core/llm";

export interface IntakeTaskResult {
  task: TaskDocument;
  transcript: string[];
}

/**
 * 针对用户第一次创建任务，通过 LLM 多轮对话提取结构化字段，生成 TaskDocument。
 * - collectInitialTaskFromUser：CLI 交互壳（仅本地开发/调试时使用）
 * - extractFromConversation：核心 LLM 提取逻辑（可被 API 路由直接调用）
 */

interface ExtractedFields {
  interaction_type: "online" | "offline" | "any";
  rawDescription: string;
  targetActivity: string;
  targetVibe: string;
  detailedPlan: string;
  complete: boolean;
  followUpQuestion: string | null;
}

// ─── System prompt ────────────────────────────────────────────────

const EXTRACT_SYSTEM_PROMPT = `你是一个社交匹配需求分析助手。用户想要找人一起做某件事，你需要从对话中提取结构化信息。

请根据对话历史，提取以下字段并以**纯JSON**格式输出（不要输出任何其他内容）：

{
  "interaction_type": "online" | "offline" | "any",
  "rawDescription": "用户核心需求的精炼描述，≤50字",
  "targetActivity": "具体活动内容，≤50字",
  "targetVibe": "期望的氛围/对方特质，≤50字",
  "detailedPlan": "完整的需求详情，markdown格式",
  "complete": true/false,
  "followUpQuestion": "如果complete=false，给出一个自然的追问；如果complete=true则为null"
}

## interaction_type 判断规则（必须精确）
- 用户明确说"线下/面对面/出去/到场" → "offline"
- 用户明确说"线上/网上/远程" → "online"
- 无法判断或用户没表态 → "any"

## complete 判断标准
- interaction_type 能判断出来 → 必须
- 具体想做什么活动能明确 → 必须
- 以上两项明确即为 complete=true

## targetActivity / targetVibe / rawDescription 的写法要求
- 每项≤50字
- 用发散性、包容性的语言描述，覆盖用户可能接受的相近活动和氛围
- 不要过度限定，用户没有明确限制的条件不要擅自加上（如人数、性别、年龄）
- 适当使用近义词扩展语义覆盖面，越普适性越好

## detailedPlan 的写法要求
- 忠实记录用户**明确提到**的所有细节（时间、地点、偏好等）
- 用户没说的信息标注为"未限定"或"灵活"，不要编造

## followUpQuestion
- 自然口语化，像朋友聊天
- 只输出JSON，不要任何解释文字`;

// ─── CLI 交互壳（仅本地开发调试使用）────────────────────────────

export async function collectInitialTaskFromUser(): Promise<IntakeTaskResult | null> {
  if (!input.isTTY) {
    return null;
  }

  const rl = createInterface({ input, output });
  const transcript: string[] = [];

  try {
    const initialQuery = (await rl.question("\n你想找人一起做什么？随便说说：\n> ")).trim();
    if (!initialQuery) return null;
    transcript.push(`用户: ${initialQuery}`);

    let conversationContext = `用户: ${initialQuery}`;
    let extracted = await extractFromConversation(conversationContext);

    while (!extracted.complete && extracted.followUpQuestion) {
      console.log(`\n${extracted.followUpQuestion}`);
      const answer = (await rl.question("（输入 q/quit 取消）> ")).trim();
      if (!answer) break;
      if (isExitKeyword(answer)) return null;

      transcript.push(`助手: ${extracted.followUpQuestion}`);
      transcript.push(`用户: ${answer}`);
      conversationContext += `\n助手: ${extracted.followUpQuestion}\n用户: ${answer}`;
      extracted = await extractFromConversation(conversationContext);
    }

    let confirmed = false;
    while (!confirmed) {
      printExtracted(extracted);
      const choice = (await rl.question("\n输入 [go] 开始匹配，[q/quit] 取消，或者继续说你想补充的内容：\n> ")).trim();

      if (!choice || choice.toLowerCase() === "go") {
        confirmed = true;
      } else if (isExitKeyword(choice)) {
        return null;
      } else {
        transcript.push(`用户(补充): ${choice}`);
        conversationContext += `\n用户(补充): ${choice}`;
        extracted = await extractFromConversation(conversationContext);
      }
    }

    return { task: buildTaskDocument(extracted), transcript };
  } finally {
    rl.close();
  }
}

// ─── 核心 LLM 提取逻辑（API 路由可直接调用）─────────────────────

/**
 * 从对话文本中提取结构化字段，供 API 路由在创建任务时调用。
 * @param conversationContext - 对话原文（可以是单条用户描述，也可以是多轮对话拼接）
 */
export async function extractFromConversation(conversationContext: string): Promise<ExtractedFields> {
  const response = await chatOnce(conversationContext, {
    system: EXTRACT_SYSTEM_PROMPT,
    temperature: 0.3,
    maxTokens: 1000
  });

  try {
    let text = response.content.trim();
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    const parsed = JSON.parse(text) as ExtractedFields;

    parsed.rawDescription = truncate(parsed.rawDescription, 50);
    parsed.targetActivity = truncate(parsed.targetActivity, 50);
    parsed.targetVibe = truncate(parsed.targetVibe, 50);

    if (!["online", "offline", "any"].includes(parsed.interaction_type)) {
      parsed.interaction_type = "any";
    }

    return parsed;
  } catch {
    return {
      interaction_type: "any",
      rawDescription: truncate(conversationContext.split("\n")[0].replace(/^用户:\s*/, ""), 50),
      targetActivity: "",
      targetVibe: "",
      detailedPlan: "",
      complete: false,
      followUpQuestion: "能再详细说说你想做什么吗？比如具体活动、线上还是线下？"
    };
  }
}

/**
 * 从提取结果构建 TaskDocument（初始状态为 Drafting）。
 * @param personaId - 所属分身 ID，用于 saveTaskMD 写入 DB
 */
export function buildTaskDocument(extracted: ExtractedFields): TaskDocument {
  const nowIso = new Date().toISOString();
  return {
    frontmatter: {
      task_id: randomUUID(),          // 纯 UUID，与 PostgreSQL defaultRandom() 保持一致
      status: "Drafting",             // 初始状态：Drafting（经 FSM 推进到 Searching）
      interaction_type: extracted.interaction_type as InteractionType,
      current_partner_id: null,
      entered_status_at: nowIso,
      created_at: nowIso,
      updated_at: nowIso,
      version: 1,
      pending_sync: false,
      hidden: false
    },
    body: {
      rawDescription: extracted.rawDescription,
      targetActivity: extracted.targetActivity,
      targetVibe: extracted.targetVibe,
      detailedPlan: extracted.detailedPlan
    }
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

function printExtracted(extracted: ExtractedFields): void {
  console.log("\n---------- 提取结果 ----------");
  console.log(`互动方式: ${extracted.interaction_type}`);
  console.log(`核心需求: ${extracted.rawDescription}`);
  console.log(`目标活动: ${extracted.targetActivity}`);
  console.log(`期望氛围: ${extracted.targetVibe}`);
  console.log(`\n详细计划:\n${extracted.detailedPlan}`);
  console.log("------------------------------");
}
