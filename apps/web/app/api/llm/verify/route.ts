/**
 * POST /api/llm/verify
 * Web 端 BFF 代理 — 服务端调用 Coding Plan API 验证模型可用性
 *
 * 为什么 Web 需要代理而 Native 不需要？
 * 1. 浏览器有 CORS 限制，不能直接请求 coding.dashscope.aliyuncs.com
 * 2. API Key 保留在服务端，不暴露给前端
 * 3. 服务端需要 HTTPS_PROXY 支持（容器网络环境）
 *
 * Body: { model: string }
 * Response: VerifyResult
 */
import { NextRequest, NextResponse } from "next/server";
import http from "node:http";
import https from "node:https";
import { HttpsProxyAgent } from "https-proxy-agent";
import { withCors, corsOptions } from "../cors";

const BASE_URL =
  process.env.CODING_PLAN_BASE_URL ?? "https://coding.dashscope.aliyuncs.com/v1";
const API_KEY = process.env.CODING_PLAN_API_KEY ?? "";
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || "";

/** 用 node:https 手动发请求（支持代理） */
function postJSON(url: string, body: object): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const agent = PROXY ? new HttpsProxyAgent(PROXY) : undefined;
    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
        "User-Agent": "coding-agent/1.0",
      },
      agent,
      timeout: 20_000,
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
    req.on("timeout", () => { req.destroy(); reject(new Error("请求超时")); });
    req.write(JSON.stringify(body));
    req.end();
  });
}

export async function POST(req: NextRequest) {
  try {
    const { model } = (await req.json()) as { model?: string };
    if (!model) {
      return withCors(NextResponse.json({ ok: false, model: "", error: "缺少 model 参数" }, { status: 400 }));
    }
    if (!API_KEY) {
      return withCors(NextResponse.json({ ok: false, model, error: "服务端未配置 CODING_PLAN_API_KEY" }, { status: 500 }));
    }

    const { status, data } = await postJSON(`${BASE_URL}/chat/completions`, {
      model,
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 8,
      temperature: 0,
    });

    if (status < 200 || status >= 300) {
      const errText = typeof data === "string" ? data : JSON.stringify(data);
      return withCors(NextResponse.json({
        ok: false,
        model,
        error: `模型响应异常 (${status}): ${errText.slice(0, 200)}`,
      }));
    }

    const body = data as Record<string, unknown>;
    const choices = body?.choices as Array<{ message?: { content?: string } }> | undefined;
    const reply = choices?.[0]?.message?.content ?? "";
    const actualModel = (body?.model as string) ?? model;

    return withCors(NextResponse.json({ ok: true, model: actualModel, reply }));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return withCors(NextResponse.json({ ok: false, model: "", error: message }));
  }
}

export async function OPTIONS() {
  return corsOptions();
}
