import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import {
  dispatchInboundHandshake,
  getListeningReportForTask,
  getWaitingHumanSummary,
  handleWaitingHumanIntent,
  type WaitingHumanIntent
} from "./dispatcher";
import { runTaskStepById } from "./task_loop";
import {
  HandshakeInboundEnvelopeSchema,
  parseTaskDocument,
  type HandshakeInboundEnvelope,
  type HandshakeOutboundEnvelope,
  type ListeningReport
} from "./types";
import {
  getTaskFilePath,
  listAllTasks,
  readTaskDocument,
  saveTaskMD,
  setTaskHidden,
  transitionTaskStatus
} from "./storage";

// ======================== HTTP Listener (Passive Flow Gateway) ========================
//
// 旧架构中 runtime.ts (CLI shell) 的所有命令已由本模块 HTTP 端点 + 前端 AgentScreen 完全覆盖：
//   list        → GET  /tasks
//   new         → POST /tasks（由前端通过 createTaskAgentFromIntake 创建后调用）
//   select      → 前端客户端状态
//   run         → POST /tasks/:id/run
//   end         → POST /tasks/:id/end
//   cancel      → POST /tasks/:id/cancel
//   listen      → POST /tasks/:id/listener  { enabled: true }
//   unlisten    → POST /tasks/:id/listener  { enabled: false }
//   report      → GET  /tasks/:id/report
//   reopen      → POST /tasks/:id/reopen
//   hide/unhide → POST /tasks/:id/hidden
//   path        → GET  /tasks/:id/path
//   handshake   → POST /handshake

let serverInstance: Server | null = null;

/**
 * Passive flow gateway.
 * HTTP inbound pipeline with safeParse -> dispatcher -> protocol response.
 */
export async function startListener(port = 8080): Promise<void> {
  if (serverInstance) {
    return;
  }

  serverInstance = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    await handleHttpRequest(req, res);
  });

  await new Promise<void>((resolve) => {
    serverInstance?.listen(port, "0.0.0.0", () => resolve());
  });
}

