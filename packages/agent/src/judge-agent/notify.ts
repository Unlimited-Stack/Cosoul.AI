/**
 * notify.ts — 裁决结果持久化（直写 handshake_logs）
 *
 * Judge Agent 裁决完成后，往双方的 handshake_logs 各写一条记录，
 * 确保 A 和 B 看到的是同一份裁决结果。
 */

import { db } from "@repo/core/db/client";
import { handshakeLogs } from "@repo/core/db/schema";
import type { JudgeDecision } from "./types";

interface PersistParams {
  initiatorTaskId: string;
  responderTaskId: string;
  round: number;
  action: string;
  decision: JudgeDecision;
  usedFallback: boolean;
}

/**
 * 将 Judge 裁决结果同时写入双方的 handshake_logs。
 * 双方各一条 judge_response 记录，payload 内容相同，peerTaskId 互为对方。
 */
export async function persistJudgeResult(params: PersistParams): Promise<void> {
  const { initiatorTaskId, responderTaskId, round, action, decision, usedFallback } = params;
  const now = new Date();

  // 共享的裁决 payload
  const judgePayload = {
    verdict: decision.verdict,
    confidence: decision.confidence,
    dimensionScores: decision.dimensionScores,
    shouldMoveToRevising: decision.shouldMoveToRevising,
    reasoning: decision.reasoning,
    userFacingSummary: decision.userFacingSummary,
    l2Action: decision.verdict === "REJECT" ? "REJECT" : "ACCEPT",
    action,
    usedFallback,
    judgedAt: now.toISOString(),
    peerTaskId: null as string | null,
  };

  // 并行写入双方 handshake_logs
  await Promise.all([
    db.insert(handshakeLogs).values({
      taskId: initiatorTaskId,
      direction: "judge_response",
      envelope: { ...judgePayload, peerTaskId: responderTaskId, side: "A" },
      round,
      visibleToUser: true,
      userSummary: decision.userFacingSummary,
      timestamp: now,
    }),
    db.insert(handshakeLogs).values({
      taskId: responderTaskId,
      direction: "judge_response",
      envelope: { ...judgePayload, peerTaskId: initiatorTaskId, side: "B" },
      round,
      visibleToUser: true,
      userSummary: decision.userFacingSummary,
      timestamp: now,
    }),
  ]);
}
