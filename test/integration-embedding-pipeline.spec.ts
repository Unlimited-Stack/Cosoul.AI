/**
 * 集成测试：Embedding Pipeline（embed + save + read）
 *
 * 验证完整链路：
 *   1. embedTaskFields() 调 DashScope API 生成向量
 *   2. saveTaskVectors() 写入 PostgreSQL task_vectors 表
 *   3. readTaskVectors() 从 DB 读回向量
 *   4. processDraftingTask() 端到端：Drafting → embed → save → Searching
 *
 * 前置条件：
 *   - PostgreSQL 数据库可达（DATABASE_URL）
 *   - DashScope API 可达（DASHSCOPE_API_KEY）
 *
 * 所有测试数据统一使用 [MIGRATE_0312] 前缀标识。
 *
 * 运行：cd packages/agent && npx vitest run test/integration-embedding-pipeline.spec.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@repo/core/db/client";
import { users, personas, tasks, taskVectors } from "@repo/core/db/schema";
import { eq, and } from "drizzle-orm";
import { embedTaskFields } from "../packages/agent/src/task-agent/embedding";
import { saveTaskVectors, readTaskVectors } from "../packages/agent/src/task-agent/retrieval";
import { saveTaskMD, readTaskDocument } from "../packages/agent/src/task-agent/storage";
import { processDraftingTask } from "../packages/agent/src/task-agent/dispatcher";
import type { TaskDocument } from "../packages/agent/src/task-agent/types";

// ─── 统一标识前缀 ──────────────────────────────────────────────
const TAG = "MIGRATE_0312";

const TEST_USER_ID = randomUUID();
const TEST_PERSONA_ID = randomUUID();
const TEST_TASK_ID = randomUUID();        // 用于分步测试（embed → save → read）
const TEST_TASK_DRAFT_ID = randomUUID();  // 用于端到端 processDraftingTask 测试

const SAMPLE_FIELDS = {
  targetActivity: `[${TAG}] 周末一起去爬山徒步，欣赏自然风光`,
  targetVibe: `[${TAG}] 轻松随和，喜欢户外运动的朋友`,
  rawDescription: `[${TAG}] 想找人周末一起爬山，不限性别年龄`
};

function makeTaskDocument(taskId: string, status: string = "Drafting"): TaskDocument {
  const now = new Date().toISOString();
  return {
    frontmatter: {
      task_id: taskId,
      status: status as "Drafting",
      interaction_type: "offline",
      current_partner_id: null,
      entered_status_at: now,
      created_at: now,
      updated_at: now,
      version: 1,
      pending_sync: false,
      hidden: false
    },
    body: {
      rawDescription: SAMPLE_FIELDS.rawDescription,
      targetActivity: SAMPLE_FIELDS.targetActivity,
      targetVibe: SAMPLE_FIELDS.targetVibe,
      detailedPlan: `[${TAG}] 周末爬山计划，时间灵活`
    }
  } as TaskDocument;
}

// ─── Setup / Teardown ───────────────────────────────────────────

let dbReachable = false;

beforeAll(async () => {
  try {
    // 清理可能残留的测试数据
    await db.delete(taskVectors).where(
      eq(taskVectors.taskId, TEST_TASK_ID)
    );
    await db.delete(taskVectors).where(
      eq(taskVectors.taskId, TEST_TASK_DRAFT_ID)
    );
    await db.delete(tasks).where(eq(tasks.taskId, TEST_TASK_ID));
    await db.delete(tasks).where(eq(tasks.taskId, TEST_TASK_DRAFT_ID));
    await db.delete(personas).where(eq(personas.personaId, TEST_PERSONA_ID));
    await db.delete(users).where(eq(users.userId, TEST_USER_ID));

    // 插入测试用户 + 分身
    await db.insert(users).values({
      userId: TEST_USER_ID,
      email: `${TAG}_embpipe_${Date.now()}@test.local`,
      name: `[${TAG}] Embedding Pipeline 测试用户`
    });
    await db.insert(personas).values({
      personaId: TEST_PERSONA_ID,
      userId: TEST_USER_ID,
      name: `[${TAG}] Embedding Pipeline 测试分身`
    });

    // 预创建测试任务
    await saveTaskMD(makeTaskDocument(TEST_TASK_ID), { personaId: TEST_PERSONA_ID });
    await saveTaskMD(makeTaskDocument(TEST_TASK_DRAFT_ID), { personaId: TEST_PERSONA_ID });

    dbReachable = true;
  } catch (error) {
    console.warn("DB setup failed, skipping embedding pipeline tests:", error);
  }
});

// afterAll — 注释掉以保留测试数据，方便在数据库中查看
// 搜索关键词 MIGRATE_0312 即可定位所有本次测试产生的数据
// afterAll(async () => {
//   if (!dbReachable) return;
//   await db.delete(taskVectors).where(eq(taskVectors.taskId, TEST_TASK_ID));
//   await db.delete(taskVectors).where(eq(taskVectors.taskId, TEST_TASK_DRAFT_ID));
//   await db.delete(tasks).where(eq(tasks.taskId, TEST_TASK_ID));
//   await db.delete(tasks).where(eq(tasks.taskId, TEST_TASK_DRAFT_ID));
//   await db.delete(personas).where(eq(personas.personaId, TEST_PERSONA_ID));
//   await db.delete(users).where(eq(users.userId, TEST_USER_ID));
// });

// ─── 测试用例 ────────────────────────────────────────────────────

describe("Embedding Pipeline 集成测试", () => {

  // ── 1. embedTaskFields 调 DashScope API ──────────────────────
  describe("embedTaskFields（DashScope API 调用）", () => {
    it("返回 3 个字段的向量，维度均为 1024", async () => {
      if (!dbReachable) return;

      const result = await embedTaskFields(
        TEST_TASK_ID,
        SAMPLE_FIELDS.targetActivity,
        SAMPLE_FIELDS.targetVibe,
        SAMPLE_FIELDS.rawDescription
      );

      expect(result.taskId).toBe(TEST_TASK_ID);
      expect(result.embeddings).toHaveLength(3);

      for (const emb of result.embeddings) {
        expect(["targetActivity", "targetVibe", "rawDescription"]).toContain(emb.field);
        expect(emb.vector).toBeInstanceOf(Array);
        expect(emb.dimensions).toBe(1024);
        expect(emb.vector.length).toBe(1024);
        expect(emb.vector.every((v) => Number.isFinite(v))).toBe(true);
      }

      console.log(`✓ [${TAG}] DashScope API 返回 3 × 1024 维向量`);
    }, 15_000);
  });

  // ── 2. saveTaskVectors 写入 DB ───────────────────────────────
  describe("saveTaskVectors（写入 task_vectors 表）", () => {
    it("向量写入后可通过 SQL 直接查到", async () => {
      if (!dbReachable) return;

      const result = await embedTaskFields(
        TEST_TASK_ID,
        SAMPLE_FIELDS.targetActivity,
        SAMPLE_FIELDS.targetVibe,
        SAMPLE_FIELDS.rawDescription
      );

      await saveTaskVectors(
        TEST_TASK_ID,
        result.embeddings.map((e) => ({ field: e.field, vector: e.vector }))
      );

      const rows = await db
        .select({
          taskId: taskVectors.taskId,
          field: taskVectors.field,
          embedding: taskVectors.embedding,
          model: taskVectors.model
        })
        .from(taskVectors)
        .where(eq(taskVectors.taskId, TEST_TASK_ID));

      expect(rows).toHaveLength(3);

      const fields = rows.map((r) => r.field).sort();
      expect(fields).toEqual(["rawDescription", "targetActivity", "targetVibe"]);

      for (const row of rows) {
        expect(row.taskId).toBe(TEST_TASK_ID);
        expect(row.embedding).toBeInstanceOf(Array);
        expect(row.embedding.length).toBe(1024);
        expect(row.model).toBe("text-embedding-v4");
      }

      console.log(`✓ [${TAG}] task_vectors 表中已写入 ${rows.length} 条记录（task_id=${TEST_TASK_ID}）`);
    }, 15_000);

    it("重复写入同字段执行 upsert 而非报错", async () => {
      if (!dbReachable) return;

      const result = await embedTaskFields(
        TEST_TASK_ID,
        `[${TAG}] 换一个活动：周末打篮球`,
        SAMPLE_FIELDS.targetVibe,
        SAMPLE_FIELDS.rawDescription
      );

      await saveTaskVectors(
        TEST_TASK_ID,
        result.embeddings.map((e) => ({ field: e.field, vector: e.vector }))
      );

      const rows = await db
        .select({ id: taskVectors.id })
        .from(taskVectors)
        .where(eq(taskVectors.taskId, TEST_TASK_ID));

      expect(rows).toHaveLength(3);
      console.log(`✓ [${TAG}] upsert 正常，仍为 3 条记录`);
    }, 15_000);
  });

  // ── 3. readTaskVectors 从 DB 读回 ───────────────────────────
  describe("readTaskVectors（从 task_vectors 表读取）", () => {
    it("读回的向量与写入的维度一致", async () => {
      if (!dbReachable) return;

      const vectors = await readTaskVectors(TEST_TASK_ID);
      expect(vectors).toHaveLength(3);

      for (const v of vectors) {
        expect(["targetActivity", "targetVibe", "rawDescription"]).toContain(v.field);
        expect(v.vector).toBeInstanceOf(Array);
        expect(v.vector.length).toBe(1024);
      }

      console.log(`✓ [${TAG}] readTaskVectors 读回 3 个字段，每个 1024 维`);
    });

    it("不存在的 taskId 返回空数组", async () => {
      const vectors = await readTaskVectors("00000000-0000-0000-0000-000000000000");
      expect(vectors).toHaveLength(0);
    });
  });

  // ── 4. processDraftingTask 端到端 ───────────────────────────
  describe("processDraftingTask（端到端：Drafting → embed → save → Searching）", () => {
    it("执行后任务状态变为 Searching，且 task_vectors 表有数据", async () => {
      if (!dbReachable) return;

      const before = await readTaskDocument(TEST_TASK_DRAFT_ID);
      expect(before.frontmatter.status).toBe("Drafting");

      const changed = await processDraftingTask(before);
      expect(changed).toBe(true);

      const after = await readTaskDocument(TEST_TASK_DRAFT_ID);
      expect(after.frontmatter.status).toBe("Searching");
      expect(after.frontmatter.version).toBe(before.frontmatter.version + 1);

      const vectors = await db
        .select({
          field: taskVectors.field,
          embedding: taskVectors.embedding
        })
        .from(taskVectors)
        .where(eq(taskVectors.taskId, TEST_TASK_DRAFT_ID));

      expect(vectors.length).toBe(3);

      const fieldNames = vectors.map((v) => v.field).sort();
      expect(fieldNames).toEqual(["rawDescription", "targetActivity", "targetVibe"]);

      for (const v of vectors) {
        expect(v.embedding.length).toBe(1024);
      }

      console.log(`✓ [${TAG}] processDraftingTask 端到端成功:`);
      console.log(`  状态: Drafting → Searching`);
      console.log(`  task_vectors: ${vectors.length} 条记录`);
    }, 30_000);
  });
});
