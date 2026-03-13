/**
 * task-agent/judge.ts — 兼容垫片（Compatibility Shim）
 *
 * 旧 executeJudgeL2 接口的向后兼容包装。
 * 实际逻辑已迁移至 judge-agent/ 独立模块。
 *
 * dispatcher.ts 已直接调用 judge-agent/evaluateMatch，
 * 此文件仅为现有测试和可能的外部引用提供兼容。
 *
 * @deprecated 请使用 import { evaluateMatch } from "../judge-agent"
 */

import { evaluateMatch } from "../judge-agent";
import { appendScratchpadNote } from "./storage";
import type {
  HandshakeInboundEnvelope,
  L2Decision,
  TaskDocument,
} from "./types";

/**
 * @deprecated 使用 evaluateMatch({ initiatorTaskId, responderTaskId, round }) 代替
 */
export async function executeJudgeL2(
  localTask: TaskDocument,
  envelope: HandshakeInboundEnvelope
): Promise<L2Decision> {
  const result = await evaluateMatch({
    initiatorTaskId: envelope.sender_agent_id,
    responderTaskId: localTask.frontmatter.task_id,
    round: envelope.round,
  });

  const scratchpadNote = `[judge:${result.decision.verdict}:${result.decision.confidence.toFixed(2)}] ${result.decision.reasoning}`;

  await appendScratchpadNote(
    localTask.frontmatter.task_id,
    scratchpadNote,
    result.timestamp
  );

  return {
    action: result.l2Action,
    shouldMoveToRevising: result.decision.shouldMoveToRevising,
    scratchpadNote,
  };
}
