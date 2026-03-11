# LLM 调用架构说明

> 适用范围：`packages/core/src/llm/` + `packages/agent/src/shared/llm/`
> 最后更新：2026-03-11

---

## 一、整体架构概览

```
┌──────────────────────────────────────────────────────────────────┐
│                         客户端（App 层）                          │
│                                                                  │
│  Web 浏览器 (3030)          Expo Web (8089)       Native 手机     │
│  ┌──────────────┐         ┌──────────────┐    ┌──────────────┐   │
│  │ AiCoreScreen │         │ AiCoreScreen │    │ AiCoreScreen │   │
│  │   (同源BFF)   │         │  (跨域BFF)   │    │   (直连API)  │   │
│  └──────┬───────┘         └──────┬───────┘    └──────┬───────┘   │
│         │                        │                    │           │
│  createProxyLlmService    createProxyLlmService  createDirectLlm │
│    ("/api")                (WEB_BFF_URL)          Service(url,key)│
└─────────┼────────────────────────┼────────────────────┼──────────┘
          │                        │                    │
          ▼                        ▼                    │
┌─────────────────────────────────────┐                 │
│     Next.js BFF (apps/web/app/api/) │                 │
│     薄壳转发 — 不含业务逻辑          │                 │
│                                     │                 │
│  /api/llm/verify  → verifyModel()   │                 │
│  /api/llm/models  → MODELS 常量     │                 │
│  /api/llm/chat    → chatOnce/Stream │ (Phase 7 新增)  │
│  /api/embedding   → embedText()     │ (Phase 7 新增)  │
└─────────────────┬───────────────────┘                 │
                  │                                     │
                  ▼                                     ▼
┌──────────────────────────────────────────────────────────────────┐
│                Coding Plan 平台（阿里百炼聚合网关）                │
│                                                                  │
│  统一入口：https://coding.dashscope.aliyuncs.com/v1              │
│  统一认证：Bearer CODING_PLAN_API_KEY                            │
│  必须请求头：User-Agent: coding-agent/1.0（否则 405）             │
│  兼容协议：OpenAI Chat Completions API                           │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ 千问系列  │  │ 智谱 GLM │  │  Kimi    │  │ MiniMax  │        │
│  │qwen3.5+  │  │glm-5/4.7 │  │kimi-k2.5 │  │M2.5      │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
│                                                                  │
│  路由机制：根据请求体 model 字段自动分发到对应厂商后端              │
│  计费方式：统一走阿里百炼账单，无需各厂商独立注册                   │
└──────────────────────────────────────────────────────────────────┘

※ Embedding 走独立端点：https://dashscope.aliyuncs.com/compatible-mode/v1
  认证：Bearer DASHSCOPE_API_KEY（与 Coding Plan 的 key 不同）
```

---

## 二、当前已实现的代码详解（实习生必读）

> 本章逐文件、逐函数地解释"现在已经写好的代码做了什么、怎么用"。
> 涉及 4 个文件，读完就能看懂整条调用链。

### 2.1 文件总览

```
packages/core/src/llm/
├── models.ts    ← 静态数据：8 个模型的 id/品牌/能力标签
├── client.ts    ← 核心：定义 LlmService 接口 + 两种工厂函数
├── server.ts    ← 服务端专用：用 node:http 直连 Coding Plan（含代理支持）
└── index.ts     ← 统一导出口
```

---

### 2.2 models.ts — 模型列表（纯静态数据，零网络请求）

**作用**：定义"Coding Plan 平台上有哪些模型可以用"。这是一个写死的常量数组，不调 API。

