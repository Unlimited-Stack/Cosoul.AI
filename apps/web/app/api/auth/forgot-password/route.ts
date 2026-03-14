/**
 * POST /api/auth/forgot-password — 发送重置密码验证码
 */
import { NextRequest, NextResponse } from "next/server";
import { forgotPassword, AuthError } from "@repo/core/auth-server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json({ error: "邮箱不能为空" }, { status: 400 });
    }

    await forgotPassword(email);
    // 不暴露邮箱是否注册，统一返回成功
    return NextResponse.json({ message: "如果该邮箱已注册，验证码已发送" });
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
