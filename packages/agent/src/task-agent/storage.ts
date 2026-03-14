import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@repo/core/db/client";
import { chatMessages, handshakeLogs, idempotencyKeys, tasks } from "@repo/core/db/schema";
import { and, desc, eq, inArray, lt, ne } from "drizzle-orm";
import type {
  ErrorCode,
  HandshakeInboundEnvelope,
  HandshakeOutboundEnvelope,
  InteractionType,
  ListeningReport,
  NegotiationSession,
  SessionStatus,
  TaskDocument,
  TaskFrontmatter,
  TaskStatus
} from "./types";
import {
  NegotiationSessionSchema,
  parseHandshakeInboundEnvelope,
  parseHandshakeOutboundEnvelope,
  parseTaskDocument
} from "./types";

/**
 * 存储/持久化防腐层（Anti-Corruption Layer）。
 *
 * PostgreSQL（tasks 表）为任务数据唯一真相源（Single Source of Truth）。
 * 文件系统仅用于对话快照、研判草稿、可观测性日志等周边数据。
 */

export interface SyncRepairJob {
  taskId: string;
  reason: string;
  createdAt: string;
}

export interface SaveTaskOptions {
  expectedVersion?: number;
  personaId?: string;
}

export interface TransitionResult {
  previousStatus: TaskStatus;
  nextStatus: TaskStatus;
  version: number;
  updatedAt: string;
}

export interface TransitionOptions {
  expectedVersion?: number;
  traceId?: string;
  messageId?: string;
  errorCode?: ErrorCode | null;
}

export interface TaskRecord {
  taskPath: string;
  task: TaskDocument;
}

export interface IdempotencyRecord {
  key: string;
  taskId: string;
  createdAt: string;
  response: HandshakeOutboundEnvelope;
}

export type HandshakeDirection = "inbound" | "outbound" | "judge_request" | "judge_response";

export interface AgentChatLogEntry {
  direction: HandshakeDirection;
  timestamp: string;
  payload: unknown;
  round?: number;
  visibleToUser?: boolean;
  userSummary?: string;
}

export interface HandshakeExchangeSnapshot {
  inbound: HandshakeInboundEnvelope | null;
  outbound: HandshakeOutboundEnvelope | null;
  sourceFilePath: string | null;
}

export interface ObservabilityLogEvent {
  trace_id: string;
  task_id: string;
  message_id: string;
  from_status: TaskStatus | "N/A";
  to_status: TaskStatus | "N/A";
  latency_ms: number;
  error_code: ErrorCode | null;
  event: string;
  timestamp: string;
  details?: Record<string, string | number | boolean>;
}

export interface RetentionCleanupResult {
  deletedRawChats: number;
  deletedAgentChatJsonl: number;
}

const DATA_ROOT = path.resolve(process.cwd(), ".data");
const TASK_AGENTS_ROOT = path.join(DATA_ROOT, "task_agents");
const SYNC_REPAIR_QUEUE_FILE = path.join(DATA_ROOT, "sync_repair_queue.jsonl");
const IDEMPOTENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const USER_PROFILE_FILE = path.join(DATA_ROOT, "User.md");
const GLOBAL_RAW_CHAT_SUMMARY_DIR = path.join(DATA_ROOT, "raw_chats_summary");
const GLOBAL_LOG_DIR = path.join(DATA_ROOT, "logs");
const RAW_CHATS_RETENTION_DAYS = 90;
const AGENT_CHAT_RETENTION_DAYS = 180;

/** FSM 允许迁移表 */
const ALLOWED_STATUS_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  Drafting: ["Searching", "Cancelled"],
  Searching: ["Negotiating", "Timeout", "Failed", "Cancelled"],
  Negotiating: ["Waiting_Human", "Timeout", "Failed", "Cancelled"],
  Waiting_Human: ["Revising", "Drafting", "Listening", "Closed", "Cancelled"],
  Listening: ["Waiting_Human", "Cancelled"],
  Revising: ["Searching", "Cancelled"],
  Closed: ["Waiting_Human"],
  Failed: ["Searching"],
  Timeout: ["Searching"],
  Cancelled: ["Waiting_Human"]
};

// ─── 内部辅助：TaskDocument ↔ DB 行转换 ───────────────────────────

type TaskDbInsert = typeof tasks.$inferInsert;
type TaskDbSelect = typeof tasks.$inferSelect;

