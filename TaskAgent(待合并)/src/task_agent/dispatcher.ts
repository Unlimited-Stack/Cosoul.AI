import { randomUUID } from "node:crypto";
import { searchByVector } from "../rag/retrieval";
import { readAllTaskVectors } from "./util/sqlite";
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
} from "./util/storage";
import type {
  ErrorCode,
  HandshakeInboundEnvelope,
  HandshakeOutboundEnvelope,
  L0Candidate,
  L1Candidate,
  ListeningReport,
  TaskDocument,
  TaskStatus
} from "./util/schema";
import { start_chat, send_friend_request } from "./friend";

/**
 * 任务匹配调度器（Matching Dispatcher）。
 *
 * 职责：
 * - 主动流（active flow）：驱动本地任务的状态机推进（Drafting/Revising -> Searching -> Negotiating）
 * - 被动流（passive flow）：处理对端 agent 发来的握手协议（Handshake）入站消息，并生成出站响应
 * - 匹配漏斗：L0（结构化硬过滤）-> L1（语义检索）-> L2（本地规则/画像研判）
 *
 * I/O 边界：
 * - 本模块不直接做文件系统 I/O；所有落盘都通过 `src/task_agent/util/storage.ts`（防腐层）完成。
 *
 * 被使用位置：
 * - `src/task_agent/task_loop.ts`：周期性调用 `processDraftingTasks()` / `processSearchingTasks()`
 */

export type WaitingHumanIntent = "satisfied" | "unsatisfied" | "enable_listener" | "closed" | "friend_request" | "exit";

/**
 * Waiting_Human 入口原因，用于前端区分展示不同 UI 和可用操作按钮。
 * Phase 3（PostgreSQL）后将由 tasks 表的 waiting_reason 字段落库，当前版本依赖握手快照推断。
 */
export type WaitingHumanReason =
  | "no_candidates"           // Searching: L1 检索返回空，无候选对象
  | "match_found"             // Negotiating: 至少一个候选双方 ACCEPT
  | "no_match_negotiating"    // Negotiating: 所有候选均被拒绝
  | "resumed_from_listening"; // Listening: 用户主动恢复（Phase 3 后由 DB 字段区分）

export interface WaitingHumanSummary {
  taskId: string;
  status: TaskStatus;
  targetActivity: string;
  targetVibe: string;
  snapshot: Awaited<ReturnType<typeof readLatestHandshakeExchange>>;
  /** 入口原因，决定前端展示哪种 UI 和可用操作列表。 */
  reason: WaitingHumanReason;
  /** 当前 reason 下允许的用户操作（前端据此渲染操作按钮）。 */
  availableIntents: WaitingHumanIntent[];
}

export interface WaitingHumanIntentResult {
  taskId: string;
  intent: WaitingHumanIntent;
  statusChanged: boolean;
  nextStatus: TaskStatus | null;
  message: string;
}

/** L2 研判结果：用于决定如何响应对端以及是否触发本地状态变更。 */
interface L2Decision {
  /** 本端希望给对端的最终动作（本阶段仅实现 ACCEPT/REJECT）。 */
  action: "ACCEPT" | "REJECT";
  /** 是否建议把本地任务标记为 Revising（提示 owner 更新/介入）。 */
  shouldMoveToRevising: boolean;
  /** 仅本地落盘的研判笔记（写入 scratchpad，严禁外发）。 */
  scratchpadNote: string;
}

/**
 * 处理 Drafting/Revising 任务：推进到 Searching。
 *
 * 语义：
 * - Drafting：刚 intake 进来，还没进入匹配池
 * - Revising：等待 owner 修改后再尝试匹配
 */
export async function processDraftingTasks(): Promise<void> {
  const draftLikeTasks = await listTasksByStatuses(["Drafting", "Revising"]);
  for (const task of draftLikeTasks) {
    await transitionTaskStatus(task.frontmatter.task_id, "Searching", {
      expectedVersion: task.frontmatter.version
    });
  }
}

