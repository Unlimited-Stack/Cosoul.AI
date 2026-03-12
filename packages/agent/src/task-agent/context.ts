import { flushMemoryIfNeeded } from "./memory";
import type { TaskDocument } from "./types";

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
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
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