function taskDocumentToDbValues(
  task: TaskDocument
): Omit<TaskDbInsert, "taskId" | "personaId" | "createdAt"> {
  const fm = task.frontmatter;
  return {
    status: fm.status,
    interactionType: fm.interaction_type,
    currentPartnerId: fm.current_partner_id ?? null,
    rawDescription: task.body.rawDescription || null,
    targetActivity: task.body.targetActivity || null,
    targetVibe: task.body.targetVibe || null,
    detailedPlan: task.body.detailedPlan || null,
    enteredStatusAt: new Date(fm.entered_status_at),
    updatedAt: new Date(fm.updated_at),
    version: fm.version,
    pendingSync: fm.pending_sync,
    hidden: fm.hidden
  };
}

function dbRowToTaskDocument(row: TaskDbSelect): TaskDocument {
  return {
    frontmatter: {
      task_id: row.taskId,
      status: row.status as TaskStatus,
      interaction_type: row.interactionType as InteractionType,
      current_partner_id: row.currentPartnerId ?? null,
      entered_status_at: row.enteredStatusAt.toISOString(),
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
      version: row.version,
      pending_sync: row.pendingSync,
      hidden: row.hidden
    },
    body: {
      rawDescription: row.rawDescription ?? "",
      targetActivity: row.targetActivity ?? "",
      targetVibe: row.targetVibe ?? "",
      detailedPlan: row.detailedPlan ?? ""
    }
  } as TaskDocument;
}

// ─── 公开 API ─────────────────────────────────────────────────────

/**
 * 保存/覆盖写入任务到 PostgreSQL tasks 表。
 * - task_id 已存在：UPDATE（可选乐观锁）
 * - task_id 不存在：INSERT（必须提供 options.personaId）
 */
export async function saveTaskMD(task: TaskDocument, options: SaveTaskOptions = {}): Promise<void> {
  const validated = parseTaskDocument(task);
  const taskId = validated.frontmatter.task_id;

  const existing = await db
    .select({ version: tasks.version })
    .from(tasks)
    .where(eq(tasks.taskId, taskId));

  if (existing.length > 0) {
    if (options.expectedVersion !== undefined && existing[0].version !== options.expectedVersion) {
      throw new Error(
        `E_VERSION_CONFLICT: expected ${options.expectedVersion}, got ${existing[0].version} for ${taskId}`
      );
    }
    await db
      .update(tasks)
      .set(taskDocumentToDbValues(validated))
      .where(eq(tasks.taskId, taskId));
  } else {
    if (options.expectedVersion !== undefined) {
      throw new Error(
        `E_VERSION_CONFLICT: expected ${options.expectedVersion}, got missing task for ${taskId}`
      );
    }
    if (!options.personaId) {
      throw new Error(
        `E_MISSING_PERSONA_ID: personaId is required when creating a new task (task_id: ${taskId})`
      );
    }
    await db.insert(tasks).values({
      taskId,
      personaId: options.personaId,
      createdAt: new Date(validated.frontmatter.created_at),
      ...taskDocumentToDbValues(validated)
    });
  }

  try {
    await syncDerivedLayers(validated);
  } catch {
    // 派生层同步失败不阻塞主写入
  }
}

export async function updateTaskStatus(taskId: string, nextStatus: TaskStatus): Promise<void> {
  await transitionTaskStatus(taskId, nextStatus);
}

export async function setTaskHidden(taskId: string, hidden: boolean): Promise<void> {
  const current = await readTaskDocument(taskId);
  if (current.frontmatter.hidden === hidden) return;

  await db
    .update(tasks)
    .set({
      hidden,
      updatedAt: new Date(),
      version: current.frontmatter.version + 1
    })
    .where(eq(tasks.taskId, taskId));
}

/**
 * L0 结构化硬过滤候选查询（PostgreSQL）。
 * 只考虑 status=Searching、interaction_type 兼容的任务。
 */
export async function queryL0Candidates(_taskId: string): Promise<string[]> {
  const source = await readTaskDocument(_taskId);
  const sourceInteraction = source.frontmatter.interaction_type;

  const rows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.status, "Searching"), ne(tasks.taskId, _taskId)));

  const result: string[] = [];
  for (const row of rows) {
    const candidateInteraction = row.interactionType as InteractionType;
    const compatible =
      sourceInteraction === "any" ||
      candidateInteraction === "any" ||
      sourceInteraction === candidateInteraction;
    if (!compatible) continue;
    result.push(row.taskId);
  }
  return result;
}

export async function enqueueSyncRepair(job: SyncRepairJob): Promise<void> {
  const line = JSON.stringify(job);
  const existing = await safeReadText(SYNC_REPAIR_QUEUE_FILE);
  const nextContent = existing.length === 0 ? `${line}\n` : `${existing.trimEnd()}\n${line}\n`;
  await writeFile(SYNC_REPAIR_QUEUE_FILE, nextContent, "utf8");
}

