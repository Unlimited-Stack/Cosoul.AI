/**
 * judge.ts — Judge Model：中立第三方匹配研判
 *
 * 在 L2 阶段引入 Judge 角色，同时评估双方的 detailedPlan，
 * 判断两个任务是否兼容/可匹配。
 *
 * 与旧 L2（executeL2Sandbox）的区别：
 *   旧 L2：只看本地任务 + 对端信封摘要（3 个字段）→ 单方面研判
 *   Judge：看双方完整 detailedPlan + 任务信息 → 中立裁决
 *
 * 网络层占位：fetchRemoteTaskContext 当前返回 stub 数据（isStubbed=true），
 * 待网络层就绪后替换为实际 HTTP 请求，Judge 逻辑无需改动。
 */

import { zodToJsonSchema } from "zod-to-json-schema";
import { chatOnce } from "@repo/core/llm";
import {
  appendAgentChatLog,
  appendScratchpadNote,
  readUserProfile,
} from "./storage";
import {
  JudgeDecisionSchema,
  type HandshakeInboundEnvelope,
  type JudgeDecision,
  type L2Decision,
  type RemoteTaskContext,
  type TaskDocument,
} from "./types";

// ─── 常量 ───────────────────────────────────────────────────────

const JUDGE_MAX_RETRIES = 3;
const JUDGE_JSON_SCHEMA = zodToJsonSchema(JudgeDecisionSchema, "JudgeDecision");

/**
 * Judge System Prompt — 中立裁决者角色
 *
 * 关键设计：
 * 1. 对称评估：Side A / Side B 地位平等，无偏向
 * 2. 三级裁决：MATCH / NEGOTIATE / REJECT
 * 3. 容忍 stub：当 detailedPlan 缺失时降低置信度但不自动拒绝
 */
