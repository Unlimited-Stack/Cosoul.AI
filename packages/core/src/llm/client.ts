/**
 * packages/core/src/llm/client.ts
 * 统一 LLM 服务接口 — Web 走代理、Native 直连，对上层透明
 *
 * 架构：
 *   Web (浏览器有 CORS 限制)  →  createProxyLlmService("/api")  →  Next.js BFF  →  Coding Plan
 *   Native (无 CORS)           →  createDirectLlmService(url,key) →  Coding Plan
 *
 * AiCoreScreen 只依赖 LlmService 接口，不关心底层走代理还是直连。
 */

import { MODELS, type ModelInfo } from "./models";

// ─── 公共类型 ──────────────────────────────────────────────────

export interface VerifyResult {
  ok: boolean;
  model: string;
  reply?: string;
  error?: string;
}

export interface LlmService {
  /** 获取可用模型列表（静态数据，无网络请求） */
  getModels(): ModelInfo[];
  /** 验证模型是否可用 */
  verifyModel(modelId: string): Promise<VerifyResult>;
}

// ─── Direct 模式 — Native 端直连 Coding Plan ───────────────────

export interface DirectLlmConfig {
  baseUrl: string;   // e.g. "https://coding.dashscope.aliyuncs.com/v1"
  apiKey: string;
}

export function createDirectLlmService(config: DirectLlmConfig): LlmService {
  return {
    getModels() {
      return MODELS;
    },

    async verifyModel(modelId: string): Promise<VerifyResult> {
      try {
        const res = await fetch(`${config.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
            "User-Agent": "coding-agent/1.0",
          },
          body: JSON.stringify({
            model: modelId,
            messages: [{ role: "user", content: "hi" }],
            max_tokens: 8,
            temperature: 0,
          }),
        });

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
  };
}