```typescript
// 文件位置：packages/core/src/llm/models.ts

// 类型：每个模型长什么样
export interface ModelInfo {
  id: string;           // 传给 API 的模型 ID，如 "kimi-k2.5"
  brand: string;        // 显示给用户看的品牌名，如 "Kimi"
  capabilities: string[];  // 能力标签，如 ["文本生成", "深度思考"]
}

// 常量数组：目前支持的 8 个模型
export const MODELS: ModelInfo[] = [
  { id: "qwen3.5-plus",          brand: "千问",    capabilities: ["文本生成", "深度思考", "视觉理解"] },
  { id: "qwen3-max-2026-01-23",  brand: "千问",    capabilities: ["文本生成", "深度思考"] },
  { id: "qwen3-coder-next",      brand: "千问",    capabilities: ["文本生成"] },
  { id: "qwen3-coder-plus",      brand: "千问",    capabilities: ["文本生成"] },
  { id: "glm-5",                 brand: "智谱",    capabilities: ["文本生成", "深度思考"] },
  { id: "glm-4.7",               brand: "智谱",    capabilities: ["文本生成", "深度思考"] },
  { id: "kimi-k2.5",             brand: "Kimi",    capabilities: ["文本生成", "深度思考", "视觉理解"] },
  { id: "MiniMax-M2.5",          brand: "MiniMax", capabilities: ["文本生成", "深度思考"] },
];
```

**怎么用**：前端 Screen 直接导入，渲染成模型选择列表。

```typescript
import { MODELS } from "@repo/core/llm";
// 遍历 MODELS 渲染成下拉菜单 / 列表卡片即可
```

**怎么加新模型**：Coding Plan 后台上架新模型后，只需要在数组末尾加一行，不改任何其他代码。

---

### 2.3 client.ts — LlmService 接口 + 两种实现

**作用**：定义统一的"调用 LLM"接口，然后提供两种实现方式。上层 Screen 组件只认接口，不关心底层走哪条路。

#### 第一步：理解接口

```typescript
// 返回值类型
export interface VerifyResult {
  ok: boolean;      // 模型是否可用
  model: string;    // 模型 ID
  reply?: string;   // 模型回复的文字（成功时有）
  error?: string;   // 错误信息（失败时有）
}

// 统一接口：不管 Web 还是 Native，上层只调这两个方法
export interface LlmService {
  getModels(): ModelInfo[];                          // 拿模型列表
  verifyModel(modelId: string): Promise<VerifyResult>; // 测试某个模型能不能用
}
```

#### 第二步：两种实现（关键！）

**实现 A：Direct 模式（Native 手机用）**

手机 App 没有浏览器的 CORS 限制，所以可以直接发 HTTP 请求给 Coding Plan：

```typescript
export function createDirectLlmService(config: DirectLlmConfig): LlmService {
  return {
    getModels() {
      return MODELS;  // 直接返回静态数组
    },

    async verifyModel(modelId: string): Promise<VerifyResult> {
      // 直接发 fetch 请求给 Coding Plan
      const res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
          "User-Agent": "coding-agent/1.0",  // ← 必须加！否则返回 405
        },
        body: JSON.stringify({
          model: modelId,     // ← 这个字段决定用哪个厂商的模型
          messages: [{ role: "user", content: "hi" }],  // 发一条最简消息测试
          max_tokens: 8,
          temperature: 0,
        }),
      });

      // 解析返回，拼成 VerifyResult
      const body = await res.json();
      return { ok: true, model: body.model, reply: body.choices[0].message.content };
    },
  };
}
```

**实现 B：Proxy 模式（Web 浏览器 + Expo Web 用）**

浏览器有 CORS 限制，不能直接请求 `coding.dashscope.aliyuncs.com`。
所以浏览器把请求发给自己的 Next.js 后端（BFF），后端再转发给 Coding Plan：

```
浏览器 → POST /api/llm/verify → Next.js 服务端 → Coding Plan → 返回结果 → 浏览器
```

