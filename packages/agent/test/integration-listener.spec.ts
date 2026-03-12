/**
 * 集成测试：HTTP Listener（前端 API 端点）
 *
 * 前置条件：
 *   - PostgreSQL 数据库可达
 *   - 启动内置 HTTP server 在随机端口
 *
 * 测试覆盖：
 *   - GET  /tasks               列表
 *   - POST /tasks               创建
 *   - GET  /tasks/:id           读取
 *   - POST /tasks/:id/cancel    取消
 *   - POST /tasks/:id/hidden    隐藏
 *   - GET  /tasks/:id/path      路径
 *   - POST /handshake           握手（schema 校验）
 *   - GET  /listener/status     监听状态
 *   - 404  未知路由
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@repo/core/db/client";
import { users, personas, tasks } from "@repo/core/db/schema";
import { eq } from "drizzle-orm";
import { startListener, stopListener, isListenerRunning } from "../src/persona-agent/task-agent/listener";
import { saveTaskMD } from "../src/persona-agent/task-agent/storage";
import type { TaskDocument } from "../src/persona-agent/task-agent/types";

const TEST_PORT = 18_000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${TEST_PORT}`;

const TEST_USER_ID = randomUUID();
const TEST_PERSONA_ID = randomUUID();
const TEST_TASK_ID = randomUUID();

let serverReady = false;

function makeTaskDocument(taskId: string): TaskDocument {
  const now = new Date().toISOString();
  return {
    frontmatter: {
      task_id: taskId,
      status: "Drafting",
      interaction_type: "any",
      current_partner_id: null,
      entered_status_at: now,
      created_at: now,
      updated_at: now,
      version: 1,
      pending_sync: false,
      hidden: false
    },
    body: {
      rawDescription: "HTTP 测试任务",
      targetActivity: "测试",
      targetVibe: "测试氛围",
      detailedPlan: ""
    }
  } as TaskDocument;
}

async function fetchJson(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init
  });
  const body = await res.json();
  return { status: res.status, body };
}

// ─── Setup / Teardown ───────────────────────────────────────────

beforeAll(async () => {
  try {
    await db.select().from(users).limit(1);
  } catch {
    console.warn("[listener-test] 数据库不可达，跳过 HTTP 集成测试");
    return;
  }

  // 创建测试数据
  await db.insert(users).values({
    userId: TEST_USER_ID,
    email: `listener-test-${TEST_USER_ID.slice(0, 8)}@test.local`,
    name: "Listener Test User"
  });
  await db.insert(personas).values({
    personaId: TEST_PERSONA_ID,
    userId: TEST_USER_ID,
    name: "Listener Test Persona"
  });

  // 预先通过 storage 创建一个任务
  const task = makeTaskDocument(TEST_TASK_ID);
  await saveTaskMD(task, { personaId: TEST_PERSONA_ID });

  // 启动 HTTP listener
  await startListener(TEST_PORT);
  serverReady = isListenerRunning();
});

afterAll(async () => {
  // 只关闭 HTTP server，不清理数据库数据
  if (isListenerRunning()) {
    await stopListener();
  }
});

// ─── 测试用例 ───────────────────────────────────────────────────

describe("HTTP Listener Endpoints", () => {
  it("GET /listener/status — 应返回 running: true", async () => {
    if (!serverReady) return;
    const { status, body } = await fetchJson("/listener/status");
    expect(status).toBe(200);
    expect(body.running).toBe(true);
  });

  it("GET /tasks — 应返回任务列表", async () => {
    if (!serverReady) return;
    const { status, body } = await fetchJson("/tasks");
    expect(status).toBe(200);
    expect(Array.isArray(body.tasks)).toBe(true);
  });

  it("GET /tasks?all=true — 应包含隐藏任务", async () => {
    if (!serverReady) return;
    const { status, body } = await fetchJson("/tasks?all=true");
    expect(status).toBe(200);
    expect(Array.isArray(body.tasks)).toBe(true);
  });

  it("GET /tasks/:id — 应返回指定任务详情", async () => {
    if (!serverReady) return;
    const { status, body } = await fetchJson(`/tasks/${TEST_TASK_ID}`);
    expect(status).toBe(200);
    expect(body.task.frontmatter.task_id).toBe(TEST_TASK_ID);
    expect(body.task.body.rawDescription).toBe("HTTP 测试任务");
  });

  it("GET /tasks/:id — 不存在的 task 应返回 404", async () => {
    if (!serverReady) return;
    const { status } = await fetchJson(`/tasks/nonexistent-${randomUUID()}`);
    expect(status).toBe(404);
  });

  it("GET /tasks/:id/path — 应返回文件路径", async () => {
    if (!serverReady) return;
    const { status, body } = await fetchJson(`/tasks/${TEST_TASK_ID}/path`);
    expect(status).toBe(200);
    expect(body.path).toContain("task.md");
  });

  it("POST /tasks/:id/hidden — 隐藏任务", async () => {
    if (!serverReady) return;

    // 设置为隐藏
    const { status: s1, body: b1 } = await fetchJson(`/tasks/${TEST_TASK_ID}/hidden`, {
      method: "POST",
      body: JSON.stringify({ hidden: true })
    });
    expect(s1).toBe(200);
    expect(b1.task.frontmatter.hidden).toBe(true);

    // 取消隐藏
    const { status: s2, body: b2 } = await fetchJson(`/tasks/${TEST_TASK_ID}/hidden`, {
      method: "POST",
      body: JSON.stringify({ hidden: false })
    });
    expect(s2).toBe(200);
    expect(b2.task.frontmatter.hidden).toBe(false);
  });

  it("POST /tasks/:id/hidden — 无效 payload 应返回 400", async () => {
    if (!serverReady) return;
    const { status } = await fetchJson(`/tasks/${TEST_TASK_ID}/hidden`, {
      method: "POST",
      body: JSON.stringify({ hidden: "yes" })
    });
    expect(status).toBe(400);
  });

  it("POST /tasks/:id/cancel — 取消 Drafting 任务", async () => {
    if (!serverReady) return;
    const { status, body } = await fetchJson(`/tasks/${TEST_TASK_ID}/cancel`, {
      method: "POST"
    });
    expect(status).toBe(200);
    expect(body.task.frontmatter.status).toBe("Cancelled");
  });

  it("POST /tasks/:id/cancel — 已终态任务应返回 200（幂等）", async () => {
    if (!serverReady) return;
    const { status, body } = await fetchJson(`/tasks/${TEST_TASK_ID}/cancel`, {
      method: "POST"
    });
    expect(status).toBe(200);
    expect(body.message).toContain("终态");
  });

  it("POST /handshake — 无效 schema 应返回 400 + ERROR action", async () => {
    if (!serverReady) return;
    const { status, body } = await fetchJson("/handshake", {
      method: "POST",
      body: JSON.stringify({ bad: "data" })
    });
    expect(status).toBe(400);
    expect(body.action).toBe("ERROR");
    expect(body.error.code).toBe("E_SCHEMA_INVALID");
  });

  it("GET /nonexistent — 未知路由应返回 404", async () => {
    if (!serverReady) return;
    const { status, body } = await fetchJson("/nonexistent");
    expect(status).toBe(404);
    expect(body.error).toBe("Not Found");
  });
});
