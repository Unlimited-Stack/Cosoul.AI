/**
 * 单元测试：纯函数（无外部依赖）
 * - cosineSimilarity
 * - Zod schema 校验
 * - TaskMD 序列化/反序列化
 */
import { describe, it, expect } from "vitest";
import { cosineSimilarity } from "../src/task-agent/embedding";
import {
  TaskDocumentSchema,
  HandshakeInboundEnvelopeSchema,
  HandshakeOutboundEnvelopeSchema,
  NegotiationSessionSchema,
  parseTaskDocument
} from "../src/task-agent/types";
import {
  parseTaskMDContent,
  serializeTaskMDContent
} from "../src/task-agent/storage";

// ─── cosineSimilarity ───────────────────────────────────────────

describe("cosineSimilarity", () => {
  it("相同向量应返回 1", () => {
    const v = [1, 2, 3, 4, 5];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it("正交向量应返回 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0, 5);
  });

  it("反向向量应返回 -1", () => {
    const a = [1, 0, 0];
    const b = [-1, 0, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
  });

  it("零向量应返回 0（不抛异常）", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it("维度不匹配应抛出错误", () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow("Vector dimension mismatch");
  });

  it("高维向量计算结果在 [-1, 1] 范围内", () => {
    const a = Array.from({ length: 1024 }, () => Math.random() - 0.5);
    const b = Array.from({ length: 1024 }, () => Math.random() - 0.5);
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeGreaterThanOrEqual(-1);
    expect(sim).toBeLessThanOrEqual(1);
  });
});

// ─── Zod Schema 校验 ────────────────────────────────────────────

describe("Zod Schemas", () => {
  const validTaskDocument = {
    frontmatter: {
      task_id: "test-task-001",
      status: "Drafting",
      interaction_type: "online",
      current_partner_id: null,
      entered_status_at: "2026-03-12T00:00:00.000Z",
      created_at: "2026-03-12T00:00:00.000Z",
      updated_at: "2026-03-12T00:00:00.000Z",
      version: 1,
      pending_sync: false,
      hidden: false
    },
    body: {
      rawDescription: "想找人一起打羽毛球",
      targetActivity: "羽毛球运动",
      targetVibe: "轻松愉快",
      detailedPlan: ""
    }
  };

  describe("TaskDocumentSchema", () => {
    it("合法 TaskDocument 应通过校验", () => {
      const result = TaskDocumentSchema.safeParse(validTaskDocument);
      expect(result.success).toBe(true);
    });

    it("缺少 task_id 应校验失败", () => {
      const bad = structuredClone(validTaskDocument);
      (bad.frontmatter as Record<string, unknown>).task_id = "";
      const result = TaskDocumentSchema.safeParse(bad);
      expect(result.success).toBe(false);
    });

    it("非法 status 值应校验失败", () => {
      const bad = structuredClone(validTaskDocument);
      (bad.frontmatter as Record<string, unknown>).status = "InvalidStatus";
      const result = TaskDocumentSchema.safeParse(bad);
      expect(result.success).toBe(false);
    });

    it("非法 interaction_type 应校验失败", () => {
      const bad = structuredClone(validTaskDocument);
      (bad.frontmatter as Record<string, unknown>).interaction_type = "virtual";
      const result = TaskDocumentSchema.safeParse(bad);
      expect(result.success).toBe(false);
    });

    it("所有合法 status 值都应通过", () => {
      const statuses = [
        "Drafting", "Searching", "Negotiating", "Waiting_Human",
        "Listening", "Revising", "Closed", "Failed", "Timeout", "Cancelled"
      ];
      for (const status of statuses) {
        const doc = structuredClone(validTaskDocument);
        doc.frontmatter.status = status as typeof doc.frontmatter.status;
        expect(TaskDocumentSchema.safeParse(doc).success).toBe(true);
      }
    });

    it("parseTaskDocument 应返回经过 Zod 校验的对象", () => {
      const parsed = parseTaskDocument(validTaskDocument);
      expect(parsed.frontmatter.task_id).toBe("test-task-001");
      expect(parsed.body.rawDescription).toBe("想找人一起打羽毛球");
    });
  });

  describe("HandshakeInboundEnvelopeSchema", () => {
    const validInbound = {
      protocol_version: "1.0",
      message_id: "msg-001",
      sender_agent_id: "agent-A",
      receiver_agent_id: "agent-B",
      task_id: "task-001",
      action: "PROPOSE",
      round: 0,
      payload: {
        interaction_type: "online",
        target_activity: "打羽毛球",
        target_vibe: "轻松"
      },
      timestamp: "2026-03-12T00:00:00.000Z",
      signature: "sig-abc"
    };

    it("合法 inbound envelope 应通过校验", () => {
      expect(HandshakeInboundEnvelopeSchema.safeParse(validInbound).success).toBe(true);
    });

    it("缺少 signature 应失败", () => {
      const bad = { ...validInbound, signature: "" };
      expect(HandshakeInboundEnvelopeSchema.safeParse(bad).success).toBe(false);
    });
  });

  describe("HandshakeOutboundEnvelopeSchema", () => {
    it("合法 outbound envelope 应通过校验", () => {
      const valid = {
        protocol_version: "1.0",
        message_id: "msg-002",
        in_reply_to: "msg-001",
        task_id: "task-001",
        action: "ACCEPT",
        error: null,
        timestamp: "2026-03-12T00:00:00.000Z"
      };
      expect(HandshakeOutboundEnvelopeSchema.safeParse(valid).success).toBe(true);
    });

    it("带 error 对象的 outbound envelope 应通过校验", () => {
      const valid = {
        protocol_version: "1.0",
        message_id: "msg-003",
        in_reply_to: "msg-001",
        task_id: "task-001",
        action: "ERROR",
        error: { code: "E_SCHEMA_INVALID", message: "Invalid schema" },
        timestamp: "2026-03-12T00:00:00.000Z"
      };
      expect(HandshakeOutboundEnvelopeSchema.safeParse(valid).success).toBe(true);
    });
  });

  describe("NegotiationSessionSchema", () => {
    it("合法 session 应通过校验", () => {
      const valid = {
        session_id: "sess-001",
        task_id: "task-001",
        remote_agent_id: "agent-B",
        remote_task_id: "task-002",
        status: "Negotiating",
        match_score: 0.85,
        l2_action: null,
        rounds: 1,
        started_at: "2026-03-12T00:00:00.000Z",
        updated_at: "2026-03-12T00:00:00.000Z",
        timeout_at: "2026-03-12T01:00:00.000Z"
      };
      expect(NegotiationSessionSchema.safeParse(valid).success).toBe(true);
    });
  });
});

// ─── TaskMD 序列化/反序列化 ──────────────────────────────────────

describe("TaskMD serialize/parse round-trip", () => {
  const sampleTask = parseTaskDocument({
    frontmatter: {
      task_id: "roundtrip-001",
      status: "Searching",
      interaction_type: "offline",
      current_partner_id: null,
      entered_status_at: "2026-03-12T00:00:00.000Z",
      created_at: "2026-03-12T00:00:00.000Z",
      updated_at: "2026-03-12T00:00:00.000Z",
      version: 3,
      pending_sync: false,
      hidden: false
    },
    body: {
      rawDescription: "周末找人爬山",
      targetActivity: "户外徒步/爬山",
      targetVibe: "热爱户外运动、积极向上",
      detailedPlan: "## 计划\n- 周六早上出发\n- 地点灵活"
    }
  });

  it("serializeTaskMDContent 应生成有效 markdown", () => {
    const md = serializeTaskMDContent(sampleTask);
    expect(md).toContain("---");
    expect(md).toContain("task_id:");
    expect(md).toContain("raw_description:");
    expect(md).toContain("target_activity:");
    expect(md).toContain("target_vibe:");
  });

  it("serialize → parse 往返应保持数据一致", () => {
    const md = serializeTaskMDContent(sampleTask);
    const parsed = parseTaskMDContent(md);
    expect(parsed.frontmatter.task_id).toBe(sampleTask.frontmatter.task_id);
    expect(parsed.frontmatter.status).toBe(sampleTask.frontmatter.status);
    expect(parsed.frontmatter.interaction_type).toBe(sampleTask.frontmatter.interaction_type);
    expect(parsed.frontmatter.version).toBe(sampleTask.frontmatter.version);
    expect(parsed.body.rawDescription).toBe(sampleTask.body.rawDescription);
    expect(parsed.body.targetActivity).toBe(sampleTask.body.targetActivity);
    expect(parsed.body.targetVibe).toBe(sampleTask.body.targetVibe);
  });

  it("detailedPlan 为空时应生成占位符且 parse 回来为空", () => {
    const noPlan = parseTaskDocument({
      ...sampleTask,
      body: { ...sampleTask.body, detailedPlan: "" }
    });
    const md = serializeTaskMDContent(noPlan);
    expect(md).toContain("（待 AI 生成）");
    const parsed = parseTaskMDContent(md);
    expect(parsed.body.detailedPlan).toBe("");
  });
});