export async function readTaskDocument(taskId: string): Promise<TaskDocument> {
  const rows = await db.select().from(tasks).where(eq(tasks.taskId, taskId));
  if (rows.length === 0) {
    throw new Error(`E_TASK_NOT_FOUND: ${taskId}`);
  }
  return dbRowToTaskDocument(rows[0]);
}

/**
 * 从 task.md 文件读取 TaskDocument。
 * 用于需要读取文件系统版本的场景（如人工编辑后的 sync）。
 */
export async function readTaskFromMD(taskId: string): Promise<TaskDocument> {
  const filePath = resolveTaskPath(taskId);
  const content = await readFile(filePath, "utf8");
  return parseTaskMDContent(content);
}

export interface SyncFromMDResult {
  task: TaskDocument;
  changedFields: string[];
}

/**
 * 从 task.md 文件回写 DB：读取 task.md → 对比 DB → 更新差异字段。
 * 典型场景：人工编辑 task.md 后调用此函数同步回 DB。
 * 返回更新后的 TaskDocument 和变更字段列表，调用方可据此决定是否触发 re-embedding。
 */
export async function syncTaskFromMD(taskId: string): Promise<SyncFromMDResult> {
  const mdTask = await readTaskFromMD(taskId);
  const dbTask = await readTaskDocument(taskId);

  // 对比 body 字段差异
  const changedFields: string[] = [];
  const bodyKeys = ["rawDescription", "targetActivity", "targetVibe", "detailedPlan"] as const;
  for (const key of bodyKeys) {
    if (mdTask.body[key] !== dbTask.body[key]) {
      changedFields.push(key);
    }
  }

  // 对比 frontmatter 中可编辑字段
  if (mdTask.frontmatter.interaction_type !== dbTask.frontmatter.interaction_type) {
    changedFields.push("interaction_type");
  }

  if (changedFields.length === 0) {
    return { task: dbTask, changedFields };
  }

  // 用 md 版本的 body + interaction_type 覆盖 DB，保留 DB 的 version/status 等元数据
  const merged: TaskDocument = {
    frontmatter: {
      ...dbTask.frontmatter,
      interaction_type: mdTask.frontmatter.interaction_type,
      updated_at: new Date().toISOString(),
      version: dbTask.frontmatter.version + 1,
    },
    body: mdTask.body,
  };

  await db
    .update(tasks)
    .set({
      ...taskDocumentToDbValues(merged),
      version: merged.frontmatter.version,
    })
    .where(eq(tasks.taskId, taskId));

  return { task: merged, changedFields };
}

export async function listTasksByStatuses(statuses: TaskStatus[]): Promise<TaskDocument[]> {
  if (statuses.length === 0) return [];
  const rows = await db
    .select()
    .from(tasks)
    .where(inArray(tasks.status, statuses));
  return rows.map(dbRowToTaskDocument);
}

export async function listAllTasks(): Promise<TaskRecord[]> {
  return listAllTaskRecords();
}

export async function getTaskFilePath(taskId: string): Promise<string> {
  const rows = await db
    .select({ taskId: tasks.taskId })
    .from(tasks)
    .where(eq(tasks.taskId, taskId));
  if (rows.length === 0) throw new Error(`E_TASK_NOT_FOUND: ${taskId}`);
  return resolveTaskPath(taskId);
}

/**
 * 任务状态迁移（乐观锁 + 审计 + 两阶段写入）。
 */
