import { Conversation } from "@repo/core/llm";
import { readTaskDocument, saveTaskMD, saveChatMessage } from "./storage";
import { embedTaskFields } from "./embedding";
import { saveTaskVectors } from "./retrieval";
import type { TaskDocument } from "./types";

/**
 * Revise 模块：处理 Revising 状态的任务修改。
 *
 * 与 intake 不同，revise 场景下基本信息已齐全，用户通过对话指令修改已有字段。
 * LLM 理解用户修改意图后，输出更新后的完整 JSON，程序侧写入 task.md → 同步 DB → re-embedding。
 */

// ─── 类型 ─────────────────────────────────────────────────────────

export interface ReviseResult {
  /** 修改后的 TaskDocument */
  task: TaskDocument;
  /** 本轮修改了哪些字段 */
  changedFields: string[];
  /** LLM 对本次修改的说明（展示给用户） */
  summary: string;
  /** 是否需要重新 embedding（向量字段有变化） */
  needReEmbed: boolean;
}

export interface ReviseSessionState {
  taskId: string;
  personaId: string;
  conv: Conversation;
  currentTask: TaskDocument;
  round: number;
}

// ─── Prompt ───────────────────────────────────────────────────────

const REVISE_SYSTEM_PROMPT = `你是一个社交匹配任务修改助手。用户已经有了一个匹配任务，现在想要修改它。

## 当前任务信息
{currentTask}

## 你的职责
用户会告诉你想怎么改（可能是修改活动、氛围、互动方式等），你需要：
1. 理解用户的修改意图
2. 输出修改后的完整 JSON（所有字段都要包含，即使没有修改的也保留原值）

## 输出格式
先用一句话简要说明你做了什么修改，然后输出 JSON 块：

修改说明文字

\`\`\`json
{
  "interaction_type": "online" | "offline" | "any",
  "rawDescription": "修改后的核心需求描述，≤50字",
  "targetActivity": "修改后的具体活动，≤50字",
  "targetVibe": "修改后的期望氛围/对方特质，≤50字",
  "detailedPlan": "修改后的完整需求详情"
}
\`\`\`

## 修改原则
- 只改用户要求改的部分，其余保持原样
- 不要擅自扩大或缩小修改范围
- 如果用户的修改指令不明确，先确认再改
- 如果用户说"没什么要改的"或类似的话，原样输出所有字段

## 如果用户想聊天或问问题
- 如果用户的消息不是修改指令（比如在问问题、闲聊），正常回复即可，不需要输出 JSON
- 只在确实有修改动作时才输出 JSON 块`;

// ─── 核心 API ─────────────────────────────────────────────────────

/**
 * 创建一个 Revise 会话。
 * API 路由在用户进入 Revising 状态时调用一次。
 */
export async function createReviseSession(taskId: string, personaId: string): Promise<ReviseSessionState> {
  const task = await readTaskDocument(taskId);

  const taskSummary = formatTaskForPrompt(task);
  const system = REVISE_SYSTEM_PROMPT.replace("{currentTask}", taskSummary);

  const conv = new Conversation({
    system,
    temperature: 0.5,
    maxTokens: 2000,
  });

  return { taskId, personaId, conv, currentTask: task, round: 0 };
}

/**
 * 处理用户在 Revising 状态下的一条消息。
 * 返回 ReviseResult（如果 LLM 输出了 JSON 修改）或 null（纯对话，无修改）。
 */
