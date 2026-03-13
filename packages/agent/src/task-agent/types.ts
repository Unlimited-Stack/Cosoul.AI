import { z } from "zod";

export const TASK_STATUS_VALUES = [
  "Drafting",
  "Searching",
  "Negotiating",
  "Waiting_Human",
  "Listening",
  "Revising",
  "Closed",
  "Failed",
  "Timeout",
  "Cancelled"
] as const;

export const INTERACTION_TYPE_VALUES = ["online", "offline", "any"] as const;

export const HANDSHAKE_ACTION_VALUES = [
  "PROPOSE",
  "COUNTER_PROPOSE",
  "ACCEPT",
  "REJECT",
  "CANCEL",
  "ERROR"
] as const;

export const TaskStatusSchema = z.enum(TASK_STATUS_VALUES);
export const InteractionTypeSchema = z.enum(INTERACTION_TYPE_VALUES);
export const HandshakeActionSchema = z.enum(HANDSHAKE_ACTION_VALUES);

export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type InteractionType = z.infer<typeof InteractionTypeSchema>;
export type HandshakeAction = z.infer<typeof HandshakeActionSchema>;

export const TaskFrontmatterSchema = z.object({
  task_id: z.string().min(1),
  status: TaskStatusSchema,
  interaction_type: InteractionTypeSchema,
  current_partner_id: z.string().nullable(),
  entered_status_at: z.string().datetime(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  version: z.number().int().nonnegative(),
  pending_sync: z.boolean(),
  hidden: z.boolean().default(false)
});

export const TaskBodySchema = z.object({
  rawDescription: z.string().min(1),
  // Drafting 阶段允许为空，Searching 之后由 intake/LLM 填充
  targetActivity: z.string().default(""),
  targetVibe: z.string().default(""),
  detailedPlan: z.string().default("")
});

export const TaskDocumentSchema = z.object({
  frontmatter: TaskFrontmatterSchema,
  body: TaskBodySchema
});

export type TaskFrontmatter = z.infer<typeof TaskFrontmatterSchema>;
export type TaskBody = z.infer<typeof TaskBodySchema>;
export type TaskDocument = z.infer<typeof TaskDocumentSchema>;

export const HandshakePayloadSchema = z.object({
  interaction_type: InteractionTypeSchema,
  target_activity: z.string().min(1),
  target_vibe: z.string().min(1)
});

export const HandshakeInboundEnvelopeSchema = z.object({
  protocol_version: z.string().min(1),
  message_id: z.string().min(1),
  sender_agent_id: z.string().min(1),
  receiver_agent_id: z.string().min(1),
  task_id: z.string().min(1),
  action: HandshakeActionSchema,
  round: z.number().int().nonnegative(),
  payload: HandshakePayloadSchema,
  timestamp: z.string().datetime(),
  signature: z.string().min(1)
});

export const HandshakeOutboundEnvelopeSchema = z.object({
  protocol_version: z.string().min(1),
  message_id: z.string().min(1),
  in_reply_to: z.string().min(1),
  task_id: z.string().min(1),
  action: HandshakeActionSchema,
  error: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1)
    })
    .nullable(),
  timestamp: z.string().datetime()
});

export type HandshakeInboundEnvelope = z.infer<typeof HandshakeInboundEnvelopeSchema>;
export type HandshakeOutboundEnvelope = z.infer<typeof HandshakeOutboundEnvelopeSchema>;

export const L2DecisionSchema = z.object({
  action: z.enum(["ACCEPT", "REJECT"]),
  shouldMoveToRevising: z.boolean(),
  scratchpadNote: z.string().min(1)
});

export type L2Decision = z.infer<typeof L2DecisionSchema>;

// ─── Judge Model 类型 ───────────────────────────────────────────

export const JUDGE_VERDICT_VALUES = ["MATCH", "NEGOTIATE", "REJECT"] as const;

