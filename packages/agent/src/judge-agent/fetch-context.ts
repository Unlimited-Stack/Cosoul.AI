/**
 * fetch-context.ts — 从 DB 直接拉取双方完整 Task 数据
 *
 * Judge Agent 运行在服务端，可直接访问 PostgreSQL，
 * 拿到双方完整 detailedPlan，不再依赖 task-agent/storage 的中转。
 */

import { db } from "@repo/core/db/client";
import { tasks } from "@repo/core/db/schema";
import { eq } from "drizzle-orm";
import type { JudgeTaskContext } from "./types";

/**
 * 从 DB 拉取单个 task 的完整上下文。
 * 直接查 PostgreSQL tasks 表，拿到真实 detailedPlan。
 */
export async function fetchTaskContext(taskId: string): Promise<JudgeTaskContext> {
  const rows = await db.select().from(tasks).where(eq(tasks.taskId, taskId));
  if (rows.length === 0) {
    throw new Error(`E_TASK_NOT_FOUND: ${taskId}`);
  }
  const row = rows[0];
  return {
    taskId: row.taskId,
    interactionType: (row.interactionType as "online" | "offline" | "any") ?? "any",
    rawDescription: row.rawDescription ?? "",
    targetActivity: row.targetActivity ?? "",
    targetVibe: row.targetVibe ?? "",
    detailedPlan: row.detailedPlan ?? "",
  };
}

/**
 * 并行拉取双方 task 上下文。
 */
export async function fetchBothTaskContexts(
  initiatorTaskId: string,
  responderTaskId: string
): Promise<{ sideA: JudgeTaskContext; sideB: JudgeTaskContext }> {
  const [sideA, sideB] = await Promise.all([
    fetchTaskContext(initiatorTaskId),
    fetchTaskContext(responderTaskId),
  ]);
  return { sideA, sideB };
}
