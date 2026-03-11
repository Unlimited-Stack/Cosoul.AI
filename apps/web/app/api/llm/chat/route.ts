/**
 * POST /api/llm/chat
 * BFF 薄壳 — 转发完整对话请求到 Coding Plan（支持 HTTPS 代理）
 *
 * 浏览器 → POST /api/llm/chat { model, messages, ... }
 *        → chatOnServer() → Coding Plan → ChatResponse → 浏览器
 */
import { NextRequest, NextResponse } from "next/server";
import { chatOnServer } from "@repo/core/llm-server";

const serverConfig = {
  baseUrl: process.env.CODING_PLAN_BASE_URL ?? "https://coding.dashscope.aliyuncs.com/v1",
  apiKey: process.env.CODING_PLAN_API_KEY ?? "",
  proxy: process.env.HTTPS_PROXY || process.env.https_proxy || "",
};

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    model?: string;
    messages?: unknown[];
    temperature?: number;
    maxTokens?: number;
    stop?: string[];
  };

  if (!body.model || !Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json(
      { error: "缺少 model 或 messages 参数" },
      { status: 400 },
    );
  }

  try {
    const result = await chatOnServer(
      {
        model: body.model,
        messages: body.messages as { role: "system" | "user" | "assistant"; content: string }[],
        temperature: body.temperature,
        maxTokens: body.maxTokens,
        stop: body.stop,
      },
      serverConfig,
    );
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
