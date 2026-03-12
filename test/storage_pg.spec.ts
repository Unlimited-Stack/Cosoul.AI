/**
 * storage_pg.spec.ts — PostgreSQL 对接集成测试
 *
 * 验证 storage.ts 中所有核心函数能正确读写 PostgreSQL。
 *
 * 注意：
 * - 本文件为临时测试，验收通过后可安全删除。
 * - 依赖真实 DB 连接（DATABASE_URL 或默认 postgresql://cosoul:cosoul@db:5432/cosoul_agent）。
 * - 使用固定测试 UUID，与 seed.ts 数据完全隔离，afterAll 中全量清理。
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@repo/core/db/client";
import { handshakeLogs, idempotencyKeys, personas, tasks, users } from "@repo/core/db/schema";
import { eq, inArray } from "drizzle-orm";
import type { HandshakeInboundEnvelope, HandshakeOutboundEnvelope } from "../../TaskAgent(待合并)/src/task_agent/util/schema";
import {
  appendAgentChatLog,
  findIdempotencyRecord,
  queryL0Candidates,
  readLatestHandshakeExchange,
  readTaskDocument,
  saveIdempotencyRecord,
  saveTaskMD,
  setTaskHidden,
  transitionTaskStatus
} from "../../TaskAgent(待合并)/src/task_agent/util/storage";

// ─── 固定测试 UUID（与 seed 数据无关，afterAll 中清理）─────────────────────

const TEST_USER_ID   = "b0000000-0000-0000-0000-000000000001";
const TEST_PERSONA_ID = "b0000000-0000-0000-0000-000000000002";
const TEST_TASK_A    = "b0000000-0000-0000-0000-000000000010"; // 主测任务
const TEST_TASK_B    = "b0000000-0000-0000-0000-000000000011"; // L0 候选任务
// buildIdempotencyKey 格式：`${message_id}::${sender_agent_id}::${protocol_version}`
const TEST_IDEMPO_MSG_ID   = "test::storage_pg::idempotency::1";
const TEST_IDEMPO_DB_KEY   = `${TEST_IDEMPO_MSG_ID}::agent-sender::1.0`;

// ─── 测试 Fixture：task 工厂 ────────────────────────────────────────────────

function makeTask(taskId: string, status = "Drafting") {
  return {
    frontmatter: {
      task_id: taskId,
      status: status as "Drafting",
      interaction_type: "online" as const,
      current_partner_id: null,
      entered_status_at: "2026-03-01T10:00:00.000Z",
      created_at: "2026-03-01T10:00:00.000Z",
      updated_at: "2026-03-01T10:00:00.000Z",
      version: 1,
      pending_sync: false,
      hidden: false
    },
    body: {
      rawDescription: "测试需求描述",
      targetActivity: "测试活动",
      targetVibe: "轻松友好",
      detailedPlan: "详细计划内容"
    }
  };
}

// ─── Setup / Teardown ───────────────────────────────────────────────────────

beforeAll(async () => {
  // 清理可能残留的同 ID 测试数据（保证幂等）
  await db.delete(handshakeLogs).where(inArray(handshakeLogs.taskId, [TEST_TASK_A, TEST_TASK_B]));
  await db.delete(idempotencyKeys).where(eq(idempotencyKeys.key, TEST_IDEMPO_DB_KEY));
  await db.delete(tasks).where(inArray(tasks.taskId, [TEST_TASK_A, TEST_TASK_B]));
  await db.delete(personas).where(eq(personas.personaId, TEST_PERSONA_ID));
  await db.delete(users).where(eq(users.userId, TEST_USER_ID));

  // 插入测试用户 + 分身（满足 tasks.persona_id 外键约束）
  await db.insert(users).values({
    userId: TEST_USER_ID,
    email: "storage_pg_test@test.local",
    name: "测试用户（storage_pg）"
  });
  await db.insert(personas).values({
    personaId: TEST_PERSONA_ID,
    userId: TEST_USER_ID,
    name: "测试分身（storage_pg）"
  });
});

// afterAll(async () => {
//   // 按外键依赖顺序倒序清理测试数据
//   await db.delete(handshakeLogs).where(inArray(handshakeLogs.taskId, [TEST_TASK_A, TEST_TASK_B]));
//   await db.delete(idempotencyKeys).where(eq(idempotencyKeys.key, TEST_IDEMPO_DB_KEY));
//   await db.delete(tasks).where(inArray(tasks.taskId, [TEST_TASK_A, TEST_TASK_B]));
//   await db.delete(personas).where(eq(personas.personaId, TEST_PERSONA_ID));
//   await db.delete(users).where(eq(users.userId, TEST_USER_ID));
// });

// ─── 测试用例 ────────────────────────────────────────────────────────────────

describe("storage.ts → PostgreSQL 对接", () => {

  // 1. 写入 + 读取任务
  describe("saveTaskMD + readTaskDocument", () => {
    it("新建任务后可按 task_id 从 DB 读回完整字段", async () => {
      await saveTaskMD(makeTask(TEST_TASK_A), { personaId: TEST_PERSONA_ID });

      const doc = await readTaskDocument(TEST_TASK_A);
      expect(doc.frontmatter.task_id).toBe(TEST_TASK_A);
      expect(doc.frontmatter.status).toBe("Drafting");
      expect(doc.frontmatter.interaction_type).toBe("online");
      expect(doc.frontmatter.hidden).toBe(false);
      expect(doc.body.rawDescription).toBe("测试需求描述");
      expect(doc.body.targetActivity).toBe("测试活动");
    });

    it("再次 saveTaskMD 应 UPDATE 而非 INSERT（版本号保持）", async () => {
      const updated = makeTask(TEST_TASK_A);
      updated.body.rawDescription = "更新后的描述";
      await saveTaskMD(updated); // 不传 personaId，走 UPDATE 路径

      const doc = await readTaskDocument(TEST_TASK_A);
      expect(doc.body.rawDescription).toBe("更新后的描述");
    });

    it("指定 expectedVersion 不匹配时抛 E_VERSION_CONFLICT", async () => {
      const doc = await readTaskDocument(TEST_TASK_A);
      const wrongVersion = doc.frontmatter.version + 99;

      await expect(
        saveTaskMD(makeTask(TEST_TASK_A), { expectedVersion: wrongVersion })
      ).rejects.toThrow("E_VERSION_CONFLICT");
    });

    it("读取不存在的 task_id 抛 E_TASK_NOT_FOUND", async () => {
      await expect(
        readTaskDocument("ffffffff-0000-0000-0000-000000000000")
      ).rejects.toThrow("E_TASK_NOT_FOUND");
    });
  });

  // 2. 状态迁移
  describe("transitionTaskStatus", () => {
    it("Drafting -> Searching 成功，版本号递增", async () => {
      const before = await readTaskDocument(TEST_TASK_A);
      const result = await transitionTaskStatus(TEST_TASK_A, "Searching");

      expect(result.previousStatus).toBe("Drafting");
      expect(result.nextStatus).toBe("Searching");
      expect(result.version).toBe(before.frontmatter.version + 1);

      const after = await readTaskDocument(TEST_TASK_A);
      expect(after.frontmatter.status).toBe("Searching");
      expect(after.frontmatter.version).toBe(result.version);
      expect(after.frontmatter.pending_sync).toBe(false); // Step 3 清标记成功
    });

    it("非法迁移 Searching -> Drafting 抛 E_INVALID_TRANSITION", async () => {
      await expect(
        transitionTaskStatus(TEST_TASK_A, "Drafting")
      ).rejects.toThrow("E_INVALID_TRANSITION");
    });

    it("乐观锁：expectedVersion 不匹配时抛 E_VERSION_CONFLICT", async () => {
      await expect(
        transitionTaskStatus(TEST_TASK_A, "Negotiating", { expectedVersion: 0 })
      ).rejects.toThrow("E_VERSION_CONFLICT");
    });
  });

  // 3. 软删除
  describe("setTaskHidden", () => {
    it("hidden=true 后 DB 中字段更新", async () => {
      await setTaskHidden(TEST_TASK_A, true);
      const doc = await readTaskDocument(TEST_TASK_A);
      expect(doc.frontmatter.hidden).toBe(true);
    });

    it("已是目标值时不重复写（幂等）", async () => {
      // 再次设为 true 不应抛错
      await expect(setTaskHidden(TEST_TASK_A, true)).resolves.toBeUndefined();
    });

    it("hidden=false 恢复", async () => {
      await setTaskHidden(TEST_TASK_A, false);
      const doc = await readTaskDocument(TEST_TASK_A);
      expect(doc.frontmatter.hidden).toBe(false);
    });
  });

  // 4. L0 候选查询
  describe("queryL0Candidates", () => {
    it("只返回 Searching 状态且 interaction_type 兼容的任务", async () => {
      // TEST_TASK_A 已处于 Searching 状态（由状态迁移测试推进）
      // 插入候选任务 TEST_TASK_B（Searching + any）
      await saveTaskMD(
        {
          frontmatter: {
            task_id: TEST_TASK_B,
            status: "Searching" as const,
            interaction_type: "any" as const,
            current_partner_id: null,
            entered_status_at: "2026-03-01T10:00:00.000Z",
            created_at: "2026-03-01T10:00:00.000Z",
            updated_at: "2026-03-01T10:00:00.000Z",
            version: 1,
            pending_sync: false,
            hidden: false
          },
          body: {
            rawDescription: "候选任务描述",
            targetActivity: "候选活动",
            targetVibe: "随和开朗",
            detailedPlan: ""
          }
        },
        { personaId: TEST_PERSONA_ID }
      );

      const candidates = await queryL0Candidates(TEST_TASK_A);
      // 候选中应包含 TEST_TASK_B（Searching + any，与 online 兼容）
      expect(candidates).toContain(TEST_TASK_B);
      // 源任务自身不应出现在候选中
      expect(candidates).not.toContain(TEST_TASK_A);
    });
  });

  // 5. 幂等键
  describe("saveIdempotencyRecord + findIdempotencyRecord", () => {
    const envelope: HandshakeInboundEnvelope = {
      protocol_version: "1.0",
      message_id: TEST_IDEMPO_MSG_ID,
      sender_agent_id: "agent-sender",
      receiver_agent_id: "agent-receiver",
      task_id: TEST_TASK_A,
      action: "PROPOSE",
      round: 1,
      payload: {
        interaction_type: "online",
        target_activity: "测试活动",
        target_vibe: "轻松友好"
      },
      timestamp: "2026-03-01T10:00:00.000Z",
      signature: "test-sig"
    };

    const response: HandshakeOutboundEnvelope = {
      protocol_version: "1.0",
      message_id: "resp-storage-pg-1",
      in_reply_to: TEST_IDEMPO_MSG_ID,
      task_id: TEST_TASK_A,
      action: "ACCEPT",
      error: null,
      timestamp: "2026-03-01T10:00:01.000Z"
    };

    it("初次查询返回 null", async () => {
      const record = await findIdempotencyRecord(envelope);
      expect(record).toBeNull();
    });

    it("保存后可查到并还原 response", async () => {
      await saveIdempotencyRecord(envelope, response);
      const record = await findIdempotencyRecord(envelope);
      expect(record).not.toBeNull();
      expect(record!.response.message_id).toBe("resp-storage-pg-1");
      expect(record!.response.action).toBe("ACCEPT");
    });

    it("相同 key 写入相同 response 不报错（幂等）", async () => {
      await expect(
        saveIdempotencyRecord(envelope, response)
      ).resolves.toBeUndefined();
    });

    it("相同 key 写入不同 response 抛 E_IDEMPOTENCY_CONFLICT", async () => {
      const differentResponse: HandshakeOutboundEnvelope = {
        ...response,
        action: "REJECT"
      };
      await expect(
        saveIdempotencyRecord(envelope, differentResponse)
      ).rejects.toThrow("E_IDEMPOTENCY_CONFLICT");
    });
  });

  // 6. 握手日志
  describe("appendAgentChatLog + readLatestHandshakeExchange", () => {
    it("写入 outbound + inbound 报文后可从 DB 读回快照", async () => {
      const ts = new Date().toISOString();

      await appendAgentChatLog(TEST_TASK_A, {
        direction: "outbound",
        timestamp: ts,
        payload: {
          protocol_version: "1.0",
          message_id: "out-1",
          in_reply_to: "in-0",
          task_id: TEST_TASK_A,
          action: "PROPOSE",
          error: null,
          timestamp: ts
        }
      });

      await appendAgentChatLog(TEST_TASK_A, {
        direction: "inbound",
        timestamp: ts,
        payload: {
          protocol_version: "1.0",
          message_id: "in-1",
          sender_agent_id: "remote-agent",
          receiver_agent_id: "local-agent",
          task_id: TEST_TASK_A,
          action: "COUNTER_PROPOSE",
          round: 1,
          payload: {
            interaction_type: "online",
            target_activity: "活动",
            target_vibe: "氛围"
          },
          timestamp: ts,
          signature: "sig-1"
        }
      });

      const snapshot = await readLatestHandshakeExchange(TEST_TASK_A);
      // sourceFilePath 在 DB 模式下为 null
      expect(snapshot.sourceFilePath).toBeNull();
      // outbound 可解析（符合 HandshakeOutboundEnvelope schema）
      expect(snapshot.outbound).not.toBeNull();
      expect(snapshot.outbound?.action).toBe("PROPOSE");
      // inbound 可解析（符合 HandshakeInboundEnvelope schema）
      expect(snapshot.inbound).not.toBeNull();
      expect(snapshot.inbound?.action).toBe("COUNTER_PROPOSE");
    });

    it("无握手记录时返回全 null 快照", async () => {
      // TEST_TASK_B 没有写入握手日志
      const snapshot = await readLatestHandshakeExchange(TEST_TASK_B);
      expect(snapshot.inbound).toBeNull();
      expect(snapshot.outbound).toBeNull();
    });
  });
});
