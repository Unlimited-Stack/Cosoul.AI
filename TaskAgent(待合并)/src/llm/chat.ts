/**
 * Re-export from @repo/core — chat logic has been consolidated into the shared package.
 * This file exists only to preserve the relative import path used by task_agent/*.ts.
 */
export {
  chatOnce,
  Conversation,
  type SingleChatOptions,
  type ConversationOptions,
  type ConversationTurn,
  // 服务创建工具，TaskAgent 中若需要显式传入 service 时使用
  createDirectLlmService,
  getDefaultService,
  type ChatResponse,
  type ChatRequest,
  type LlmService,
} from "@repo/core/llm";
