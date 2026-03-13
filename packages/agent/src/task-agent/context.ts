import { flushMemoryIfNeeded } from "./memory";
import type { TaskDocument } from "./types";
import type { Conversation, ConversationTurn } from "@repo/core/llm";

/**
 * Prompt 上下文构建与 token 预算管理模块。
 *
 * 目标：给 LLM 调用/握手协议生成层提供稳定的 systemPrompt + taskPrompt，
 * 并在接近 token 上限时触发 memory flush，避免提示词爆仓。
 *
 * token 估算使用轻量近似（字符长度/4），是软约束，不精确计费。
 */

export interface PromptContext {
  systemPrompt: string;
  taskPrompt: string;
  tokenBudget: number;
  estimatedTokens: number;
  memoryFlushed: boolean;
  memorySummaryPath: string | null;
}

export interface BuildPromptContextInput {
  task: TaskDocument;
  conversationTurns: string[];
  tokenBudget: number;
  /** 触发 memory flush 的阈值比例（默认 0.8） */
  flushTriggerRatio?: number;
  /** 可选：从 PersonaAgent 注入的 Soul.md 文本，注入到 systemPrompt */
  soulText?: string;
}

/**
 * 构建给模型调用的 prompt 上下文。
 *
 * 行为：
 * 1. 估算当前对话 token
 * 2. 达到阈值（默认预算 80%）时触发 flushMemoryIfNeeded
 * 3. 用 truncateTurnsByBudget 在预算内裁剪对话
 * 4. 拼装 taskPrompt（携带 task 元信息 + 最终对话）
 * 5. 若传入 soulText，注入到 systemPrompt（L2 研判以分身视角执行）
 */
export async function buildPromptContext(input: BuildPromptContextInput): Promise<PromptContext> {
  const flushTriggerRatio = input.flushTriggerRatio ?? 0.8;
  const triggerTokens = Math.floor(input.tokenBudget * flushTriggerRatio);
  const estimatedTokens = estimateTokens(input.conversationTurns.join("\n"));

  let conversationTurns = input.conversationTurns;
  let memoryFlushed = false;
  let memorySummaryPath: string | null = null;

  if (estimatedTokens >= triggerTokens) {
    const flushResult = await flushMemoryIfNeeded({
      taskId: input.task.frontmatter.task_id,
      conversationTurns: input.conversationTurns,
      estimatedTokens,
      triggerTokens,
      timestamp: new Date().toISOString()
    });

    if (flushResult) {
      memoryFlushed = true;
      memorySummaryPath = flushResult.summaryPath;
      conversationTurns = [flushResult.summaryText];
    }
  }

  const promptTurns = truncateTurnsByBudget(conversationTurns, input.tokenBudget);
  const taskPrompt = [
    `TaskId: ${input.task.frontmatter.task_id}`,
    `Status: ${input.task.frontmatter.status}`,
    `TargetActivity: ${input.task.body.targetActivity}`,
    `TargetVibe: ${input.task.body.targetVibe}`,
    "Conversation:",
    ...promptTurns
  ].join("\n");

  // 若传入 soulText，将分身人格注入 systemPrompt
  const systemPrompt = input.soulText
    ? `You are a matching agent acting on behalf of this persona:\n\n${input.soulText}\n\nOutput protocol JSON only.`
    : "You are a matching agent. Output protocol JSON only.";

  return {
    systemPrompt,
    taskPrompt,
    tokenBudget: input.tokenBudget,
    estimatedTokens,
    memoryFlushed,
    memorySummaryPath
  };
}

/** token 粗略估算（字符数 / 4） */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── 对话压缩（供 intake / revise 多轮对话使用）──────────────────

/** 压缩触发阈值：Conversation 历史 token 超过此值时触发压缩 */
const COMPRESS_TOKEN_THRESHOLD = 10000;

/** LLM 生成摘要的 system prompt */
const COMPRESS_SYSTEM_PROMPT = `你是一个对话摘要助手。请将下面的多轮对话压缩为一段简洁的摘要，保留所有关键信息（用户需求、已确认的字段值、重要偏好）。
摘要要求：
- 使用中文
- ≤300字
- 保留具体的字段值（活动、氛围、互动方式等）
- 丢弃寒暄、重复确认等无信息量内容
- 以第三人称客观描述

只输出摘要文本，不要任何前缀或格式标记。`;

export interface CompressResult {
  /** 是否触发了压缩 */
  compressed: boolean;
  /** 压缩后的摘要文本（未触发时为 null） */
  summary: string | null;
}

/**
 * 检测 Conversation 上下文是否过长，如过长则用 LLM 生成压缩摘要，
 * 并重置 Conversation 历史（将摘要注入为首条上下文）。
 *
 * 调用方在每轮对话后调用此函数，若返回 compressed=true，
 * 应将 summary 写入 chat_messages.compress_summary 字段。
 *
 * @param conv - 当前 Conversation 实例
 * @param phase - 当前阶段标识（intake / revise），用于摘要前缀
 * @param threshold - 触发压缩的 token 阈值，默认 4000
 */
export async function compressConversationIfNeeded(
  conv: Conversation,
  phase: "intake" | "revise",
  threshold: number = COMPRESS_TOKEN_THRESHOLD,
): Promise<CompressResult> {
  const currentTokens = conv.getHistoryTokenCount();

  if (currentTokens < threshold) {
    return { compressed: false, summary: null };
  }

  // 收集历史 turns 为文本
  const history: ConversationTurn[] = conv.getHistory();
  const turnsText = history
    .map((t) => `${t.role === "user" ? "用户" : "助手"}: ${t.content}`)
    .join("\n");

  // 用 LLM 生成压缩摘要
  const { chatOnce } = await import("@repo/core/llm");
  const response = await chatOnce(
    `请压缩以下${phase === "intake" ? "需求采集" : "任务修改"}对话：\n\n${turnsText}`,
    { system: COMPRESS_SYSTEM_PROMPT, temperature: 0.3, maxTokens: 500 },
  );

  const summary = response.content.trim();

  // 重置 Conversation 并注入摘要作为上下文前缀
  conv.reset();
  // 以 assistant 角色注入摘要，让后续对话保持连贯
  await conv.say(`[以下是之前对话的摘要]\n${summary}\n[摘要结束，请继续对话]`);

  return { compressed: true, summary };
}

/**
 * 在 token 预算内裁剪对话 turns（优先保留最新内容）。
 * 从最后一条往前回溯，尽可能保留最近的 turn。
 */
function truncateTurnsByBudget(turns: string[], tokenBudget: number): string[] {
  const result: string[] = [];
  let used = 0;

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    const turnTokens = Math.ceil(turn.length / 4);
    if (used + turnTokens > tokenBudget) continue;
    used += turnTokens;
    result.push(turn);
  }

  return result.reverse();
}
