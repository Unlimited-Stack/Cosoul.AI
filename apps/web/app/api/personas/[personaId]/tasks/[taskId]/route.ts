/**
 * /api/personas/:personaId/tasks/:taskId — BFF 薄壳
 * DELETE → 删除指定任务
 */
import { NextRequest, NextResponse } from "next/server";
import { deleteTask } from "@repo/core/persona-server";

interface RouteParams {
  params: Promise<{ personaId: string; taskId: string }>;
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const { taskId } = await params;
    const deleted = await deleteTask(taskId);
    if (!deleted) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, taskId: deleted.taskId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
