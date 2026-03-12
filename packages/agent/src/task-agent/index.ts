import type { PersonaContext } from "../persona-agent/types";
import { buildTaskDocument, createExtractionConversation, extractFromConversation } from "./intake";
import { runTaskStep, runTaskStepById, saveIntakeResult } from "./task_loop";
import { readTaskDocument, saveTaskMD, transitionTaskStatus } from "./storage";
import { buildPromptContext } from "./context";
import { embedTaskFields } from "./embedding";
import { saveTaskVectors } from "./retrieval";
import type { TaskDocument, TaskStatus } from "./types";

export type { TaskStepResult } from "./task_loop";

// ============================================================
// TaskAgent — 单任务执行引擎
// 职责：驱动单个 Task 的 FSM 生命周期
//   - 接受 PersonaContext 只读注入（soulText / preferences / tokenBudget）
//   - 执行 Drafting → Searching → Negotiating → Closed 状态流转
//   - 不直接操作 DB；通过 storage 层代理
// ============================================================

export class TaskAgent {
  private taskId: string;
  private personaContext: PersonaContext;

  /**
   * @param taskId - 任务 UUID（必须已在 PostgreSQL tasks 表中存在）
   * @param personaContext - 由 PersonaAgent.getContext() 注入的只读快照
   */
  constructor(taskId: string, personaContext: PersonaContext) {
    this.taskId = taskId;
    this.personaContext = personaContext;
  }

  get id(): string {
    return this.taskId;
  }

  /**
   * 读取当前任务文档
   */
  async getTask(): Promise<TaskDocument> {
    return readTaskDocument(this.taskId);
  }

  /**
   * 执行单步 FSM 推进。
   * 返回状态是否发生了变化。
   */
  async step(): Promise<{ changed: boolean; previousStatus: TaskStatus; currentStatus: TaskStatus }> {
    const result = await runTaskStepById(this.taskId);
    return {
      changed: result.changed,
      previousStatus: result.previousStatus,
      currentStatus: result.currentStatus
    };
  }

  /**
   * 构建当前 prompt 上下文（供外部调用，如 API route 生成对话提示）
   * 注入 soulText，让 LLM 以分身视角执行
   */
  async buildContext(conversationTurns: string[]) {
    const task = await this.getTask();
    return buildPromptContext({
      task,
      conversationTurns,
      tokenBudget: this.personaContext.tokenBudget,
      soulText: this.personaContext.soulText
    });
  }

  /**
   * 直接运行任务步骤（使用已有的 task 对象，避免重复读取）
   */
  async stepWithTask(task: TaskDocument): Promise<boolean> {
    return runTaskStep(task);
  }

  /**
   * 强制状态流转（人工干预场景，如用户取消任务）
   */
  async forceTransition(
    nextStatus: TaskStatus,
    options?: { traceId?: string }
  ): Promise<void> {
    await transitionTaskStatus(this.taskId, nextStatus, {
      traceId: options?.traceId
    });
  }
}

// ============================================================
// 工厂函数 — 从 intake 对话中创建 TaskAgent
// ============================================================

/**
 * 从多轮对话中提取任务信息，构建 TaskDocument，持久化，并返回对应的 TaskAgent。
 *
 * @param conversationTurns - intake 对话记录（user/assistant 交替）
 * @param personaContext - 由 PersonaAgent.getContext() 注入的只读快照
 * @returns 新建的 TaskAgent 实例
 */
export async function createTaskAgentFromIntake(
  conversationTurns: string[],
  personaContext: PersonaContext
): Promise<TaskAgent> {
  const conv = createExtractionConversation();
  const result = await extractFromConversation(conv, conversationTurns.join("\n"));
  const task = buildTaskDocument(result.fields);

  const timestamp = new Date().toISOString();
  await saveTaskMD(task, { personaId: personaContext.personaId });
  await saveIntakeResult(task, conversationTurns, timestamp);

  // Intake 阶段直接完成 embedding，避免依赖后续 processDraftingTask
  if (task.body.targetActivity && task.body.targetVibe && task.body.rawDescription) {
    const embResult = await embedTaskFields(
      task.frontmatter.task_id,
      task.body.targetActivity,
      task.body.targetVibe,
      task.body.rawDescription,
    );
    await saveTaskVectors(
      task.frontmatter.task_id,
      embResult.embeddings.map((e) => ({ field: e.field, vector: e.vector })),
    );
  }

  return new TaskAgent(task.frontmatter.task_id, personaContext);
}

// Re-export commonly used types and utilities for consumers
export type { TaskDocument, TaskStatus } from "./types";
export { readTaskDocument, saveTaskMD } from "./storage";
export { embedTaskFields } from "./embedding";
export { startListener, stopListener, isListenerRunning } from "./listener";