export async function stopListener(): Promise<void> {
  if (!serverInstance) {
    return;
  }

  const instance = serverInstance;
  serverInstance = null;

  await new Promise<void>((resolve, reject) => {
    instance.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export function isListenerRunning(): boolean {
  return serverInstance !== null;
}

export async function handleInboundHandshake(payload: unknown): Promise<HandshakeOutboundEnvelope> {
  const parsed = HandshakeInboundEnvelopeSchema.safeParse(payload);
  if (!parsed.success) {
    return buildSchemaErrorResponse(payload);
  }

  const envelope: HandshakeInboundEnvelope = parsed.data;
  return dispatchInboundHandshake(envelope);
}

// ─── 终态常量 ──────────────────────────────────────────────────────
const TERMINAL_STATUSES = ["Closed", "Failed", "Timeout", "Cancelled"] as const;

async function handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? "GET";
  const parsedUrl = new URL(req.url ?? "/", "http://localhost");
  const pathname = parsedUrl.pathname;
  const payload = method === "POST" || method === "PATCH" ? await readJsonBody(req) : {};

  // ─── Handshake endpoint ──────────────────────────────────────
  if (method === "POST" && pathname === "/handshake") {
    const response = await handleInboundHandshake(payload);
    sendJson(res, response.action === "ERROR" ? 400 : 200, response);
    return;
  }

  // ─── Task list（覆盖旧 runtime: list [all]）─────────────────
  if (method === "GET" && pathname === "/tasks") {
    const showAll = parsedUrl.searchParams.get("all") === "true";
    const records = await listAllTasks();
    const visible = showAll ? records : records.filter((r) => !r.task.frontmatter.hidden);
    sendJson(res, 200, {
      tasks: visible.map((record) => ({
        task_id: record.task.frontmatter.task_id,
        status: record.task.frontmatter.status,
        hidden: record.task.frontmatter.hidden,
        version: record.task.frontmatter.version,
        updated_at: record.task.frontmatter.updated_at
      }))
    });
    return;
  }

  // ─── Create task（覆盖旧 runtime: new）───────────────────────
  if (method === "POST" && pathname === "/tasks") {
    try {
      const task = parseTaskDocument(payload);
      await saveTaskMD(task);
      sendJson(res, 201, { task_id: task.frontmatter.task_id });
    } catch (error) {
      sendJson(res, 400, { error: normalizeErrorMessage(error) });
    }
    return;
  }

  // ─── Read single task（覆盖旧 runtime: select + active 信息查看）
  const taskIdMatch = pathname.match(/^\/tasks\/([^/]+)$/);
  if (method === "GET" && taskIdMatch) {
    const taskId = decodeURIComponent(taskIdMatch[1]);
    try {
      const task = await readTaskDocument(taskId);
      const summary = task.frontmatter.status === "Waiting_Human" ? await getWaitingHumanSummary(taskId) : null;
      const taskPath = await getTaskFilePath(taskId);
      sendJson(res, 200, { task, waiting_human_summary: summary, task_path: taskPath });
    } catch (error) {
      sendJson(res, 404, { error: normalizeErrorMessage(error) });
    }
    return;
  }

  // ─── Run task step（覆盖旧 runtime: run）─────────────────────
  const taskRunMatch = pathname.match(/^\/tasks\/([^/]+)\/run$/);
  if (method === "POST" && taskRunMatch) {
    const taskId = decodeURIComponent(taskRunMatch[1]);
    try {
      const result = await runTaskStepById(taskId);
      const latest = await readTaskDocument(taskId);
      sendJson(res, 200, {
        changed: result.changed,
        handled: result.handled,
        previous_status: result.previousStatus,
        current_status: result.currentStatus,
        task: latest
      });
    } catch (error) {
      sendJson(res, 400, { error: normalizeErrorMessage(error) });
    }
    return;
  }

  // ─── End task（覆盖旧 runtime: end）──────────────────────────
  const taskEndMatch = pathname.match(/^\/tasks\/([^/]+)\/end$/);
  if (method === "POST" && taskEndMatch) {
    const taskId = decodeURIComponent(taskEndMatch[1]);
    try {
      const task = await readTaskDocument(taskId);
      if ((TERMINAL_STATUSES as readonly string[]).includes(task.frontmatter.status)) {
        sendJson(res, 200, { message: `任务已是终态：${task.frontmatter.status}`, task });
        return;
      }
      if (task.frontmatter.status !== "Waiting_Human") {
        sendJson(res, 400, {
          error: `end 仅在 Waiting_Human 阶段可用（当前：${task.frontmatter.status}）。如需放弃任务请用 cancel。`
        });
        return;
      }
      await transitionTaskStatus(taskId, "Closed", {
        expectedVersion: task.frontmatter.version,
        traceId: "api",
        messageId: "owner"
      });
      const latest = await readTaskDocument(taskId);
      sendJson(res, 200, { message: "任务已结束：Closed", task: latest });
    } catch (error) {
      sendJson(res, 400, { error: normalizeErrorMessage(error) });
    }
    return;
  }

  // ─── Cancel task（覆盖旧 runtime: cancel）────────────────────
  const taskCancelMatch = pathname.match(/^\/tasks\/([^/]+)\/cancel$/);
  if (method === "POST" && taskCancelMatch) {
    const taskId = decodeURIComponent(taskCancelMatch[1]);
    try {
      const task = await readTaskDocument(taskId);
      if ((TERMINAL_STATUSES as readonly string[]).includes(task.frontmatter.status)) {
        sendJson(res, 200, { message: `任务已是终态：${task.frontmatter.status}`, task });
        return;
      }
      await transitionTaskStatus(taskId, "Cancelled", {
        expectedVersion: task.frontmatter.version,
        traceId: "api",
        messageId: "owner"
      });
      const latest = await readTaskDocument(taskId);
      sendJson(res, 200, { message: "任务已放弃：Cancelled", task: latest });
    } catch (error) {
      sendJson(res, 400, { error: normalizeErrorMessage(error) });
    }
    return;
  }

  // ─── Task listener control（覆盖旧 runtime: listen / unlisten）
  const taskListenerMatch = pathname.match(/^\/tasks\/([^/]+)\/listener$/);
  if (method === "POST" && taskListenerMatch) {
    const taskId = decodeURIComponent(taskListenerMatch[1]);
    const command = parseTaskListenerCommand(payload);
    if (!command) {
      sendJson(res, 400, { error: "Invalid listener command payload. Expected { enabled: boolean, abandon?: boolean }" });
      return;
    }

    try {
      const before = await readTaskDocument(taskId);

      if (command.enabled) {
        // listen: Waiting_Human → Listening
        await transitionTaskStatus(taskId, "Listening", {
          expectedVersion: before.frontmatter.version,
          traceId: "api",
          messageId: "owner"
        });
      } else {
        // unlisten: Listening → Waiting_Human, or Cancelled if abandon
        const targetStatus = command.abandon ? "Cancelled" : "Waiting_Human";
        await transitionTaskStatus(taskId, targetStatus, {
          expectedVersion: before.frontmatter.version,
          traceId: "api",
          messageId: "owner"
        });
      }

      const latest = await readTaskDocument(taskId);
      sendJson(res, 200, {
        task_id: latest.frontmatter.task_id,
        status: latest.frontmatter.status,
        version: latest.frontmatter.version
      });
    } catch (error) {
      sendJson(res, 400, { error: normalizeErrorMessage(error) });
    }
    return;
  }

  // ─── Listening report（覆盖旧 runtime: report）──────────────
  const taskReportMatch = pathname.match(/^\/tasks\/([^/]+)\/report$/);
  if (method === "GET" && taskReportMatch) {
    const taskId = decodeURIComponent(taskReportMatch[1]);
    try {
      const report: ListeningReport = await getListeningReportForTask(taskId);
      sendJson(res, 200, report);
    } catch (error) {
      sendJson(res, 400, { error: normalizeErrorMessage(error) });
    }
    return;
  }

  // ─── Reopen task（覆盖旧 runtime: reopen）────────────────────
  const taskReopenMatch = pathname.match(/^\/tasks\/([^/]+)\/reopen$/);
  if (method === "POST" && taskReopenMatch) {
    const taskId = decodeURIComponent(taskReopenMatch[1]);
    try {
      const task = await readTaskDocument(taskId);
      await transitionTaskStatus(taskId, "Waiting_Human", {
        expectedVersion: task.frontmatter.version,
        traceId: "api",
        messageId: "owner"
      });
      const latest = await readTaskDocument(taskId);
      sendJson(res, 200, { message: "任务已重开为 Waiting_Human", task: latest });
    } catch (error) {
      sendJson(res, 400, { error: normalizeErrorMessage(error) });
    }
    return;
  }

  // ─── Hide / unhide task（覆盖旧 runtime: hide / unhide）─────
  const taskHiddenMatch = pathname.match(/^\/tasks\/([^/]+)\/hidden$/);
  if (method === "POST" && taskHiddenMatch) {
    const taskId = decodeURIComponent(taskHiddenMatch[1]);
    const hidden = parseHiddenCommand(payload);
    if (hidden === null) {
      sendJson(res, 400, { error: "Invalid payload. Expected { hidden: boolean }" });
      return;
    }
    try {
      await setTaskHidden(taskId, hidden);
      const latest = await readTaskDocument(taskId);
      sendJson(res, 200, {
        message: hidden ? `任务已隐藏：${taskId}` : `任务已取消隐藏：${taskId}`,
        task: latest
      });
    } catch (error) {
      sendJson(res, 400, { error: normalizeErrorMessage(error) });
    }
    return;
  }

  // ─── Task file path（覆盖旧 runtime: path）──────────────────
  const taskPathMatch = pathname.match(/^\/tasks\/([^/]+)\/path$/);
  if (method === "GET" && taskPathMatch) {
    const taskId = decodeURIComponent(taskPathMatch[1]);
    try {
      const taskPath = await getTaskFilePath(taskId);
      sendJson(res, 200, { task_id: taskId, path: taskPath });
    } catch (error) {
      sendJson(res, 404, { error: normalizeErrorMessage(error) });
    }
    return;
  }

  // ─── Waiting human intent（对端/前端触发意图决策）────────────
  const waitingIntentMatch = pathname.match(/^\/tasks\/([^/]+)\/waiting-human-intent$/);
  if (method === "POST" && waitingIntentMatch) {
    const taskId = decodeURIComponent(waitingIntentMatch[1]);
    const intent = parseWaitingHumanIntentPayload(payload);
    if (!intent) {
      sendJson(res, 400, { error: "Invalid waiting-human intent" });
      return;
    }
    try {
      const result = await handleWaitingHumanIntent(taskId, intent);
      sendJson(res, 200, {
        ...result,
        listener_running: isListenerRunning(),
        task: await readTaskDocument(taskId)
      });
    } catch (error) {
      sendJson(res, 400, { error: normalizeErrorMessage(error) });
    }
    return;
  }

  // ─── Listener management ────────────────────────────────────
  if (method === "POST" && pathname === "/listener/start") {
    await startListener();
    sendJson(res, 200, { running: true });
    return;
  }

  if (method === "POST" && pathname === "/listener/stop") {
    sendJson(res, 400, {
      error: "Global listener stop is disabled. Use POST /tasks/:id/listener with {\"enabled\":false} instead."
    });
    return;
  }

  if (method === "GET" && pathname === "/listener/status") {
    sendJson(res, 200, { running: isListenerRunning() });
    return;
  }

  sendJson(res, 404, { error: "Not Found" });
}

// ─── Payload 解析辅助 ──────────────────────────────────────────────

function parseWaitingHumanIntentPayload(payload: unknown): WaitingHumanIntent | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const intent = (payload as Record<string, unknown>).intent;
  if (
    intent === "satisfied" ||
    intent === "unsatisfied" ||
    intent === "enable_listener" ||
    intent === "closed" ||
    intent === "friend_request" ||
    intent === "exit"
  ) {
    return intent;
  }
  return null;
}

function parseTaskListenerCommand(payload: unknown): { enabled: boolean; abandon: boolean } | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const enabled = (payload as Record<string, unknown>).enabled;
  const abandonRaw = (payload as Record<string, unknown>).abandon;
  if (typeof enabled !== "boolean") {
    return null;
  }
  return {
    enabled,
    abandon: typeof abandonRaw === "boolean" ? abandonRaw : true
  };
}