const JUDGE_SYSTEM_PROMPT = `你是一个中立的任务匹配裁判（Judge）。你会收到两个用户各自的任务计划，你的职责是判断这两个任务是否兼容、能否匹配成一次共同活动。

你必须输出严格符合以下 JSON Schema 的裁决对象，不要输出任何额外文字、解释或 markdown 标记：
${JSON.stringify(JUDGE_JSON_SCHEMA, null, 2)}

## 评估流程

**你必须先逐一评估以下四个维度，给出 0~1 的分数填入 dimensionScores，然后再综合得出 verdict 和 confidence。**

### 维度 1: activityCompatibility（活动兼容性，权重 0.45）
评估双方 detailedPlan / targetActivity 描述的活动是否互补或兼容。
- 1.0: 完全一致（都想打篮球）
- 0.8~0.9: 高度兼容/互补（一方想教吉他，另一方想学吉他）
- 0.5~0.7: 同类但有差异（都想运动，但一个篮球一个羽毛球）
- 0.2~0.4: 弱关联（都是"线下社交"但具体活动不同）
- 0.0~0.1: 完全无关（编程 vs 潜水）

### 维度 2: vibeAlignment（氛围对齐，权重 0.25）
评估双方期望的社交氛围是否一致。
- 1.0: 完全一致（都是"轻松随意"）
- 0.7~0.9: 兼容（"轻松随意" vs "轻松友好"）
- 0.3~0.6: 有张力但不冲突（"专注高效" vs "轻松学习"）
- 0.0~0.2: 明显冲突（"竞技对抗" vs "佛系躺平"）

### 维度 3: interactionTypeMatch（交互类型匹配，权重 0.20）
- 1.0: 完全一致，或至少一方为 "any"
- 0.0: 一方 "online" 另一方 "offline"（且都不是 "any"）→ 硬冲突

### 维度 4: planSpecificity（计划具体性，权重 0.10）
评估双方 detailedPlan 的信息充分程度。
- 1.0: 双方都有详细计划
- 0.5~0.7: 一方详细，另一方只有 targetActivity
- 0.2~0.4: 双方都只有简短描述
- 0.0~0.1: 一方或双方完全没有计划（stubbed / 空）

### 综合 confidence 计算建议
confidence ≈ activityCompatibility × 0.45 + vibeAlignment × 0.25 + interactionTypeMatch × 0.20 + planSpecificity × 0.10
（你可以在此基础上微调，但偏差不应超过 ±0.1）

## 裁决规则
- **MATCH**（confidence >= 0.7）：活动高度兼容，氛围一致，交互类型兼容
- **NEGOTIATE**（confidence 0.4~0.7）：有部分重叠，可通过协商调整达成一致
- **REJECT**（confidence < 0.4 或 interactionTypeMatch = 0）：根本不兼容或存在硬冲突

## 特殊规则
- shouldMoveToRevising：当 verdict 为 REJECT 且 Side A 修改计划后有机会匹配时设为 true
- userFacingSummary：用一句自然语言告诉用户裁决结果，不超过 50 字
- reasoning：详细记录你的推理过程，**必须包含每个维度的评估理由**

## 示例（few-shot）

### 示例 1: 高度匹配 → MATCH
Side A: targetActivity="打篮球", targetVibe="轻松友好", interaction_type="offline", detailedPlan="周六下午朝阳公园打半场3v3"
Side B: targetActivity="周末篮球", targetVibe="运动交友", interaction_type="offline", detailedPlan=""
→ dimensionScores: { activityCompatibility: 0.95, vibeAlignment: 0.85, interactionTypeMatch: 1.0, planSpecificity: 0.5 }
→ verdict: "MATCH", confidence: 0.87

### 示例 2: 互补匹配 → MATCH
Side A: targetActivity="学吉他", targetVibe="耐心友好", interaction_type="offline", detailedPlan="零基础想学弹唱，每周一次"
Side B: targetActivity="教吉他", targetVibe="轻松分享", interaction_type="any", detailedPlan=""
→ dimensionScores: { activityCompatibility: 0.90, vibeAlignment: 0.80, interactionTypeMatch: 1.0, planSpecificity: 0.5 }
→ verdict: "MATCH", confidence: 0.85

### 示例 3: 同类但有差异 → NEGOTIATE
Side A: targetActivity="户外运动", targetVibe="挑战自我", interaction_type="offline", detailedPlan="想爬山或徒步"
Side B: targetActivity="骑行", targetVibe="享受风景", interaction_type="offline", detailedPlan="公路骑行50公里"
→ dimensionScores: { activityCompatibility: 0.45, vibeAlignment: 0.50, interactionTypeMatch: 1.0, planSpecificity: 0.8 }
→ verdict: "NEGOTIATE", confidence: 0.53

### 示例 4: 看似相似实则不同 → NEGOTIATE（注意区分）
Side A: targetActivity="打游戏", targetVibe="竞技刺激", interaction_type="online", detailedPlan="英雄联盟排位"
Side B: targetActivity="桌游", targetVibe="欢乐社交", interaction_type="offline", detailedPlan="周末面杀剧本杀"
→ dimensionScores: { activityCompatibility: 0.15, vibeAlignment: 0.30, interactionTypeMatch: 0.0, planSpecificity: 0.9 }
→ verdict: "REJECT", confidence: 0.14
（虽然都是"游戏"，但电子游戏 vs 桌游是不同活动，online vs offline 硬冲突）

### 示例 5: 完全不相关 → REJECT
Side A: targetActivity="结对编程", targetVibe="专注高效", interaction_type="online", detailedPlan="TypeScript + Next.js 做 side project"
Side B: targetActivity="潜水", targetVibe="冒险刺激", interaction_type="offline", detailedPlan=""
→ dimensionScores: { activityCompatibility: 0.0, vibeAlignment: 0.10, interactionTypeMatch: 0.0, planSpecificity: 0.4 }
→ verdict: "REJECT", confidence: 0.05

### 示例 6: 信息不对称但核心匹配 → MATCH
Side A: targetActivity="跑步", targetVibe="轻松健康", interaction_type="offline", detailedPlan="每周三次晨跑5公里，奥森公园，配速6分"
Side B: targetActivity="一起跑步", targetVibe="坚持锻炼", interaction_type="any", detailedPlan=""（stubbed）
→ dimensionScores: { activityCompatibility: 0.95, vibeAlignment: 0.80, interactionTypeMatch: 1.0, planSpecificity: 0.35 }
→ verdict: "MATCH", confidence: 0.82
（虽然 Side B 没有详细计划，但 targetActivity 高度吻合，不因信息缺失而降级为 NEGOTIATE）

### 示例 7: 部分重叠可协商 → NEGOTIATE
Side A: targetActivity="学英语", targetVibe="互相督促", interaction_type="online", detailedPlan="备考雅思，想找口语练习搭子"
Side B: targetActivity="英语角", targetVibe="轻松社交", interaction_type="offline", detailedPlan="周末咖啡厅英语角聊天"
→ dimensionScores: { activityCompatibility: 0.65, vibeAlignment: 0.45, interactionTypeMatch: 0.0, planSpecificity: 0.7 }
→ verdict: "REJECT", confidence: 0.38
（活动有重叠但 online vs offline 硬冲突，如果一方愿意调整交互方式则可匹配）
→ shouldMoveToRevising: true`;