```typescript
export function createProxyLlmService(proxyBaseUrl: string): LlmService {
  return {
    getModels() {
      return MODELS;
    },

    async verifyModel(modelId: string): Promise<VerifyResult> {
      // 不直接请求 Coding Plan，而是请求自己的后端
      const res = await fetch(`${proxyBaseUrl}/llm/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelId }),
      });
      return await res.json();
    },
  };
}
```

#### 第三步：谁在什么时候选用哪种实现？

在 `apps/native/app/(tabs)/ai-core.tsx` 里根据平台自动选择：

```typescript
import { Platform } from "react-native";

const llmService = useMemo(() => {
  if (Platform.OS === "web") {
    // 浏览器环境 → 走 BFF 代理（避免 CORS）
    return createProxyLlmService(WEB_BFF_URL);
  }
  // 手机环境 → 直连 Coding Plan（无 CORS 限制）
  return createDirectLlmService({ baseUrl, apiKey });
}, []);

// 把 llmService 传给 Screen 组件
return <AiCoreScreen llmService={llmService} />;
```

在 `apps/web/app/ai-core/page.tsx` 里：

```typescript
// Web 端永远走代理（同源 BFF，连跨域都不需要）
const llmService = createProxyLlmService("/api");
return <AiCoreScreen llmService={llmService} />;
```

---

### 2.4 server.ts — BFF 后端的实际执行逻辑

**作用**：Web 浏览器发 `POST /api/llm/verify` 后，Next.js 路由会调用这个文件来真正请求 Coding Plan。

**为什么不用 `fetch`？** 因为服务端需要支持 HTTPS 代理（容器网络经常要走代理才能访问外网），`fetch` 不支持代理，所以用 `node:http/https` 原生模块 + `HttpsProxyAgent`。

```typescript
// 文件位置：packages/core/src/llm/server.ts

// 核心函数：验证模型是否可用
export async function verifyModelOnServer(modelId: string, config: ServerLlmConfig): Promise<VerifyResult> {
  // 1. 没配置 API Key → 直接报错
  if (!config.apiKey) return { ok: false, model: modelId, error: "服务端未配置 API Key" };

  // 2. 用 node:http 发请求（支持代理）
  const { status, data } = await postJSON(
    `${config.baseUrl}/chat/completions`,
    {
      model: modelId,
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 8,
      temperature: 0,
    },
    config
  );

  // 3. 解析结果返回
  if (status >= 200 && status < 300) {
    return { ok: true, model: data.model, reply: data.choices[0].message.content };
  } else {
    return { ok: false, model: modelId, error: `模型响应异常 (${status})` };
  }
}
```

**BFF 路由文件（真正的薄壳）**：

```typescript
// 文件位置：apps/web/app/api/llm/verify/route.ts
// 只有 5 行核心代码：读环境变量 → 解析请求体 → 调用 server.ts → 返回 JSON

import { verifyModelOnServer } from "@repo/core/llm-server";

const serverConfig = {
  baseUrl: process.env.CODING_PLAN_BASE_URL,
  apiKey: process.env.CODING_PLAN_API_KEY,
  proxy: process.env.HTTPS_PROXY || "",
};

export async function POST(req) {
  const { model } = await req.json();
  const result = await verifyModelOnServer(model, serverConfig);
  return NextResponse.json(result);
}
```

---

### 2.5 实际发生的 HTTP 请求/响应（抓包级详解）

当用户在 AiCoreScreen 里点击"切换到 kimi-k2.5"时：

**请求（发给 Coding Plan）：**

```http
POST https://coding.dashscope.aliyuncs.com/v1/chat/completions HTTP/1.1
Content-Type: application/json
Authorization: Bearer sk-sp-90237be7707141c8b1b024c82c4512d8
User-Agent: coding-agent/1.0

{
  "model": "kimi-k2.5",
  "messages": [{ "role": "user", "content": "hi" }],
  "max_tokens": 8,
  "temperature": 0
}
```

> `model` 字段决定了 Coding Plan 把请求转发给月之暗面（Kimi 的厂商）。
> 换成 `"glm-5"` 就转发给智谱，换成 `"qwen3.5-plus"` 就转发给通义千问。
> 你只需要一个 URL + 一个 API Key，就能用所有厂商的模型。

**响应（Coding Plan 返回，OpenAI 兼容格式）：**

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "model": "kimi-k2.5",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "你好！有什么可以帮助你的吗？"
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 3,
    "completion_tokens": 12,
    "total_tokens": 15
  }
}
```

