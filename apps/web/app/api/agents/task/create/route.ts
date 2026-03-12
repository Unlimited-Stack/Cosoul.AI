/**
 * POST /api/agents/task/create — BFF 薄壳
 * 前端确认任务提取结果后 → 调用 createTaskAgentFromIntake → 创建任务 + 启动 FSM
 *
 * 请求体：{
 *   personaId: string,
 *   conversationTurns: string[],   // 完整对话历史（"用户：xxx" / "AI：xxx"）
 *   extractedFields?: { ... },     // 可选，前端已确认的提取字段（跳过重复提取）
 * }
 *
 * 响应：{ taskId, personaId, rawDescription, status, targetActivity, targetVibe }
 *
 * 流程：
 *   1. 查询 persona 的 profileText（Soul.md）构建 PersonaContext
 *   2. 调用 createTaskAgentFromIntake(turns, ctx) — LLM 提取 + 持久化 + embedding
 *   3. 调用 taskAgent.step() — Drafting → Searching（自动开始匹配）
 *   4. 返回任务摘要
 */
import { NextRequest, NextResponse } from "next/server";
import { getPersonaWithProfile } from "@repo/core/persona-server";
import { createTaskAgentFromIntake } from "@repo/agent";
import type { PersonaContext } from "@repo/agent";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      personaId?: string;
      conversationTurns?: string[];
    };

    // ── 参数校验 ──
    if (!body.personaId?.trim()) {
      return NextResponse.json(
        { error: "缺少 personaId 参数" },
        { status: 400 },
      );
    }
    if (
      !Array.isArray(body.conversationTurns) ||
      body.conversationTurns.length === 0
    ) {
      return NextResponse.json(
        { error: "缺少 conversationTurns 参数（对话历史数组）" },
        { status: 400 },
      );
    }

    // ── 查询 Persona Profile → 构建 PersonaContext ──
    const persona = await getPersonaWithProfile(body.personaId);
    if (!persona) {
      return NextResponse.json(
        { error: "人格不存在" },
        { status: 404 },
      );
    }

    const personaContext: PersonaContext = {
      personaId: persona.personaId,
      personaName: persona.name,
      soulText: persona.profileText ?? "",
      preferences: (persona.preferences as Record<string, unknown>) ?? {},
      relevantMemory: "",
      tokenBudget: 4000,
    };

    // ── 调用 TaskAgent 完整 Intake 流程 ──
    // extractFromConversation → buildTaskDocument → saveTaskMD → embedding → 返回 TaskAgent
    const taskAgent = await createTaskAgentFromIntake(
      body.conversationTurns,
      personaContext,
    );

    // ── 驱动 FSM：Drafting → Searching ──
    let stepResult;
    try {
      stepResult = await taskAgent.step();
      console.log("[task/create] FSM step:", stepResult);
    } catch (stepErr) {
      // step 失败不影响任务创建，任务已持久化，后续可通过 task_loop 重试
      console.warn("[task/create] FSM step 失败（任务已创建）:", stepErr);
    }

    // ── 读取最终任务数据返回 ──
    const task = await taskAgent.getTask();

    return NextResponse.json(
      {
        taskId: task.frontmatter.task_id,
        personaId: body.personaId,
        rawDescription: task.body.rawDescription,
        targetActivity: task.body.targetActivity,
        targetVibe: task.body.targetVibe,
        status: task.frontmatter.status,
      },
      { status: 201 },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[task/create] 创建失败:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
