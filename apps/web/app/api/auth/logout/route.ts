/**
 * POST /api/auth/logout — 登出（吊销当前 refresh token）
 */
import { NextRequest, NextResponse } from "next/server";
import { logout } from "@repo/core/auth-server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { refreshToken } = body;

    if (!refreshToken) {
      return NextResponse.json({ error: "缺少 refreshToken" }, { status: 400 });
    }

    await logout(refreshToken);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
