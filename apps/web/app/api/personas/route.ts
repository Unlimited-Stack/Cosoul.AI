/**
 * /api/personas — BFF 薄壳
 * GET  → 获取当前用户的分身列表
 * POST → 创建新分身（写入 personas + persona_profiles）
 *
 * ⚠️ 当前无认证系统，暂时使用种子用户 Alice 的 userId。
 *    接入认证后替换为 session.userId。
 */
import { NextRequest, NextResponse } from "next/server";
import {
  listPersonas,
  createPersona,
} from "@repo/core/persona-server";

/** Admin 调试账号 — 后续替换为认证系统获取的 userId */
const ADMIN_USER_ID = process.env.ADMIN_USER_ID ?? "c9bc33bf-db62-41f9-96df-2583a88fbd77";

export async function GET() {
  try {
    const personas = await listPersonas(ADMIN_USER_ID);
    return NextResponse.json(personas);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      name?: string;
      bio?: string;
      coreIdentity?: string;
      preferences?: string;
    };

    if (!body.name?.trim()) {
      return NextResponse.json({ error: "缺少 name 参数" }, { status: 400 });
    }

    const persona = await createPersona(ADMIN_USER_ID, {
      name: body.name,
      bio: body.bio ?? "",
      coreIdentity: body.coreIdentity ?? "",
      preferences: body.preferences ?? "",
    });

    return NextResponse.json(persona, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
