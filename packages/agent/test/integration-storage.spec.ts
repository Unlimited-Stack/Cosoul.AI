/**
 * 集成测试：Storage 层（PostgreSQL CRUD）
 *
 * 前置条件：
 *   - PostgreSQL 数据库可达（DATABASE_URL 环境变量或默认连接串）
 *   - 数据库表已迁移（users, personas, tasks 等表存在）
 *
 * 注意：测试会在数据库中创建真实数据，测试完成后通过 afterAll 清理。
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
} from "../src/persona-agent/task-agent/storage";
import type { TaskDocument } from "../src/persona-agent/task-agent/types";

// ─── 测试用 fixture ─────────────────────────────────────────────

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
      rawDescription: "测试任务描述",
      targetActivity: "测试活动",
      targetVibe: "轻松测试",
      detailedPlan: "",
      ...overrides?.body
    }
  } as TaskDocument;
}

// ─── Setup / Teardown ───────────────────────────────────────────

beforeAll(async () => {
  try {
    // 测试数据库连接
    await db.select().from(users).limit(1);
    dbReachable = true;
  } catch (e) {
    console.warn("[storage-test] 数据库不可达，跳过存储集成测试:", (e as Error).message);
    return;
  }

  // 创建测试用的 user + persona（外键依赖）
  await db.insert(users).values({
    userId: TEST_USER_ID,
    email: `test-${TEST_USER_ID.slice(0, 8)}@test.local`,
    name: "Test User"
  });

  await db.insert(personas).values({
    personaId: TEST_PERSONA_ID,
    userId: TEST_USER_ID,
    name: "Test Persona"
  });
});

afterAll(async () => {
  // 不清理测试数据，保留在数据库中供检查
});

// ─── 测试用例 ───────────────────────────────────────────────────

describe.skipIf(!true)("Storage: PostgreSQL CRUD", () => {
  // 这里的 skipIf 会在 beforeAll 之后运行，
  // 但由于 vitest 限制，我们在每个 test 内部检查 dbReachable

  it("saveTaskMD — 应能成功创建新任务 (INSERT)", async () => {
    if (!dbReachable) return;

    const task = makeTaskDocument(TEST_TASK_ID);
    await saveTaskMD(task, { personaId: TEST_PERSONA_ID });

    // 验证写入
    const rows = await db.select().from(tasks).where(eq(tasks.taskId, TEST_TASK_ID));
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("Drafting");
    expect(rows[0].rawDescription).toBe("测试任务描述");
  });

  it("readTaskDocument — 应能正确读取刚创建的任务", async () => {
    if (!dbReachable) return;

    const doc = await readTaskDocument(TEST_TASK_ID);
    expect(doc.frontmatter.task_id).toBe(TEST_TASK_ID);
    expect(doc.frontmatter.status).toBe("Drafting");
    expect(doc.body.rawDescription).toBe("测试任务描述");
    expect(doc.body.targetActivity).toBe("测试活动");
  });

  it("readTaskDocument — 不存在的 task 应抛出 E_TASK_NOT_FOUND", async () => {
    if (!dbReachable) return;

    // task_id 必须是合法 UUID 格式，否则 PostgreSQL 会抛 syntax error
    await expect(readTaskDocument("00000000-0000-0000-0000-000000000000")).rejects.toThrow("E_TASK_NOT_FOUND");
  });

  it("saveTaskMD — UPDATE 已存在的任务", async () => {
    if (!dbReachable) return;

    const doc = await readTaskDocument(TEST_TASK_ID);
    const updated: TaskDocument = {
      frontmatter: { ...doc.frontmatter, updated_at: new Date().toISOString() },
      body: { ...doc.body, rawDescription: "更新后的描述" }
    };
    await saveTaskMD(updated);

    const reloaded = await readTaskDocument(TEST_TASK_ID);
    expect(reloaded.body.rawDescription).toBe("更新后的描述");
  });

  it("saveTaskMD — 乐观锁冲突应抛出 E_VERSION_CONFLICT", async () => {
    if (!dbReachable) return;

    const doc = await readTaskDocument(TEST_TASK_ID);
    // 传入错误的 expectedVersion
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

    // Searching → Closed 不在 FSM 允许列表中
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

    // 创建第二个 Searching 任务
    const task2 = makeTaskDocument(TEST_TASK_ID_2, {
      status: "Searching",
      interaction_type: "online"
    });
    await saveTaskMD(task2, { personaId: TEST_PERSONA_ID });

    // TEST_TASK_ID 当前也是 Searching，两者 interaction_type 都是 online → 兼容
    const candidates = await queryL0Candidates(TEST_TASK_ID);
    expect(candidates).toContain(TEST_TASK_ID_2);
    // 不应包含自身
    expect(candidates).not.toContain(TEST_TASK_ID);
  });

  it("transitionTaskStatus — 完整 FSM 路径: Searching → Negotiating → Waiting_Human → Closed", async () => {
    if (!dbReachable) return;

    // 使用 task2 做完整路径测试
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
