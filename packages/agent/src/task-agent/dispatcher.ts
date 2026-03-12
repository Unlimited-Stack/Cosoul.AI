import { randomUUID } from "node:crypto";
import { readTaskVectors, saveTaskVectors, searchByVector } from "./retrieval";
import { embedTaskFields } from "./embedding";
import {
  appendAgentChatLog,
  appendScratchpadNote,
  expireTimedOutSessions,
  findIdempotencyRecord,
  generateListeningReport,
  listTasksByStatuses,
  queryL0Candidates,
  readLatestHandshakeExchange,
  readTaskDocument,
  readUserProfile,
  saveIdempotencyRecord,
  transitionTaskStatus
} from "./storage";
import type {
  ErrorCode,
  HandshakeInboundEnvelope,
  HandshakeOutboundEnvelope,
  L0Candidate,
  L1Candidate,
  ListeningReport,
  TaskDocument,
  TaskStatus
} from "./types";
import { start_chat, send_friend_request } from "./friend";

/**
 * 任务匹配调度器（Matching Dispatcher）。
 *
 * 主动流：驱动本地任务状态机推进（Drafting/Revising → Searching → Negotiating）
 * 被动流：处理对端 agent 发来的握手协议（Handshake）入站消息
 * 匹配漏斗：L0（结构化硬过滤）→ L1（语义检索，PostgreSQL pgvector）→ L2（本地规则/画像研判）
 */

export type WaitingHumanIntent = "satisfied" | "unsatisfied" | "enable_listener" | "closed" | "friend_request" | "exit";

export type WaitingHumanReason =
  | "no_candidates"
  | "match_found"
  | "no_match_negotiating"
  | "resumed_from_listening";

export interface WaitingHumanSummary {
  taskId: string;
  status: TaskStatus;
  targetActivity: string;
  targetVibe: string;
  snapshot: Awaited<ReturnType<typeof readLatestHandshakeExchange>>;
  reason: WaitingHumanReason;
  availableIntents: WaitingHumanIntent[];
}

export interface WaitingHumanIntentResult {
  taskId: string;
  intent: WaitingHumanIntent;
  statusChanged: boolean;
  nextStatus: TaskStatus | null;
  message: string;
}

interface L2Decision {
  action: "ACCEPT" | "REJECT";
  shouldMoveToRevising: boolean;
  scratchpadNote: string;
}

// ─── 主动流 ───────────────────────────────────────────────────────

export async function processDraftingTasks(): Promise<void> {
  const draftLikeTasks = await listTasksByStatuses(["Drafting", "Revising"]);
  for (const task of draftLikeTasks) {
    await transitionTaskStatus(task.frontmatter.task_id, "Searching", {
      expectedVersion: task.frontmatter.version
    });
  }
}

export async function processSearchingTasks(): Promise<void> {
  const searchingTasks = await listTasksByStatuses(["Searching"]);
  for (const task of searchingTasks) {
    const l1 = await runL1Retrieval(task);
    if (l1.length === 0) {
      await transitionTaskStatus(task.frontmatter.task_id, "Waiting_Human", {
        expectedVersion: task.frontmatter.version
      });
      continue;
    }

    const topCandidate = l1[0];
    const proposeSent = await sendInitialPropose(task.frontmatter.task_id, topCandidate.taskId);
    if (!proposeSent) continue;

    await transitionTaskStatus(task.frontmatter.task_id, "Waiting_Human", {
      expectedVersion: task.frontmatter.version
    });
  }
}

export async function processDraftingTask(task: TaskDocument): Promise<boolean> {
  if (task.frontmatter.status !== "Drafting" && task.frontmatter.status !== "Revising") return false;

  // 向量化三字段并写入 task_vectors 表，供后续 L1 检索使用
  const taskId = task.frontmatter.task_id;
  if (task.body.targetActivity && task.body.targetVibe && task.body.rawDescription) {
    const result = await embedTaskFields(
      taskId,
      task.body.targetActivity,
      task.body.targetVibe,
      task.body.rawDescription
    );
    await saveTaskVectors(
      taskId,
      result.embeddings.map((e) => ({ field: e.field, vector: e.vector }))
    );
  }

  await transitionTaskStatus(taskId, "Searching", {
    expectedVersion: task.frontmatter.version
  });
  return true;
}

