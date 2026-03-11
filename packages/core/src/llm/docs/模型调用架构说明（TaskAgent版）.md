# 模型调用架构说明（TaskAgent 版）

> 适用范围：`packages/core/src/llm/` + `packages/agent/src/shared/llm/`
> 最后更新：2026-03-11

---

## 一、整体架构概览

```
┌──────────────────────────────────────────────────────────────────┐
│                         客户端（App 层）                          │
│                                                                  │
│  Web 浏览器 (3030)         Expo Web (8089)       Native 手机     │
│  ┌──────────────┐        ┌──────────────┐    ┌──────────────┐   │
│  │ AgentScreen  │        │ AgentScreen  │    │ AgentScreen  │   │
│  │  (同源BFF)   │        │  (跨域BFF)   │    │  (直连API)   │   │
│  └──────┬───────┘        └──────┬───────┘    └──────┬───────┘   │
│         │                       │                    │           │
│  createLlmServiceForPlatform("web-browser")          │           │
│         │           createLlmServiceForPlatform       │           │
│         │              ("expo-web", bffUrl)           │           │
│         │                       │   createLlmServiceForPlatform  │
│         │                       │     ("native", baseUrl, apiKey)│
└─────────┼───────────────────────┼────────────────────┼──────────┘
          │                       │                    │
          ▼                       ▼                    │
  createProxyLlmService    createProxyLlmService       │
     ("/api")               (WEB_BFF_URL)              │
          │                       │         createDirectLlmService
          ▼                       ▼                    │
┌─────────────────────────────────────┐                │
│     Next.js BFF (apps/web/app/api/) │                │
│     薄壳转发 — 不含业务逻辑          │                │
│                                     │                │
│  /api/llm/models  → MODELS 常量     │                │
│  /api/llm/verify  → verifyModel()   │                │
│  /api/llm/chat    → chatOnServer()  │ ← 新增         │
│  /api/embedding   → embedText()     │ (Phase 7)     │
└─────────────────┬───────────────────┘                │
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
└──────────────────────────────────────────────────────────────────┘

※ Node.js / TaskAgent 使用 createLlmServiceForPlatform("node")
  自动读取 CODING_PLAN_BASE_URL + CODING_PLAN_API_KEY 环境变量直连
```

**设计原则：** 上层代码只依赖 `LlmService` 接口，无需感知底层走代理还是直连。App 层通过 `createLlmServiceForPlatform()` 一次创建，注入 React Context 供全局使用。

---

## 二、目录结构

```
packages/core/src/llm/
├── index.ts     # 统一导出入口
├── types.ts     # 基础原语类型（Role / ChatMessage / TokenUsage）
├── models.ts    # 支持的模型列表（静态元数据，零网络请求）
├── client.ts    # LlmService 接口 + Direct / Proxy 两种实现 + 平台工厂
├── chat.ts      # 高层对话工具（chatOnce 单次 + Conversation 多轮）
└── server.ts    # 服务端专用：支持 HTTPS_PROXY 的 Node.js HTTP 实现
```

---

## 三、文件详解

### 3.1 types.ts — 基础原语类型

最小化公共类型，不依赖任何其他模块。

| 类型 | 说明 |
|------|------|
| `Role` | 消息角色：`"system" \| "user" \| "assistant"` |
| `ChatMessage` | 单条消息 `{ role, content }` |
| `TokenUsage` | Token 统计 `{ promptTokens, completionTokens, totalTokens }` |

---

### 3.2 models.ts — 模型元数据

定义平台支持的模型列表，用于 UI 展示和模型选择器，**不发起任何网络请求**。

| 导出 | 类型 | 说明 |
|------|------|------|
| `ModelInfo` | interface | `{ id, brand, capabilities[] }` |
| `MODELS` | `ModelInfo[]` | 当前支持的 8 个模型 |

**当前支持模型：**

| 模型 ID | 品牌 | 能力 |
|---------|------|------|
| `qwen3.5-plus` | 千问 | 文本生成、深度思考、视觉理解 |
| `qwen3-max-2026-01-23` | 千问 | 文本生成、深度思考 |
| `qwen3-coder-next` | 千问 | 文本生成 |
| `qwen3-coder-plus` | 千问 | 文本生成 |
| `glm-5` | 智谱 | 文本生成、深度思考 |
| `glm-4.7` | 智谱 | 文本生成、深度思考 |
| `kimi-k2.5` | Kimi | 文本生成、深度思考、视觉理解 |
| `MiniMax-M2.5` | MiniMax | 文本生成、深度思考 |

> 新增模型只需在 `MODELS` 数组中追加一条记录即可。

---

