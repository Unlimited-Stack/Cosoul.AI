/**
 * POST /api/user/change-password — 修改密码（已登录状态）
 */
import { NextRequest, NextResponse } from "next/server";
import { changePassword } from "@repo/core/user-server";
import { requireAuth, AuthHttpError } from "@repo/core/auth-middleware";

export async function POST(req: NextRequest) {
  try {
    const auth = requireAuth(req);
    const body = await req.json();
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: "当前密码和新密码不能为空" }, { status: 400 });
    }

    await changePassword(auth.userId, { currentPassword, newPassword });
    return NextResponse.json({ message: "密码修改成功" });
  } catch (err: unknown) {
    if (err instanceof AuthHttpError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    const message = err instanceof Error ? err.message : String(err);
    // 区分业务错误（当前密码错误等）和服务端错误
    const status = message.includes("密码") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
