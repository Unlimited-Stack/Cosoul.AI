import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@repo/core/db/client";
import { handshakeLogs, idempotencyKeys, tasks } from "@repo/core/db/schema";
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
} from "./schema";
import {
  NegotiationSessionSchema,
  parseHandshakeInboundEnvelope,
  parseHandshakeOutboundEnvelope,
  parseTaskDocument
} from "./schema";

/**
 * 存储/持久化防腐层（Anti-Corruption Layer）。
 *
 * 本模块是任务系统所有"落盘写入"的唯一入口。
 * 目标：把数据库/文件系统细节与上层业务逻辑隔离。
 *
 * 设计约定：
 * - PostgreSQL（tasks 表）：任务数据真相源（Single Source of Truth）
 * - PostgreSQL（handshake_logs 表）：握手日志
 * - PostgreSQL（idempotency_keys 表）：握手幂等键（TTL 7 天）
 * - `.data/task_agents/<task_dir>/data/raw_chats/`：对话原文快照（按天文件）
 * - `.data/task_agents/<task_dir>/data/agent_chat/scratchpad.md`：本地研判草稿
 * - `.data/sync_repair_queue.jsonl`：派生层同步失败修复队列（JSONL）
 * - `.data/raw_chats_summary/`：全局摘要（按天覆盖写）
 * - `.data/logs/`：系统/审计日志（JSONL）
 *
 * 注意：
 * - 状态迁移采用"两阶段写"：先在 DB 置 `pending_sync=true`，同步完成后清标记。
 * - 派生层（向量索引/摘要）同步失败时不回滚 tasks 表，而是入修复队列供后台重试。
 */

/**
 * 派生层同步失败后的修复队列条目。
 * 语义：tasks 表已写入成功，但向量索引/RAG 等派生层未同步完成，需要后台重试。
 */
export interface SyncRepairJob {
  taskId: string;
  reason: string;
  createdAt: string;
}

/**
 * 保存任务时的可选参数。
 * - `expectedVersion`：乐观锁版本号（用于避免并发覆盖）。
 * - `personaId`：分身 ID（新建任务时必填，更新时可省略）。
 */
export interface SaveTaskOptions {
  expectedVersion?: number;
  personaId?: string;
}

/**
 * 状态迁移结果（方便上层写日志/打点/调试）。
 */
export interface TransitionResult {
  previousStatus: TaskStatus;
  nextStatus: TaskStatus;
  version: number;
  updatedAt: string;
}

/**
 * 状态迁移的可选元信息。
 * - `expectedVersion`：乐观锁；不匹配时抛 `E_VERSION_CONFLICT`
 * - `traceId/messageId`：用于可观测性关联
 * - `errorCode`：记录业务/系统错误码（可空，用于审计日志）
 */
export interface TransitionOptions {
  expectedVersion?: number;
  traceId?: string;
  messageId?: string;
  errorCode?: ErrorCode | null;
}

/** 扫描到的任务与其合成文件路径（用于兼容依赖 taskPath 的文件操作）。 */
export interface TaskRecord {
  taskPath: string;
  task: TaskDocument;
}

/**
 * 幂等记录（来自 idempotency_keys 表）。
 */
export interface IdempotencyRecord {
  key: string;
  taskId: string;
  createdAt: string;
  response: HandshakeOutboundEnvelope;
}

/** Agent 间协议报文日志行格式（入站/出站都写）。 */
export interface AgentChatLogEntry {
  direction: "inbound" | "outbound";
  timestamp: string;
  payload: unknown;
}

export interface HandshakeExchangeSnapshot {
  /** 最近一次入站握手消息（若不存在则为 null）。 */
  inbound: HandshakeInboundEnvelope | null;
  /** 最近一次出站握手响应（若不存在则为 null）。 */
  outbound: HandshakeOutboundEnvelope | null;
  /** 读取来源描述（DB 模式下为 null）。 */
  sourceFilePath: string | null;
}

/**
 * 系统事件的结构化日志（JSON 行写入 `.data/logs/YYYY-MM-DD-sys.md`）。
 */
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

/** 保留策略清理的统计结果。 */
export interface RetentionCleanupResult {
  deletedRawChats: number;
  deletedAgentChatJsonl: number;
}

