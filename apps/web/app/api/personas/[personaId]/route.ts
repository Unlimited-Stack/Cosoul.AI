/**
 * /api/personas/:personaId — BFF 薄壳
 * DELETE → 删除分身（级联删除关联任务）
 */
import { NextRequest, NextResponse } from "next/server";
import { deletePersona } from "@repo/core/persona-server";

interface RouteParams {
  params: Promise<{ personaId: string }>;
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const { personaId } = await params;
    const deleted = await deletePersona(personaId);
    if (!deleted) {
      return NextResponse.json({ error: "人格不存在" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, personaId: deleted.personaId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