export async function transitionTaskStatus(
  taskId: string,
  nextStatus: TaskStatus,
  options: TransitionOptions = {}
): Promise<TransitionResult> {
  const startedAt = Date.now();
  const current = await readTaskDocument(taskId);
  const previousStatus = current.frontmatter.status;

  if (options.expectedVersion !== undefined && current.frontmatter.version !== options.expectedVersion) {
    throw new Error(
      `E_VERSION_CONFLICT: expected ${options.expectedVersion}, got ${current.frontmatter.version} for ${taskId}`
    );
  }

  assertTransitionAllowed(previousStatus, nextStatus);

  const nowIso = new Date().toISOString();
  const nextVersion = current.frontmatter.version + 1;

  await db
    .update(tasks)
    .set({
      status: nextStatus,
      enteredStatusAt: new Date(nowIso),
      updatedAt: new Date(nowIso),
      version: nextVersion,
      pendingSync: true
    })
    .where(and(eq(tasks.taskId, taskId), eq(tasks.version, current.frontmatter.version)));

  try {
    const step1Doc: TaskDocument = {
      frontmatter: {
        ...current.frontmatter,
        status: nextStatus,
        entered_status_at: nowIso,
        updated_at: nowIso,
        version: nextVersion,
        pending_sync: true
      },
      body: current.body
    } as TaskDocument;
    await syncDerivedLayers(step1Doc);

    await db
      .update(tasks)
      .set({ pendingSync: false, updatedAt: new Date() })
      .where(eq(tasks.taskId, taskId));
  } catch (error) {
    await enqueueSyncRepair({
      taskId,
      reason: normalizeErrorReason(error),
      createdAt: new Date().toISOString()
    });

    await appendObservabilityLog({
      trace_id: options.traceId ?? "local",
      task_id: taskId,
      message_id: options.messageId ?? "local",
      from_status: previousStatus,
      to_status: nextStatus,
      latency_ms: Date.now() - startedAt,
      error_code: "E_DEP_UNAVAILABLE",
      event: "status_transition_sync_deferred",
      timestamp: new Date().toISOString(),
      details: { pending_sync: true }
    });
  }

  await appendObservabilityLog({
    trace_id: options.traceId ?? "local",
    task_id: taskId,
    message_id: options.messageId ?? "local",
    from_status: previousStatus,
    to_status: nextStatus,
    latency_ms: Date.now() - startedAt,
    error_code: options.errorCode ?? null,
    event: "status_transition",
    timestamp: new Date().toISOString()
  });

  return { previousStatus, nextStatus, version: nextVersion, updatedAt: nowIso };
}

export async function retrySyncRepairs(): Promise<SyncRepairJob[]> {
  const jobs = await readRepairQueue();
  if (jobs.length === 0) return [];

  const remaining: SyncRepairJob[] = [];
  for (const job of jobs) {
    try {
      const rows = await db
        .select({ pendingSync: tasks.pendingSync })
        .from(tasks)
        .where(eq(tasks.taskId, job.taskId));
      if (rows.length === 0 || !rows[0].pendingSync) continue;

      const doc = await readTaskDocument(job.taskId);
      await syncDerivedLayers(doc);

      await db
        .update(tasks)
        .set({ pendingSync: false, updatedAt: new Date() })
        .where(eq(tasks.taskId, job.taskId));
    } catch {
      remaining.push(job);
    }
  }

  await rewriteRepairQueue(remaining);
  return remaining;
}

export async function findIdempotencyRecord(
  envelope: HandshakeInboundEnvelope
): Promise<IdempotencyRecord | null> {
  const key = buildIdempotencyKey(envelope);

  const cutoff = new Date(Date.now() - IDEMPOTENCY_WINDOW_MS);
  await db.delete(idempotencyKeys).where(lt(idempotencyKeys.createdAt, cutoff));

  const rows = await db
    .select()
    .from(idempotencyKeys)
    .where(eq(idempotencyKeys.key, key));

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    key: row.key,
    taskId: envelope.task_id,
    createdAt: row.createdAt.toISOString(),
    response: row.response as HandshakeOutboundEnvelope
  };
}

export async function saveIdempotencyRecord(
  envelope: HandshakeInboundEnvelope,
  response: HandshakeOutboundEnvelope
): Promise<void> {
  const key = buildIdempotencyKey(envelope);

  const existing = await db
    .select()
    .from(idempotencyKeys)
    .where(eq(idempotencyKeys.key, key));

  if (existing.length > 0) {
    if (stableStringify(existing[0].response) !== stableStringify(response)) {
      throw new Error("E_IDEMPOTENCY_CONFLICT: existing response mismatches new response");
    }
    return;
  }

  await db.insert(idempotencyKeys).values({
    key,
    response: response as Record<string, unknown>
  });
}

export async function appendAgentChatLog(taskId: string, entry: AgentChatLogEntry): Promise<void> {
  await db.insert(handshakeLogs).values({
    taskId,
    direction: entry.direction,
    envelope: entry.payload as Record<string, unknown>,
    round: entry.round ?? null,
    visibleToUser: entry.visibleToUser ?? false,
    userSummary: entry.userSummary ?? null,
    timestamp: new Date(entry.timestamp)
  });
}

/**
 * 读取用户可见的协商摘要（visible_to_user = true）。
 * 前端展示"Agent 在帮你做什么"时使用。
 */
export async function readUserVisibleNegotiationSummary(taskId: string): Promise<Array<{
  round: number;
  summary: string;
  decision: string | null;
  timestamp: string;
}>> {
  const rows = await db
    .select()
    .from(handshakeLogs)
    .where(
      and(
        eq(handshakeLogs.taskId, taskId),
        eq(handshakeLogs.visibleToUser, true)
      )
    )
    .orderBy(handshakeLogs.timestamp);

  return rows.map((row) => {
    const envelope = row.envelope as Record<string, unknown>;
    const decision = envelope.parsedDecision as Record<string, unknown> | undefined;
    return {
      round: row.round ?? 0,
      summary: row.userSummary ?? "",
      decision: decision?.action as string ?? null,
      timestamp: row.timestamp.toISOString()
    };
  });
}