/** `.data/` 根目录（文件层根）。 */
const DATA_ROOT = path.resolve(process.cwd(), ".data");
/** `.data/task_agents/`：每个任务对应子目录（agent_chat、raw_chats 等文件存放处）。 */
const TASK_AGENTS_ROOT = path.join(DATA_ROOT, "task_agents");
/** `.data/sync_repair_queue.jsonl`：派生层修复队列（JSONL）。 */
const SYNC_REPAIR_QUEUE_FILE = path.join(DATA_ROOT, "sync_repair_queue.jsonl");
/** 幂等窗口：超过该时间的 idempotency_keys 记录会被清理（7 天）。 */
const IDEMPOTENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** `.data/User.md`：本机用户画像/偏好（仅本地研判使用）。 */
const USER_PROFILE_FILE = path.join(DATA_ROOT, "User.md");
/** `.data/raw_chats_summary/`：全局摘要目录（按天覆盖写）。 */
const GLOBAL_RAW_CHAT_SUMMARY_DIR = path.join(DATA_ROOT, "raw_chats_summary");
/** `.data/logs/`：系统/审计日志目录（JSON 行）。 */
const GLOBAL_LOG_DIR = path.join(DATA_ROOT, "logs");
/** raw chat 快照默认保留天数。 */
const RAW_CHATS_RETENTION_DAYS = 90;
/** agent chat JSONL 默认保留天数。 */
const AGENT_CHAT_RETENTION_DAYS = 180;

/** FSM 允许迁移表。 */
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

// ─── 内部辅助：TaskDocument ↔ DB 行转换 ────────────────────────────────────

type TaskDbInsert = typeof tasks.$inferInsert;
type TaskDbSelect = typeof tasks.$inferSelect;

/**
 * 将 TaskDocument 映射为 tasks 表的可更新字段（不含 taskId / personaId / createdAt）。
 */
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

/**
 * 将 tasks 表行映射为 TaskDocument（不经过 Zod 校验，信任 DB 数据）。
 * 注意：DB 中字段可为 null（Drafting 阶段），映射时补空字符串。
 */
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

// ─── 公开 API ────────────────────────────────────────────────────────────────

/**
 * 保存/覆盖写入任务到 PostgreSQL tasks 表（真相源）。
 *
 * - 若 task_id 已存在：UPDATE（可选乐观锁校验）。
 * - 若 task_id 不存在：INSERT（必须提供 `options.personaId`）。
 *
 * 写入后调用 syncDerivedLayers() 以触发向量索引等派生层同步（当前为占位实现）。
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
    // Derived layer sync failures do not block the primary write.
  }
}

/**
 * 仅更新状态的薄封装（推荐生产路径使用 `transitionTaskStatus()`）。
 */
export async function updateTaskStatus(taskId: string, nextStatus: TaskStatus): Promise<void> {
  await transitionTaskStatus(taskId, nextStatus);
}

/**
 * 设置/取消任务的软删除标记（hidden）。
 */
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
 * L0 结构化"硬过滤"候选查询。
 *
 * 过滤规则：
 * - 只考虑 `status=Searching` 的任务
 * - `target_activity` / `target_vibe` 必须非空（L0 门控条件）
 * - `interaction_type` 必须与源任务兼容
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
    if (!row.targetActivity || !row.targetVibe) continue;

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

/**
 * 追加一条派生层修复任务到 `sync_repair_queue.jsonl`。
 */
export async function enqueueSyncRepair(job: SyncRepairJob): Promise<void> {
  const line = JSON.stringify(job);
  const existing = await safeReadText(SYNC_REPAIR_QUEUE_FILE);
  const nextContent = existing.length === 0 ? `${line}\n` : `${existing.trimEnd()}\n${line}\n`;
  await writeFile(SYNC_REPAIR_QUEUE_FILE, nextContent, "utf8");
}

/**
 * 按 `task_id` 从 PostgreSQL tasks 表读取并映射为 TaskDocument。
 */
export async function readTaskDocument(taskId: string): Promise<TaskDocument> {
  const rows = await db.select().from(tasks).where(eq(tasks.taskId, taskId));
  if (rows.length === 0) {
    throw new Error(`E_TASK_NOT_FOUND: ${taskId}`);
  }
  return dbRowToTaskDocument(rows[0]);
}

/**
 * 列出指定状态集合的任务（给 dispatcher/task_loop 做轮询用）。
 */
export async function listTasksByStatuses(statuses: TaskStatus[]): Promise<TaskDocument[]> {
  if (statuses.length === 0) return [];
  const rows = await db
    .select()
    .from(tasks)
    .where(inArray(tasks.status, statuses));
  return rows.map(dbRowToTaskDocument);
}