export async function processSearchingTask(task: TaskDocument): Promise<boolean> {
  if (task.frontmatter.status !== "Searching") return false;

  const l1 = await runL1Retrieval(task);
  if (l1.length === 0) {
    await transitionTaskStatus(task.frontmatter.task_id, "Waiting_Human", {
      expectedVersion: task.frontmatter.version
    });
    return true;
  }

  const proposeSent = await sendInitialPropose(task.frontmatter.task_id, l1[0].taskId);
  if (!proposeSent) return false;

  await transitionTaskStatus(task.frontmatter.task_id, "Negotiating", {
    expectedVersion: task.frontmatter.version
  });
  return true;
}

// ─── Waiting_Human 处理 ───────────────────────────────────────────

function inferWaitingHumanReason(
  snapshot: Awaited<ReturnType<typeof readLatestHandshakeExchange>>
): WaitingHumanReason {
  if (!snapshot.inbound && !snapshot.outbound) return "no_candidates";
  if (snapshot.inbound?.action === "ACCEPT" && snapshot.outbound?.action === "ACCEPT") return "match_found";
  return "no_match_negotiating";
}

function resolveAvailableIntents(reason: WaitingHumanReason): WaitingHumanIntent[] {
  switch (reason) {
    case "no_candidates":
    case "no_match_negotiating":
      return ["unsatisfied", "enable_listener", "closed"];
    case "match_found":
    case "resumed_from_listening":
      return ["satisfied", "unsatisfied", "friend_request", "enable_listener", "closed"];
  }
}

export async function getWaitingHumanSummary(taskId: string): Promise<WaitingHumanSummary> {
  const task = await readTaskDocument(taskId);
  const snapshot = await readLatestHandshakeExchange(taskId);
  const reason = inferWaitingHumanReason(snapshot);
  return {
    taskId,
    status: task.frontmatter.status,
    targetActivity: task.body.targetActivity,
    targetVibe: task.body.targetVibe,
    snapshot,
    reason,
    availableIntents: resolveAvailableIntents(reason)
  };
}

export async function handleWaitingHumanIntent(
  taskId: string,
  intent: WaitingHumanIntent
): Promise<WaitingHumanIntentResult> {
  const task = await readTaskDocument(taskId);
  if (task.frontmatter.status !== "Waiting_Human") {
    return {
      taskId, intent,
      statusChanged: false,
      nextStatus: task.frontmatter.status,
      message: `任务当前不在 Waiting_Human 状态：${task.frontmatter.status}`
    };
  }

  const snapshot = await readLatestHandshakeExchange(taskId);
  const reason = inferWaitingHumanReason(snapshot);
  const allowed = resolveAvailableIntents(reason);
  if (intent !== "exit" && !allowed.includes(intent)) {
    return {
      taskId, intent,
      statusChanged: false,
      nextStatus: task.frontmatter.status,
      message: `当前状态（reason=${reason}）不支持操作 "${intent}"，可用操作：${allowed.join(", ")}`
    };
  }

  if (intent === "satisfied") {
    await start_chat(taskId);
    return { taskId, intent, statusChanged: false, nextStatus: task.frontmatter.status, message: "已接受匹配，start_chat 已触发。" };
  }
  if (intent === "unsatisfied") {
    await transitionTaskStatus(taskId, "Revising", { expectedVersion: task.frontmatter.version });
    return { taskId, intent, statusChanged: true, nextStatus: "Revising", message: "已进入 Revising，请修改任务需求后重新匹配。" };
  }
  if (intent === "closed") {
    await transitionTaskStatus(taskId, "Closed", { expectedVersion: task.frontmatter.version });
    return { taskId, intent, statusChanged: true, nextStatus: "Closed", message: "任务已关闭。" };
  }
  if (intent === "enable_listener") {
    await transitionTaskStatus(taskId, "Listening", { expectedVersion: task.frontmatter.version });
    return { taskId, intent, statusChanged: true, nextStatus: "Listening", message: "任务已进入后台监听模式。" };
  }
  if (intent === "friend_request") {
    await send_friend_request(taskId, task.frontmatter.current_partner_id);
    return { taskId, intent, statusChanged: false, nextStatus: task.frontmatter.status, message: "好友申请已发送。" };
  }
  return { taskId, intent, statusChanged: false, nextStatus: task.frontmatter.status, message: "已退出，任务保持 Waiting_Human。" };
}

export async function getListeningReportForTask(taskId: string): Promise<ListeningReport> {
  await expireTimedOutSessions(taskId);
  return generateListeningReport(taskId);
}

// ─── 被动流：入站握手协议处理 ─────────────────────────────────────

