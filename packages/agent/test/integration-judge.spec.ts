/**
 * integration-judge.spec.ts
 *
 * 集成测试：使用两组任务数据（全部写入 DB），调用独立 Judge 模块的 evaluateMatch，
 * 验证 Judge 从 DB 读取双方完整数据后做出正确裁决。
 *
 * 运行: npx vitest run test/integration-judge.spec.ts
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@repo/core/db/client";
import { handshakeLogs, personas, tasks, users } from "@repo/core/db/schema";
import { eq, inArray } from "drizzle-orm";
import { evaluateMatch } from "../src/judge-agent";

// ─── 固定测试 UUID ──────────────────────────────────────────────────

const TEST_USER_ID      = "e0000000-0000-0000-0000-000000000001";
const TEST_PERSONA_ID   = "e0000000-0000-0000-0000-000000000002";
const TEST_TASK_A_ID    = "e0000000-0000-0000-0000-00000000000a";  // 篮球
const TEST_TASK_B_ID    = "e0000000-0000-0000-0000-00000000000b";  // 运动（应 MATCH）
const TEST_TASK_C_ID    = "e0000000-0000-0000-0000-00000000000c";  // 编程
const TEST_TASK_D_ID    = "e0000000-0000-0000-0000-00000000000d";  // 潜水（应 REJECT）

const ALL_TASK_IDS = [TEST_TASK_A_ID, TEST_TASK_B_ID, TEST_TASK_C_ID, TEST_TASK_D_ID];

// ─── Setup / Teardown ───────────────────────────────────────────────

beforeAll(async () => {
  // 清理残留（顺序：handshake_logs → tasks → personas → users）
  await db.delete(handshakeLogs).where(
    inArray(handshakeLogs.taskId, ALL_TASK_IDS)
  );
  await db.delete(tasks).where(
    inArray(tasks.taskId, ALL_TASK_IDS)
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

  // 所有 4 个任务都写入 DB —— Judge 会通过 taskId 直接从 DB 读取
  await db.insert(tasks).values([
    {
      taskId: TEST_TASK_A_ID,
      personaId: TEST_PERSONA_ID,
      status: "Negotiating",
      interactionType: "offline",
      rawDescription: "周末想找人一起打篮球，水平一般，主要图个开心",
      targetActivity: "打篮球",
      targetVibe: "轻松友好，运动为主",
      detailedPlan: "周六下午 2-5 点，在朝阳公园篮球场，打半场 3v3 或者投篮都行。水平不高但很有热情，希望氛围轻松不要太卷。可以打完一起喝杯奶茶。",
    },
    {
      taskId: TEST_TASK_B_ID,
      personaId: TEST_PERSONA_ID,
      status: "Searching",
      interactionType: "offline",
      rawDescription: "周末想做点运动，篮球或羽毛球都行",
      targetActivity: "周末运动，篮球或羽毛球都行",
      targetVibe: "轻松随意，交个朋友",
      detailedPlan: "周末有空想找人一起运动，篮球最好，羽毛球也行。不挑场地，公园或者社区球场都可以。",
    },
    {
      taskId: TEST_TASK_C_ID,
      personaId: TEST_PERSONA_ID,
      status: "Negotiating",
      interactionType: "online",
      rawDescription: "想找个伙伴一起结对编程，做个 side project",
      targetActivity: "结对编程",
      targetVibe: "专注高效，互相学习",
      detailedPlan: "用 TypeScript + Next.js 做一个 AI 聊天工具，每周线上 pair 两次，每次 2 小时。希望对方有基本的 TS 经验，一起 code review。",
    },
    {
      taskId: TEST_TASK_D_ID,
      personaId: TEST_PERSONA_ID,
      status: "Searching",
      interactionType: "offline",
      rawDescription: "想去三亚潜水，考 OW 证书",
      targetActivity: "去三亚潜水，考 OW 证",
      targetVibe: "冒险刺激，探索海底世界",
      detailedPlan: "计划下个月去三亚学潜水，找个搭子一起考 PADI OW 证书，大概需要 4 天。",
    },
  ]);
});

afterAll(async () => {
  await db.delete(handshakeLogs).where(
    inArray(handshakeLogs.taskId, ALL_TASK_IDS)
  );
  await db.delete(tasks).where(
    inArray(tasks.taskId, ALL_TASK_IDS)
  );
  await db.delete(personas).where(eq(personas.personaId, TEST_PERSONA_ID));
  await db.delete(users).where(eq(users.userId, TEST_USER_ID));
});

// ─── 测试用例 ───────────────────────────────────────────────────────

describe("Judge Model 集成测试（独立模块）", () => {
  it("场景1: 篮球 vs 运动 → 应该 MATCH 或 NEGOTIATE (ACCEPT)", async () => {
    console.log("\n" + "=".repeat(60));
    console.log("场景 1: 篮球 vs 周末运动");
    console.log("=".repeat(60));

    const result = await evaluateMatch({
      initiatorTaskId: TEST_TASK_B_ID,  // 主动方：周末运动
      responderTaskId: TEST_TASK_A_ID,  // 被动方：打篮球
      round: 1,
    });

    console.log("\n📋 JudgeEvaluateResult:");
    console.log(JSON.stringify(result, null, 2));

    // 篮球 vs 运动，应该是 ACCEPT（MATCH 或 NEGOTIATE）
    expect(result.l2Action).toBe("ACCEPT");
    expect(result.decision.verdict).toMatch(/^(MATCH|NEGOTIATE)$/);
    expect(result.decision.dimensionScores.activityCompatibility).toBeGreaterThanOrEqual(0.5);

    // 验证 handshake_logs 已写入双方
    const logsA = await db.select().from(handshakeLogs)
      .where(eq(handshakeLogs.taskId, TEST_TASK_A_ID));
    const logsB = await db.select().from(handshakeLogs)
      .where(eq(handshakeLogs.taskId, TEST_TASK_B_ID));

    expect(logsA.filter(l => l.direction === "judge_response").length).toBeGreaterThanOrEqual(1);
    expect(logsB.filter(l => l.direction === "judge_response").length).toBeGreaterThanOrEqual(1);

    console.log("\n✅ 场景 1 通过: l2Action =", result.l2Action, "verdict =", result.decision.verdict);
  }, 30_000);

  it("场景2: 编程 vs 潜水 → 应该 REJECT", async () => {
    console.log("\n" + "=".repeat(60));
    console.log("场景 2: 结对编程 vs 潜水");
    console.log("=".repeat(60));

    const result = await evaluateMatch({
      initiatorTaskId: TEST_TASK_D_ID,  // 主动方：潜水
      responderTaskId: TEST_TASK_C_ID,  // 被动方：编程
      round: 1,
    });

    console.log("\n📋 JudgeEvaluateResult:");
    console.log(JSON.stringify(result, null, 2));

    // 编程 vs 潜水，完全不搭 + online vs offline 硬冲突 → REJECT
    expect(result.l2Action).toBe("REJECT");
    expect(result.decision.verdict).toBe("REJECT");
    expect(result.decision.dimensionScores.interactionTypeMatch).toBe(0);

    // 验证 handshake_logs 已写入双方
    const logsC = await db.select().from(handshakeLogs)
      .where(eq(handshakeLogs.taskId, TEST_TASK_C_ID));
    const logsD = await db.select().from(handshakeLogs)
      .where(eq(handshakeLogs.taskId, TEST_TASK_D_ID));

    expect(logsC.filter(l => l.direction === "judge_response").length).toBeGreaterThanOrEqual(1);
    expect(logsD.filter(l => l.direction === "judge_response").length).toBeGreaterThanOrEqual(1);

    console.log("\n✅ 场景 2 通过: l2Action =", result.l2Action, "verdict =", result.decision.verdict);
  }, 30_000);
});