/** 列出所有任务记录（供 runtime/UI 展示用）。 */
export async function listAllTasks(): Promise<TaskRecord[]> {
  return listAllTaskRecords();
}

/**
 * 获取某个任务的文件目录路径（用于排障；实际数据已在 PostgreSQL 中）。
 * 若任务不存在于 DB 会抛 `E_TASK_NOT_FOUND`。
 */
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
 *
 * - Step 1：UPDATE tasks SET status=next, pending_sync=true, version+=1
 * - Step 2：syncDerivedLayers（向量索引等，当前为占位）
 * - Step 3：UPDATE tasks SET pending_sync=false
 * - 若 Step 2 失败：不回滚 Step 1，入修复队列 + 写审计日志
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

  // Step 1：写入新状态并标记 pending_sync=true
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
    // Step 2：同步派生层（向量索引等，当前为占位实现）
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

    // Step 3：清除 pending_sync（表示"派生层已完全一致"）
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

/**
 * 重试修复队列中的任务（将 pending_sync 置为 false）。
 */
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

/**
 * 查询幂等记录（用于握手重放/去重）。
 * 读取 `idempotency_keys` 表，并自动清理超过 7 天的记录。
 */
export async function findIdempotencyRecord(
  envelope: HandshakeInboundEnvelope
): Promise<IdempotencyRecord | null> {
  const key = buildIdempotencyKey(envelope);

  // 清理超过 7 天的记录
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

/**
 * 写入幂等记录到 `idempotency_keys` 表。
 *
 * - 同一幂等键重复写入且 response 一致：视为幂等成功，直接返回。
 * - 同一幂等键重复写入但 response 不一致：抛 `E_IDEMPOTENCY_CONFLICT`。
 */
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
    // PostgreSQL JSONB 按 key 字母序存储，JS 对象保留插入顺序。
    // 两侧都经过 stableStringify 规范化后再比较，避免 key 顺序差异导致误判。
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

/**
 * 将入站/出站协议报文写入 `handshake_logs` 表。
 *
 * 字段映射：
 * - `entry.direction`  → `handshake_logs.direction`（inbound / outbound）
 * - `entry.payload`    → `handshake_logs.envelope`（完整握手报文，JSONB）
 * - `entry.timestamp`  → `handshake_logs.timestamp`
 */
export async function appendAgentChatLog(taskId: string, entry: AgentChatLogEntry): Promise<void> {
  await db.insert(handshakeLogs).values({
    taskId,
    direction: entry.direction,
    envelope: entry.payload as Record<string, unknown>,
    timestamp: new Date(entry.timestamp)
  });
}

/**
 * 从 `handshake_logs` 表读取最近一次握手收发快照。
 */
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
      try {
        outbound = parseHandshakeOutboundEnvelope(row.envelope);
      } catch {
        // ignore malformed envelope
      }
    }
    if (row.direction === "inbound" && inbound === null) {
      try {
        inbound = parseHandshakeInboundEnvelope(row.envelope);
      } catch {
        // ignore malformed envelope
      }
    }
    if (inbound && outbound) break;
  }

  return { inbound, outbound, sourceFilePath: null };
}

/**
 * 写入本地 scratchpad（只用于本机研判，严禁通过网络发送）。
 */
export async function appendScratchpadNote(taskId: string, note: string, timestamp: string): Promise<void> {
  const taskDir = path.dirname(resolveTaskPath(taskId));
  const scratchpadPath = path.join(taskDir, "data", "agent_chat", "scratchpad.md");
  const existing = await safeReadText(scratchpadPath);
  const block = `\n## ${timestamp}\n${note}\n`;
  const next = existing.length === 0 ? `# scratchpad\n${block}` : `${existing.trimEnd()}\n${block}`;
  await mkdir(path.dirname(scratchpadPath), { recursive: true });
  await writeFile(scratchpadPath, next, "utf8");
}

/**
 * 读取 `.data/User.md`（用于 L2 本地研判的用户画像/偏好）。
 */
export async function readUserProfile(): Promise<string> {
  return safeReadText(USER_PROFILE_FILE);
}

/**
 * 将对话原文快照归档到 `raw_chats/`（默认保留 90 天）。
 */
export async function appendRawChat(taskId: string, content: string, timestamp: string): Promise<string> {
  const taskDir = path.dirname(resolveTaskPath(taskId));
  const rawChatDir = path.join(taskDir, "data", "raw_chats");
  await mkdir(rawChatDir, { recursive: true });
  const day = timestamp.slice(0, 10);
  const filePath = path.join(rawChatDir, `${day}-chat.md`);
  await writeFile(filePath, content, "utf8");
  return filePath;
}