export async function dispatchInboundHandshake(
  envelope: HandshakeInboundEnvelope
): Promise<HandshakeOutboundEnvelope> {
  const now = new Date().toISOString();

  if (envelope.protocol_version !== "1.0") {
    return buildErrorResponse(envelope, "E_PROTOCOL_VERSION_UNSUPPORTED", "Unsupported protocol version");
  }

  const replay = await findIdempotencyRecord(envelope);
  if (replay) return replay.response;

  await appendAgentChatLog(envelope.task_id, { direction: "inbound", timestamp: now, payload: envelope });

  let response: HandshakeOutboundEnvelope;

  try {
    const localTask = await readTaskDocument(envelope.task_id);

    if (envelope.round >= 5 && isStatusOneOf(localTask.frontmatter.status, ["Searching", "Negotiating"])) {
      await transitionTaskStatus(envelope.task_id, "Timeout", { expectedVersion: localTask.frontmatter.version });
      response = buildActionResponse(envelope, "REJECT");
    } else if (envelope.action === "CANCEL") {
      if (isStatusOneOf(localTask.frontmatter.status, ["Drafting", "Searching", "Negotiating", "Waiting_Human", "Revising"])) {
        await transitionTaskStatus(envelope.task_id, "Cancelled", { expectedVersion: localTask.frontmatter.version });
      }
      response = buildActionResponse(envelope, "CANCEL");
    } else {
      const decision = await executeL2Sandbox(localTask, envelope);
      await appendScratchpadNote(envelope.task_id, decision.scratchpadNote, now);

      if (decision.shouldMoveToRevising && localTask.frontmatter.status === "Waiting_Human") {
        await transitionTaskStatus(envelope.task_id, "Revising", { expectedVersion: localTask.frontmatter.version });
      }

      if (decision.action === "ACCEPT" && envelope.action === "ACCEPT") {
        const latestTask = await readTaskDocument(envelope.task_id);
        if (isStatusOneOf(latestTask.frontmatter.status, ["Searching", "Negotiating"])) {
          await transitionTaskStatus(envelope.task_id, "Waiting_Human", { expectedVersion: latestTask.frontmatter.version });
        }
        await notifyOwnerForHumanReview(envelope.task_id);
      }

      response = buildActionResponse(envelope, decision.action);
    }
  } catch (error) {
    response = buildErrorResponse(envelope, classifyErrorCode(error), normalizeErrorMessage(error));
  }

  try {
    await saveIdempotencyRecord(envelope, response);
  } catch {
    response = buildErrorResponse(envelope, "E_IDEMPOTENCY_CONFLICT", "Idempotency conflict");
  }

  await appendAgentChatLog(envelope.task_id, {
    direction: "outbound",
    timestamp: new Date().toISOString(),
    payload: response
  });

  return response;
}

// ─── 匹配漏斗 L0 / L1 / L2 ───────────────────────────────────────

export async function runL0Filter(task: TaskDocument): Promise<L0Candidate[]> {
  const candidateIds = await queryL0Candidates(task.frontmatter.task_id);
  return candidateIds.map((taskId) => ({
    taskId,
    reason: "L0 passed: tags/deal-breakers/interaction-type compatible"
  }));
}

/**
 * L1：语义检索与排序。
 * 从 PostgreSQL task_vectors 表读取向量，计算加权余弦相似度。
 * 替换原 SQLite 版本，接口不变。
 */
export async function runL1Retrieval(task: TaskDocument): Promise<L1Candidate[]> {
  const l0Candidates = await runL0Filter(task);
  if (l0Candidates.length === 0) return [];

  // 从 PostgreSQL 读取源任务向量
  const sourceVectorRows = await readTaskVectors(task.frontmatter.task_id);
  if (sourceVectorRows.length === 0) return [];

  const queryVectors: Record<string, number[]> = {};
  for (const v of sourceVectorRows) {
    queryVectors[v.field] = v.vector;
  }

  const vectorResults = await searchByVector({
    sourceTaskId: task.frontmatter.task_id,
    queryVectors: {
      targetActivity: queryVectors["targetActivity"],
      targetVibe: queryVectors["targetVibe"],
      rawDescription: queryVectors["rawDescription"]
    },
    candidateTaskIds: l0Candidates.map((c) => c.taskId),
    topK: 10
  });

  return vectorResults
    .filter((r) => r.score >= 0.3)
    .map((r) => ({ taskId: r.taskId, score: r.score }));
}

/**
 * L2：本地研判沙盒（规则 + 用户画像 + 协议动作）。
 * 读取 User.md 作为用户画像（后续可替换为 PersonaContext.preferences）。
 */
