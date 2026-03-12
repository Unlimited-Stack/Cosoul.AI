/**
 * 集成测试：完整任务流程 Intake → Drafting → Searching → Waiting_Human
 *
 * 验证链路：
 *   1. intake 提取字段 + buildTaskDocument（状态 = Drafting）
 *   2. saveTaskMD 写入 DB + embedding 写入 task_vectors
 *   3. processDraftingTask 状态流转 Drafting → Searching
 *   4. processSearchingTask 执行 L1 检索 → 跳转 Waiting_Human
 *
 * 前置条件：
 *   - PostgreSQL 数据库可达（DATABASE_URL）
 *   - DashScope API 可达（DASHSCOPE_API_KEY）
 *
 * 所有测试数据使用 [FLOW_TEST] 前缀标识。
 *
 * 运行：cd packages/agent && npx vitest run test/integration-full-flow.spec.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@repo/core/db/client";
import { users, personas, tasks, taskVectors } from "@repo/core/db/schema";
import { eq } from "drizzle-orm";

import {
  createExtractionConversation,
  extractFromConversation,
  buildTaskDocument,
} from "../src/task-agent/intake";
import { embedTaskFields } from "../src/task-agent/embedding";
import { saveTaskVectors, readTaskVectors } from "../src/task-agent/retrieval";
import {
  saveTaskMD,
  readTaskDocument,
  transitionTaskStatus,
} from "../src/task-agent/storage";
import { processDraftingTask, processSearchingTask } from "../src/task-agent/dispatcher";
import { saveIntakeResult } from "../src/task-agent/task_loop";
import type { TaskDocument } from "../src/task-agent/types";

// ─── 标识 & ID ───────────────────────────────────────────────────
const TAG = "FLOW_TEST";

const TEST_USER_ID = randomUUID();
const TEST_PERSONA_ID = randomUUID();

// 主测试任务（走完整流程）
const MAIN_TASK_ID = randomUUID();

// 对手任务（用于 L1 检索能匹配到，使 Searching → Waiting_Human 走 match 分支）
const PEER_TASK_ID = randomUUID();

let dbReachable = false;
const HAS_LLM_KEY = !!(process.env.DASHSCOPE_API_KEY || process.env.OPENAI_API_KEY);

// ─── Setup / Teardown ────────────────────────────────────────────

beforeAll(async () => {
  try {
    await db.select().from(users).limit(1);
    dbReachable = true;
  } catch (e) {
    console.warn(`[${TAG}] 数据库不可达，跳过测试:`, (e as Error).message);
    return;
  }

  // 清理可能残留的测试数据
  for (const tid of [MAIN_TASK_ID, PEER_TASK_ID]) {
    await db.delete(taskVectors).where(eq(taskVectors.taskId, tid));
    await db.delete(tasks).where(eq(tasks.taskId, tid));
  }
  await db.delete(personas).where(eq(personas.personaId, TEST_PERSONA_ID));
  await db.delete(users).where(eq(users.userId, TEST_USER_ID));

  // 插入测试用户 + 分身
  await db.insert(users).values({
    userId: TEST_USER_ID,
    email: `${TAG}_flow_${Date.now()}@test.local`,
    name: `[${TAG}] Full Flow Test User`,
  });
  await db.insert(personas).values({
    personaId: TEST_PERSONA_ID,
    userId: TEST_USER_ID,
    name: `[${TAG}] Full Flow Test Persona`,
  });
});

// afterAll — 注释掉以保留测试数据，方便在数据库中查看
// 搜索关键词 FLOW_TEST 即可定位所有本次测试产生的数据
// afterAll(async () => {
//   if (!dbReachable) return;
//   for (const tid of [MAIN_TASK_ID, PEER_TASK_ID]) {
//     await db.delete(taskVectors).where(eq(taskVectors.taskId, tid));
//     await db.delete(tasks).where(eq(tasks.taskId, tid));
//   }
//   await db.delete(personas).where(eq(personas.personaId, TEST_PERSONA_ID));
//   await db.delete(users).where(eq(users.userId, TEST_USER_ID));
// });

// ─── 辅助 ────────────────────────────────────────────────────────

function makePeerTask(): TaskDocument {
  const now = new Date().toISOString();
  return {
    frontmatter: {
      task_id: PEER_TASK_ID,
      status: "Searching",
      interaction_type: "offline",
      current_partner_id: null,
      entered_status_at: now,
      created_at: now,
      updated_at: now,
      version: 1,
      pending_sync: false,
      hidden: false,
    },
    body: {
      rawDescription: `[${TAG}] 想找人周末一起打篮球，随便玩玩`,
      targetActivity: `[${TAG}] 周末户外打篮球`,
      targetVibe: `[${TAG}] 轻松随意，友好开放`,
      detailedPlan: `[${TAG}] 周末下午，公园篮球场`,
    },
  } as TaskDocument;
}

// ─── 测试用例 ────────────────────────────────────────────────────

describe.skipIf(!HAS_LLM_KEY)("完整流程：Intake → Drafting → Searching → Waiting_Human", () => {

  // ── Step 1: Intake 提取 + buildTaskDocument ──────────────────
  let mainTask: TaskDocument;

  it("Step 1: intake 提取用户需求，构建 Drafting 状态的 TaskDocument", async () => {
    if (!dbReachable) return;

    const conv = createExtractionConversation();
    const result = await extractFromConversation(
      conv,
      "我想找人这周末一起去户外打篮球，轻松随意就好，不要太卷"
    );

    console.log(`[${TAG}] intake 提取结果:`, JSON.stringify(result.fields, null, 2));

    expect(result.fields.rawDescription).toBeTruthy();
    expect(result.fields.targetActivity).toBeTruthy();
    expect(result.fields.targetVibe).toBeTruthy();
    expect(result.fields.interaction_type).toBe("offline");
    expect(result.complete).toBe(true);

    // 构建 TaskDocument，但使用固定的 MAIN_TASK_ID 以便后续断言
    const built = buildTaskDocument(result.fields);
    mainTask = {
      frontmatter: { ...built.frontmatter, task_id: MAIN_TASK_ID },
      body: built.body,
    };

    expect(mainTask.frontmatter.status).toBe("Drafting");
    expect(mainTask.frontmatter.version).toBe(1);
    console.log(`✓ [${TAG}] Step 1 完成：TaskDocument 已构建，status=Drafting`);
  }, 15_000);

  // ── Step 2: 存储 + Embedding ─────────────────────────────────
  it("Step 2: saveTaskMD 写入 DB，embedding 写入 task_vectors", async () => {
    if (!dbReachable) return;

    // 2a. 保存任务到 DB
    await saveTaskMD(mainTask, { personaId: TEST_PERSONA_ID });

    // 验证 DB 中任务存在且状态正确
    const dbDoc = await readTaskDocument(MAIN_TASK_ID);
    expect(dbDoc.frontmatter.status).toBe("Drafting");
    expect(dbDoc.frontmatter.task_id).toBe(MAIN_TASK_ID);
    expect(dbDoc.body.rawDescription).toBe(mainTask.body.rawDescription);
    console.log(`  ✓ saveTaskMD 成功，DB 中 status=Drafting`);

    // 2b. 保存 intake 记录
    await saveIntakeResult(
      mainTask,
      ["用户: 我想找人这周末一起去户外打篮球，轻松随意就好"],
      new Date().toISOString()
    );
    console.log(`  ✓ saveIntakeResult 成功`);

    // 2c. Embedding（模拟 createTaskAgentFromIntake 中的逻辑）
    expect(mainTask.body.targetActivity).toBeTruthy();
    expect(mainTask.body.targetVibe).toBeTruthy();
    expect(mainTask.body.rawDescription).toBeTruthy();

    const embResult = await embedTaskFields(
      MAIN_TASK_ID,
      mainTask.body.targetActivity,
      mainTask.body.targetVibe,
      mainTask.body.rawDescription,
    );
    expect(embResult.embeddings).toHaveLength(3);

    await saveTaskVectors(
      MAIN_TASK_ID,
      embResult.embeddings.map((e) => ({ field: e.field, vector: e.vector })),
    );

    // 验证向量已写入
    const vectors = await readTaskVectors(MAIN_TASK_ID);
    expect(vectors).toHaveLength(3);
    const vectorFields = vectors.map((v) => v.field).sort();
    expect(vectorFields).toEqual(["rawDescription", "targetActivity", "targetVibe"]);

    for (const v of vectors) {
      expect(v.vector).toBeInstanceOf(Array);
      expect(v.vector.length).toBe(1024);
    }

    console.log(`✓ [${TAG}] Step 2 完成：DB 存储 + 3 条向量写入成功`);
  }, 30_000);

  // ── Step 3: Drafting → Searching ─────────────────────────────
  it("Step 3: processDraftingTask 推进状态 Drafting → Searching", async () => {
    if (!dbReachable) return;

    const before = await readTaskDocument(MAIN_TASK_ID);
    expect(before.frontmatter.status).toBe("Drafting");

    const changed = await processDraftingTask(before);
    expect(changed).toBe(true);

    const after = await readTaskDocument(MAIN_TASK_ID);
    expect(after.frontmatter.status).toBe("Searching");
    expect(after.frontmatter.version).toBe(before.frontmatter.version + 1);

    // 向量应该仍然存在（processDraftingTask 不再负责 embedding）
    const vectors = await readTaskVectors(MAIN_TASK_ID);
    expect(vectors).toHaveLength(3);

    console.log(`✓ [${TAG}] Step 3 完成：Drafting → Searching，version=${after.frontmatter.version}`);
  });

  // ── Step 4: Searching → Waiting_Human ────────────────────────
  it("Step 4: processSearchingTask 执行 L1 检索，跳转到 Waiting_Human", async () => {
    if (!dbReachable) return;

    // 4a. 创建一个对手任务（状态 Searching + 相似向量），供 L1 检索匹配
    const peer = makePeerTask();
    await saveTaskMD(peer, { personaId: TEST_PERSONA_ID });

    const peerEmb = await embedTaskFields(
      PEER_TASK_ID,
      peer.body.targetActivity,
      peer.body.targetVibe,
      peer.body.rawDescription,
    );
    await saveTaskVectors(
      PEER_TASK_ID,
      peerEmb.embeddings.map((e) => ({ field: e.field, vector: e.vector })),
    );
    console.log(`  ✓ 对手任务 ${PEER_TASK_ID} 已创建（Searching + 向量）`);

    // 4b. 执行 processSearchingTask
    const searchingTask = await readTaskDocument(MAIN_TASK_ID);
    expect(searchingTask.frontmatter.status).toBe("Searching");

    const changed = await processSearchingTask(searchingTask);
    expect(changed).toBe(true);

    // 4c. 验证状态跳转
    const afterSearch = await readTaskDocument(MAIN_TASK_ID);
    // processSearchingTask 成功匹配后跳转 Negotiating，
    // 如果没有匹配到（或发送 propose 失败）则跳转 Waiting_Human
    const validNextStatuses = ["Negotiating", "Waiting_Human"];
    expect(validNextStatuses).toContain(afterSearch.frontmatter.status);

    console.log(`✓ [${TAG}] Step 4 完成：Searching → ${afterSearch.frontmatter.status}`);
    console.log(`  最终 version=${afterSearch.frontmatter.version}`);
  }, 30_000);

  // ── Step 5: 验证整体一致性 ──────────────────────────────────
  it("Step 5: 最终状态一致性校验", async () => {
    if (!dbReachable) return;

    const finalTask = await readTaskDocument(MAIN_TASK_ID);

    // 任务应已离开 Drafting/Searching
    expect(finalTask.frontmatter.status).not.toBe("Drafting");
    expect(finalTask.frontmatter.status).not.toBe("Searching");

    // version 应至少递增了 2 次（Drafting→Searching, Searching→下一状态）
    expect(finalTask.frontmatter.version).toBeGreaterThanOrEqual(3);

    // body 字段应完整保留
    expect(finalTask.body.rawDescription).toBeTruthy();
    expect(finalTask.body.targetActivity).toBeTruthy();
    expect(finalTask.body.targetVibe).toBeTruthy();

    // 向量数据应完整
    const vectors = await readTaskVectors(MAIN_TASK_ID);
    expect(vectors).toHaveLength(3);

    console.log(`✓ [${TAG}] 全流程验证通过:`);
    console.log(`  最终状态: ${finalTask.frontmatter.status}`);
    console.log(`  最终版本: ${finalTask.frontmatter.version}`);
    console.log(`  向量数据: ${vectors.length} 条`);
    console.log(`  任务描述: ${finalTask.body.rawDescription}`);
  });
});
