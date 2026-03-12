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
