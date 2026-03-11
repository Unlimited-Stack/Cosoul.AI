// ---------------------------------------------------------------------------
// Shared LLM primitive types
// Provider-specific types (LLMProvider, ProviderConfig, etc.) have been
// removed — chat capabilities now live in LlmService (client.ts).
// ---------------------------------------------------------------------------

export type Role = "system" | "user" | "assistant";

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
