/**
 * server.ts — Judge Agent HTTP 微服务
 *
 * 路由：
 *   POST /judge    — 执行 L2 裁决（核心接口）
 *   GET  /health   — 健康检查
 *
 * 纯内部服务，只有 task-agent 的 dispatcher 或 BFF 调用，不对前端暴露。
 * 复用 evaluateMatch 作为唯一裁决入口，保证 HTTP 和直接调用走同一条链路。
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { JudgeEvaluateRequestSchema } from "./types";
import { evaluateMatch } from "./index";

// ─── HTTP 路由 ─────────────────────────────────────────────────

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // CORS（开发环境允许跨域，生产环境可收紧）
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  // GET /health — 健康检查
  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      status: "ok",
      service: "judge-agent",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // POST /judge — 执行裁决
  if (req.method === "POST" && url.pathname === "/judge") {
    await handleJudge(req, res);
    return;
  }

  sendJson(res, 404, { error: "Not Found" });
}

// ─── POST /judge 处理 ─────────────────────────────────────────

async function handleJudge(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // 读取请求体
  let body: string;
  try {
    body = await readBody(req);
  } catch {
    sendJson(res, 400, { error: "Failed to read request body" });
    return;
  }

  // 解析 + 校验入参
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON" });
    return;
  }

  const validation = JudgeEvaluateRequestSchema.safeParse(parsed);
  if (!validation.success) {
    sendJson(res, 400, {
      error: "Schema validation failed",
      details: validation.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    });
    return;
  }

  try {
    // 复用 evaluateMatch — HTTP 和直接调用走同一条链路
    const result = await evaluateMatch(validation.data);
    sendJson(res, 200, { success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    console.error(`[JudgeAgent] POST /judge 失败: ${message}`);

    // 区分 task 不存在 vs 其他错误
    const status = message.includes("E_TASK_NOT_FOUND") ? 404 : 500;
    sendJson(res, status, { error: message });
  }
}

// ─── 工具函数 ─────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

// ─── 创建服务器（供 entry.ts 调用） ──────────────────────────

export function createJudgeServer() {
  return createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error("[JudgeAgent] Unhandled error:", err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: "Internal server error" });
      }
    });
  });
}