/**
 * 处理 Searching 任务：执行 L1 检索并对最优候选发送 propose（当前为占位实现），随后推进到 Negotiating。
 *
 * 注意：
 * - `sendInitialPropose()` 目前返回 true（占位）；未来应在此接入网络/消息总线发送 PROPOSE。
 * - 任何状态推进都应通过 `transitionTaskStatus()`，以获得乐观锁/审计日志/派生层同步语义。
 */
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
    if (!proposeSent) {
      continue;
    }

    await transitionTaskStatus(task.frontmatter.task_id, "Waiting_Human", {
      expectedVersion: task.frontmatter.version
    });
  }
}

export async function processDraftingTask(task: TaskDocument): Promise<boolean> {
  if (task.frontmatter.status !== "Drafting" && task.frontmatter.status !== "Revising") {
    return false;
  }
  await transitionTaskStatus(task.frontmatter.task_id, "Searching", {
    expectedVersion: task.frontmatter.version
  });
  return true;
}

export async function processSearchingTask(task: TaskDocument): Promise<boolean> {
  if (task.frontmatter.status !== "Searching") {
    return false;
  }
  const l1 = await runL1Retrieval(task);
  if (l1.length === 0) {
    await transitionTaskStatus(task.frontmatter.task_id, "Waiting_Human", {
      expectedVersion: task.frontmatter.version
    });
    return true;
  }
  const proposeSent = await sendInitialPropose(task.frontmatter.task_id, l1[0].taskId);
  if (!proposeSent) {
    return false;
  }
  await transitionTaskStatus(task.frontmatter.task_id, "Negotiating", {
    expectedVersion: task.frontmatter.version
  });
  return true;
}


/**
 * 根据握手快照推断 Waiting_Human 入口原因。
 * Phase 3（PostgreSQL）后改为直接读取 tasks.waiting_reason 字段，无需推断。
 */
function inferWaitingHumanReason(
  snapshot: Awaited<ReturnType<typeof readLatestHandshakeExchange>>
): WaitingHumanReason {
  if (!snapshot.inbound && !snapshot.outbound) {
    return "no_candidates";
  }
  if (snapshot.inbound?.action === "ACCEPT" && snapshot.outbound?.action === "ACCEPT") {
    return "match_found";
  }
  return "no_match_negotiating";
}

/**
 * 根据入口原因返回前端允许展示的操作列表。
 * - no_candidates / no_match_negotiating：无匹配结果，不允许 satisfied / friend_request
 * - match_found / resumed_from_listening：有匹配结果，全部操作可用
 */
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

/**
 * 处理 Waiting_Human 状态下的用户意图（唯一执行入口，替代已删除的 CLI 版本）。
 *
 * 合并自原 processWaitingHumanTask（CLI readline 版），逻辑改进：
 * - 根据 reason 校验 intent 合法性，防止无意义操作（如无匹配时执行 satisfied）
 * - unsatisfied → Revising（而非 Drafting），符合 FSM 迁移表
 *
 * 调用方：
 * - runtime.ts：CLI run 命令的 Waiting_Human 分支
 * - listener.ts：HTTP POST /tasks/:taskId/waiting-human-intent
 */
