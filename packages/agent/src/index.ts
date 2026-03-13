// ============================================================
// @repo/agent 统一导出
// PersonaAgent 负责管理分身画像(Soul.md)和长期记忆(Memory.md)
// ============================================================

// 主类
export { PersonaAgent } from "./persona-agent/index";

// 类型定义与 Zod Schema
export {
  SoulDocumentSchema,
  MemoryDocumentSchema,
  PersonaContextSchema,
  PreferenceLearningSchema,
  PERSONA_CONFIG,
} from "./persona-agent/types";
export type {
  SoulDocument,
  MemoryDocument,
  PersonaContext,
  PreferenceLearning,
  PersonaConfig,
} from "./persona-agent/types";

// Soul.md 工具函数
export {
  parseSoulMd,
  serializeSoulMd,
  extractPreferences,
} from "./persona-agent/soul-loader";

// Memory.md 工具函数
export {
  parseMemoryMd,
  serializeMemoryMd,
  appendLearning,
  createEmptyMemory,
} from "./persona-agent/memory-manager";

// 偏好学习
export { learnFromTaskSummary } from "./persona-agent/preference-learner";

// Soul.md 更新器
export { appendHistoryAnnotation } from "./persona-agent/soul-updater";

// ============================================================
// TaskAgent — 单任务执行引擎（与 PersonaAgent 平级，支持多 Persona 复用）
// ============================================================
export { TaskAgent, createTaskAgentFromIntake } from "./task-agent/index";
export type { TaskStepResult } from "./task-agent/index";
export type { TaskDocument, TaskStatus } from "./task-agent/types";

// Intake 层 — 多轮对话提取（BFF 路由直接调用）
export {
  createExtractionConversation,
  extractFromConversation,
  buildTaskDocument,
} from "./task-agent/intake";
export type { ExtractionResult, IntakePersistCtx } from "./task-agent/intake";

// ============================================================
// JudgeAgent — 独立云端裁决模块（与 PersonaAgent / TaskAgent 平级）
// ============================================================
export { evaluateMatch } from "./judge-agent/index";
export { JudgeEvaluateRequestSchema, JudgeEvaluateResultSchema } from "./judge-agent/types";
export type {
  JudgeEvaluateRequest,
  JudgeEvaluateResult,
  JudgeDecision,
  JudgeTaskContext,
} from "./judge-agent/types";