export async function readLatestHandshakeExchange(taskId: string): Promise<HandshakeExchangeSnapshot> {
  const rows = await db
    .select()
    .from(handshakeLogs)
    .where(eq(handshakeLogs.taskId, taskId))
    .orderBy(desc(handshakeLogs.timestamp));

  let inbound: HandshakeInboundEnvelope | null = null;
  let outbound: HandshakeOutboundEnvelope | null = null;

  for (const row of rows) {
    if (row.direction === "outbound" && outbound === null) {
      try { outbound = parseHandshakeOutboundEnvelope(row.envelope); } catch { /* ignore */ }
    }
    if (row.direction === "inbound" && inbound === null) {
      try { inbound = parseHandshakeInboundEnvelope(row.envelope); } catch { /* ignore */ }
    }
    if (inbound && outbound) break;
  }

  return { inbound, outbound, sourceFilePath: null };
}

export async function appendScratchpadNote(taskId: string, note: string, timestamp: string): Promise<void> {
  const taskDir = path.dirname(resolveTaskPath(taskId));
  const scratchpadPath = path.join(taskDir, "data", "agent_chat", "scratchpad.md");
  const existing = await safeReadText(scratchpadPath);
  const block = `\n## ${timestamp}\n${note}\n`;
  const next = existing.length === 0 ? `# scratchpad\n${block}` : `${existing.trimEnd()}\n${block}`;
  await mkdir(path.dirname(scratchpadPath), { recursive: true });
  await writeFile(scratchpadPath, next, "utf8");
}

export async function readUserProfile(): Promise<string> {
  return safeReadText(USER_PROFILE_FILE);
}

export async function appendRawChat(taskId: string, content: string, timestamp: string): Promise<string> {
  const taskDir = path.dirname(resolveTaskPath(taskId));
  const rawChatDir = path.join(taskDir, "data", "raw_chats");
  await mkdir(rawChatDir, { recursive: true });
  const day = timestamp.slice(0, 10);
  const filePath = path.join(rawChatDir, `${day}-chat.md`);
  await writeFile(filePath, content, "utf8");
  return filePath;
}

export async function appendRawChatSummary(content: string, timestamp: string): Promise<string> {
  await mkdir(GLOBAL_RAW_CHAT_SUMMARY_DIR, { recursive: true });
  const day = timestamp.slice(0, 10);
  const filePath = path.join(GLOBAL_RAW_CHAT_SUMMARY_DIR, `${day}-summary.md`);
  await writeFile(filePath, content, "utf8");
  return filePath;
}

export async function appendObservabilityLog(event: ObservabilityLogEvent): Promise<void> {
  await mkdir(GLOBAL_LOG_DIR, { recursive: true });
  const day = event.timestamp.slice(0, 10);
  const filePath = path.join(GLOBAL_LOG_DIR, `${day}-sys.md`);
  const existing = await safeReadText(filePath);
  const line = JSON.stringify(event);
  const next = existing.length === 0 ? `${line}\n` : `${existing.trimEnd()}\n${line}\n`;
  await writeFile(filePath, next, "utf8");
}

export async function cleanupExpiredData(nowIso = new Date().toISOString()): Promise<RetentionCleanupResult> {
  const nowMs = Date.parse(nowIso);
  const rawCutoffMs = nowMs - RAW_CHATS_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const agentCutoffMs = nowMs - AGENT_CHAT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  let deletedRawChats = 0;
  let deletedAgentChatJsonl = 0;
  const records = await listAllTaskRecords();
  const seenDirs = new Set<string>();

  for (const record of records) {
    const taskDir = path.dirname(record.taskPath);
    if (seenDirs.has(taskDir)) continue;
    seenDirs.add(taskDir);

    const rawDir = path.join(taskDir, "data", "raw_chats");
    const agentDir = path.join(taskDir, "data", "agent_chat");

    deletedRawChats += await cleanupFilesByAge(rawDir, /-chat\.md$/, rawCutoffMs);
    deletedAgentChatJsonl += await cleanupFilesByAge(agentDir, /-agentchat\.jsonl$/, agentCutoffMs);
  }

  await appendObservabilityLog({
    trace_id: "maintenance",
    task_id: "N/A",
    message_id: "retention",
    from_status: "N/A",
    to_status: "N/A",
    latency_ms: 0,
    error_code: null,
    event: "retention_cleanup",
    timestamp: nowIso,
    details: { deleted_raw_chats: deletedRawChats, deleted_agent_chat_jsonl: deletedAgentChatJsonl }
  });

  return { deletedRawChats, deletedAgentChatJsonl };
}