export async function handleWaitingHumanIntent(taskId: string, intent: WaitingHumanIntent): Promise<WaitingHumanIntentResult> {
  const task = await readTaskDocument(taskId);
  if (task.frontmatter.status !== "Waiting_Human") {
    return {
      taskId, intent,
      statusChanged: false,
      nextStatus: task.frontmatter.status,
      message: `任务当前不在 Waiting_Human 状态：${task.frontmatter.status}`
    };
  }

  // 根据入口原因校验 intent 合法性（exit 始终允许）
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
    // Waiting_Human → Revising（用户修改需求后重新进入 Searching）
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

/**
 * 处理入站握手协议消息（被动流）。
 *
 * 关键保证：幂等（idempotent）
 * - 若同一入站 envelope 重放，则直接返回历史 response（避免重复处理/重复状态迁移）
 *
 * 主要行为：
 * 1) 协议版本校验（当前仅支持 1.0）
 * 2) 幂等重放：`findIdempotencyRecord()`
 * 3) 记录 inbound/outbound 到 `agent_chat/*.jsonl`（便于复盘）
 * 4) 读取本地任务并根据 round/action/L2 决策进行状态迁移与响应生成
 * 5) 落盘幂等记录：`saveIdempotencyRecord()`
 *
 * 被使用位置：
 * - 当前代码库暂无直接引用（通常由网络层/协议层在收到对端消息时调用）
 */
export async function dispatchInboundHandshake(envelope: HandshakeInboundEnvelope): Promise<HandshakeOutboundEnvelope> {
  const now = new Date().toISOString();

  if (envelope.protocol_version !== "1.0") {
    return buildErrorResponse(envelope, "E_PROTOCOL_VERSION_UNSUPPORTED", "Unsupported protocol version");
  }

  const replay = await findIdempotencyRecord(envelope);
  if (replay) {
    return replay.response;
  }

  await appendAgentChatLog(envelope.task_id, {
    direction: "inbound",
    timestamp: now,
    payload: envelope
  });

  let response: HandshakeOutboundEnvelope;

  try {
    const localTask = await readTaskDocument(envelope.task_id);

    // round 超限：若本地仍在 Searching/Negotiating，视为超时并拒绝。
    if (envelope.round >= 5 && isStatusOneOf(localTask.frontmatter.status, ["Searching", "Negotiating"])) {
      await transitionTaskStatus(envelope.task_id, "Timeout", { expectedVersion: localTask.frontmatter.version });
      response = buildActionResponse(envelope, "REJECT");
    } else if (envelope.action === "CANCEL") {
      // 对端要求取消：只有在本地处于可取消状态时才真正迁移到 Cancelled。
      if (isStatusOneOf(localTask.frontmatter.status, ["Drafting", "Searching", "Negotiating", "Waiting_Human", "Revising"])) {
        await transitionTaskStatus(envelope.task_id, "Cancelled", { expectedVersion: localTask.frontmatter.version });
      }
      response = buildActionResponse(envelope, "CANCEL");
    } else {
      // 其余动作走 L2 研判（本地规则/画像/冲突判断）。
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
    // 将内部异常归一化为协议错误响应，避免抛到上游导致消息丢失。
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

/**
 * L0：结构化硬过滤（只返回候选 taskId 列表 + 通过原因）。
 *
 * 过滤规则由 `queryL0Candidates()` 实现（tags / deal_breakers / interaction_type）。
 */
export async function runL0Filter(task: TaskDocument): Promise<L0Candidate[]> {
  const candidateIds = await queryL0Candidates(task.frontmatter.task_id);
  return candidateIds.map((taskId) => ({
    taskId,
    reason: "L0 passed: tags/deal-breakers/interaction-type compatible"
  }));
}

/**
 * L1：语义检索与排序（把 L0 候选池送入语义相似度检索）。
 *
 * 实现要点：
 * - 先跑 L0，避免无意义的语义计算
 * - 候选池仅抽取 `targetActivity/targetVibe` 参与相似度计算
 * - 过滤阈值：只保留 `score >= 0.72` 的候选（当前为经验阈值）
 */
export async function runL1Retrieval(task: TaskDocument): Promise<L1Candidate[]> {
  // L0: structural hard-filter (interaction_type / tags / deal_breakers)
  const l0Candidates = await runL0Filter(task);
  if (l0Candidates.length === 0) {
    return [];
  }

  // Load source task's embedding vectors
  const sourceVectors = readAllTaskVectors(task.frontmatter.task_id);
  if (sourceVectors.length === 0) {
    return [];
  }

  const queryVectors: Record<string, number[]> = {};
  for (const v of sourceVectors) {
    queryVectors[v.field] = v.vector;
  }

  // L1: vector search constrained to L0-approved candidates only
  const vectorResults = searchByVector({
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
 *
 * 输入：
 * - `task`：本地任务（真相源）
 * - `envelope`：对端入站握手消息（包含对端 payload）
 *
 * 输出：
 * - `action`：建议对端动作（ACCEPT/REJECT）
 * - `shouldMoveToRevising`：是否需要 owner 介入更新
 * - `scratchpadNote`：研判笔记（只写本地，不外发）
 */
export async function executeL2Sandbox(task: TaskDocument, envelope: HandshakeInboundEnvelope): Promise<L2Decision> {
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

/**
 * 向对端发送初始 propose（出站握手）。
 *
 * 约定（按你当前需求）：
 * - “只要发送成功”就视为进入协商阶段（由上层把状态迁移到 Negotiating）
 * - 暂不处理 response（Waiting_Human 等更精细的推进后续再补）
 *
 * 当前实现：
 * - 永远会先把出站 envelope 记录到本地 `agent_chat` 日志（便于复盘）
 * - 若配置了 `TASK_AGENT_PEER_HANDSHAKE_URL`，会尝试 HTTP POST（带超时）
 * - 若未配置 URL，则视为“占位发送成功”，保证状态机联调可继续推进
 */
async function sendInitialPropose(sourceTaskId: string, targetTaskId: string): Promise<boolean> {
  const sourceTask = await readTaskDocument(sourceTaskId);
  const now = new Date().toISOString();
  
  const envelope: HandshakeInboundEnvelope = {
    protocol_version: "1.0",
    message_id: randomUUID(),
    // 占位：未来应为本 agent 的稳定 ID（例如机器指纹/配置项）。
    sender_agent_id: "local",
    // 占位：当前候选只有 taskId，暂用 taskId 充当 receiver 标识；未来应为对端 agent_id。
    receiver_agent_id: targetTaskId,
    // 约定：用发起方本地 task_id 作为会话 ID（双方一致性策略后续再明确）。
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

  // 先落盘：即使真实网络发送失败，也能看到“我尝试发起过什么”。
  await appendAgentChatLog(sourceTaskId, { direction: "outbound", timestamp: now, payload: envelope });

  try {
    await postHandshakeToPeer(envelope);
    return true;
  } catch (error) {
    // 再落一条失败原因，方便本地排障（不抛给上层，交由上层决定是否重试/回退）。
    await appendAgentChatLog(sourceTaskId, {
      direction: "outbound",
      timestamp: new Date().toISOString(),
      payload: { event: "propose_send_failed", reason: normalizeErrorMessage(error) }
    });
    return false;
  }
}

/** 通知 owner 进入人工审核（占位实现，例如发 IM/邮件/系统通知）。 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function notifyOwnerForHumanReview(_taskId: string): Promise<void> {
  // Placeholder: notification integration will be implemented in later phases.
}

/**
 * 出站握手发送（HTTP 占位实现）。
 *
 * - 若未配置 `TASK_AGENT_PEER_HANDSHAKE_URL`：直接视为发送成功（占位），方便你先跑通状态机
 * - 若配置了 URL：尝试 HTTP POST JSON（带 5s 超时）；非 2xx 视为失败
 *
 * 注意：当前不解析对端 response（你说暂时不用 response 机制）。
 */
async function postHandshakeToPeer(envelope: HandshakeInboundEnvelope): Promise<void> {
  const url = process.env.TASK_AGENT_PEER_HANDSHAKE_URL;
  if (!url || url.trim().length === 0) {
    return;
  }

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

/**
 * 构造握手协议的“动作响应”。
 * - `in_reply_to` 关联入站 `message_id`
 * - `message_id` 为本端新生成的唯一 ID
 */
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

/**
 * 构造握手协议的“错误响应”（`action=ERROR`）。
 * 注意：错误码来自 `ErrorCode`（schema 约束）。
 */
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
    error: {
      code,
      message
    },
    timestamp: new Date().toISOString()
  };
}

/** 小工具：判断当前状态是否属于给定集合。 */
function isStatusOneOf(status: TaskStatus, statuses: TaskStatus[]): boolean {
  return statuses.includes(status);
}


/** 将异常对象归一化为可对外展示的错误消息文本。 */
function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "Internal error";
}

/**
 * 将异常消息映射为协议错误码（粗粒度分类）。
 * - 版本冲突：`E_VERSION_CONFLICT`（乐观锁失败）
 * - 派生层不可用：`E_DEP_UNAVAILABLE`
 * - 其他：`E_INTERNAL`
 */
function classifyErrorCode(error: unknown): ErrorCode {
  const message = normalizeErrorMessage(error);
  if (message.includes("E_VERSION_CONFLICT")) {
    return "E_VERSION_CONFLICT";
  }
  if (message.includes("E_DEP_UNAVAILABLE")) {
    return "E_DEP_UNAVAILABLE";
  }
  return "E_INTERNAL";
}