// ─── 公开 API ───────────────────────────────────────────────────

/**
 * Judge L2 入口 — 替代原 executeL2Sandbox。
 *
 * 流程：
 * 1. 获取远端任务上下文（当前 stub）
 * 2. 读取本地用户画像
 * 3. 构建 Judge prompt（双方对称）
 * 4. 调用 LLM 裁决
 * 5. 映射为 L2Decision（向后兼容）
 * 6. 全程持久化到 handshake_logs
 *
 * 任何环节失败 → fallback 到规则引擎
 */
export async function executeJudgeL2(
  localTask: TaskDocument,
  envelope: HandshakeInboundEnvelope
): Promise<L2Decision> {
  const taskId = localTask.frontmatter.task_id;
  const now = () => new Date().toISOString();

  try {
    // 1. 获取远端任务上下文
    const remoteContext = await fetchRemoteTaskContext(envelope);

    // 2. 读取本地用户画像
    const userProfile = await readUserProfile();

    // 3. 构建 Judge prompt
    const prompt = buildJudgePrompt(localTask, remoteContext, envelope, userProfile);

    // 4. 持久化 judge_request
    await appendAgentChatLog(taskId, {
      direction: "judge_request",
      timestamp: now(),
      payload: {
        content: prompt,
        localTaskId: taskId,
        remoteTaskId: remoteContext.taskId,
        remoteIsStubbed: remoteContext.isStubbed,
        round: envelope.round,
      },
      round: envelope.round,
    });

    // 5. 调用 Judge LLM
    const { raw, decision: rawDecision } = await callJudgeWithRetry(prompt);

    // 5.5 硬约束校验：修正 LLM 输出中 verdict/confidence 与 dimensionScores 不一致的情况
    const decision = applyHardConstraints(rawDecision, localTask, remoteContext);

    // 6. 映射为 L2Decision
    const l2Decision = judgeDecisionToL2Decision(decision);

    // 7. 持久化 judge_response + scratchpad
    await appendAgentChatLog(taskId, {
      direction: "judge_response",
      timestamp: now(),
      payload: {
        content: raw,
        parsedDecision: decision,
        mappedL2Action: l2Decision.action,
      },
      round: envelope.round,
      visibleToUser: true,
      userSummary: decision.userFacingSummary,
    });

    await appendScratchpadNote(
      taskId,
      `[judge:${decision.verdict}:${decision.confidence}] ${decision.reasoning}`,
      now()
    );

    return l2Decision;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "unknown error";
    console.error(`[Judge] LLM 路径失败，降级到规则 fallback: ${errorMsg}`);

    // 持久化失败记录
    await appendAgentChatLog(taskId, {
      direction: "judge_response",
      timestamp: now(),
      payload: { content: null, error: errorMsg, fellBackToRule: true },
      round: envelope.round,
      visibleToUser: false,
    });

    return fallbackRuleJudge(localTask, envelope, errorMsg);
  }
}

