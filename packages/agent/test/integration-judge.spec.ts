/**
 * integration-judge.spec.ts
 *
 * 集成测试：使用两组本地构造的任务数据，调用 executeJudgeL2，
 * 直接打印 Judge 模型的返回结果。
 *
 * 运行: npx vitest run test/integration-judge.spec.ts
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@repo/core/db/client";
import { handshakeLogs, personas, tasks, users } from "@repo/core/db/schema";
import { eq, inArray } from "drizzle-orm";
import { executeJudgeL2 } from "../src/task-agent/judge";
import type {
  HandshakeInboundEnvelope,
  TaskDocument,
} from "../src/task-agent/types";

// ─── 固定测试 UUID ──────────────────────────────────────────────────

const TEST_USER_ID      = "e0000000-0000-0000-0000-000000000001";
const TEST_PERSONA_ID   = "e0000000-0000-0000-0000-000000000002";
const TEST_TASK_A_ID    = "e0000000-0000-0000-0000-00000000000a";  // 本地任务（篮球）
const TEST_TASK_B_ID    = "e0000000-0000-0000-0000-00000000000b";  // 远端任务（模拟信封）
const TEST_TASK_C_ID    = "e0000000-0000-0000-0000-00000000000c";  // 本地任务（编程）
const TEST_TASK_D_ID    = "e0000000-0000-0000-0000-00000000000d";  // 远端任务（潜水，应 REJECT）

// ─── 本地 TaskDocument 构造 ─────────────────────────────────────────

const now = new Date().toISOString();

/** 本地任务 A：想打篮球 */
const localTaskA: TaskDocument = {
  frontmatter: {
    task_id: TEST_TASK_A_ID,
    status: "Negotiating",
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
    rawDescription: "周末想找人一起打篮球，水平一般，主要图个开心",
    targetActivity: "打篮球",
    targetVibe: "轻松友好，运动为主",
    detailedPlan:
      "周六下午 2-5 点，在朝阳公园篮球场，打半场 3v3 或者投篮都行。水平不高但很有热情，希望氛围轻松不要太卷。可以打完一起喝杯奶茶。",
  },
};

/** 本地任务 C：想找人结对编程 */
const localTaskC: TaskDocument = {
  frontmatter: {
    task_id: TEST_TASK_C_ID,
    status: "Negotiating",
    interaction_type: "online",
    current_partner_id: null,
    entered_status_at: now,
    created_at: now,
    updated_at: now,
    version: 1,
    pending_sync: false,
    hidden: false,
  },
  body: {
    rawDescription: "想找个伙伴一起结对编程，做个 side project",
    targetActivity: "结对编程",
    targetVibe: "专注高效，互相学习",
    detailedPlan:
      "用 TypeScript + Next.js 做一个 AI 聊天工具，每周线上 pair 两次，每次 2 小时。希望对方有基本的 TS 经验，一起 code review。",
  },
};

// ─── 远端信封构造 ───────────────────────────────────────────────────

/** 远端任务 B 的信封：也想运动（应该 MATCH/NEGOTIATE） */
const envelopeB: HandshakeInboundEnvelope = {
  protocol_version: "1.0",
  message_id: "msg-judge-test-b",
  sender_agent_id: TEST_TASK_B_ID,
  receiver_agent_id: TEST_TASK_A_ID,
  task_id: TEST_TASK_A_ID,
  action: "PROPOSE",
  round: 1,
  payload: {
    interaction_type: "offline",
    target_activity: "周末运动，篮球或羽毛球都行",
    target_vibe: "轻松随意，交个朋友",
  },
  timestamp: now,
  signature: "test-sig-b",
};

/** 远端任务 D 的信封：想潜水（跟编程完全不搭，应该 REJECT） */
const envelopeD: HandshakeInboundEnvelope = {
  protocol_version: "1.0",
  message_id: "msg-judge-test-d",
  sender_agent_id: TEST_TASK_D_ID,
  receiver_agent_id: TEST_TASK_C_ID,
  task_id: TEST_TASK_C_ID,
  action: "PROPOSE",
  round: 1,
  payload: {
    interaction_type: "offline",
    target_activity: "去三亚潜水，考 OW 证",
    target_vibe: "冒险刺激，探索海底世界",
  },
  timestamp: now,
  signature: "test-sig-d",
};

// ─── Setup / Teardown ───────────────────────────────────────────────

