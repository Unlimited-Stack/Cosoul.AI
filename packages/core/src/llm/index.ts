/**
 * packages/core/src/llm/index.ts
 * LLM 模块统一导出
 */

// 模型元数据（UI 展示用）
export { MODELS, type ModelInfo } from "./models";

// 基础类型
export type { Role, ChatMessage, TokenUsage } from "./types";

// 客户端服务接口 + 完整调用能力
export {
  type VerifyResult,
  type LlmService,
  type DirectLlmConfig,
  type ChatRequest,
  type ChatResponse,
  type LlmPlatform,
  type PlatformLlmConfig,
  createDirectLlmService,
  createProxyLlmService,
  getDefaultService,
  createLlmServiceForPlatform,
} from "./client";

// 高层对话工具（单次 + 多轮）
export { chatOnce, Conversation } from "./chat";
export type { SingleChatOptions, ConversationOptions, ConversationTurn } from "./chat";
