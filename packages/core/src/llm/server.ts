/**
 * packages/core/src/llm/server.ts
 * 服务端专用 LLM 工具 — 支持 HTTPS_PROXY 代理
 *
 * 用途：Next.js BFF 等服务端环境调用 Coding Plan API
 * 客户端（浏览器/Native）请勿导入此模块（依赖 node:http / node:https）
 */
import http from "node:http";
import https from "node:https";
import { HttpsProxyAgent } from "https-proxy-agent";
import type { VerifyResult } from "./client";

// ─── 配置 ──────────────────────────────────────────────────────

export interface ServerLlmConfig {
  baseUrl: string;   // e.g. "https://coding.dashscope.aliyuncs.com/v1"
  apiKey: string;
  /** HTTPS 代理地址（可选），留空则直连 */
  proxy?: string;
  /** 请求超时毫秒数，默认 20000 */
  timeout?: number;
}

// ─── 底层 HTTP 工具 ────────────────────────────────────────────

/** 用 node:https 发 POST 请求（支持 HTTPS_PROXY 代理） */
function postJSON(
  url: string,
  body: object,
  config: { apiKey: string; proxy?: string; timeout?: number },
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const agent = config.proxy ? new HttpsProxyAgent(config.proxy) : undefined;
    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
        "User-Agent": "coding-agent/1.0",
      },
      agent,
      timeout: config.timeout ?? 20_000,
    };

    const req = (parsed.protocol === "http:" ? http : https).request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        try {
          resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode ?? 0, data: raw });
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("请求超时"));
    });
    req.write(JSON.stringify(body));
    req.end();
  });
}

// ─── 公共 API ──────────────────────────────────────────────────

/**
 * 服务端验证模型可用性（支持 HTTPS 代理）
 *
 * 向 Coding Plan 发送一条极简请求，检查模型是否可用。
 * BFF 路由只需调用此函数即可，不用自己写 HTTP 逻辑。
 */
export async function verifyModelOnServer(
  modelId: string,
  config: ServerLlmConfig,
): Promise<VerifyResult> {
  if (!config.apiKey) {
    return { ok: false, model: modelId, error: "服务端未配置 API Key" };
  }

  try {
    const { status, data } = await postJSON(
      `${config.baseUrl}/chat/completions`,
      {
        model: modelId,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 8,
        temperature: 0,
      },
      config,
    );

    if (status < 200 || status >= 300) {
      const errText = typeof data === "string" ? data : JSON.stringify(data);
      return {
        ok: false,
        model: modelId,
        error: `模型响应异常 (${status}): ${errText.slice(0, 200)}`,
      };
    }

    const body = data as Record<string, unknown>;
    const choices = body?.choices as
      | Array<{ message?: { content?: string } }>
      | undefined;
    const reply = choices?.[0]?.message?.content ?? "";
    const actualModel = (body?.model as string) ?? modelId;

    return { ok: true, model: actualModel, reply };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, model: modelId, error: message };
  }
}