beforeAll(async () => {
  // 清理残留（顺序：handshake_logs → tasks → personas → users）
  await db.delete(handshakeLogs).where(
    inArray(handshakeLogs.taskId, [TEST_TASK_A_ID, TEST_TASK_C_ID])
  );
  await db.delete(tasks).where(
    inArray(tasks.taskId, [TEST_TASK_A_ID, TEST_TASK_C_ID])
  );
  await db.delete(personas).where(eq(personas.personaId, TEST_PERSONA_ID));
  await db.delete(users).where(eq(users.userId, TEST_USER_ID));

  // 插入前置数据
  await db.insert(users).values({
    userId: TEST_USER_ID,
    email: "judge_test@test.local",
    name: "Judge测试用户",
  });
  await db.insert(personas).values({
    personaId: TEST_PERSONA_ID,
    userId: TEST_USER_ID,
    name: "Judge测试分身",
  });
  // 任务 A（篮球）和 C（编程）
  await db.insert(tasks).values([
    {
      taskId: TEST_TASK_A_ID,
      personaId: TEST_PERSONA_ID,
      status: "Negotiating",
      interactionType: "offline",
      rawDescription: localTaskA.body.rawDescription,
      targetActivity: localTaskA.body.targetActivity,
      targetVibe: localTaskA.body.targetVibe,
      detailedPlan: localTaskA.body.detailedPlan,
    },
    {
      taskId: TEST_TASK_C_ID,
      personaId: TEST_PERSONA_ID,
      status: "Negotiating",
      interactionType: "online",
      rawDescription: localTaskC.body.rawDescription,
      targetActivity: localTaskC.body.targetActivity,
      targetVibe: localTaskC.body.targetVibe,
      detailedPlan: localTaskC.body.detailedPlan,
    },
  ]);
});

// ─── afterAll 清理（默认注释掉，保留数据方便手动检查） ─────────────
// afterAll(async () => {
//   await db.delete(handshakeLogs).where(
//     inArray(handshakeLogs.taskId, [TEST_TASK_A_ID, TEST_TASK_C_ID])
//   );
//   await db.delete(tasks).where(
//     inArray(tasks.taskId, [TEST_TASK_A_ID, TEST_TASK_C_ID])
//   );
//   await db.delete(personas).where(eq(personas.personaId, TEST_PERSONA_ID));
//   await db.delete(users).where(eq(users.userId, TEST_USER_ID));
// });

// ─── 测试用例 ───────────────────────────────────────────────────────

describe("Judge Model 集成测试", () => {
  it("场景1: 篮球 vs 运动 → 应该 MATCH 或 NEGOTIATE (ACCEPT)", async () => {
    console.log("\n" + "=".repeat(60));
    console.log("场景 1: 篮球 vs 周末运动");
    console.log("=".repeat(60));

    const result = await executeJudgeL2(localTaskA, envelopeB);

    console.log("\n📋 L2Decision（最终映射结果）:");
    console.log(JSON.stringify(result, null, 2));

    // 从 handshake_logs 中读取 Judge 的原始裁决
    const logs = await db
      .select()
      .from(handshakeLogs)
      .where(eq(handshakeLogs.taskId, TEST_TASK_A_ID));

    const judgeResponse = logs.find((l) => l.direction === "judge_response");
    if (judgeResponse) {
      const envelope = judgeResponse.envelope as Record<string, unknown>;
      console.log("\n🔍 JudgeDecision（Judge 原始裁决）:");
      console.log(JSON.stringify(envelope.parsedDecision, null, 2));
      console.log("\n💬 用户可见摘要:", judgeResponse.userSummary);
    }

    // 篮球 vs 运动，应该是 ACCEPT（MATCH 或 NEGOTIATE）
    expect(result.action).toBe("ACCEPT");
    console.log("\n✅ 场景 1 通过: action =", result.action);
  }, 30_000);

  it("场景2: 编程 vs 潜水 → 应该 REJECT", async () => {
    console.log("\n" + "=".repeat(60));
    console.log("场景 2: 结对编程 vs 潜水");
    console.log("=".repeat(60));

    const result = await executeJudgeL2(localTaskC, envelopeD);

    console.log("\n📋 L2Decision（最终映射结果）:");
    console.log(JSON.stringify(result, null, 2));

    // 从 handshake_logs 中读取 Judge 的原始裁决
    const logs = await db
      .select()
      .from(handshakeLogs)
      .where(eq(handshakeLogs.taskId, TEST_TASK_C_ID));

    const judgeResponse = logs.find((l) => l.direction === "judge_response");
    if (judgeResponse) {
      const envelope = judgeResponse.envelope as Record<string, unknown>;
      console.log("\n🔍 JudgeDecision（Judge 原始裁决）:");
      console.log(JSON.stringify(envelope.parsedDecision, null, 2));
      console.log("\n💬 用户可见摘要:", judgeResponse.userSummary);
    }

    // 编程 vs 潜水，完全不搭，应该 REJECT
    expect(result.action).toBe("REJECT");
    console.log("\n✅ 场景 2 通过: action =", result.action);
  }, 30_000);
});