function parseHiddenCommand(payload: unknown): boolean | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const hidden = (payload as Record<string, unknown>).hidden;
  if (typeof hidden !== "boolean") {
    return null;
  }
  return hidden;
}

// ─── HTTP 辅助 ─────────────────────────────────────────────────────

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.statusCode = statusCode;
  res.end(JSON.stringify(body));
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "Internal error";
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString("utf8").trim();
  if (body.length === 0) {
    return {};
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    return {};
  }
}

function buildSchemaErrorResponse(payload: unknown): HandshakeOutboundEnvelope {
  const inReplyTo =
    typeof payload === "object" && payload !== null && typeof (payload as Record<string, unknown>).message_id === "string"
      ? ((payload as Record<string, unknown>).message_id as string)
      : "unknown";

  const taskId =
    typeof payload === "object" && payload !== null && typeof (payload as Record<string, unknown>).task_id === "string"
      ? ((payload as Record<string, unknown>).task_id as string)
      : "unknown";

  return {
    protocol_version: "1.0",
    message_id: randomUUID(),
    in_reply_to: inReplyTo,
    task_id: taskId,
    action: "ERROR",
    error: {
      code: "E_SCHEMA_INVALID",
      message: "Inbound handshake schema validation failed"
    },
    timestamp: new Date().toISOString()
  };
}