export async function processReviseMessage(
  session: ReviseSessionState,
  userMessage: string,
): Promise<{ reply: string; revision: ReviseResult | null }> {
  session.round += 1;

  // 持久化用户消息
  await saveChatMessage({
    taskId: session.taskId,
    personaId: session.personaId,
    senderType: "human",
    senderId: session.personaId,
    content: userMessage,
    metadata: { phase: "revise", round: session.round },
  });

  const response = await session.conv.say(userMessage);
  const text = response.content;

  // 持久化 LLM 回复
  await saveChatMessage({
    taskId: session.taskId,
    personaId: session.personaId,
    senderType: "agent",
    senderId: session.personaId,
    content: text,
    metadata: { phase: "revise", round: session.round },
  });

  // 尝试从回复中提取 JSON 块
  const jsonMatch = text.match(/```json\s*\n([\s\S]*?)\n\s*```/);

  if (!jsonMatch) {
    // 纯对话，没有修改
    return { reply: text, revision: null };
  }

  // 有 JSON → 解析修改
  const summary = text.slice(0, text.indexOf("```json")).trim();

  try {
    const parsed = JSON.parse(jsonMatch[1]);
    const oldTask = session.currentTask;

    // 检测变更字段
    const changedFields: string[] = [];
    if (parsed.rawDescription !== undefined && parsed.rawDescription !== oldTask.body.rawDescription) {
      changedFields.push("rawDescription");
    }
    if (parsed.targetActivity !== undefined && parsed.targetActivity !== oldTask.body.targetActivity) {
      changedFields.push("targetActivity");
    }
    if (parsed.targetVibe !== undefined && parsed.targetVibe !== oldTask.body.targetVibe) {
      changedFields.push("targetVibe");
    }
    if (parsed.detailedPlan !== undefined && parsed.detailedPlan !== oldTask.body.detailedPlan) {
      changedFields.push("detailedPlan");
    }
    if (parsed.interaction_type !== undefined && parsed.interaction_type !== oldTask.frontmatter.interaction_type) {
      changedFields.push("interaction_type");
    }

    if (changedFields.length === 0) {
      return { reply: summary || "当前没有需要修改的内容。", revision: null };
    }

    // 构建更新后的 TaskDocument
    const updatedTask: TaskDocument = {
      frontmatter: {
        ...oldTask.frontmatter,
        interaction_type: parsed.interaction_type ?? oldTask.frontmatter.interaction_type,
        updated_at: new Date().toISOString(),
        version: oldTask.frontmatter.version + 1,
      },
      body: {
        rawDescription: truncate(String(parsed.rawDescription ?? oldTask.body.rawDescription), 50),
        targetActivity: truncate(String(parsed.targetActivity ?? oldTask.body.targetActivity), 50),
        targetVibe: truncate(String(parsed.targetVibe ?? oldTask.body.targetVibe), 50),
        detailedPlan: String(parsed.detailedPlan ?? oldTask.body.detailedPlan),
      },
    };

    // 写入 DB + task.md（saveTaskMD 内部 syncDerivedLayers 会写 task.md）
    await saveTaskMD(updatedTask, { expectedVersion: oldTask.frontmatter.version });

    // 更新 session 中的当前任务快照
    session.currentTask = updatedTask;

    const vectorFields = ["targetActivity", "targetVibe", "rawDescription"];
    const needReEmbed = changedFields.some((f) => vectorFields.includes(f));

    return {
      reply: summary || `已修改: ${changedFields.join("、")}`,
      revision: {
        task: updatedTask,
        changedFields,
        summary: summary || `已修改: ${changedFields.join("、")}`,
        needReEmbed,
      },
    };
  } catch {
    return { reply: text, revision: null };
  }
}

/**
 * 完成修改，触发 re-embedding 并准备重新进入 Searching。
 * 调用方在用户确认修改完成后调用。
 */
export async function finalizeRevision(taskId: string): Promise<{
  task: TaskDocument;
  reEmbedded: boolean;
}> {
  const task = await readTaskDocument(taskId);

  // 无论如何都重新 embedding，因为 Revising 状态意味着用户想重新匹配
  let reEmbedded = false;
  if (task.body.targetActivity && task.body.targetVibe && task.body.rawDescription) {
    const result = await embedTaskFields(
      taskId,
      task.body.targetActivity,
      task.body.targetVibe,
      task.body.rawDescription,
    );
    await saveTaskVectors(
      taskId,
      result.embeddings.map((e) => ({ field: e.field, vector: e.vector })),
    );
    reEmbedded = true;
  }

  return { task, reEmbedded };
}

// ─── 内部辅助 ─────────────────────────────────────────────────────

function formatTaskForPrompt(task: TaskDocument): string {
  return [
    `互动方式: ${task.frontmatter.interaction_type}`,
    `核心需求: ${task.body.rawDescription}`,
    `目标活动: ${task.body.targetActivity}`,
    `期望氛围: ${task.body.targetVibe}`,
    `详细计划: ${task.body.detailedPlan || "（无）"}`,
  ].join("\n");
}

function truncate(text: string, maxLen: number): string {
  if (!text) return "";
  return text.length <= maxLen ? text : text.slice(0, maxLen);
}