/**
 * 将对话总结写入 `.data/raw_chats_summary/`（按天覆盖写）。
 */
export async function appendRawChatSummary(content: string, timestamp: string): Promise<string> {
  await mkdir(GLOBAL_RAW_CHAT_SUMMARY_DIR, { recursive: true });
  const day = timestamp.slice(0, 10);
  const filePath = path.join(GLOBAL_RAW_CHAT_SUMMARY_DIR, `${day}-summary.md`);
  await writeFile(filePath, content, "utf8");
  return filePath;
}

/**
 * 将结构化系统事件以 JSON 行写入 `.data/logs/YYYY-MM-DD-sys.md`。
 */
export async function appendObservabilityLog(event: ObservabilityLogEvent): Promise<void> {
  await mkdir(GLOBAL_LOG_DIR, { recursive: true });
  const day = event.timestamp.slice(0, 10);
  const filePath = path.join(GLOBAL_LOG_DIR, `${day}-sys.md`);
  const existing = await safeReadText(filePath);
  const line = JSON.stringify(event);
  const next = existing.length === 0 ? `${line}\n` : `${existing.trimEnd()}\n${line}\n`;
  await writeFile(filePath, next, "utf8");
}

/**
 * 保留策略清理：
 * - `raw_chats/*-chat.md`：默认保留 90 天
 * - `agent_chat/*-agentchat.jsonl`：默认保留 180 天
 */
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
    details: {
      deleted_raw_chats: deletedRawChats,
      deleted_agent_chat_jsonl: deletedAgentChatJsonl
    }
  });

  return { deletedRawChats, deletedAgentChatJsonl };
}

/**
 * 全量重建派生索引（幂等占位实现）。
 * 实际向量重建由独立的 embedding pipeline 负责；此处仅统计任务数量并写审计日志。
 */
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

/**
 * `Timeout|Failed -> Searching` 的显式恢复入口。
 */
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

// ─── Negotiation Session Storage（无对应 DB 表，保留 JSONL 文件存储）─────────

/**
 * 创建或更新谈判会话（存储于 `task_dir/data/sessions.jsonl`）。
 */
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

/**
 * 按 remote_agent_id 查找进行中的谈判会话。
 */
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

/**
 * 列出某任务的所有谈判会话。
 */
export async function listNegotiationSessions(taskId: string): Promise<NegotiationSession[]> {
  return readAllSessions(taskId);
}

/**
 * 从所有会话生成 ListeningReport。
 */
export async function generateListeningReport(taskId: string): Promise<ListeningReport> {
  const sessions = await readAllSessions(taskId);
  const accepted = sessions.filter((s) => s.status === "Accepted").length;
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
    accepted,
    rejected,
    timed_out: timedOut,
    sessions: sorted,
    generated_at: new Date().toISOString()
  };
}

/**
 * 将超时的 Negotiating 会话标记为 Timeout。
 */
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

// ─── 公开序列化工具（供测试/调试使用）─────────────────────────────────────

/**
 * 解析 `task.md` 文本为结构化 `TaskDocument`（主要供测试使用）。
 */
export function parseTaskMDContent(content: string): TaskDocument {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!frontmatterMatch) {
    throw new Error("E_TASK_MD_INVALID: missing YAML frontmatter");
  }

  const yamlText = frontmatterMatch[1];
  const bodyText = frontmatterMatch[2].trim();
  const frontmatter = parseSimpleYamlObject(yamlText);
  const body = parseTaskBody(bodyText);

  return parseTaskDocument({ frontmatter, body });
}

/**
 * 将 `TaskDocument` 序列化为 `task.md` 格式文本（主要供测试使用）。
 */
export function serializeTaskMDContent(task: TaskDocument): string {
  const frontmatterYaml = serializeSimpleYamlObject(task.frontmatter);
  const detailedSection = task.body.detailedPlan
    ? `\n\n### 需求详情\n${task.body.detailedPlan}`
    : "\n\n### 需求详情\n（待 AI 生成）";
  return `---\n${frontmatterYaml}\n---\n\n### 原始描述\n${task.body.rawDescription}\n\n### 靶向映射\n<Target_Activity>${task.body.targetActivity}</Target_Activity>\n<Target_Vibe>${task.body.targetVibe}</Target_Vibe>${detailedSection}\n`;
}

