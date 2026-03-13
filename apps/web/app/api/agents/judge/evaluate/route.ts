/**
 * POST /api/agents/judge/evaluate — Judge 裁决 API
 *
 * 云端独立 Judge 服务入口。主动搜索方调用此接口，
 * 传入双方 taskId，Judge 从 DB 读取双方完整任务数据后进行中立裁决。
 *
 * 请求体：{
 *   initiatorTaskId: string,   // 主动搜索方 task_id
 *   responderTaskId: string,   // 被动方 task_id
 *   round?: number,            // 协商轮次（默认 0）
 *   requesterId?: string,      // 请求方标识（用于日志追踪）
 * }
 *
 * 响应：{
 *   initiatorTaskId, responderTaskId,
 *   decision: JudgeDecision,  // verdict: "MATCH" | "NEGOTIATE" | "REJECT"
 *   round, timestamp, usedFallback
 * }
 *
 * 裁决结果会自动写入双方的 handshake_logs（judge_request + judge_response），
 * 调用方无需额外持久化。
 */
import { NextRequest, NextResponse } from "next/server";
import { evaluateMatch } from "@repo/agent/judge-agent";
import { JudgeEvaluateRequestSchema } from "@repo/agent/judge-agent/types";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // ── Zod 参数校验 ──
    const parseResult = JudgeEvaluateRequestSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: "参数校验失败",
          details: parseResult.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        { status: 400 },
      );
    }

    const request = parseResult.data;

    // ── 调用 Judge 裁决 ──
    const result = await evaluateMatch(request);

    return NextResponse.json(result, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    // 区分任务不存在 vs 内部错误
    if (message.includes("E_TASK_NOT_FOUND")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    console.error("[judge/evaluate] 裁决失败:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
