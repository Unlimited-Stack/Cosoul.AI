/**
 * judge-agent/constraints.ts — 硬约束校验
 *
 * 对 LLM 返回的 JudgeDecision 做一致性兜底。
 * LLM 有时会给出 dimensionScores 和 verdict/confidence 不一致的结果，
 * 这里用代码做最终仲裁，保证输出可靠。
 */

import type { JudgeDecision, JudgeTaskContext } from "./types";

/**
 * 对 JudgeDecision 应用硬约束校验，确保输出一致性。
 *
 * 约束规则：
 * 1. interaction_type 硬冲突 → 强制 REJECT
 * 2. MATCH + confidence < 0.7 → 降为 NEGOTIATE
 * 3. NEGOTIATE + confidence < 0.4 → 降为 REJECT
 * 4. REJECT + confidence >= 0.7 → 钳制 confidence ≤ 0.35
 */
export function applyHardConstraints(
  decision: JudgeDecision,
  sideA: JudgeTaskContext,
  sideB: JudgeTaskContext
): JudgeDecision {
  const d = { ...decision, dimensionScores: { ...decision.dimensionScores } };

  // ── 硬约束 1: interaction_type 硬冲突 → 强制 interactionTypeMatch=0, REJECT ──
  const itA = sideA.interactionType;
  const itB = sideB.interactionType;
  if (itA !== "any" && itB !== "any" && itA !== itB) {
    d.dimensionScores.interactionTypeMatch = 0;
    if (d.verdict !== "REJECT") {
      d.verdict = "REJECT";
      d.confidence = Math.min(d.confidence, 0.2);
      d.reasoning = `[hard-constraint: interaction_type ${itA} vs ${itB}] ${d.reasoning}`;
    }
  }

  // ── 硬约束 2: verdict 与 confidence 一致性校验 ──
  if (d.verdict === "MATCH" && d.confidence < 0.7) {
    d.verdict = "NEGOTIATE";
  }
  if (d.verdict === "NEGOTIATE" && d.confidence < 0.4) {
    d.verdict = "REJECT";
  }
  if (d.verdict === "REJECT" && d.confidence >= 0.7) {
    d.confidence = Math.min(d.confidence, 0.35);
  }

  return d;
}