// ─── 远端任务上下文获取（占位） ─────────────────────────────────

/**
 * 获取远端任务的上下文信息。
 *
 * TODO(network): 当网络层就绪后，替换为实际 HTTP 请求：
 *   - GET /api/tasks/{taskId}/context
 *   - 返回远端的 detailedPlan, targetActivity, targetVibe, interactionType
 *
 * 当前实现：从握手信封的 payload 中提取可用字段，detailedPlan 留空。
 */
async function fetchRemoteTaskContext(
  envelope: HandshakeInboundEnvelope
): Promise<RemoteTaskContext> {
  // ── Phase 1: Stub 实现 ──
  // 网络层未就绪，只能从信封 payload 获取有限信息
  // detailedPlan 无法获取，标记 isStubbed=true

  // TODO(network): 替换为以下逻辑：
  // const url = `${PEER_API_BASE}/api/tasks/${envelope.sender_agent_id}/context`;
  // const res = await fetch(url, { ... });
  // const data = await res.json();
  // return { ...data, isStubbed: false };

  return {
    taskId: envelope.sender_agent_id,
    detailedPlan: "",  // 网络层就绪后从远端获取
    targetActivity: envelope.payload.target_activity,
    targetVibe: envelope.payload.target_vibe,
    interactionType: envelope.payload.interaction_type,
    isStubbed: true,
  };
}

// ─── Prompt 构建 ────────────────────────────────────────────────

/**
 * 构建 Judge 的 user prompt — 双方对称呈现。
 *
 * Side A = 本地任务（有完整 detailedPlan）
 * Side B = 远端任务（当前 stub，detailedPlan 可能为空）
 */