### 3.3 client.ts — 核心服务接口与实现

#### LlmService 接口

所有 LLM 调用的统一抽象，包含完整的对话和 Token 估算能力：

```typescript
interface LlmService {
  getModels(): ModelInfo[]                                  // 获取模型列表（无网络）
  verifyModel(modelId: string): Promise<VerifyResult>       // 探测模型连通性
  chat(request: ChatRequest): Promise<ChatResponse>         // 发起完整对话
  countTokens(text: string): number                         // 估算单段文本 token 数
  countMessageTokens(messages: ChatMessage[]): number       // 估算消息数组 token 数
}
```

#### 请求 / 响应类型

```typescript
interface ChatRequest {
  model: string               // 模型 ID，如 "qwen3.5-plus"
  messages: ChatMessage[]
  temperature?: number        // 默认 0.7
  maxTokens?: number
  stop?: string[]
}

interface ChatResponse {
  content: string
  finishReason: "stop" | "length" | "error" | "unknown"
  usage: TokenUsage
  model: string
  latencyMs: number
}
```

#### 三种创建方式

| 工厂函数 | 适用场景 | 说明 |
|---------|---------|------|
| `createDirectLlmService(config)` | Native 手机端 | 原生 `fetch` 直连 Coding Plan，支持超时控制 |
| `createProxyLlmService(proxyBaseUrl)` | Web 浏览器 | 通过 Next.js BFF 中转，绕过 CORS |
| `getDefaultService()` | Node.js / TaskAgent | 读环境变量自动创建 Direct 实例 |

#### 平台自适应工厂（新增）

```typescript
type LlmPlatform = "web-browser" | "expo-web" | "native" | "node";

// App 层只需调用一次，通过 React Context 注入全局
const service = createLlmServiceForPlatform({
  platform: "web-browser",  // 自动选择 Proxy 模式，默认 proxyBaseUrl="/api"
});

const service = createLlmServiceForPlatform({
  platform: "expo-web",
  proxyBaseUrl: "http://localhost:3030/api",  // Expo Web 必须显式指定
});

const service = createLlmServiceForPlatform({
  platform: "native",
  baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
  apiKey: "sk-sp-...",
});

const service = createLlmServiceForPlatform({
  platform: "node",  // 自动读取 CODING_PLAN_BASE_URL + CODING_PLAN_API_KEY
});
```

**平台到实现的映射：**

| platform | 实际调用 | 网络路径 |
|----------|---------|---------|
| `web-browser` | `createProxyLlmService("/api")` | 浏览器 → BFF → Coding Plan |
| `expo-web` | `createProxyLlmService(bffUrl)` | Expo Web → BFF（跨域）→ Coding Plan |
| `native` | `createDirectLlmService(...)` | 手机 → Coding Plan（直连） |
| `node` | `getDefaultService()` | Node.js → Coding Plan（直连） |

#### Token 估算算法

CJK 字符（中日韩）约 1.5 字/token，其余字符约 4 字符/token；每条消息加 4 个格式开销 token，消息数组首部加 2 个 priming token。

---

### 3.4 chat.ts — 高层对话工具

基于 `LlmService` 封装，提供更简洁的调用 API。

#### `chatOnce(userMessage, options?)` — 单次对话

```typescript
// Node.js / TaskAgent（自动读取环境变量）
const res = await chatOnce("帮我总结一下", {
  system: "你是一个助手",
  temperature: 0.3,
});

// Web（显式传入 service）
const res = await chatOnce("你好", { service: proxyService, model: "glm-5" });
```

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `service` | `LlmService` | 自动 | 不传则读环境变量 |
| `model` | `string` | `qwen3-max-2026-01-23` | 模型 ID |
| `system` | `string` | — | System prompt |
| `temperature` | `number` | 0.7 | 生成温度 |
| `maxTokens` | `number` | — | 最大生成 token 数 |
| `stop` | `string[]` | — | 停止词 |

#### `Conversation` — 有状态多轮对话

```typescript
const conv = new Conversation({ system: "你是助手", model: "qwen3.5-plus" });
const r1 = await conv.say("你好");
const r2 = await conv.say("再介绍一下自己");
```

**公共方法：**

| 方法 | 说明 |
|------|------|
| `say(message)` | 发送消息，返回 `ChatResponse` |
| `getHistory()` | 获取对话历史副本 |
| `getHistoryTokenCount()` | 获取当前历史的估算 token 数 |
| `getTurnCount()` | 获取已完成轮次数（user+assistant 算一轮） |
| `reset()` | 清空历史和累计用量，保留 system prompt |
| `setSystemPrompt(prompt)` | 动态替换 system prompt |
| `setModel(modelId)` | 切换模型（下一轮生效） |
| `exportMessages()` | 导出完整消息数组（含 system，用于日志/保存） |

