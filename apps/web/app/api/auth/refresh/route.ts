/**
 * POST /api/auth/refresh — 刷新 Token（静默续期）
 */
import { NextRequest, NextResponse } from "next/server";
import { refresh, AuthError } from "@repo/core/auth-server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { refreshToken, deviceInfo } = body;

    if (!refreshToken) {
      return NextResponse.json({ error: "缺少 refreshToken" }, { status: 400 });
    }

    const tokens = await refresh({ refreshToken, deviceInfo });
    return NextResponse.json(tokens);
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
