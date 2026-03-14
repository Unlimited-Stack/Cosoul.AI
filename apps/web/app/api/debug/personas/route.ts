/**
 * /api/debug/personas — 调试专用 BFF 路由
 * GET → 返回所有分身的完整数据（含 Soul.md profileText + tasks）
 *
 * 仅供调试页面使用，生产环境应移除或加鉴权。
 */
import { NextResponse } from "next/server";
import { listPersonasDebug } from "@repo/core/persona-server";

const ADMIN_USER_ID =
  process.env.ADMIN_USER_ID ?? "c9bc33bf-db62-41f9-96df-2583a88fbd77";

export async function GET() {
  try {
    const data = await listPersonasDebug(ADMIN_USER_ID);
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
