import { z } from "zod";

// ============================================================
// Soul.md 文档结构 — 分身人格的结构化表示
// frontmatter: YAML 元数据 (persona_id, version 等)
// sections: 四段式内容 (Core Identity / Preferences / Values & Vibe / History Annotations)
// ============================================================
export const SoulDocumentSchema = z.object({
  frontmatter: z.object({
    persona_id: z.string().default(""),
    persona_name: z.string().default(""),
    owner_user_id: z.string().default(""),
    version: z.number().int().min(1).default(1),
    created_at: z.string().default(""),
    updated_at: z.string().default(""),
  }),
  sections: z.object({
    /** 身份/背景/兴趣标签 */
    coreIdentity: z.string(),
    /** 交互偏好/匹配偏好/Deal Breakers */
    preferences: z.string(),
    /** 价值观/气质风格/决策准则 */
    valuesAndVibe: z.string(),
    /** Agent 自动追加的偏好演变记录 */
    historyAnnotations: z.string(),
  }),
  /** 原始 markdown 全文（用于 LLM 注入） */
  rawText: z.string(),
});
export type SoulDocument = z.infer<typeof SoulDocumentSchema>;

// ============================================================
// Memory.md 文档结构 — 分身的长期经验笔记本
// 记录匹配模式、偏好演变日志、Token 使用统计
// ============================================================
export const MemoryDocumentSchema = z.object({
  frontmatter: z.object({
    persona_id: z.string().default(""),
    last_updated: z.string().default(""),
    total_tasks_completed: z.number().int().min(0).default(0),
    total_tasks_cancelled: z.number().int().min(0).default(0),
  }),
  sections: z.object({
    /** 跨任务归纳的匹配规律 */
    matchingPatterns: z.string(),
    /** 偏好变化时间线 */
    preferenceLog: z.string(),
    /** Token 消耗统计 */
    tokenStats: z.string(),
  }),
  /** 原始 markdown 全文 */
  rawText: z.string(),
});
export type MemoryDocument = z.infer<typeof MemoryDocumentSchema>;

// ============================================================
// PersonaContext — 注入给 Task-Agent 的只读快照
// Task-Agent 只能读取，不可修改
// ============================================================
export const PersonaContextSchema = z.object({
  personaId: z.string(),
  personaName: z.string(),
  soulText: z.string(),
  preferences: z.record(z.unknown()),
  relevantMemory: z.string(),
  tokenBudget: z.number(),
});
export type PersonaContext = z.infer<typeof PersonaContextSchema>;

// ============================================================
// PreferenceLearning — 偏好学习结果
// 从 task_summary 中提取的洞察和建议更新
// ============================================================
export const PreferenceLearningSchema = z.object({
  /** 关联的任务 ID */
  taskId: z.string().optional(),
  /** 任务结果: completed / cancelled / timeout */
  outcome: z.enum(["completed", "cancelled", "timeout"]),
  /** 提取的洞察列表 */
  insights: z.array(z.string()),
  /** 建议的偏好更新 */
  suggestedUpdates: z.array(
    z.object({
      field: z.string(),
      oldValue: z.string().optional(),
      newValue: z.string(),
      reason: z.string(),
    })
  ),
  /** 学习时间戳 */
  learnedAt: z.string(),
});
export type PreferenceLearning = z.infer<typeof PreferenceLearningSchema>;

// ============================================================
// PersonaConfig — 默认配置常量
// ============================================================
export const PERSONA_CONFIG = {
  /** 每月 Token 总预算 */
  monthlyTokenBudget: 500_000,
  /** 单任务默认 Token 预算 */
  defaultTaskTokenBudget: 10_000,
  /** Memory.md 最大字符数（超出触发压缩） */
  memoryMaxChars: 8_000,
  /** 最大并发任务数 */
  maxConcurrentTasks: 5,
} as const;

export type PersonaConfig = typeof PERSONA_CONFIG;