**自动裁剪：** 当历史 token 超过 `maxHistoryTokens`（默认 8000）时，从最早的对话轮（user+assistant 一对）开始删除，直到满足限制。

---

### 3.5 server.ts — 服务端专用模块

> ⚠️ **客户端（浏览器/Native）请勿导入此模块**，依赖 `node:http` / `node:https`。

用于 Next.js BFF 等服务端环境，支持通过 `HTTPS_PROXY` 代理访问 Coding Plan API。

**与 `client.ts` 的区别：**
- 使用 Node.js 原生 `http`/`https` 模块，支持 `HttpsProxyAgent`
- 供 BFF 路由直接调用，不暴露给客户端

#### `verifyModelOnServer(modelId, config)` — 服务端模型验证

```typescript
const result = await verifyModelOnServer("qwen3.5-plus", {
  baseUrl: process.env.CODING_PLAN_BASE_URL!,
  apiKey: process.env.CODING_PLAN_API_KEY!,
  proxy: process.env.HTTPS_PROXY,
  timeout: 20000,
});
```

#### `chatOnServer(request, config)` — 服务端完整对话（新增）

```typescript
const response = await chatOnServer(
  {
    model: "qwen3.5-plus",
    messages: [
      { role: "system", content: "你是助手" },
      { role: "user", content: "你好" },
    ],
    temperature: 0.7,
  },
  {
    baseUrl: process.env.CODING_PLAN_BASE_URL!,
    apiKey: process.env.CODING_PLAN_API_KEY!,
    proxy: process.env.HTTPS_PROXY,
    timeout: 60000,  // chat 超时默认 60 秒（比 verify 长）
  },
);
// response: { content, finishReason, usage, model, latencyMs }
```

---

### 3.6 index.ts — 统一导出入口

所有外部消费方统一从此文件导入：

```typescript
// 模型列表
import { MODELS, type ModelInfo } from "@repo/core/llm";

// 核心服务
import {
  createDirectLlmService,
  createProxyLlmService,
  getDefaultService,
  createLlmServiceForPlatform,  // ← 推荐使用
} from "@repo/core/llm";

// 高层对话工具
import { chatOnce, Conversation } from "@repo/core/llm";

// 类型
import type {
  LlmService, ChatRequest, ChatResponse, ChatMessage, TokenUsage,
  LlmPlatform, PlatformLlmConfig,
} from "@repo/core/llm";
```

---

## 四、BFF 路由一览

| 路由 | 方法 | 说明 | 调用的 server.ts 函数 |
|------|------|------|----------------------|
| `/api/llm/models` | GET | 返回模型列表 | 无（直接返回 MODELS） |
| `/api/llm/verify` | POST | 验证模型连通性 | `verifyModelOnServer()` |
| `/api/llm/chat` | POST | 完整对话请求 | `chatOnServer()` |

**BFF chat 路由示例请求：**

```json
POST /api/llm/chat
{
  "model": "qwen3.5-plus",
  "messages": [
    { "role": "system", "content": "你是助手" },
    { "role": "user", "content": "你好" }
  ],
  "temperature": 0.7,
  "maxTokens": 2048
}
```

---

## 五、多端调用模式对比

```
┌────────────────────┬─────────────────────────────────────────────┐
│    调用方            │  推荐用法                                    │
├────────────────────┼─────────────────────────────────────────────┤
│ Next.js Web 前端    │ createLlmServiceForPlatform("web-browser") │
│                    │  → Proxy → BFF /api/llm/* → Coding Plan    │
├────────────────────┼─────────────────────────────────────────────┤
│ Expo Web 模式       │ createLlmServiceForPlatform("expo-web",    │
│                    │    { proxyBaseUrl: WEB_BFF_URL })           │
│                    │  → Proxy → BFF（跨域）→ Coding Plan         │
├────────────────────┼─────────────────────────────────────────────┤
│ React Native 手机   │ createLlmServiceForPlatform("native",      │
│                    │    { baseUrl, apiKey })                     │
│                    │  → Direct → Coding Plan                    │
├────────────────────┼─────────────────────────────────────────────┤
│ Node.js / TaskAgent │ createLlmServiceForPlatform("node")        │
│                    │  → Direct（读 env）→ Coding Plan            │
│                    │  或直接用 chatOnce() / Conversation         │
└────────────────────┴─────────────────────────────────────────────┘
```

---

## 六、快速上手

### App 层初始化（推荐方式）

