/**
 * /api/user/profile — BFF 薄壳
 * GET  → 获取当前用户信息
 * PATCH → 修改用户信息（部分更新）
 *
 * 认证：通过 Authorization: Bearer <token> 获取 userId
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserProfile, updateUserProfile } from "@repo/core/user-server";
import { requireAuth, AuthHttpError } from "@repo/core/auth-middleware";

export async function GET(req: NextRequest) {
  try {
    const auth = requireAuth(req);
    const profile = await getUserProfile(auth.userId);
    if (!profile) {
      return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    }
    return NextResponse.json(profile);
  } catch (err: unknown) {
    if (err instanceof AuthHttpError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = requireAuth(req);
    const body = await req.json();
    const updated = await updateUserProfile(auth.userId, body);
    if (!updated) {
      return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (err: unknown) {
    if (err instanceof AuthHttpError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
