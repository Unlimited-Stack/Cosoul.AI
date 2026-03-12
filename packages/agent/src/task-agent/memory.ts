import { appendObservabilityLog, appendRawChat, appendRawChatSummary } from "./storage";

/**
 * Memory 模块：任务内对话归档与摘要（Memory extraction / summarization）。
 *
 * 职责：当单个任务的对话长度接近 token 上限时，把原始对话归档到磁盘，
 * 并生成一段更短的摘要文本，供 context.ts 替换原对话以降低 token 占用。
 *
 * 注意：这里的"记忆"是任务内视角（单次任务对话的压缩），
 * 跨任务的长期经验积累由父级 persona-agent/memory-manager.ts 负责。
 */

export interface MemoryFlushResult {
  rawLogPath: string;
  summaryPath: string;
  summaryText: string;
}

export interface MemoryFlushInput {
  taskId: string;
  conversationTurns: string[];
  estimatedTokens: number;
  triggerTokens: number;
  timestamp: string;
}

/**
 * 在需要时执行 memory flush：归档 raw chat、写入 summary，并发出 observability 日志。
 *
 * 返回：
 * - 不需要 flush（未达阈值）→ null
 * - flush 成功 → { rawLogPath, summaryPath, summaryText }
 */
export async function flushMemoryIfNeeded(input: MemoryFlushInput): Promise<MemoryFlushResult | null> {
  if (input.estimatedTokens < input.triggerTokens) {
    return null;
  }

  const rawContent = [
    `# Raw Chat Snapshot`,
    `task_id: ${input.taskId}`,
    `timestamp: ${input.timestamp}`,
    "",
    ...input.conversationTurns.map((turn, index) => `## Turn ${index + 1}\n${turn}`)
  ].join("\n");

  const summaryText = summarizeTurns(input.conversationTurns);
  const summaryContent = [
    `# Chat Summary`,
    `task_id: ${input.taskId}`,
    `timestamp: ${input.timestamp}`,
    "",
    summaryText
  ].join("\n");

  const rawLogPath = await appendRawChat(input.taskId, rawContent, input.timestamp);
  const summaryPath = await appendRawChatSummary(summaryContent, input.timestamp);

  await appendObservabilityLog({
    trace_id: "memory",
    task_id: input.taskId,
    message_id: "memory_flush",
    from_status: "N/A",
    to_status: "N/A",
    latency_ms: 0,
    error_code: null,
    event: "memory_flush",
    timestamp: input.timestamp,
    details: {
      estimated_tokens: input.estimatedTokens,
      trigger_tokens: input.triggerTokens
    }
  });

  return { rawLogPath, summaryPath, summaryText };
}

/**
 * 轻量摘要器（占位实现）。
 * 取首尾 turn 拼接，截断到 600 字符。
 * 后续可替换为 LLM 摘要调用。
 */
function summarizeTurns(turns: string[]): string {
  if (turns.length === 0) return "No conversation turns.";
  const first = turns[0];
  const last = turns[turns.length - 1];
  const combined = `${first}\n${last}`.trim();
  const trimmed = combined.length > 600 ? `${combined.slice(0, 600)}...` : combined;
  return `Summary (${turns.length} turns):\n${trimmed}`;
}
