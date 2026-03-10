/**
 * Cosoul.AI — Drizzle ORM 数据库表定义（10 张核心表）
 *
 * 表一览：
 *  1. users           — 用户账号
 *  2. personas        — AI 分身（一用户多分身）
 *  3. persona_profiles — 分身偏好档案（User.md 结构化派生）
 *  4. tasks           — 任务（含 FSM 状态机）
 *  5. task_summaries  — 任务摘要（可跨任务复用）
 *  6. task_vectors    — Embedding 向量索引（pgvector）
 *  7. contacts        — 联系人（分身级别好友关系）
 *  8. handshake_logs  — 握手日志
 *  9. chat_messages   — 聊天消息（四种模式）
 * 10. idempotency_keys — 幂等控制（TTL 7 天）
 * 11. memory_summaries — 记忆摘要（参与 RAG）
 */

import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  boolean,
  integer,
  index,
  uniqueIndex,
  customType,
} from "drizzle-orm/pg-core";

// ─── pgvector 自定义类型 ───────────────────────────────────────────
// Drizzle 尚未内置 vector 类型，用 customType 桥接 pgvector
const vector = customType<{
  data: number[];
  driverParam: string;
  config: { dimensions: number };
}>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 1024})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: unknown): number[] {
    if (typeof value === "string") {
      return value
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map(Number);
    }
    return value as number[];
  },
});

// ─── 1. users ─────────────────────────────────────────────────────
export const users = pgTable("users", {
  userId: uuid("user_id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 100 }),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── 2. personas ──────────────────────────────────────────────────
export const personas = pgTable(
  "personas",
  {
    personaId: uuid("persona_id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    avatar: text("avatar"),
    bio: text("bio"),
    settings: jsonb("settings").default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_personas_user_id").on(table.userId),
  ]
);

// ─── 3. persona_profiles ─────────────────────────────────────────
export const personaProfiles = pgTable("persona_profiles", {
  personaId: uuid("persona_id")
    .primaryKey()
    .references(() => personas.personaId, { onDelete: "cascade" }),
  profileText: text("profile_text"), // User.md 全文
  preferences: jsonb("preferences").default({}), // 结构化偏好
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── 4. tasks ─────────────────────────────────────────────────────
export const tasks = pgTable(
  "tasks",
  {
    taskId: uuid("task_id").primaryKey().defaultRandom(),
    personaId: uuid("persona_id")
      .notNull()
      .references(() => personas.personaId, { onDelete: "cascade" }),
    status: varchar("status", { length: 30 }).notNull().default("Drafting"),
    interactionType: varchar("interaction_type", { length: 20 })
      .notNull()
      .default("any"), // online / offline / any
    currentPartnerId: uuid("current_partner_id"),
    rawDescription: text("raw_description"),
    targetActivity: text("target_activity"),
    targetVibe: text("target_vibe"),
    detailedPlan: text("detailed_plan"),
    enteredStatusAt: timestamp("entered_status_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    version: integer("version").notNull().default(1), // 乐观锁
    pendingSync: boolean("pending_sync").notNull().default(false),
    hidden: boolean("hidden").notNull().default(false),
  },
  (table) => [
    index("idx_tasks_persona_status").on(table.personaId, table.status),
  ]
);

// ─── 5. task_summaries ────────────────────────────────────────────
export const taskSummaries = pgTable("task_summaries", {
  taskId: uuid("task_id")
    .primaryKey()
    .references(() => tasks.taskId, { onDelete: "cascade" }),
  summaryText: text("summary_text"),
  tags: jsonb("tags").default([]), // 标签数组，用于跨任务复用查询
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── 6. task_vectors ──────────────────────────────────────────────
// pgvector HNSW 索引在迁移 SQL 中手动创建（Drizzle 不直接支持 HNSW）
export const taskVectors = pgTable(
  "task_vectors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.taskId, { onDelete: "cascade" }),
    field: varchar("field", { length: 30 }).notNull(), // activity / vibe / raw / summary
    embedding: vector("embedding", { dimensions: 1024 }).notNull(),
    model: varchar("model", { length: 100 }).default("text-embedding-v4"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_task_vectors_task_field").on(table.taskId, table.field),
  ]
);

// ─── 7. contacts ──────────────────────────────────────────────────
export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personaId: uuid("persona_id")
      .notNull()
      .references(() => personas.personaId, { onDelete: "cascade" }),
    friendPersonaId: uuid("friend_persona_id")
      .notNull()
      .references(() => personas.personaId, { onDelete: "cascade" }),
    status: varchar("status", { length: 20 }).notNull().default("pending"), // pending / accepted / blocked
    aiNote: text("ai_note"), // AI 生成的好友备注（仅自己可见）
    sourceTaskId: uuid("source_task_id").references(() => tasks.taskId),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_contacts_persona").on(table.personaId),
    index("idx_contacts_friend").on(table.friendPersonaId),
  ]
);

// ─── 8. handshake_logs ────────────────────────────────────────────
export const handshakeLogs = pgTable(
  "handshake_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.taskId, { onDelete: "cascade" }),
    direction: varchar("direction", { length: 10 }).notNull(), // inbound / outbound
    envelope: jsonb("envelope").notNull(), // 完整握手报文
    timestamp: timestamp("timestamp", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_handshake_task").on(table.taskId),
  ]
);

// ─── 9. chat_messages ─────────────────────────────────────────────
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").references(() => tasks.taskId, {
      onDelete: "set null",
    }),
    personaId: uuid("persona_id")
      .notNull()
      .references(() => personas.personaId, { onDelete: "cascade" }),
    senderType: varchar("sender_type", { length: 20 }).notNull(), // human / agent
    senderId: uuid("sender_id").notNull(), // persona_id of sender
    content: text("content").notNull(),
    metadata: jsonb("metadata").default({}), // 交互模式、附件等
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_chat_persona").on(table.personaId),
    index("idx_chat_task").on(table.taskId),
  ]
);

// ─── 10. idempotency_keys ─────────────────────────────────────────
// TTL 7 天：通过 PostgreSQL pg_cron 或应用层定期清理 created_at < NOW() - 7 days
export const idempotencyKeys = pgTable("idempotency_keys", {
  key: varchar("key", { length: 255 }).primaryKey(),
  response: jsonb("response"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── 11. memory_summaries ─────────────────────────────────────────
export const memorySummaries = pgTable(
  "memory_summaries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personaId: uuid("persona_id")
      .notNull()
      .references(() => personas.personaId, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.taskId, {
      onDelete: "set null",
    }),
    summaryText: text("summary_text").notNull(),
    sourceLogId: varchar("source_log_id", { length: 255 }),
    turnCount: integer("turn_count"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_memory_persona").on(table.personaId),
  ]
);
