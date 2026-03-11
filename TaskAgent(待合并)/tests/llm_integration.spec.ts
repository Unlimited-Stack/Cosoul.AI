/**
 * llm_integration.spec.ts — LLM 单次 + 多轮对话集成测试
 *
 * 验证通过 @repo/core 的 chat 模块能正确调用 LLM，并返回 token 计数。
 *
 * 凭据策略：
 *  1. 优先使用 CODING_PLAN_BASE_URL + CODING_PLAN_API_KEY（Coding Plan 网关）
 *  2. 若不可用，回退到 DASHSCOPE_API_KEY + 阿里云兼容端点（qwen-turbo 模型）
 *
 * 注意：
 * - 本文件为临时测试，验收通过后可安全删除。
 * - 测试需要有效 API Key，无 Key 时自动跳过（skipIf）。
 */

import "dotenv/config";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  Conversation,
  chatOnce,
  createDirectLlmService,
  type LlmService
} from "../src/llm/chat";

// ─── 凭据检测 ──────────────────────────────────────────────────────────────

const CODING_PLAN_URL  = process.env.CODING_PLAN_BASE_URL  ?? "";
const CODING_PLAN_KEY  = process.env.CODING_PLAN_API_KEY   ?? "";
const DASHSCOPE_KEY    = process.env.DASHSCOPE_API_KEY      ?? "";
const DASHSCOPE_URL    = "https://dashscope.aliyuncs.com/compatible-mode/v1";

/**
 * 探测某个 service 是否真正可用（发一条极小请求）。
 * 返回 true 代表连通，false 代表失败（401 / 网络不通等）。
 */
async function probeService(service: LlmService, modelId: string): Promise<boolean> {
  try {
    const res = await service.verifyModel(modelId);
    return res.ok;
  } catch {
    return false;
  }
}

// ─── 运行时决策：选出可用的 service + model ─────────────────────────────────

let activeService: LlmService | null = null;
let activeModel = "";

beforeAll(async () => {
  // 候选列表：Coding Plan → DashScope 兼容端点
  const candidates: Array<{ label: string; service: LlmService; model: string }> = [];

  if (CODING_PLAN_KEY) {
    candidates.push({
      label: "Coding Plan (qwen3.5-plus)",
      service: createDirectLlmService({ baseUrl: CODING_PLAN_URL || "https://coding.dashscope.aliyuncs.com/v1", apiKey: CODING_PLAN_KEY }),
      model: "qwen3.5-plus"
    });
  }
  if (DASHSCOPE_KEY) {
    candidates.push({
      label: "DashScope compatible (qwen-turbo)",
      service: createDirectLlmService({ baseUrl: DASHSCOPE_URL, apiKey: DASHSCOPE_KEY }),
      model: "qwen-turbo"
    });
  }

  if (candidates.length === 0) {
    console.warn("[llm_integration] 未找到任何 API Key，所有 chat 测试将被跳过。");
    return;
  }

  for (const c of candidates) {
    const ok = await probeService(c.service, c.model);
    console.log(`[llm_integration] 探测 ${c.label}: ${ok ? "✅ 可用" : "❌ 不可用"}`);
    if (ok && !activeService) {
      activeService = c.service;
      activeModel = c.model;
    }
  }

  if (!activeService) {
    console.warn("[llm_integration] 所有 LLM 端点均不可用，测试将跳过。");
  } else {
    console.log(`[llm_integration] 使用 model: ${activeModel}`);
  }
}, 30_000);

// ─── 测试用例 ────────────────────────────────────────────────────────────────