// ─── 内部工具函数 ───────────────────────────────────────────────────────────

/** 校验状态迁移是否合法。 */
function assertTransitionAllowed(current: TaskStatus, next: TaskStatus): void {
  const allowed = ALLOWED_STATUS_TRANSITIONS[current];
  if (!allowed.includes(next)) {
    throw new Error(`E_INVALID_TRANSITION: ${current} -> ${next} is not allowed`);
  }
}

/**
 * 根据 task_id 计算确定性本地文件路径（用于 agent_chat/raw_chats/sessions 等文件操作）。
 * PostgreSQL 是任务数据真相源，该路径仅用于周边文件存储。
 */
function resolveTaskPath(taskId: string): string {
  return path.join(TASK_AGENTS_ROOT, toTaskFolderName(taskId), "task.md");
}

/**
 * 从 PostgreSQL 查询所有任务，映射为 TaskRecord（taskPath 为合成路径）。
 */
async function listAllTaskRecords(): Promise<TaskRecord[]> {
  const rows = await db.select().from(tasks);
  return rows.map((row) => ({
    taskPath: resolveTaskPath(row.taskId),
    task: dbRowToTaskDocument(row)
  }));
}

/** 派生层同步占位实现（向量索引/摘要生成由独立 pipeline 负责）。 */
async function syncDerivedLayers(_task: TaskDocument): Promise<void> {
  // 当前 PostgreSQL 已是任务数据真相源，此处为派生层（向量/摘要）同步占位。
  // 实际向量化由外部 embedding pipeline 在写入 task_vectors 表后完成。
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
      // Skip malformed session lines
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
    typeof maybe.taskId === "string" &&
    maybe.taskId.length > 0 &&
    typeof maybe.reason === "string" &&
    maybe.reason.length > 0 &&
    typeof maybe.createdAt === "string" &&
    maybe.createdAt.length > 0
  );
}

function isAgentChatLogEntry(input: unknown): input is AgentChatLogEntry {
  if (typeof input !== "object" || input === null) return false;
  const maybe = input as Record<string, unknown>;
  return (
    (maybe.direction === "inbound" || maybe.direction === "outbound") &&
    typeof maybe.timestamp === "string" &&
    maybe.timestamp.length > 0 &&
    "payload" in maybe
  );
}

/** 构建幂等键：`message_id::sender_agent_id::protocol_version`。 */
function buildIdempotencyKey(envelope: HandshakeInboundEnvelope): string {
  return `${envelope.message_id}::${envelope.sender_agent_id}::${envelope.protocol_version}`;
}

function normalizeErrorReason(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "E_DEP_UNAVAILABLE";
}

/**
 * JSON 序列化时按 key 字母序递归排序（stable stringify）。
 * 用于比较两个来源不同的 JSON 对象（如 JS 对象 vs PostgreSQL JSONB 检索结果），
 * 消除 key 顺序不同导致的误判。
 */
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

// ─── task.md 序列化/解析辅助（仅供 parseTaskMDContent/serializeTaskMDContent 使用）─

function parseTaskBody(bodyText: string): {
  rawDescription: string;
  targetActivity: string;
  targetVibe: string;
  detailedPlan: string;
} {
  const rawSection = bodyText.match(/### 原始描述\s*([\s\S]*?)\n### 靶向映射/);
  const activityMatch = bodyText.match(/<Target_Activity>([\s\S]*?)<\/Target_Activity>/);
  const vibeMatch = bodyText.match(/<Target_Vibe>([\s\S]*?)<\/Target_Vibe>/);

  if (!rawSection || !activityMatch || !vibeMatch) {
    throw new Error("E_TASK_BODY_INVALID: required sections are missing");
  }

  const rawDescription = rawSection[1].trim();
  const targetActivity = activityMatch[1].trim();
  const targetVibe = vibeMatch[1].trim();
  const detailedMatch = bodyText.match(/### 需求详情\s*([\s\S]*)$/);
  const detailedPlan = detailedMatch ? detailedMatch[1].trim() : "";
  const cleanPlan = detailedPlan === "（待 AI 生成）" ? "" : detailedPlan;

  return { rawDescription, targetActivity, targetVibe, detailedPlan: cleanPlan };
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

function serializeSimpleYamlObject(frontmatter: TaskFrontmatter): string {
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
    `hidden: ${frontmatter.hidden ? "true" : "false"}`
  ].join("\n");
}

function quoteYaml(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

