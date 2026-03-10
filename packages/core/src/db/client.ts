/**
 * PostgreSQL 连接池 + Drizzle ORM 初始化
 *
 * 使用方式:
 *   import { db, pool } from "@repo/core/db/client";
 *   const result = await db.select().from(users);
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// 从环境变量读取连接串
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://cosoul:cosoul@db:5432/cosoul_agent";

/** 原始 pg 连接池（需要时可直接用于 raw SQL） */
export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 20, // 最大连接数
  idleTimeoutMillis: 30_000, // 空闲 30s 后回收
  connectionTimeoutMillis: 5_000, // 连接超时 5s
});

/** Drizzle ORM 实例（带完整 schema 类型推导） */
export const db = drizzle(pool, { schema });

/**
 * 初始化数据库：启用 pgvector 扩展
 * 在应用启动时调用一次即可
 */
export async function initDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("CREATE EXTENSION IF NOT EXISTS vector");
    console.log("[db] pgvector extension enabled");
  } finally {
    client.release();
  }
}

/**
 * 关闭连接池（优雅退出时调用）
 */
export async function closeDatabase(): Promise<void> {
  await pool.end();
  console.log("[db] connection pool closed");
}
