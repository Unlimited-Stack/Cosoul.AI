/**
 * POST /api/llm/verify
 * BFF 薄壳 — 转发模型验证请求到 @repo/core 服务端实现
 *
 * 为什么 Web 需要 BFF 而 Native 不需要？
 * 1. 浏览器有 CORS 限制，不能直接请求 coding.dashscope.aliyuncs.com
 * 2. API Key 保留在服务端，不暴露给前端
 * 3. 服务端需要 HTTPS_PROXY 支持（容器网络环境）
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyModelOnServer } from "@repo/core/llm-server";

const serverConfig = {
  baseUrl: process.env.CODING_PLAN_BASE_URL ?? "https://coding.dashscope.aliyuncs.com/v1",
  apiKey: process.env.CODING_PLAN_API_KEY ?? "",
  proxy: process.env.HTTPS_PROXY || process.env.https_proxy || "",
};

export async function POST(req: NextRequest) {
  const { model } = (await req.json()) as { model?: string };
  if (!model) {
    return NextResponse.json(
      { ok: false, model: "", error: "缺少 model 参数" },
      { status: 400 },
    );
  }

  const result = await verifyModelOnServer(model, serverConfig);
  return NextResponse.json(result);
}
