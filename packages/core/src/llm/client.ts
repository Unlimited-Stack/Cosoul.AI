/**
 * packages/core/src/llm/client.ts
 * 统一 LLM 服务接口 — Web 走代理、Native 直连，对上层透明
 *
 * 架构：
 *   Web (浏览器有 CORS 限制)  →  createProxyLlmService("/api")  →  Next.js BFF  →  Coding Plan
 *   Native (无 CORS)           →  createDirectLlmService(url,key) →  Coding Plan
 *
 * Coding Plan 是统一 API 网关，通过 model 字段路由到各厂商模型
 * （Qwen / GLM / Kimi / MiniMax 等），baseUrl 和 apiKey 始终不变。
 */

import { MODELS, type ModelInfo } from "./models";
import type { ChatMessage, TokenUsage } from "./types";

export type { ChatMessage, TokenUsage, ModelInfo };

// ─── 公共类型 ──────────────────────────────────────────────────

export interface VerifyResult {
  ok: boolean;
  model: string;
  reply?: string;
  error?: string;
}

/** 发起一次真实对话的请求结构 */
export interface ChatRequest {
  /** 模型 ID，例如 "qwen3.5-plus"、"glm-5" */
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
}

/** 对话响应结构 */
export interface ChatResponse {
  content: string;
  finishReason: "stop" | "length" | "error" | "unknown";
  usage: TokenUsage;
  model: string;
  latencyMs: number;
}

/** 统一 LLM 服务接口，Web / Native 使用同一套 API */
export interface LlmService {
  /** 获取可用模型列表（静态数据，无网络请求） */
  getModels(): ModelInfo[];
  /** 验证模型是否可用（发送极小请求探测连通性） */
  verifyModel(modelId: string): Promise<VerifyResult>;
  /** 发起完整对话请求 */
  chat(request: ChatRequest): Promise<ChatResponse>;
  /** 估算字符串的 token 数量 */
  countTokens(text: string): number;
  /** 估算消息数组的总 token 数量（含消息格式开销） */
  countMessageTokens(messages: ChatMessage[]): number;
}

// ─── Direct 模式 — Native 端直连 Coding Plan ───────────────────

export interface DirectLlmConfig {
  baseUrl: string;   // e.g. "https://coding.dashscope.aliyuncs.com/v1"
  apiKey: string;
  /** 请求超时毫秒数，默认 30000 */
  timeoutMs?: number;
}

export function createDirectLlmService(config: DirectLlmConfig): LlmService {
  const timeoutMs = config.timeoutMs ?? 30_000;

  return {
    getModels() {
      return MODELS;
    },

    async verifyModel(modelId: string): Promise<VerifyResult> {
      try {
        const res = await fetchWithTimeout(
          `${config.baseUrl}/chat/completions`,
          {
            method: "POST",
            headers: buildHeaders(config.apiKey),
            body: JSON.stringify({
              model: modelId,
              messages: [{ role: "user", content: "hi" }],
              max_tokens: 8,
              temperature: 0,
            }),
          },
          timeoutMs,
        );

        if (!res.ok) {
          const errText = await res.text();
          return {
            ok: false,
            model: modelId,
            error: `模型响应异常 (${res.status}): ${errText.slice(0, 200)}`,
          };
        }

        const body = (await res.json()) as Record<string, unknown>;
        const choices = body?.choices as Array<{ message?: { content?: string } }> | undefined;
        const reply = choices?.[0]?.message?.content ?? "";
        const actualModel = (body?.model as string) ?? modelId;
        return { ok: true, model: actualModel, reply };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, model: modelId, error: message };
      }
    },

    async chat(request: ChatRequest): Promise<ChatResponse> {
      const start = Date.now();

      const res = await fetchWithTimeout(
        `${config.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: buildHeaders(config.apiKey),
          body: JSON.stringify({
            model: request.model,
            messages: request.messages,
            temperature: request.temperature ?? 0.7,
            max_tokens: request.maxTokens,
            stop: request.stop,
          }),
        },
        timeoutMs,
      );

      const latencyMs = Date.now() - start;

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`LLM API ${res.status}: ${errText.slice(0, 200)}`);
      }

      const body = (await res.json()) as Record<string, unknown>;
      const choices = body.choices as
        | Array<{ message?: { content?: string }; finish_reason?: string }>
        | undefined;
      const usageRaw = body.usage as
        | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
        | undefined;

      return {
        content: choices?.[0]?.message?.content ?? "",
        finishReason: mapFinishReason(choices?.[0]?.finish_reason),
        usage: {
          promptTokens: usageRaw?.prompt_tokens ?? 0,
          completionTokens: usageRaw?.completion_tokens ?? 0,
          totalTokens: usageRaw?.total_tokens ?? 0,
        },
        model: (body.model as string) ?? request.model,
        latencyMs,
      };
    },

    countTokens(text: string): number {
      return estimateTokens(text);
    },

    countMessageTokens(messages: ChatMessage[]): number {
      let total = 0;
      for (const msg of messages) {
        total += 4; // 每条消息的格式开销
        total += estimateTokens(msg.content);
      }
      total += 2; // 首 token priming
      return total;
    },
  };
}

// ─── Proxy 模式 — Web 端走 Next.js BFF 代理 ───────────────────

export function createProxyLlmService(proxyBaseUrl: string): LlmService {
  return {
    getModels() {
      return MODELS;
    },

    async verifyModel(modelId: string): Promise<VerifyResult> {
      try {
        const res = await fetch(`${proxyBaseUrl}/llm/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: modelId }),
        });
        return (await res.json()) as VerifyResult;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, model: modelId, error: message };
      }
    },

    async chat(request: ChatRequest): Promise<ChatResponse> {
      const res = await fetch(`${proxyBaseUrl}/llm/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Proxy chat ${res.status}: ${errText.slice(0, 200)}`);
      }
      return (await res.json()) as ChatResponse;
    },

    countTokens(text: string): number {
      return estimateTokens(text);
    },

    countMessageTokens(messages: ChatMessage[]): number {
      let total = 0;
      for (const msg of messages) {
        total += 4;
        total += estimateTokens(msg.content);
      }
      total += 2;
      return total;
    },
  };
}

