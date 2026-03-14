/**
 * judge-agent/index.ts — 独立 Judge 微服务核心模块
 *
 * 设计理念：
 *   Judge 是云端独立服务，不属于任何一方。
 *   接收双方 taskId → 从 DB 读取双方完整任务数据 → 中立裁决 → 将结果写入双方的 handshake_logs。
 *
 * 调用方式：
 *   1. 直接调用：import { evaluateMatch } from "@repo/agent/judge-agent"
 *   2. HTTP API：POST /judge（由 server.ts 路由调用）
 *   3. BFF 转发：POST /api/agents/judge/evaluate（Next.js BFF 壳）
 */

import { chatOnce } from "@repo/core/llm";
import { JudgeDecisionSchema } from "./types";
import type {
  JudgeDecision,
  JudgeEvaluateRequest,
  JudgeEvaluateResult,
  JudgeTaskContext,
} from "./types";
import { JUDGE_SYSTEM_PROMPT, buildJudgePrompt } from "./prompt";
import { applyHardConstraints } from "./constraints";
import { fetchBothTaskContexts } from "./fetch-context";
import { persistJudgeResult } from "./notify";

// ─── 常量 ───────────────────────────────────────────────────────

const JUDGE_MAX_RETRIES = 3;

// ─── 公开 API ───────────────────────────────────────────────────

/**
 * 核心入口：评估两个任务是否匹配。
 *
 * 流程：
 * 1. 从 DB 直查双方任务完整数据
 * 2. 构建对称 prompt（含 action 握手动作）
 * 3. 调用 LLM 裁决 + 硬约束校验
 * 4. 将 judge_response 写入双方的 handshake_logs
 * 5. 返回裁决结果（含 l2Action 向后兼容字段）
 */