export async function executeL2Sandbox(
  task: TaskDocument,
  envelope: HandshakeInboundEnvelope
): Promise<L2Decision> {
  const userProfile = await readUserProfile();
  const interactionCompatible =
    task.frontmatter.interaction_type === "any" ||
    envelope.payload.interaction_type === "any" ||
    task.frontmatter.interaction_type === envelope.payload.interaction_type;

  const hasConflict = !interactionCompatible;

  if (envelope.action === "REJECT") {
    return {
      action: "REJECT",
      shouldMoveToRevising: false,
      scratchpadNote: "Peer rejected in L2; keep silent log only."
    };
  }

  if (envelope.action === "COUNTER_PROPOSE" && task.frontmatter.status === "Waiting_Human") {
    return {
      action: "REJECT",
      shouldMoveToRevising: true,
      scratchpadNote: `Counter-propose arrived in Waiting_Human. Mark Revising for owner update. UserProfilePreview=${userProfile.slice(0, 80)}`
    };
  }

  if (hasConflict) {
    return {
      action: "REJECT",
      shouldMoveToRevising: false,
      scratchpadNote: "L2 conflict on interaction/deal-breakers. Reject."
    };
  }

  const supportSignals =
    envelope.payload.target_activity.length > 0 &&
    envelope.payload.target_vibe.length > 0 &&
    ["PROPOSE", "COUNTER_PROPOSE", "ACCEPT"].includes(envelope.action);

  return {
    action: supportSignals ? "ACCEPT" : "REJECT",
    shouldMoveToRevising: false,
    scratchpadNote: `L2 evaluated with action=${envelope.action}; support=${supportSignals}; userProfileChars=${userProfile.length}`
  };
}

// ─── 内部辅助 ─────────────────────────────────────────────────────

async function sendInitialPropose(sourceTaskId: string, targetTaskId: string): Promise<boolean> {
  const sourceTask = await readTaskDocument(sourceTaskId);
  const now = new Date().toISOString();

  const envelope: HandshakeInboundEnvelope = {
    protocol_version: "1.0",
    message_id: randomUUID(),
    sender_agent_id: "local",
    receiver_agent_id: targetTaskId,
    task_id: sourceTaskId,
    action: "PROPOSE",
    round: 0,
    payload: {
      interaction_type: sourceTask.frontmatter.interaction_type,
      target_activity: sourceTask.body.targetActivity,
      target_vibe: sourceTask.body.targetVibe
    },
    timestamp: now,
    signature: "local-placeholder-signature"
  };

  await appendAgentChatLog(sourceTaskId, { direction: "outbound", timestamp: now, payload: envelope });

  try {
    await postHandshakeToPeer(envelope);
    return true;
  } catch (error) {
    await appendAgentChatLog(sourceTaskId, {
      direction: "outbound",
      timestamp: new Date().toISOString(),
      payload: { event: "propose_send_failed", reason: normalizeErrorMessage(error) }
    });
    return false;
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function notifyOwnerForHumanReview(_taskId: string): Promise<void> {
  // Placeholder: notification integration will be implemented in later phases.
}

async function postHandshakeToPeer(envelope: HandshakeInboundEnvelope): Promise<void> {
  const url = process.env.TASK_AGENT_PEER_HANDSHAKE_URL;
  if (!url || url.trim().length === 0) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(envelope),
      signal: controller.signal
    });
    if (!res.ok) {
      throw new Error(`E_PEER_HTTP_${res.status}: handshake POST failed`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function buildActionResponse(
  envelope: HandshakeInboundEnvelope,
  action: "ACCEPT" | "REJECT" | "CANCEL"
): HandshakeOutboundEnvelope {
  return {
    protocol_version: "1.0",
    message_id: randomUUID(),
    in_reply_to: envelope.message_id,
    task_id: envelope.task_id,
    action,
    error: null,
    timestamp: new Date().toISOString()
  };
}

function buildErrorResponse(
  envelope: HandshakeInboundEnvelope,
  code: ErrorCode,
  message: string
): HandshakeOutboundEnvelope {
  return {
    protocol_version: "1.0",
    message_id: randomUUID(),
    in_reply_to: envelope.message_id,
    task_id: envelope.task_id,
    action: "ERROR",
    error: { code, message },
    timestamp: new Date().toISOString()
  };
}

function isStatusOneOf(status: TaskStatus, statuses: TaskStatus[]): boolean {
  return statuses.includes(status);
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "Internal error";
}

function classifyErrorCode(error: unknown): ErrorCode {
  const message = normalizeErrorMessage(error);
  if (message.includes("E_VERSION_CONFLICT")) return "E_VERSION_CONFLICT";
  if (message.includes("E_DEP_UNAVAILABLE")) return "E_DEP_UNAVAILABLE";
  return "E_INTERNAL";
}
