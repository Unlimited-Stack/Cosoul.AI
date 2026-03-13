/**
 * judge-agent/types.ts — Judge 模块专属类型定义
 *
 * 独立于 task-agent，Judge 通过 taskId 从数据库读取双方完整数据，
 * 不依赖信封中的摘要字段，实现真正的中立裁决。
 */

import { z } from "zod";
import {
  DimensionScoresSchema,
  JudgeDecisionSchema,
  JUDGE_VERDICT_VALUES,
  InteractionTypeSchema,
} from "../task-agent/types";

// ─── 从 task-agent/types 复用的基础 Schema ──────────────────────

export {
  DimensionScoresSchema,
  JudgeDecisionSchema,
  JUDGE_VERDICT_VALUES,
  InteractionTypeSchema,
};
export type {
  DimensionScores,
  JudgeDecision,
  InteractionType,
  TaskDocument,
} from "../task-agent/types";

// ─── Judge 请求 ─────────────────────────────────────────────────

/** 调用 Judge 裁决时的输入参数 */
export const JudgeEvaluateRequestSchema = z.object({
  /** 主动搜索方的 task_id */
  initiatorTaskId: z.string().uuid(),
  /** 被动方的 task_id */
  responderTaskId: z.string().uuid(),
  /** 当前协商轮次 */
  round: z.number().int().nonnegative().default(0),
  /** 请求方标识（用于日志追踪） */
  requesterId: z.string().optional(),
});

export type JudgeEvaluateRequest = z.infer<typeof JudgeEvaluateRequestSchema>;

// ─── Judge 裁决结果 ─────────────────────────────────────────────

/** Judge 裁决完整结果（返回给双方） */
export const JudgeEvaluateResultSchema = z.object({
  /** 主动方 task_id */
  initiatorTaskId: z.string(),
  /** 被动方 task_id */
  responderTaskId: z.string(),
  /** Judge 裁决详情 */
  decision: JudgeDecisionSchema,
  /** 向后兼容的 L2 action 映射 */
  l2Action: z.enum(["ACCEPT", "REJECT"]),
  /** 协商轮次 */
  round: z.number(),
  /** 裁决时间戳 */
  timestamp: z.string().datetime(),
  /** 是否使用了 fallback 规则（LLM 不可用时） */
  usedFallback: z.boolean().default(false),
});

export type JudgeEvaluateResult = z.infer<typeof JudgeEvaluateResultSchema>;

// ─── 内部：从 DB 读取的任务上下文 ────────────────────────────────

/** Judge 内部使用的任务上下文（从 DB 直接读取，非 stub） */
export const JudgeTaskContextSchema = z.object({
  taskId: z.string(),
  interactionType: z.enum(["online", "offline", "any"]),
  targetActivity: z.string(),
  targetVibe: z.string(),
  detailedPlan: z.string(),
  rawDescription: z.string(),
});

export type JudgeTaskContext = z.infer<typeof JudgeTaskContextSchema>;