export async function rebuildIndex(): Promise<number> {
  const records = await listAllTaskRecords();
  const count = records.length;

  await appendObservabilityLog({
    trace_id: "maintenance",
    task_id: "N/A",
    message_id: "rebuild_index",
    from_status: "N/A",
    to_status: "N/A",
    latency_ms: 0,
    error_code: null,
    event: "rebuild_index",
    timestamp: new Date().toISOString(),
    details: { task_count: count }
  });

  return count;
}

export async function resumeFailedOrTimeoutTask(taskId: string, triggerBy: string): Promise<TransitionResult> {
  const current = await readTaskDocument(taskId);
  if (current.frontmatter.status !== "Timeout" && current.frontmatter.status !== "Failed") {
    throw new Error(`E_INVALID_TRANSITION: ${current.frontmatter.status} cannot resume to Searching`);
  }

  const result = await transitionTaskStatus(taskId, "Searching", {
    expectedVersion: current.frontmatter.version,
    traceId: "resume",
    messageId: triggerBy
  });

  await appendObservabilityLog({
    trace_id: "resume",
    task_id: taskId,
    message_id: triggerBy,
    from_status: current.frontmatter.status,
    to_status: "Searching",
    latency_ms: 0,
    error_code: null,
    event: "manual_resume",
    timestamp: new Date().toISOString(),
    details: { trigger_by: triggerBy }
  });

  return result;
}

// ─── Chat Messages（intake / revise 多轮对话持久化）──────────────

export interface ChatMessageInput {
  taskId: string;
  personaId: string;
  senderType: "human" | "agent";
  senderId: string;
  content: string;
  /** 压缩后的对话历史摘要（上下文过长时由 LLM 生成） */
  compressSummary?: string;
  metadata?: Record<string, unknown>;
}

export async function saveChatMessage(msg: ChatMessageInput): Promise<string> {
  const [row] = await db.insert(chatMessages).values({
    taskId: msg.taskId,
    personaId: msg.personaId,
    senderType: msg.senderType,
    senderId: msg.senderId,
    content: msg.content,
    compressSummary: msg.compressSummary ?? null,
    metadata: msg.metadata ?? {},
  }).returning({ id: chatMessages.id });
  return row.id;
}

export async function listChatMessages(taskId: string) {
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.taskId, taskId))
    .orderBy(chatMessages.createdAt);
}

// ─── Negotiation Session Storage（JSONL 文件存储）─────────────────

export async function upsertNegotiationSession(session: NegotiationSession): Promise<void> {
  const sessions = await readAllSessions(session.task_id);
  const index = sessions.findIndex((s) => s.session_id === session.session_id);
  if (index >= 0) {
    sessions[index] = session;
  } else {
    sessions.push(session);
  }
  await rewriteSessions(session.task_id, sessions);
}

export async function findSessionByRemoteAgent(
  taskId: string,
  remoteAgentId: string
): Promise<NegotiationSession | null> {
  const sessions = await readAllSessions(taskId);
  return (
    sessions.find(
      (s) =>
        s.remote_agent_id === remoteAgentId &&
        s.status !== "Rejected" &&
        s.status !== "Timeout"
    ) ?? null
  );
}

export async function listNegotiationSessions(taskId: string): Promise<NegotiationSession[]> {
  return readAllSessions(taskId);
}

export async function generateListeningReport(taskId: string): Promise<ListeningReport> {
  const sessions = await readAllSessions(taskId);
  const matched = sessions.filter((s) => s.status === "Accepted" && s.verdict === "MATCH").length;
  const negotiating = sessions.filter((s) => s.status === "Negotiating" || s.verdict === "NEGOTIATE").length;
  const rejected = sessions.filter((s) => s.status === "Rejected").length;
  const timedOut = sessions.filter((s) => s.status === "Timeout").length;

  const sorted = [...sessions].sort((a, b) => {
    const statusOrder: Record<SessionStatus, number> = { Accepted: 0, Negotiating: 1, Rejected: 2, Timeout: 3 };
    const aDiff = statusOrder[a.status] - statusOrder[b.status];
    if (aDiff !== 0) return aDiff;
    return (b.match_score ?? -1) - (a.match_score ?? -1);
  });

  return {
    task_id: taskId,
    total_handshakes: sessions.length,
    matched,
    negotiating,
    rejected,
    timed_out: timedOut,
    sessions: sorted,
    generated_at: new Date().toISOString()
  };
}