export async function evaluateMatch(
  request: JudgeEvaluateRequest
): Promise<JudgeEvaluateResult> {
  const { initiatorTaskId, responderTaskId, round, action = "PROPOSE" } = request;
  const timestamp = new Date().toISOString();

  // 1. 从 DB 直查双方任务
  const { sideA, sideB } = await fetchBothTaskContexts(initiatorTaskId, responderTaskId);

  try {
    // 2. 构建 Judge prompt（含 action 上下文）
    const prompt = buildJudgePrompt(sideA, sideB, round, action);

    // 3. 调用 Judge LLM + 重试
    const { decision: rawDecision } = await callJudgeWithRetry(prompt);

    // 4. 硬约束校验
    const decision = applyHardConstraints(rawDecision, sideA, sideB);

    // 5. 持久化到双方 handshake_logs
    await persistJudgeResult({
      initiatorTaskId,
      responderTaskId,
      round,
      action,
      decision,
      usedFallback: false,
    });

    return {
      initiatorTaskId,
      responderTaskId,
      decision,
      round,
      timestamp,
      usedFallback: false,
      l2Action: decision.verdict === "REJECT" ? "REJECT" : "ACCEPT",
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "unknown error";
    console.error(`[JudgeAgent] LLM 路径失败，降级到规则 fallback: ${errorMsg}`);

    // Fallback 规则裁决
    const fallbackDecision = fallbackRuleJudge(sideA, sideB, errorMsg);

    // 持久化 fallback 结果
    await persistJudgeResult({
      initiatorTaskId,
      responderTaskId,
      round,
      action,
      decision: fallbackDecision,
      usedFallback: true,
    });

    return {
      initiatorTaskId,
      responderTaskId,
      decision: fallbackDecision,
      round,
      timestamp,
      usedFallback: true,
      l2Action: fallbackDecision.verdict === "REJECT" ? "REJECT" : "ACCEPT",
    };
  }
}

// ─── LLM 调用 + 重试 ───────────────────────────────────────────

async function callJudgeWithRetry(
  prompt: string
): Promise<{ raw: string; decision: JudgeDecision }> {
  let lastError = "";

  for (let attempt = 0; attempt < JUDGE_MAX_RETRIES; attempt++) {
    const userMessage = attempt === 0
      ? prompt
      : `${prompt}\n\n[重试 #${attempt}] 上次输出不符合 schema：${lastError}\n请严格按照 JSON Schema 重新输出，只输出纯 JSON。`;

    let res;
    try {
      res = await chatOnce(userMessage, {
        system: JUDGE_SYSTEM_PROMPT,
        temperature: 0.1,
        maxTokens: 800,
      });
    } catch (e) {
      if (isInfraError(e)) throw e;
      lastError = `chatOnce threw: ${(e as Error).message}`;
      continue;
    }

    if (!res.content || res.content.trim().length === 0) {
      throw new Error("Judge LLM returned empty response");
    }

    const jsonStr = extractJson(res.content);

    try {
      const parsed = JSON.parse(jsonStr);
      const validation = JudgeDecisionSchema.safeParse(parsed);
      if (validation.success) {
        return { raw: res.content, decision: validation.data };
      }
      lastError = validation.error.issues
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join("; ");
    } catch (e) {
      lastError = `JSON parse failed: ${(e as Error).message}`;
    }
  }

  throw new Error(`Judge LLM retries exhausted after ${JUDGE_MAX_RETRIES} attempts. Last error: ${lastError}`);
}

// ─── 规则 Fallback ──────────────────────────────────────────────

/**
 * 当 LLM 不可用时的降级规则裁决。
 * 基于 interaction_type 和 targetActivity 做简单判断。
 */
function fallbackRuleJudge(
  sideA: JudgeTaskContext,
  sideB: JudgeTaskContext,
  errorDetail: string
): JudgeDecision {
  const tag = "[judge-fallback]";

  // 规则 1: interaction_type 不兼容 → REJECT
  const itA = sideA.interactionType;
  const itB = sideB.interactionType;
  if (itA !== "any" && itB !== "any" && itA !== itB) {
    return {
      dimensionScores: {
        activityCompatibility: 0,
        vibeAlignment: 0,
        interactionTypeMatch: 0,
        planSpecificity: 0,
      },
      verdict: "REJECT",
      confidence: 0.1,
      shouldMoveToRevising: true,
      reasoning: `${tag} interaction_type incompatible: ${itA} vs ${itB}. ${errorDetail.slice(0, 120)}`,
      userFacingSummary: "交互方式不兼容，无法匹配。",
    };
  }

  // 规则 2: 有基本任务信息 → NEGOTIATE（保守接受）
  const hasContent =
    sideA.targetActivity.length > 0 &&
    sideB.targetActivity.length > 0;

  if (hasContent) {
    return {
      dimensionScores: {
        activityCompatibility: 0.5,
        vibeAlignment: 0.5,
        interactionTypeMatch: 1.0,
        planSpecificity: sideA.detailedPlan && sideB.detailedPlan ? 0.8 : 0.3,
      },
      verdict: "NEGOTIATE",
      confidence: 0.5,
      shouldMoveToRevising: false,
      reasoning: `${tag} LLM unavailable, rule-based NEGOTIATE. ${errorDetail.slice(0, 120)}`,
      userFacingSummary: "系统暂时无法深度评估，建议进一步了解。",
    };
  }

  // 规则 3: 信息不足 → REJECT
  return {
    dimensionScores: {
      activityCompatibility: 0,
      vibeAlignment: 0,
      interactionTypeMatch: 1.0,
      planSpecificity: 0,
    },
    verdict: "REJECT",
    confidence: 0.2,
    shouldMoveToRevising: true,
    reasoning: `${tag} Insufficient task data for matching. ${errorDetail.slice(0, 120)}`,
    userFacingSummary: "任务信息不足，无法匹配。",
  };
}

// ─── 工具函数 ───────────────────────────────────────────────────

function extractJson(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) return braceMatch[0].trim();
  return text.trim();
}

function isInfraError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    msg.includes("fetch") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("timeout") ||
    msg.includes("abort") ||
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("429") ||
    msg.includes("500") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("api key") ||
    msg.includes("rate limit")
  );
}
