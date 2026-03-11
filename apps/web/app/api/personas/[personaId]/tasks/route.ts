/**
 * /api/personas/:personaId/tasks — BFF 薄壳
 * GET  → 获取指定分身的任务列表
 * POST → 为指定分身创建新任务
 */
import { NextRequest, NextResponse } from "next/server";
import { listTasks, createTask } from "@repo/core/persona-server";

interface RouteParams {
  params: Promise<{ personaId: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { personaId } = await params;
    const tasks = await listTasks(personaId);
    return NextResponse.json(tasks);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { personaId } = await params;
    const body = (await req.json()) as {
      rawDescription?: string;
      interactionType?: string;
    };

    if (!body.rawDescription?.trim()) {
      return NextResponse.json({ error: "缺少 rawDescription 参数" }, { status: 400 });
    }

    const task = await createTask(personaId, {
      rawDescription: body.rawDescription,
      interactionType: body.interactionType ?? "any",
    });

    return NextResponse.json(task, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