**代码拿到响应后怎么处理：**

```typescript
// client.ts 里的 verifyModel() 拿到 body 后：
const reply = body.choices[0].message.content;  // "你好！有什么可以帮助你的吗？"
const model = body.model;                       // "kimi-k2.5"
return { ok: true, model, reply };
// 这个结果最终传回 AiCoreScreen，显示绿色状态栏 "✓ kimi-k2.5 切换成功"
```

---

### 2.6 环境变量在哪里配置

所有 Key 统一写在 `/workspaces/.env`，各端通过不同方式读取：

| 环境变量 | 值 | 谁读它 | 怎么读 |
|---------|-----|-------|--------|
| `CODING_PLAN_API_KEY` | `sk-sp-...` | Next.js 服务端 | `process.env` 直接读（next.config.js 加载了 dotenv） |
| `CODING_PLAN_API_KEY` | `sk-sp-...` | Expo Native | `app.config.ts` 读进 `extra` → `Constants.expoConfig.extra` 拿到 |
| `CODING_PLAN_BASE_URL` | `https://coding.dashscope...` | 同上 | 同上 |
| `DASHSCOPE_API_KEY` | `sk-...` | Embedding 模块（Phase 5） | `process.env` 直接读 |

**两个 Key 别混淆：**
- `CODING_PLAN_API_KEY`（`sk-sp-` 开头）→ 用于对话（Chat Completions）
- `DASHSCOPE_API_KEY`（`sk-` 开头）→ 用于向量化（Embedding），端点也不同

---

### 2.7 数据库方面（当前阶段）

当前阶段 LLM 调用**不涉及数据库读写**。`MODELS` 是硬编码的常量，`verifyModel` 的结果直接返回给前端显示，不存库。

Phase 2-8 实现后，LLM 调用链才会和数据库交互（详见第四章参考表）。

---

## 三、调用链路总览（Phase 2-8 待实现）

> 以下章节供 Coding Agent 和工程师查阅，不需要逐行阅读。

### 四层架构

```
Screen UI → BFF 薄壳 → Agent 编排层 → LLM Provider → Coding Plan HTTP
```

| 层 | 位置 | 职责 |
|---|------|------|
| Screen | `packages/ui/src/screens/` | 用户交互，调用注入的 service |
| BFF | `apps/web/app/api/` | 薄壳转发，不含业务逻辑 |
| Agent | `packages/agent/src/` | Intake 对话、L2 研判、记忆压缩、FSM 推进 |
| Provider | `packages/agent/src/shared/llm/` | BaseModel 抽象 → Qwen/OpenAI/Claude 适配器 |

### Provider 统一接口

```typescript
// packages/agent/src/shared/llm/base-model.ts
abstract class BaseModel {
  abstract chatOnce(messages: ChatMessage[]): Promise<ChatCompletionResponse>;
  abstract chatStream(messages: ChatMessage[]): AsyncGenerator<string>;
  abstract countTokens(text: string): number;
}
```

| Provider | Base URL | 特殊处理 |
|----------|---------|---------|
| Qwen | `coding.dashscope.aliyuncs.com/v1` | 需 `User-Agent: coding-agent/1.0` |
| OpenAI | `api.openai.com/v1` | 标准 SDK |
| Claude | `api.anthropic.com/v1` | system 字段独立传递 |

### 多轮对话（Conversation 类）

```typescript
const conv = new Conversation({ system: "你是匹配助手。", maxHistoryTokens: 8000 });
const r1 = await conv.say("我想找人打球");
const r2 = await conv.say("户外羽毛球");
// 超过 maxHistoryTokens 自动裁剪最旧的 user+assistant 对
```

