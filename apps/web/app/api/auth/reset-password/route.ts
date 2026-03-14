/**
 * POST /api/auth/reset-password — 通过验证码重置密码
 */
import { NextRequest, NextResponse } from "next/server";
import { resetPassword, AuthError } from "@repo/core/auth-server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, code, newPassword } = body;

    if (!email || !code || !newPassword) {
      return NextResponse.json({ error: "邮箱、验证码和新密码不能为空" }, { status: 400 });
    }

    await resetPassword({ email, code, newPassword });
    return NextResponse.json({ message: "密码重置成功，请重新登录" });
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