// ─── 默认服务（Node.js 环境，读取环境变量） ─────────────────────

/**
 * 获取默认 LlmService（Node.js 服务端 / TaskAgent 专用）。
 * 从 CODING_PLAN_BASE_URL / QWEN_API_KEY 环境变量读取配置。
 */
export function getDefaultService(): LlmService {
  return createDirectLlmService({
    baseUrl:
      process.env.CODING_PLAN_BASE_URL ?? "https://coding.dashscope.aliyuncs.com/v1",
    apiKey: process.env.CODING_PLAN_API_KEY ?? process.env.QWEN_API_KEY ?? "",
  });
}

// ─── 平台自适应工厂 ──────────────────────────────────────────────

/**
 * 平台标识：App 层在初始化时传入，工厂据此选择 Proxy 或 Direct 模式。
 * - "web-browser"：Next.js 前端，走同源 BFF 代理 ("/api")
 * - "expo-web"：Expo Web 模式，走跨域 BFF 代理 (需显式传 bffUrl)
 * - "native"：React Native 手机端，直连 Coding Plan（无 CORS 限制）
 * - "node"：Node.js 服务端 / TaskAgent，直连 Coding Plan（读环境变量）
 */
export type LlmPlatform = "web-browser" | "expo-web" | "native" | "node";

export interface PlatformLlmConfig {
  platform: LlmPlatform;
  /** Proxy 模式下的 BFF 地址（web-browser 默认 "/api"，expo-web 必须提供） */
  proxyBaseUrl?: string;
  /** Direct 模式下的 Coding Plan 地址 */
  baseUrl?: string;
  /** Direct 模式下的 API Key */
  apiKey?: string;
  /** Direct 模式下的超时毫秒数 */
  timeoutMs?: number;
}

/**
 * 统一 Service 工厂 — 根据平台自动选择 Proxy / Direct 模式。
 * App 层只需调用一次，然后通过 React Context 共享给所有子页面。
 *
 * @example
 * // Next.js Web
 * const service = createLlmServiceForPlatform({ platform: "web-browser" });
 *
 * // Expo Web（跨域场景）
 * const service = createLlmServiceForPlatform({ platform: "expo-web", proxyBaseUrl: "http://localhost:3030/api" });
 *
 * // Native 手机
 * const service = createLlmServiceForPlatform({ platform: "native", baseUrl: "https://...", apiKey: "sk-..." });
 *
 * // Node.js / TaskAgent（读环境变量）
 * const service = createLlmServiceForPlatform({ platform: "node" });
 */
export function createLlmServiceForPlatform(config: PlatformLlmConfig): LlmService {
  switch (config.platform) {
    case "web-browser":
      return createProxyLlmService(config.proxyBaseUrl ?? "/api");

    case "expo-web":
      if (!config.proxyBaseUrl) {
        throw new Error("expo-web 平台必须提供 proxyBaseUrl（BFF 地址）");
      }
      return createProxyLlmService(config.proxyBaseUrl);

    case "native":
      return createDirectLlmService({
        baseUrl: config.baseUrl ?? "https://coding.dashscope.aliyuncs.com/v1",
        apiKey: config.apiKey ?? "",
        timeoutMs: config.timeoutMs,
      });

    case "node":
      return getDefaultService();

    default:
      throw new Error(`未知平台: ${config.platform as string}`);
  }
}

// ─── 内部工具函数 ──────────────────────────────────────────────

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "User-Agent": "coding-agent/1.0",
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function mapFinishReason(
  reason: string | null | undefined,
): ChatResponse["finishReason"] {
  if (reason === "stop") return "stop";
  if (reason === "length") return "length";
  return "unknown";
}

/**
 * 估算 token 数量：CJK 约 1.5 字/token，其他语言约 4 字符/token。
 */
function estimateTokens(text: string): number {
  let cjkCount = 0;
  let otherCount = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3000 && code <= 0x30ff)
    ) {
      cjkCount++;
    } else {
      otherCount++;
    }
  }
  return Math.ceil(cjkCount / 1.5) + Math.ceil(otherCount / 4);
}
