/**
 * 集成测试：Storage 层（PostgreSQL CRUD）
 *
 * 前置条件：
 *   - PostgreSQL 数据库可达（DATABASE_URL 环境变量或默认连接串）
 *   - 数据库表已迁移（users, personas, tasks 等表存在）
 *
 * 注意：测试会在数据库中创建真实数据，afterAll 已注释，保留数据供检查。
 *       所有测试数据统一使用 [MIGRATE_0312] 前缀标识。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@repo/core/db/client";
import { users, personas, tasks } from "@repo/core/db/schema";
import { eq } from "drizzle-orm";
import {
  saveTaskMD,
  readTaskDocument,
  transitionTaskStatus,
  listTasksByStatuses,
  listAllTasks,
  setTaskHidden,
  queryL0Candidates,
  parseTaskMDContent,
  serializeTaskMDContent
} from "../packages/agent/src/task-agent/storage";
import type { TaskDocument } from "../packages/agent/src/task-agent/types";

// ─── 统一标识前缀 ──────────────────────────────────────────────
const TAG = "MIGRATE_0312";

const TEST_USER_ID = randomUUID();
const TEST_PERSONA_ID = randomUUID();
const TEST_TASK_ID = randomUUID();
const TEST_TASK_ID_2 = randomUUID();

let dbReachable = false;

function makeTaskDocument(
  taskId: string,
  overrides?: Partial<TaskDocument["frontmatter"]> & { body?: Partial<TaskDocument["body"]> }
): TaskDocument {
  const now = new Date().toISOString();
  return {
    frontmatter: {
      task_id: taskId,
      status: "Drafting",
      interaction_type: "online",
      current_partner_id: null,
      entered_status_at: now,
      created_at: now,
      updated_at: now,
      version: 1,
      pending_sync: false,
      hidden: false,
      ...overrides
    },
    body: {
      rawDescription: `[${TAG}] 存储层测试任务`,
      targetActivity: `[${TAG}] 测试活动`,
      targetVibe: `[${TAG}] 轻松测试氛围`,
      detailedPlan: "",
      ...overrides?.body
    }
  } as TaskDocument;
}

// ─── Setup / Teardown ───────────────────────────────────────────

beforeAll(async () => {
  try {
    await db.select().from(users).limit(1);
    dbReachable = true;
  } catch (e) {
    console.warn("[storage-test] 数据库不可达，跳过存储集成测试:", (e as Error).message);
    return;
  }

  // 创建测试用的 user + persona（外键依赖）
  await db.insert(users).values({
    userId: TEST_USER_ID,
    email: `${TAG}_storage_${TEST_USER_ID.slice(0, 8)}@test.local`,
    name: `[${TAG}] Storage Test User`
  });

  await db.insert(personas).values({
    personaId: TEST_PERSONA_ID,
    userId: TEST_USER_ID,
    name: `[${TAG}] Storage Test Persona`
  });
});

// afterAll — 注释掉以保留测试数据，方便在数据库中查看
// 搜索关键词 MIGRATE_0312 即可定位所有本次测试产生的数据
// afterAll(async () => {
//   if (!dbReachable) return;
//   await db.delete(tasks).where(eq(tasks.taskId, TEST_TASK_ID));
//   await db.delete(tasks).where(eq(tasks.taskId, TEST_TASK_ID_2));
//   await db.delete(personas).where(eq(personas.personaId, TEST_PERSONA_ID));
//   await db.delete(users).where(eq(users.userId, TEST_USER_ID));
// });

// ─── 测试用例 ───────────────────────────────────────────────────

describe.skipIf(!true)("Storage: PostgreSQL CRUD", () => {

  it("saveTaskMD — 应能成功创建新任务 (INSERT)", async () => {
    if (!dbReachable) return;

    const task = makeTaskDocument(TEST_TASK_ID);
    await saveTaskMD(task, { personaId: TEST_PERSONA_ID });

    const rows = await db.select().from(tasks).where(eq(tasks.taskId, TEST_TASK_ID));
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("Drafting");
    expect(rows[0].rawDescription).toBe(`[${TAG}] 存储层测试任务`);
  });

  it("readTaskDocument — 应能正确读取刚创建的任务", async () => {
    if (!dbReachable) return;

    const doc = await readTaskDocument(TEST_TASK_ID);
    expect(doc.frontmatter.task_id).toBe(TEST_TASK_ID);
    expect(doc.frontmatter.status).toBe("Drafting");
    expect(doc.body.rawDescription).toBe(`[${TAG}] 存储层测试任务`);
    expect(doc.body.targetActivity).toBe(`[${TAG}] 测试活动`);
  });

  it("readTaskDocument — 不存在的 task 应抛出 E_TASK_NOT_FOUND", async () => {
    if (!dbReachable) return;
    await expect(readTaskDocument("00000000-0000-0000-0000-000000000000")).rejects.toThrow("E_TASK_NOT_FOUND");
  });

  it("saveTaskMD — UPDATE 已存在的任务", async () => {
    if (!dbReachable) return;

    const doc = await readTaskDocument(TEST_TASK_ID);
    const updated: TaskDocument = {
      frontmatter: { ...doc.frontmatter, updated_at: new Date().toISOString() },
      body: { ...doc.body, rawDescription: `[${TAG}] 更新后的描述` }
    };
    await saveTaskMD(updated);

    const reloaded = await readTaskDocument(TEST_TASK_ID);
    expect(reloaded.body.rawDescription).toBe(`[${TAG}] 更新后的描述`);
  });

  it("saveTaskMD — 乐观锁冲突应抛出 E_VERSION_CONFLICT", async () => {
    if (!dbReachable) return;

    const doc = await readTaskDocument(TEST_TASK_ID);
    await expect(
      saveTaskMD(doc, { expectedVersion: doc.frontmatter.version + 999 })
    ).rejects.toThrow("E_VERSION_CONFLICT");
  });

  it("transitionTaskStatus — Drafting → Searching 应成功", async () => {
    if (!dbReachable) return;

    const result = await transitionTaskStatus(TEST_TASK_ID, "Searching");
    expect(result.previousStatus).toBe("Drafting");
    expect(result.nextStatus).toBe("Searching");
    expect(result.version).toBeGreaterThan(1);

    const doc = await readTaskDocument(TEST_TASK_ID);
    expect(doc.frontmatter.status).toBe("Searching");
  });

  it("transitionTaskStatus — 非法迁移应抛出 E_INVALID_TRANSITION", async () => {
    if (!dbReachable) return;
    await expect(transitionTaskStatus(TEST_TASK_ID, "Closed")).rejects.toThrow("E_INVALID_TRANSITION");
  });

  it("listTasksByStatuses — 应能按状态过滤", async () => {
    if (!dbReachable) return;

    const searching = await listTasksByStatuses(["Searching"]);
    expect(searching.some(t => t.frontmatter.task_id === TEST_TASK_ID)).toBe(true);

    const drafting = await listTasksByStatuses(["Drafting"]);
    expect(drafting.some(t => t.frontmatter.task_id === TEST_TASK_ID)).toBe(false);
  });

  it("listAllTasks — 应包含测试任务", async () => {
    if (!dbReachable) return;

    const all = await listAllTasks();
    expect(all.some(r => r.task.frontmatter.task_id === TEST_TASK_ID)).toBe(true);
  });

  it("setTaskHidden — 应能切换隐藏状态", async () => {
    if (!dbReachable) return;

    await setTaskHidden(TEST_TASK_ID, true);
    let doc = await readTaskDocument(TEST_TASK_ID);
    expect(doc.frontmatter.hidden).toBe(true);

    await setTaskHidden(TEST_TASK_ID, false);
    doc = await readTaskDocument(TEST_TASK_ID);
    expect(doc.frontmatter.hidden).toBe(false);
  });

  it("queryL0Candidates — 应能查询兼容候选任务", async () => {
    if (!dbReachable) return;

    const task2 = makeTaskDocument(TEST_TASK_ID_2, {
      status: "Searching",
      interaction_type: "online"
    });
    await saveTaskMD(task2, { personaId: TEST_PERSONA_ID });

    const candidates = await queryL0Candidates(TEST_TASK_ID);
    expect(candidates).toContain(TEST_TASK_ID_2);
    expect(candidates).not.toContain(TEST_TASK_ID);
  });

  it("transitionTaskStatus — 完整 FSM 路径: Searching → Negotiating → Waiting_Human → Closed", async () => {
    if (!dbReachable) return;

    await transitionTaskStatus(TEST_TASK_ID_2, "Negotiating");
    let doc = await readTaskDocument(TEST_TASK_ID_2);
    expect(doc.frontmatter.status).toBe("Negotiating");

    await transitionTaskStatus(TEST_TASK_ID_2, "Waiting_Human");
    doc = await readTaskDocument(TEST_TASK_ID_2);
    expect(doc.frontmatter.status).toBe("Waiting_Human");

    await transitionTaskStatus(TEST_TASK_ID_2, "Closed");
    doc = await readTaskDocument(TEST_TASK_ID_2);
    expect(doc.frontmatter.status).toBe("Closed");
  });
});