function buildJudgePrompt(
  localTask: TaskDocument,
  remote: RemoteTaskContext,
  envelope: HandshakeInboundEnvelope,
  userProfile: string
): string {
  const sideA = [
    "## Side A（本地任务）",
    `task_id: ${localTask.frontmatter.task_id}`,
    `interaction_type: ${localTask.frontmatter.interaction_type}`,
    `targetActivity: ${localTask.body.targetActivity}`,
    `targetVibe: ${localTask.body.targetVibe}`,
    `detailedPlan: ${localTask.body.detailedPlan || "（未填写）"}`,
    `rawDescription: ${localTask.body.rawDescription}`,
  ].join("\n");

  const stubNote = remote.isStubbed
    ? "\n[注意: Side B 的 detailedPlan 当前不可用（网络层未就绪），请基于已有字段判断]"
    : "";

  const sideB = [
    "## Side B（对端任务）",
    `task_id: ${remote.taskId}`,
    `interaction_type: ${remote.interactionType}`,
    `targetActivity: ${remote.targetActivity}`,
    `targetVibe: ${remote.targetVibe}`,
    `detailedPlan: ${remote.detailedPlan || "（未提供）"}`,
    `data_source: ${remote.isStubbed ? "stubbed" : "live"}`,
    stubNote,
  ].join("\n");

  const handshakeCtx = [
    "## 握手上下文",
    `action: ${envelope.action}`,
    `round: ${envelope.round}`,
  ].join("\n");

  const profile = [
    "## 用户画像（Side A 的用户，仅作辅助参考）",
    userProfile.slice(0, 1500),
  ].join("\n");

  return [sideA, "", sideB, "", handshakeCtx, "", profile, "", "请输出你的 JudgeDecision JSON。"].join("\n");
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

// ─── 硬约束校验 ─────────────────────────────────────────────────

/**
 * 对 LLM 返回的 JudgeDecision 做一致性兜底。
 *
 * LLM 有时会给出 dimensionScores 和 verdict/confidence 不一致的结果，
 * 这里用代码做最终仲裁，保证输出可靠。
 */
function applyHardConstraints(
  decision: JudgeDecision,
  localTask: TaskDocument,
  remote: RemoteTaskContext
): JudgeDecision {
  const d = { ...decision, dimensionScores: { ...decision.dimensionScores } };

  // ── 硬约束 1: interaction_type 硬冲突 → 强制 interactionTypeMatch=0, REJECT ──
  const localIT = localTask.frontmatter.interaction_type;
  const remoteIT = remote.interactionType;
  if (localIT !== "any" && remoteIT !== "any" && localIT !== remoteIT) {
    d.dimensionScores.interactionTypeMatch = 0;
    if (d.verdict !== "REJECT") {
      d.verdict = "REJECT";
      d.confidence = Math.min(d.confidence, 0.2);
      d.reasoning = `[hard-constraint: interaction_type ${localIT} vs ${remoteIT}] ${d.reasoning}`;
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
    // LLM 说 REJECT 但 confidence 很高，信任 verdict，压低 confidence
    d.confidence = Math.min(d.confidence, 0.35);
  }

  return d;
}

// ─── JudgeDecision → L2Decision 映射 ───────────────────────────

/**
 * 将 Judge 的三级裁决映射为 L2Decision（向后兼容）。
 *
 * MATCH / NEGOTIATE → ACCEPT（dispatcher 后续流程不变）
 * REJECT → REJECT
 */
function judgeDecisionToL2Decision(jd: JudgeDecision): L2Decision {
  return {
    action: jd.verdict === "REJECT" ? "REJECT" : "ACCEPT",
    shouldMoveToRevising: jd.shouldMoveToRevising,
    scratchpadNote: `[judge:${jd.verdict}:${jd.confidence.toFixed(2)}] ${jd.reasoning}`,
  };
}

// ─── 规则 Fallback ──────────────────────────────────────────────

/**
 * Judge 规则 fallback — 当 LLM 不可用时的降级逻辑。
 *
 * 与旧 fallbackRuleBasedL2 逻辑一致，但标记为 [judge-fallback]。
 */
function fallbackRuleJudge(
  task: TaskDocument,
  envelope: HandshakeInboundEnvelope,
  errorDetail: string
): L2Decision {
  const tag = "[judge-fallback]";
  const errorSuffix = errorDetail ? ` | error: ${errorDetail.slice(0, 120)}` : "";

  // 规则 1: 对端 REJECT → 直接 REJECT
  if (envelope.action === "REJECT") {
    return {
      action: "REJECT",
      shouldMoveToRevising: false,
      scratchpadNote: `${tag} Peer rejected.${errorSuffix}`,
    };
  }

  // 规则 2: COUNTER_PROPOSE + Waiting_Human → REJECT + 建议 Revising
  if (envelope.action === "COUNTER_PROPOSE" && task.frontmatter.status === "Waiting_Human") {
    return {
      action: "REJECT",
      shouldMoveToRevising: true,
      scratchpadNote: `${tag} Counter-propose in Waiting_Human → Revising.${errorSuffix}`,
    };
  }

  // 规则 3: interaction_type 不兼容 → REJECT
  const compatible =
    task.frontmatter.interaction_type === "any" ||
    envelope.payload.interaction_type === "any" ||
    task.frontmatter.interaction_type === envelope.payload.interaction_type;
  if (!compatible) {
    return {
      action: "REJECT",
      shouldMoveToRevising: false,
      scratchpadNote: `${tag} interaction_type incompatible.${errorSuffix}`,
    };
  }

  // 规则 4: 有实质内容的正向 action → ACCEPT
  const supportSignals =
    envelope.payload.target_activity.length > 0 &&
    envelope.payload.target_vibe.length > 0 &&
    ["PROPOSE", "COUNTER_PROPOSE", "ACCEPT"].includes(envelope.action);

  return {
    action: supportSignals ? "ACCEPT" : "REJECT",
    shouldMoveToRevising: false,
    scratchpadNote: `${tag} rule: action=${envelope.action}, support=${supportSignals}${errorSuffix}`,
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
