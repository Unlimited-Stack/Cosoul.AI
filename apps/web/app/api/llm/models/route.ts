/**
 * GET /api/llm/models
 * 返回 Coding Plan 平台可用模型列表（数据来自 @repo/core/llm）
 */
import { NextResponse } from "next/server";
import { MODELS } from "@repo/core/llm";

export async function GET() {
  return NextResponse.json({ models: MODELS });
}
