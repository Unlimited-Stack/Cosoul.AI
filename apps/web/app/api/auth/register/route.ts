/**
 * POST /api/auth/register — 用户注册
 * BFF 薄壳，实际逻辑在 @repo/core/auth-server
 */
import { NextRequest, NextResponse } from "next/server";
import { register, AuthError } from "@repo/core/auth-server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password, name, deviceInfo } = body;

    if (!email || !password) {
      return NextResponse.json({ error: "邮箱和密码不能为空" }, { status: 400 });
    }

    const result = await register({ email, password, name, deviceInfo });
    return NextResponse.json(result, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