describe("LLM 对话集成测试", () => {

  // ── 1. 单次对话（chatOnce） ──────────────────────────────────────────────
  describe("单次对话 chatOnce", () => {
    it("返回非空 content + token 计数 > 0", async () => {
      if (!activeService) {
        console.warn("跳过：无可用 LLM 服务");
        return;
      }

      const res = await chatOnce("请用一句话介绍你自己", {
        service: activeService,
        model: activeModel,
        system: "你是一个简洁的 AI 助手，回答不超过 30 字。",
        temperature: 0.3,
        maxTokens: 80
      });

      console.log("\n=== 单次对话结果 ===");
      console.log(`模型  : ${res.model}`);
      console.log(`回复  : ${res.content}`);
      console.log(`耗时  : ${res.latencyMs} ms`);
      console.log(`Token : prompt=${res.usage.promptTokens}  completion=${res.usage.completionTokens}  total=${res.usage.totalTokens}`);
      console.log(`结束  : ${res.finishReason}`);

      expect(res.content.length).toBeGreaterThan(0);
      expect(res.usage.promptTokens).toBeGreaterThan(0);
      expect(res.usage.completionTokens).toBeGreaterThan(0);
      expect(res.usage.totalTokens).toBe(res.usage.promptTokens + res.usage.completionTokens);
      expect(["stop", "length"]).toContain(res.finishReason);
    }, 30_000);

    it("连续两次独立调用互不影响（token 各自独立计数）", async () => {
      if (!activeService) {
        console.warn("跳过：无可用 LLM 服务");
        return;
      }

      const [r1, r2] = await Promise.all([
        chatOnce("1+1 等于几？", {
          service: activeService,
          model: activeModel,
          maxTokens: 20
        }),
        chatOnce("天空是什么颜色？", {
          service: activeService,
          model: activeModel,
          maxTokens: 20
        })
      ]);

      console.log("\n=== 并发单次对话 ===");
      console.log(`[Q1] 1+1=? → ${r1.content}  (total tokens: ${r1.usage.totalTokens})`);
      console.log(`[Q2] 天空颜色 → ${r2.content}  (total tokens: ${r2.usage.totalTokens})`);

      // 两次调用都应有独立的 token 计数
      expect(r1.usage.totalTokens).toBeGreaterThan(0);
      expect(r2.usage.totalTokens).toBeGreaterThan(0);
    }, 30_000);
  });

  // ── 2. 多轮对话（Conversation） ──────────────────────────────────────────
  describe("多轮对话 Conversation", () => {
    it("3 轮对话：history 增长、token 累计、上下文连贯", async () => {
      if (!activeService) {
        console.warn("跳过：无可用 LLM 服务");
        return;
      }

      const conv = new Conversation({
        service: activeService,
        model: activeModel,
        system: "你是一个户外活动推荐助手，每次回答不超过 40 字。",
        temperature: 0.5,
        maxTokens: 100
      });

      console.log("\n=== 多轮对话 ===");

      // Turn 1
      const r1 = await conv.say("我周末想出去玩，有什么推荐？");
      console.log(`\n[Turn 1]`);
      console.log(`  用户 : 我周末想出去玩，有什么推荐？`);
      console.log(`  助手 : ${r1.content}`);
      console.log(`  Token: prompt=${r1.usage.promptTokens}  completion=${r1.usage.completionTokens}  total=${r1.usage.totalTokens}`);

      expect(r1.content.length).toBeGreaterThan(0);
      expect(r1.usage.totalTokens).toBeGreaterThan(0);
      expect(conv.getTurnCount()).toBe(1);

      // Turn 2 - 追问（测试上下文记忆）
      const r2 = await conv.say("我比较喜欢爬山，有具体地点推荐吗？");
      console.log(`\n[Turn 2]`);
      console.log(`  用户 : 我比较喜欢爬山，有具体地点推荐吗？`);
      console.log(`  助手 : ${r2.content}`);
      console.log(`  Token: prompt=${r2.usage.promptTokens}  completion=${r2.usage.completionTokens}  total=${r2.usage.totalTokens}`);

      // Turn 2 的 prompt_tokens 应包含 Turn 1 历史，因此大于 Turn 1
      expect(r2.usage.promptTokens).toBeGreaterThan(r1.usage.promptTokens);
      expect(conv.getTurnCount()).toBe(2);

      // Turn 3 - 要求总结（测试多轮上下文聚合能力）
      const r3 = await conv.say("请总结一下我们聊了什么");
      console.log(`\n[Turn 3]`);
      console.log(`  用户 : 请总结一下我们聊了什么`);
      console.log(`  助手 : ${r3.content}`);
      console.log(`  Token: prompt=${r3.usage.promptTokens}  completion=${r3.usage.completionTokens}  total=${r3.usage.totalTokens}`);

      // ── 统计 ──────────────────────────────────────────────────────────
      console.log(`\n=== 多轮统计 ===`);
      console.log(`  轮数       : ${conv.getTurnCount()}`);
      console.log(`  history 长度: ${conv.getHistory().length}（${conv.getTurnCount()} user + ${conv.getTurnCount()} assistant）`);
      console.log(`  历史 Token  : ${conv.getHistoryTokenCount()}（估算）`);
      console.log(`  累计 Token  : prompt=${conv.totalUsage.promptTokens}  completion=${conv.totalUsage.completionTokens}  total=${conv.totalUsage.totalTokens}`);

      expect(conv.getTurnCount()).toBe(3);
      expect(conv.getHistory()).toHaveLength(6);            // 3 user + 3 assistant
      expect(conv.totalUsage.totalTokens).toBeGreaterThan(r1.usage.totalTokens);  // 累计必须多于单轮
      expect(conv.getHistoryTokenCount()).toBeGreaterThan(0);
    }, 90_000);

    it("Conversation.reset() 清空历史并重置累计 token", async () => {
      if (!activeService) {
        console.warn("跳过：无可用 LLM 服务");
        return;
      }

      const conv = new Conversation({
        service: activeService,
        model: activeModel,
        maxTokens: 40
      });

      await conv.say("你好");
      expect(conv.getTurnCount()).toBe(1);
      expect(conv.totalUsage.totalTokens).toBeGreaterThan(0);

      conv.reset();

      expect(conv.getTurnCount()).toBe(0);
      expect(conv.totalUsage.totalTokens).toBe(0);
      expect(conv.getHistory()).toHaveLength(0);

      console.log("\n[reset 后]");
      console.log(`  轮数: ${conv.getTurnCount()}, 累计 Token: ${conv.totalUsage.totalTokens}`);
    }, 30_000);
  });

  // ── 3. Token 估算（无需 API）────────────────────────────────────────────
  describe("countTokens 本地估算（不消耗 API）", () => {
    it("getDefaultService().countTokens 对中英文返回正数估算", () => {
      if (!activeService) {
        console.warn("跳过：无可用 LLM 服务");
        return;
      }

      const cnText = "你好，我想找一个周末爬山的伙伴";
      const enText = "Hello, I am looking for a hiking partner this weekend";

      const cnTokens = activeService.countTokens(cnText);
      const enTokens = activeService.countTokens(enText);

      console.log(`\n=== 本地 Token 估算 ===`);
      console.log(`  中文 "${cnText}" → ${cnTokens} tokens`);
      console.log(`  英文 "${enText}" → ${enTokens} tokens`);

      expect(cnTokens).toBeGreaterThan(0);
      expect(enTokens).toBeGreaterThan(0);
    });

    it("countMessageTokens 随消息条数增长", () => {
      if (!activeService) {
        console.warn("跳过：无可用 LLM 服务");
        return;
      }

      const singleMsg = [{ role: "user" as const, content: "你好" }];
      const multiMsg  = [
        { role: "user"      as const, content: "你好" },
        { role: "assistant" as const, content: "你好，有什么可以帮您？" },
        { role: "user"      as const, content: "我想爬山" }
      ];

      const t1 = activeService.countMessageTokens(singleMsg);
      const t3 = activeService.countMessageTokens(multiMsg);

      console.log(`\n=== 消息 Token 估算 ===`);
      console.log(`  1 条消息: ${t1} tokens`);
      console.log(`  3 条消息: ${t3} tokens`);

      expect(t3).toBeGreaterThan(t1);
    });
  });
});