/** 各评估维度的独立打分（0~1） */
export const DimensionScoresSchema = z.object({
  /** 活动兼容性：双方活动是否互补/兼容（权重最高） */
  activityCompatibility: z.number().min(0).max(1),
  /** 氛围对齐：双方期望的社交氛围是否一致 */
  vibeAlignment: z.number().min(0).max(1),
  /** 交互类型匹配：online/offline/any 的兼容度 */
  interactionTypeMatch: z.number().min(0).max(1),
  /** 计划具体性：双方 detailedPlan 的信息充分程度 */
  planSpecificity: z.number().min(0).max(1),
});

export type DimensionScores = z.infer<typeof DimensionScoresSchema>;

export const JudgeDecisionSchema = z.object({
  /** 各维度独立打分，先分维度评估再综合 */
  dimensionScores: DimensionScoresSchema,
  /** 研判结论：MATCH=高度匹配, NEGOTIATE=部分匹配可协商, REJECT=不匹配 */
  verdict: z.enum(JUDGE_VERDICT_VALUES),
  /** 综合置信度 0~1（基于维度加权得出） */
  confidence: z.number().min(0).max(1),
  /** 是否建议任务回到 Revising 状态 */
  shouldMoveToRevising: z.boolean(),
  /** 内部推理过程（写入 scratchpad，不展示给用户） */
  reasoning: z.string().min(1),
  /** 面向用户的一句话摘要 */
  userFacingSummary: z.string().min(1)
});

export type JudgeDecision = z.infer<typeof JudgeDecisionSchema>;

/** 对端任务上下文（Judge 评估时使用，网络层未就绪时 isStubbed=true） */
export const RemoteTaskContextSchema = z.object({
  taskId: z.string().min(1),
  /** 对端 detailedPlan 全文（核心匹配依据，stub 时为空字符串） */
  detailedPlan: z.string(),
  targetActivity: z.string(),
  targetVibe: z.string(),
  interactionType: InteractionTypeSchema,
  /** true 表示远端数据不可用，当前为占位数据 */
  isStubbed: z.boolean()
});

export type RemoteTaskContext = z.infer<typeof RemoteTaskContextSchema>;

export const ErrorCodeSchema = z.enum([
  "E_SCHEMA_INVALID",
  "E_PROTOCOL_VERSION_UNSUPPORTED",
  "E_IDEMPOTENCY_CONFLICT",
  "E_VERSION_CONFLICT",
  "E_DEP_UNAVAILABLE",
  "E_INTERNAL"
]);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const L0CandidateSchema = z.object({
  taskId: z.string().min(1),
  reason: z.string().min(1)
});

export const L1CandidateSchema = z.object({
  taskId: z.string().min(1),
  score: z.number()
});

export type L0Candidate = z.infer<typeof L0CandidateSchema>;
export type L1Candidate = z.infer<typeof L1CandidateSchema>;

export const SESSION_STATUS_VALUES = [
  "Negotiating",
  "Accepted",
  "Rejected",
  "Timeout"
] as const;

export const SessionStatusSchema = z.enum(SESSION_STATUS_VALUES);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const NegotiationSessionSchema = z.object({
  session_id: z.string().min(1),
  task_id: z.string().min(1),
  remote_agent_id: z.string().min(1),
  remote_task_id: z.string().min(1),
  status: SessionStatusSchema,
  match_score: z.number().nullable(),
  l2_action: z.enum(["ACCEPT", "REJECT"]).nullable(),
  rounds: z.number().int().nonnegative(),
  started_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  timeout_at: z.string().datetime()
});

export type NegotiationSession = z.infer<typeof NegotiationSessionSchema>;

export const ListeningReportSchema = z.object({
  task_id: z.string().min(1),
  total_handshakes: z.number().int().nonnegative(),
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  timed_out: z.number().int().nonnegative(),
  sessions: z.array(NegotiationSessionSchema),
  generated_at: z.string().datetime()
});

export type ListeningReport = z.infer<typeof ListeningReportSchema>;

export function parseTaskDocument(input: unknown): TaskDocument {
  return TaskDocumentSchema.parse(input);
}

export function parseHandshakeInboundEnvelope(input: unknown): HandshakeInboundEnvelope {
  return HandshakeInboundEnvelopeSchema.parse(input);
}

export function parseHandshakeOutboundEnvelope(input: unknown): HandshakeOutboundEnvelope {
  return HandshakeOutboundEnvelopeSchema.parse(input);
}
