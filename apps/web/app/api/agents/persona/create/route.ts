/**
 * POST /api/agents/persona/create — BFF 薄壳
 * 接收 SoulChat 对话历史 → 调用 persona-agent 总结对话 → 创建人格 + Soul.md
 *
 * 请求体：{ conversationTurns: string[] }
 * 响应：  { personaId, name, bio, soulMd } 或 { error }
 *
 * 当前阶段：先从对话中提取 name/bio/coreIdentity 直接创建，
 * 后续接入 @repo/agent PersonaAgent 做完整的 Soul.md 生成。
 */
import { NextRequest, NextResponse } from "next/server";
import { createPersona } from "@repo/core/persona-server";

const ADMIN_USER_ID =
  process.env.ADMIN_USER_ID ?? "c9bc33bf-db62-41f9-96df-2583a88fbd77";

/**
 * 从对话历史中提取人格关键信息（临时实现，后续由 PersonaAgent LLM 接管）
 * 规则：取所有用户发言拼接，第一句作为 name 候选，其余作为 bio/coreIdentity
 */
function extractPersonaFromConversation(turns: string[]) {
  const userTurns = turns
    .filter((t) => t.startsWith("用户："))
    .map((t) => t.replace("用户：", "").trim());

  if (userTurns.length === 0) {
    return { name: "新人格", bio: "", coreIdentity: "" };
  }

  // 简单策略：第一句话的前 20 字做名称，全部拼接做 bio
  const firstMsg = userTurns[0];
  const name = firstMsg.length > 20 ? firstMsg.slice(0, 20) + "…" : firstMsg;
  const bio = userTurns.join("\n");
  const coreIdentity = bio;

  return { name, bio, coreIdentity };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      conversationTurns?: string[];
    };

    if (
      !Array.isArray(body.conversationTurns) ||
      body.conversationTurns.length === 0
    ) {
      return NextResponse.json(
        { error: "缺少 conversationTurns 参数（对话历史数组）" },
        { status: 400 },
      );
    }

    // 从对话中提取人格信息（临时方案，后续接入 PersonaAgent）
    const { name, bio, coreIdentity } = extractPersonaFromConversation(
      body.conversationTurns,
    );

    // 调用已有的 createPersona 写入 DB
    const persona = await createPersona(ADMIN_USER_ID, {
      name,
      bio,
      coreIdentity,
      preferences: "",
    });

    // TODO: 接入 @repo/agent PersonaAgent
    //   const agent = new PersonaAgent(persona.personaId, "", "");
    //   const soulMd = await agent.generateSoulMd(body.conversationTurns);
    //   await savePersonaProfile(persona.personaId, soulMd);

    return NextResponse.json(
      {
        personaId: persona.personaId,
        name: persona.name,
        bio: persona.bio,
        // soulMd: "", // 后续由 PersonaAgent 生成
      },
      { status: 201 },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