export async function expireTimedOutSessions(taskId: string): Promise<number> {
  const sessions = await readAllSessions(taskId);
  const now = Date.now();
  let expired = 0;
  for (const session of sessions) {
    if (session.status === "Negotiating" && now > Date.parse(session.timeout_at)) {
      session.status = "Timeout";
      session.updated_at = new Date().toISOString();
      expired += 1;
    }
  }
  if (expired > 0) {
    await rewriteSessions(taskId, sessions);
  }
  return expired;
}

// ─── 公开序列化工具（供测试/调试使用）────────────────────────────

export function parseTaskMDContent(content: string): TaskDocument {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!frontmatterMatch) {
    throw new Error("E_TASK_MD_INVALID: missing YAML frontmatter");
  }

  const yamlText = frontmatterMatch[1];
  const bodyText = frontmatterMatch[2].trim();
  const yaml = parseSimpleYamlObject(yamlText);

  // body 字段现在从 YAML 中读取，只有 detailedPlan 保留在 markdown body
  const rawDescription = String(yaml.raw_description ?? "");
  const targetActivity = String(yaml.target_activity ?? "");
  const targetVibe = String(yaml.target_vibe ?? "");

  // 从 YAML 中移除 body 字段，剩余的才是 frontmatter
  delete yaml.raw_description;
  delete yaml.target_activity;
  delete yaml.target_vibe;

  const detailedMatch = bodyText.match(/### 需求详情\s*([\s\S]*)$/);
  const detailedPlan = detailedMatch ? detailedMatch[1].trim() : "";
  const cleanPlan = detailedPlan === "（待 AI 生成）" ? "" : detailedPlan;

  return parseTaskDocument({
    frontmatter: yaml,
    body: { rawDescription, targetActivity, targetVibe, detailedPlan: cleanPlan },
  });
}

export function serializeTaskMDContent(task: TaskDocument): string {
  const yamlLines = [
    ...serializeSimpleYamlLines(task.frontmatter),
    `raw_description: ${quoteYaml(task.body.rawDescription)}`,
    `target_activity: ${quoteYaml(task.body.targetActivity)}`,
    `target_vibe: ${quoteYaml(task.body.targetVibe)}`,
  ];
  const detailedSection = task.body.detailedPlan
    ? `\n\n### 需求详情\n${task.body.detailedPlan}`
    : "\n\n### 需求详情\n（待 AI 生成）";
  return `---\n${yamlLines.join("\n")}\n---${detailedSection}\n`;
}

// ─── 内部工具函数 ─────────────────────────────────────────────────

function assertTransitionAllowed(current: TaskStatus, next: TaskStatus): void {
  const allowed = ALLOWED_STATUS_TRANSITIONS[current];
  if (!allowed.includes(next)) {
    throw new Error(`E_INVALID_TRANSITION: ${current} -> ${next} is not allowed`);
  }
}

function resolveTaskPath(taskId: string): string {
  return path.join(TASK_AGENTS_ROOT, toTaskFolderName(taskId), "task.md");
}

async function listAllTaskRecords(): Promise<TaskRecord[]> {
  const rows = await db.select().from(tasks);
  return rows.map((row) => ({
    taskPath: resolveTaskPath(row.taskId),
    task: dbRowToTaskDocument(row)
  }));
}

/**
 * 派生层同步：将 TaskDocument 写出为 task.md 文件。
 * task.md 既是可观测副本，也可被人工编辑后通过 syncTaskFromMD 回流。
 */
async function syncDerivedLayers(task: TaskDocument): Promise<void> {
  const filePath = resolveTaskPath(task.frontmatter.task_id);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, serializeTaskMDContent(task), "utf8");
}

async function readAllSessions(taskId: string): Promise<NegotiationSession[]> {
  const sessionsFile = path.join(
    path.dirname(resolveTaskPath(taskId)),
    "data",
    "sessions.jsonl"
  );
  const raw = await safeReadText(sessionsFile);
  if (raw.trim().length === 0) return [];

  const result: NegotiationSession[] = [];
  for (const line of raw.split("\n").map((l) => l.trim()).filter((l) => l.length > 0)) {
    try {
      result.push(NegotiationSessionSchema.parse(JSON.parse(line)));
    } catch {
      // skip malformed lines
    }
  }
  return result;
}

async function rewriteSessions(taskId: string, sessions: NegotiationSession[]): Promise<void> {
  const sessionsDir = path.join(path.dirname(resolveTaskPath(taskId)), "data");
  await mkdir(sessionsDir, { recursive: true });
  const sessionsFile = path.join(sessionsDir, "sessions.jsonl");
  if (sessions.length === 0) {
    await writeFile(sessionsFile, "", "utf8");
    return;
  }
  await writeFile(sessionsFile, sessions.map((s) => JSON.stringify(s)).join("\n") + "\n", "utf8");
}

