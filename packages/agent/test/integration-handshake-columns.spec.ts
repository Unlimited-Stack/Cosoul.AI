/**
 * integration-handshake-columns.spec.ts
 *
 * 验证 handshake_logs 表扩展列（round, visible_to_user, user_summary）
 * 以及 Judge Model 裁决记录读写功能是否正常工作。
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@repo/core/db/client";
import { handshakeLogs, personas, tasks, users } from "@repo/core/db/schema";
import { eq } from "drizzle-orm";
import {
  appendAgentChatLog,
  readUserVisibleNegotiationSummary,
} from "../src/task-agent/storage";

// ─── 固定测试 UUID ──────────────────────────────────────────────────

const TEST_USER_ID    = "c0000000-0000-0000-0000-000000000001";
const TEST_PERSONA_ID = "c0000000-0000-0000-0000-000000000002";
const TEST_TASK_ID    = "c0000000-0000-0000-0000-000000000010";

// ─── Setup / Teardown ───────────────────────────────────────────────

beforeAll(async () => {
  // 清理残留
  await db.delete(handshakeLogs).where(eq(handshakeLogs.taskId, TEST_TASK_ID));
  await db.delete(tasks).where(eq(tasks.taskId, TEST_TASK_ID));
  await db.delete(personas).where(eq(personas.personaId, TEST_PERSONA_ID));
  await db.delete(users).where(eq(users.userId, TEST_USER_ID));

  // 插入测试前置数据
  await db.insert(users).values({
    userId: TEST_USER_ID,
    email: "handshake_col_test@test.local",
    name: "握手列测试用户",
  });
  await db.insert(personas).values({
    personaId: TEST_PERSONA_ID,
    userId: TEST_USER_ID,
    name: "握手列测试分身",
  });
  await db.insert(tasks).values({
    taskId: TEST_TASK_ID,
    personaId: TEST_PERSONA_ID,
    status: "Negotiating",
  });
});

afterAll(async () => {
  await db.delete(handshakeLogs).where(eq(handshakeLogs.taskId, TEST_TASK_ID));
  await db.delete(tasks).where(eq(tasks.taskId, TEST_TASK_ID));
  await db.delete(personas).where(eq(personas.personaId, TEST_PERSONA_ID));
  await db.delete(users).where(eq(users.userId, TEST_USER_ID));
});

// ─── 测试用例 ───────────────────────────────────────────────────────

describe("handshake_logs 扩展列验证", () => {
  it("round / visible_to_user / user_summary 列存在且可写入", async () => {
    const now = new Date().toISOString();

    await db.insert(handshakeLogs).values({
      taskId: TEST_TASK_ID,
      direction: "judge_request",
      envelope: { content: "测试 Judge 请求内容", round: 1 },
      round: 1,
      visibleToUser: false,
      userSummary: null,
      timestamp: new Date(now),
    });

    const rows = await db
      .select()
      .from(handshakeLogs)
      .where(eq(handshakeLogs.taskId, TEST_TASK_ID));

    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows[0];
    expect(row.direction).toBe("judge_request");
    expect(row.round).toBe(1);
    expect(row.visibleToUser).toBe(false);
    expect(row.userSummary).toBeNull();
  });

  it("direction 支持 judge_request / judge_response 值", async () => {
    const now = new Date().toISOString();

    await db.insert(handshakeLogs).values({
      taskId: TEST_TASK_ID,
      direction: "judge_response",
      envelope: {
        content: '{"verdict":"MATCH","confidence":0.85}',
        parsedDecision: {
          verdict: "MATCH",
          confidence: 0.85,
          dimensionScores: { activityCompatibility: 0.9, vibeAlignment: 0.8, interactionTypeMatch: 1.0, planSpecificity: 0.5 },
          shouldMoveToRevising: false,
          reasoning: "test",
          userFacingSummary: "双方活动匹配",
        },
        // verdict 已直接存储在 parsedDecision 中，无需额外映射
      },
      round: 1,
      visibleToUser: true,
      userSummary: "双方活动匹配，可以一起进行。",
      timestamp: new Date(now),
    });

    const rows = await db
      .select()
      .from(handshakeLogs)
      .where(eq(handshakeLogs.taskId, TEST_TASK_ID));

    const judgeResponse = rows.find((r) => r.direction === "judge_response");
    expect(judgeResponse).toBeDefined();
    expect(judgeResponse!.round).toBe(1);
    expect(judgeResponse!.visibleToUser).toBe(true);
    expect(judgeResponse!.userSummary).toContain("双方活动匹配");
  });
});

describe("appendAgentChatLog 写入 Judge 裁决", () => {
  it("通过 storage API 写入 judge_request / judge_response 并读回", async () => {
    const now = new Date().toISOString();

    await appendAgentChatLog(TEST_TASK_ID, {
      direction: "judge_request",
      timestamp: now,
      payload: { content: "通过 API 写入的 Judge 请求", round: 2 },
      round: 2,
    });

    await appendAgentChatLog(TEST_TASK_ID, {
      direction: "judge_response",
      timestamp: now,
      payload: {
        content: '{"verdict":"REJECT","confidence":0.15}',
        parsedDecision: {
          verdict: "REJECT",
          confidence: 0.15,
          dimensionScores: { activityCompatibility: 0.0, vibeAlignment: 0.1, interactionTypeMatch: 0.0, planSpecificity: 0.4 },
          shouldMoveToRevising: true,
          reasoning: "活动完全不相关",
          userFacingSummary: "活动不匹配。",
        },
        // verdict 已直接存储在 parsedDecision 中，无需额外映射
      },
      round: 2,
      visibleToUser: true,
      userSummary: "活动不匹配。",
    });

    // 验证写入成功
    const rows = await db
      .select()
      .from(handshakeLogs)
      .where(eq(handshakeLogs.taskId, TEST_TASK_ID));

    const judgeRequests = rows.filter((r) => r.direction === "judge_request");
    const judgeResponses = rows.filter((r) => r.direction === "judge_response");
    expect(judgeRequests.length).toBeGreaterThanOrEqual(1);
    expect(judgeResponses.length).toBeGreaterThanOrEqual(1);
  });
});

describe("readUserVisibleNegotiationSummary", () => {
  it("只返回 visible_to_user=true 的摘要", async () => {
    const summaries = await readUserVisibleNegotiationSummary(TEST_TASK_ID);

    // 之前写入了 2 条 visibleToUser=true 的记录
    expect(summaries.length).toBeGreaterThanOrEqual(2);
    for (const s of summaries) {
      expect(s.summary.length).toBeGreaterThan(0);
      expect(s.round).toBeGreaterThanOrEqual(1);
    }
  });
});
