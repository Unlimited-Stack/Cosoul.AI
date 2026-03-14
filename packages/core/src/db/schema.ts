/**
 * Cosoul.AI — Drizzle ORM 数据库表定义（10 张核心表）
 *
 * 表一览：
 *  1. users              — 用户账号
 *  2. refresh_tokens     — Refresh Token 管理（设备级别）
 *  3. password_reset_codes — 找回密码验证码
 *  4. personas           — AI 分身（一用户多分身，含 profile_text / preferences）
 *  5. tasks              — 任务（含 FSM 状态机）
 *  6. task_vectors       — Embedding 向量索引（pgvector）
 *  7. contacts           — 联系人（分身级别好友关系）
 *  8. handshake_logs     — 握手日志
 *  9. chat_messages      — 聊天消息（intake / revise / agent 多轮对话）
 * 10. idempotency_keys   — 幂等控制（TTL 7 天）
 */

import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  date,
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
export const users = pgTable(
  "users",
  {
    userId: uuid("user_id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull().default(""),
    phone: varchar("phone", { length: 20 }).unique(),
    name: varchar("name", { length: 100 }),
    avatarUrl: text("avatar_url"),
    gender: varchar("gender", { length: 10 }),            // male / female / other / secret
    birthday: date("birthday"),                            // 生日
    bio: text("bio"),                                      // 个人简介（≤200 字）
    interests: jsonb("interests").default([]),              // 兴趣标签 ["摄影","数码","运动"]
    school: varchar("school", { length: 100 }),            // 院校名称
    location: varchar("location", { length: 100 }),        // 常住地
    subscriptionTier: varchar("subscription_tier", { length: 20 }).notNull().default("free"),
    subscriptionExpiresAt: timestamp("subscription_expires_at", { withTimezone: true }),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_users_phone").on(table.phone),
    index("idx_users_status").on(table.status),
    index("idx_users_subscription").on(table.subscriptionTier),
  ]
);


// ─── 2. refresh_tokens ───────────────────────────────────────────
// 每次刷新都 Rotation：旧 token 吊销 + 签发新 token
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 255 }).notNull().unique(), // SHA-256 哈希
    deviceInfo: varchar("device_info", { length: 255 }),                   // 设备标识
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revoked: boolean("revoked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_refresh_tokens_user").on(table.userId),
  ]
);

// ─── 3. password_reset_codes ─────────────────────────────────────
// 6 位数字验证码，15 分钟过期，限频 60s/次 + 5次/24h
export const passwordResetCodes = pgTable(
  "password_reset_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    code: varchar("code", { length: 10 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    used: boolean("used").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_reset_codes_user").on(table.userId),
  ]
);

// ─── 4. personas ──────────────────────────────────────────────────
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
    profileText: text("profile_text"), // Soul.md 全文
    preferences: jsonb("preferences").default({}), // 结构化偏好
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

// ─── 3. tasks ─────────────────────────────────────────────────────
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

// ─── 4. task_vectors ──────────────────────────────────────────────
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

// ─── 5. contacts ──────────────────────────────────────────────────
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

// ─── 6. handshake_logs ────────────────────────────────────────────
// direction: inbound / outbound（握手报文）、judge_request / judge_response（Judge Model 裁决）
export const handshakeLogs = pgTable(
  "handshake_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.taskId, { onDelete: "cascade" }),
    direction: varchar("direction", { length: 20 }).notNull(), // inbound / outbound / judge_request / judge_response
    envelope: jsonb("envelope").notNull(), // 握手报文 或 L2 LLM 对话内容
    round: integer("round"), // 协商轮次（从 envelope.round 提取，便于按轮次查询历史）
    visibleToUser: boolean("visible_to_user").notNull().default(false), // 是否节选给用户展示
    userSummary: text("user_summary"), // 面向用户的可读摘要（L2 研判结论的自然语言版）
    timestamp: timestamp("timestamp", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_handshake_task").on(table.taskId),
    index("idx_handshake_task_round").on(table.taskId, table.round),
  ]
);

// ─── 7. chat_messages ─────────────────────────────────────────────
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
    compressSummary: text("compress_summary"), // 压缩后的对话历史摘要（上下文过长时由 LLM 生成）
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

// ─── 8. idempotency_keys ─────────────────────────────────────────
// TTL 7 天：通过 PostgreSQL pg_cron 或应用层定期清理 created_at < NOW() - 7 days
export const idempotencyKeys = pgTable("idempotency_keys", {
  key: varchar("key", { length: 255 }).primaryKey(),
  response: jsonb("response"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