async function readRepairQueue(): Promise<SyncRepairJob[]> {
  const raw = await safeReadText(SYNC_REPAIR_QUEUE_FILE);
  if (raw.trim().length === 0) return [];

  const jobs: SyncRepairJob[] = [];
  for (const line of raw.split("\n").map((l) => l.trim()).filter((l) => l.length > 0)) {
    const parsed: unknown = JSON.parse(line);
    if (isSyncRepairJob(parsed)) jobs.push(parsed);
  }
  return jobs;
}

async function rewriteRepairQueue(jobs: SyncRepairJob[]): Promise<void> {
  if (jobs.length === 0) {
    await writeFile(SYNC_REPAIR_QUEUE_FILE, "", "utf8");
    return;
  }
  await writeFile(SYNC_REPAIR_QUEUE_FILE, `${jobs.map((j) => JSON.stringify(j)).join("\n")}\n`, "utf8");
}

async function cleanupFilesByAge(dirPath: string, namePattern: RegExp, cutoffMs: number): Promise<number> {
  const entries = await safeReadDir(dirPath);
  let deleted = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !namePattern.test(entry.name)) continue;
    const date = entry.name.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
    if (!date) continue;
    const fileMs = Date.parse(`${date}T00:00:00.000Z`);
    if (!Number.isNaN(fileMs) && fileMs < cutoffMs) {
      await unlink(path.join(dirPath, entry.name));
      deleted += 1;
    }
  }
  return deleted;
}

async function safeReadDir(dirPath: string): Promise<import("node:fs").Dirent[]> {
  try {
    return await readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function safeReadText(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function isSyncRepairJob(input: unknown): input is SyncRepairJob {
  if (typeof input !== "object" || input === null) return false;
  const maybe = input as Record<string, unknown>;
  return (
    typeof maybe.taskId === "string" && maybe.taskId.length > 0 &&
    typeof maybe.reason === "string" && maybe.reason.length > 0 &&
    typeof maybe.createdAt === "string" && maybe.createdAt.length > 0
  );
}

function buildIdempotencyKey(envelope: HandshakeInboundEnvelope): string {
  return `${envelope.message_id}::${envelope.sender_agent_id}::${envelope.protocol_version}`;
}

function normalizeErrorReason(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "E_DEP_UNAVAILABLE";
}

function stableStringify(obj: unknown): string {
  return JSON.stringify(obj, (_, v: unknown) => {
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        sorted[k] = (v as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return v;
  });
}

function toTaskFolderName(taskId: string): string {
  return `task_${taskId.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}

function parseSimpleYamlObject(yamlText: string): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const line of yamlText.split("\n").map((l) => l.trim())) {
    if (line.length === 0 || line.startsWith("#")) continue;
    const sep = line.indexOf(":");
    if (sep === -1) throw new Error(`E_YAML_PARSE: invalid line "${line}"`);
    const key = line.slice(0, sep).trim();
    const valueText = line.slice(sep + 1).trim();
    raw[key] = parseYamlScalarOrArray(valueText);
  }
  return raw;
}

function parseYamlScalarOrArray(valueText: string): unknown {
  if (valueText === "null") return null;
  if (valueText === "true") return true;
  if (valueText === "false") return false;
  if (valueText.startsWith("[") && valueText.endsWith("]")) {
    const inner = valueText.slice(1, -1).trim();
    if (inner.length === 0) return [];
    return inner.split(",").map((p) => stripYamlQuotes(p.trim()));
  }
  if (/^-?\d+$/.test(valueText)) return Number(valueText);
  return stripYamlQuotes(valueText);
}

function stripYamlQuotes(v: string): string {
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

function serializeSimpleYamlLines(frontmatter: TaskFrontmatter): string[] {
  return [
    `task_id: ${quoteYaml(frontmatter.task_id)}`,
    `status: ${quoteYaml(frontmatter.status)}`,
    `interaction_type: ${quoteYaml(frontmatter.interaction_type)}`,
    `current_partner_id: ${frontmatter.current_partner_id === null ? "null" : quoteYaml(frontmatter.current_partner_id)}`,
    `entered_status_at: ${quoteYaml(frontmatter.entered_status_at)}`,
    `created_at: ${quoteYaml(frontmatter.created_at)}`,
    `updated_at: ${quoteYaml(frontmatter.updated_at)}`,
    `version: ${frontmatter.version}`,
    `pending_sync: ${frontmatter.pending_sync ? "true" : "false"}`,
    `hidden: ${frontmatter.hidden ? "true" : "false"}`,
  ];
}

function quoteYaml(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}