---

## 四、上下文 / 记忆 / Embedding 参考

### Prompt 上下文构建

```
buildPromptContext(task, turns, tokenBudget=4000)
  → estimateTokens → 超 80%？→ flushMemoryIfNeeded()
  → truncateTurnsByBudget → 拼装 taskPrompt
```

### 记忆压缩 Flush 流程

```
对话超阈值 → 归档 raw_chats/ → LLM 生成 summary
→ 写 raw_chats_summary/ → 写 memory_summaries 表
→ summary embedding → task_vectors 表
→ 用 summary 替换原对话继续
```

### Token 估算

- 通用：`Math.ceil(text.length / 4)`
- CJK 优化：中日韩 ÷ 1.5 + 英文 ÷ 4（误差 ≤20%，软约束）

### Embedding 调用

```typescript
const vector = await embedText("周末户外羽毛球");  // → number[1024]
const vectors = await embedBatch(["打球", "看电影"]); // 批量
await embedTaskFields(taskId, activity, vibe, raw);   // 三字段一键向量化
```

端点：`POST dashscope.aliyuncs.com/compatible-mode/v1/embeddings`，用 `DASHSCOPE_API_KEY`

### L1 向量检索

```sql
SELECT task_id, embedding <=> $1::vector AS distance
FROM task_vectors WHERE field = 'targetActivity' AND task_id = ANY($2)
ORDER BY distance ASC LIMIT 20;
```

加权：`0.35 × activity + 0.35 × vibe + 0.30 × raw` → Top-K

---

## 五、数据库交互汇总

| 操作 | 时机 | 表 | 读/写 |
|------|------|---|------|
| 加载 User.md 偏好 | Intake / L2 研判前 | `persona_profiles` | 读 |
| 加载 task.md | L2 研判 / prompt 构建 | `tasks` + `task_summaries` | 读 |
| 保存对话消息 | 每轮对话后 | `chat_messages` | 写 |
| 保存任务向量 | Intake 完成后 | `task_vectors` | 写 |
| L0 硬过滤 | Searching 阶段 | `tasks` (WHERE status) | 读 |
| L1 向量搜索 | Searching 阶段 | `task_vectors` (pgvector `<=>`) | 读 |
| 保存握手记录 | 发送/接收 PROPOSE | `handshake_logs` | 写 |
| 幂等检查 | 接收握手消息 | `idempotency_keys` | 读+写 |
| 记忆压缩 | 对话超阈值 | `memory_summaries` + `task_vectors` | 写 |
| 状态迁移 | FSM 推进 | `tasks` (乐观锁 version) | 写 |

---

## 六、错误处理速查

| 错误 | 原因 | 处理 |
|------|------|------|
| 405 | 缺 `User-Agent: coding-agent/1.0` | 修复请求头，不重试 |
| 401/403 | API Key 无效 | 不重试，提示用户 |
| 429 | 频率限制 | 指数退避（1s→2s→4s），最多 3 次 |
| 5xx | 服务端故障 | 指数退避，最多 3 次 |
| CORS | 浏览器跨域 | 应走 BFF 代理，检查 Platform.OS |
| Token 超限 | prompt 过长 | 触发 memory flush 后重建 prompt |

---

## 七、扩展速查

**加新模型**：`models.ts` 加一行 `{ id: "deepseek-v3", brand: "DeepSeek", ... }`

**加新 Provider**：`shared/llm/` 新建 `xxx-provider.ts` 继承 BaseModel → `provider-registry.ts` 注册

**SSE 流式**（Phase 7）：`POST /api/llm/chat { stream: true }` → `ReadableStream` 逐 chunk 读

**Agent 人格注入**：system prompt = Agent.md 人格 + User.md 画像 + 任务上下文 + 输出格式约束，可通过 `persona.settings` 动态调参