```typescript
// apps/web/ 根布局
import { createLlmServiceForPlatform } from "@repo/core/llm";

const llmService = createLlmServiceForPlatform({ platform: "web-browser" });
// 通过 React Context 注入给子页面
<LlmProvider service={llmService}>
  <App />
</LlmProvider>
```

```typescript
// apps/native/ 根布局
import { Platform } from "react-native";
import { createLlmServiceForPlatform } from "@repo/core/llm";

const llmService = createLlmServiceForPlatform(
  Platform.OS === "web"
    ? { platform: "expo-web", proxyBaseUrl: WEB_BFF_URL }
    : { platform: "native", baseUrl: CODING_PLAN_BASE_URL, apiKey: CODING_PLAN_API_KEY }
);
```

### TaskAgent / Node.js 服务端

```typescript
import { chatOnce, Conversation } from "@repo/core/llm";

// 单次调用（自动读取环境变量）
const res = await chatOnce("请总结以下内容：...", { system: "你是代码助手" });

// 多轮对话
const conv = new Conversation({ system: "你是代码助手", model: "qwen3.5-plus" });
await conv.say("第一个问题");
await conv.say("追问");
```

---

## 七、Agent 编排层（Phase 2-8 待实现）

### 四层架构

```
Screen UI → BFF 薄壳 → Agent 编排层 → LlmService → Coding Plan HTTP
```

| 层 | 位置 | 职责 |
|---|------|------|
| Screen | `packages/ui/src/screens/` | 用户交互，通过 Context 获取 service |
| BFF | `apps/web/app/api/` | 薄壳转发，不含业务逻辑 |
| Agent | `packages/agent/src/` | Intake 对话、L2 研判、记忆压缩、FSM 推进 |
| Provider | `packages/core/src/llm/` | LlmService 统一接口 + 平台工厂 |

### 多轮对话（Conversation 类）

```typescript
const conv = new Conversation({ system: "你是匹配助手。", maxHistoryTokens: 8000 });
const r1 = await conv.say("我想找人打球");
const r2 = await conv.say("户外羽毛球");
// 超过 maxHistoryTokens 自动裁剪最旧的 user+assistant 对
```

---

## 八、上下文 / 记忆 / Embedding 参考

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

### Embedding 调用

```typescript
const vector = await embedText("周末户外羽毛球");  // → number[1024]
const vectors = await embedBatch(["打球", "看电影"]); // 批量
```

端点：`POST dashscope.aliyuncs.com/compatible-mode/v1/embeddings`，用 `DASHSCOPE_API_KEY`

---

## 九、环境变量

| 变量名 | 说明 | 使用场景 |
|--------|------|----------|
| `CODING_PLAN_BASE_URL` | API 网关地址 | 所有直连模式 |
| `CODING_PLAN_API_KEY` | 主 API Key（`sk-sp-` 开头） | 所有直连模式 |
| `QWEN_API_KEY` | 备用 API Key（兼容旧配置） | Node.js fallback |
| `HTTPS_PROXY` | HTTPS 代理地址 | server.ts（BFF 服务端） |
| `DASHSCOPE_API_KEY` | Embedding 专用 Key（`sk-` 开头） | 向量化模块 |

---

## 十、错误处理速查

| 错误 | 原因 | 处理 |
|------|------|------|
| 405 | 缺 `User-Agent: coding-agent/1.0` | 修复请求头，不重试 |
| 401/403 | API Key 无效 | 不重试，提示用户 |
| 429 | 频率限制 | 指数退避（1s→2s→4s），最多 3 次 |
| 5xx | 服务端故障 | 指数退避，最多 3 次 |
| CORS | 浏览器跨域 | 应走 BFF 代理，检查 platform 配置 |
| Token 超限 | prompt 过长 | 触发 memory flush 后重建 prompt |

---

## 十一、扩展速查

| 需求 | 操作 |
|------|------|
| 新增支持的模型 | 在 `models.ts` 的 `MODELS` 数组中追加 `ModelInfo` 记录 |
| 修改默认模型 | 修改 `chat.ts` 中的 `DEFAULT_MODEL` 常量 |
| 调整 token 估算精度 | 修改 `client.ts` 中的 `estimateTokens` 函数 |
| 添加流式输出支持 | 在 `LlmService` 接口中新增 `chatStream` 方法 |
| 更换 API 网关地址 | 修改环境变量 `CODING_PLAN_BASE_URL`，无需改代码 |
| 新增 Provider 适配 | `shared/llm/` 新建 provider 继承 BaseModel → registry 注册 |
| SSE 流式（Phase 7） | `POST /api/llm/chat { stream: true }` → `ReadableStream` 逐 chunk |
