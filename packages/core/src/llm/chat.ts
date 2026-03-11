/**
 * packages/core/src/llm/chat.ts
 * 高层对话工具 — 单次对话 + 有状态多轮对话
 *
 * 基于 LlmService 实现，不依赖具体 Provider。
 * Web 传入 createProxyLlmService，Native / Node 传入 createDirectLlmService，
 * 不传则自动读取环境变量创建默认 Direct 服务。
 */

import type { ChatMessage, TokenUsage } from "./types";
import {
  type ChatResponse,
  type LlmService,
  getDefaultService,
} from "./client";

// ─── 默认模型 ──────────────────────────────────────────────────

const DEFAULT_MODEL = "qwen3-max-2026-01-23";

// ─── 公共选项类型 ──────────────────────────────────────────────

export interface SingleChatOptions {
  /**
   * LlmService 实例。
   * Web 传 createProxyLlmService，Native 传 createDirectLlmService。
   * 不传则自动从环境变量创建 Direct 服务（适合 Node.js / TaskAgent）。
   */
  service?: LlmService;
  /** 使用的模型 ID，默认 "qwen3-max-2026-01-23" */
  model?: string;
  /** System prompt */
  system?: string;
  /** 温度，默认 0.7 */
  temperature?: number;
  /** 最大生成 token 数 */
  maxTokens?: number;
  /** 停止词 */
  stop?: string[];
}

export interface ConversationOptions extends SingleChatOptions {
  /** 历史消息 token 上限，超出后自动裁剪最早的对话轮，默认 8000 */
  maxHistoryTokens?: number;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  usage?: TokenUsage;
  latencyMs?: number;
}

// ─── 单次对话 ──────────────────────────────────────────────────

/**
 * 单次 LLM 调用：system + user → assistant 回复。
 * 适用于一次性提取、生成、摘要等场景。
 *
 * @example
 * // TaskAgent / Node.js（自动读取环境变量）
 * const res = await chatOnce("帮我总结一下", { system: "你是助手", temperature: 0.3 });
 *
 * // Web（显式传入 service）
 * const res = await chatOnce("你好", { service: proxyService, model: "glm-5" });
 */
export async function chatOnce(
  userMessage: string,
  options: SingleChatOptions = {},
): Promise<ChatResponse> {
  const service = resolveService(options);
  const model = options.model ?? DEFAULT_MODEL;

  const messages: ChatMessage[] = [];
  if (options.system) {
    messages.push({ role: "system", content: options.system });
  }
  messages.push({ role: "user", content: userMessage });

  return service.chat({
    model,
    messages,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    stop: options.stop,
  });
}

// ─── 多轮对话 ──────────────────────────────────────────────────

/**
 * 有状态多轮对话管理器。
 * 维护消息历史、累计 token 用量，并在历史超限时自动裁剪最早的对话轮。
 *
 * @example
 * // TaskAgent / Node.js（自动读取环境变量）
 * const conv = new Conversation({ system: "你是助手", model: "qwen3.5-plus" });
 * const r1 = await conv.say("你好");
 * const r2 = await conv.say("再介绍一下自己");
 *
 * // Web（显式传入 service）
 * const conv = new Conversation({ service: proxyService, model: "glm-5" });
 */
export class Conversation {
  private service: LlmService;
  private model: string;
  private systemPrompt: string | null;
  private history: ConversationTurn[] = [];
  private maxHistoryTokens: number;
  private temperature: number;
  private maxTokens: number | undefined;
  private stop: string[] | undefined;

  /** 累计 token 用量（跨所有轮次） */
  totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  constructor(options: ConversationOptions = {}) {
    this.service = resolveService(options);
    this.model = options.model ?? DEFAULT_MODEL;
    this.systemPrompt = options.system ?? null;
    this.maxHistoryTokens = options.maxHistoryTokens ?? 8000;
    this.temperature = options.temperature ?? 0.7;
    this.maxTokens = options.maxTokens;
    this.stop = options.stop;
  }

  /** 发送用户消息，返回 assistant 回复 */
  async say(userMessage: string): Promise<ChatResponse> {
    this.history.push({ role: "user", content: userMessage });
    this.trimHistory();

    const response = await this.service.chat({
      model: this.model,
      messages: this.buildMessages(),
      temperature: this.temperature,
      maxTokens: this.maxTokens,
      stop: this.stop,
    });

    this.history.push({
      role: "assistant",
      content: response.content,
      usage: response.usage,
      latencyMs: response.latencyMs,
    });

    this.totalUsage.promptTokens += response.usage.promptTokens;
    this.totalUsage.completionTokens += response.usage.completionTokens;
    this.totalUsage.totalTokens += response.usage.totalTokens;

    return response;
  }

  /** 获取当前消息历史（副本） */
  getHistory(): ConversationTurn[] {
    return [...this.history];
  }

  /** 获取当前历史的 token 估算值 */
  getHistoryTokenCount(): number {
    const messages = this.history.map((t) => ({
      role: t.role as "user" | "assistant",
      content: t.content,
    }));
    return this.service.countMessageTokens(messages);
  }

  /** 获取已完成的对话轮次数（user + assistant 为一轮） */
  getTurnCount(): number {
    return Math.floor(this.history.length / 2);
  }

  /** 重置对话（保留 system prompt，清空历史和累计用量） */
  reset(): void {
    this.history = [];
    this.totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }

  /** 中途替换 system prompt */
  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  /** 切换模型（下一轮生效） */
  setModel(modelId: string): void {
    this.model = modelId;
  }

  /** 导出完整消息数组（含 system prompt，用于保存 / 日志） */
  exportMessages(): ChatMessage[] {
    return this.buildMessages();
  }

  // ─── 私有方法 ────────────────────────────────────────────────

  private buildMessages(): ChatMessage[] {
    const messages: ChatMessage[] = [];
    if (this.systemPrompt) {
      messages.push({ role: "system", content: this.systemPrompt });
    }
    for (const turn of this.history) {
      messages.push({ role: turn.role, content: turn.content });
    }
    return messages;
  }

  /**
   * 当历史超过 maxHistoryTokens 时，裁剪最早的对话轮（user+assistant 一对一起删）。
   * 保留最近一条 user 消息不删除。
   */
  private trimHistory(): void {
    while (this.history.length > 1) {
      if (this.getHistoryTokenCount() <= this.maxHistoryTokens) break;

      if (
        this.history.length >= 2 &&
        this.history[0].role === "user" &&
        this.history[1].role === "assistant"
      ) {
        this.history.splice(0, 2);
      } else {
        this.history.shift();
      }
    }
  }
}

// ─── 内部工具 ──────────────────────────────────────────────────

function resolveService(options: SingleChatOptions): LlmService {
  return options.service ?? getDefaultService();
}
