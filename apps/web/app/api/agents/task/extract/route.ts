/**
 * POST /api/agents/task/extract — BFF 薄壳
 * 前端每轮用户发言 → 调用 @repo/agent extractFromConversation → 返回提取结果
 *
 * 设计要点：
 *   - 服务端维护有状态的 Conversation 实例（通过 conversationHistory 重建）
 *   - 返回 ExtractionResult：fields / complete / missingFields / followUpQuestion
 *   - complete=false → 前端用 followUpQuestion 做 AI 回复，继续对话
 *   - complete=true  → 前端展示确认摘要，用户确认后调 /api/agents/task/create
 *
 * 请求体：{
 *   personaId: string,
 *   userMessage: string,           // 本轮用户输入
 *   conversationHistory: string[], // 之前所有对话轮次（"用户：xxx" / "AI：xxx"）
 * }
 *
 * 响应：ExtractionResult | { error }
 */
import { NextRequest, NextResponse } from "next/server";
import {
  createExtractionConversation,
  extractFromConversation,
} from "@repo/agent";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      personaId?: string;
      userMessage?: string;
      conversationHistory?: string[];
    };

    // ── 参数校验 ──
    if (!body.personaId?.trim()) {
      return NextResponse.json(
        { error: "缺少 personaId 参数" },
        { status: 400 },
      );
    }
    if (!body.userMessage?.trim()) {
      return NextResponse.json(
        { error: "缺少 userMessage 参数" },
        { status: 400 },
      );
    }

    const history = body.conversationHistory ?? [];

    // ── 重建 Conversation 上下文 ──
    // 每次请求创建新的 Conversation 实例，通过注入历史消息恢复上下文
    const conv = createExtractionConversation();

    // 回放历史：将之前的对话轮次注入 Conversation，让 LLM 拥有完整上下文
    for (const turn of history) {
      if (turn.startsWith("用户：") || turn.startsWith("用户:")) {
        const content = turn.replace(/^用户[：:]/, "").trim();
        if (content) {
          // 注入用户历史消息 → LLM 提取 → 丢弃结果（仅为重建上下文）
          await conv.say(content);
        }
      }
      // AI 回复不需要注入，Conversation 内部会自动记录 assistant 消息
    }

    // ── 执行本轮提取 ──
    const result = await extractFromConversation(conv, body.userMessage.trim());

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[extract] 提取失败:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
