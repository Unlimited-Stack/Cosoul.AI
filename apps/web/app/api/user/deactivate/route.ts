/**
 * POST /api/user/deactivate — 注销账号（软删除）
 */
import { NextRequest, NextResponse } from "next/server";
import { deactivateAccount } from "@repo/core/user-server";
import { requireAuth, AuthHttpError } from "@repo/core/auth-middleware";

export async function POST(req: NextRequest) {
  try {
    const auth = requireAuth(req);
    const body = await req.json();
    const { password } = body;

    if (!password) {
      return NextResponse.json({ error: "需要输入密码确认注销" }, { status: 400 });
    }

    await deactivateAccount(auth.userId, password);
    return NextResponse.json({ message: "账号已注销" });
  } catch (err: unknown) {
    if (err instanceof AuthHttpError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    const message = err instanceof Error ? err.message : String(err);
    const status = message === "密码错误" ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
