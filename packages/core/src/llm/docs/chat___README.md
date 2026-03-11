# LLM 模块文档

> `packages/core/src/llm/`
>
> 统一 LLM 接入层，供 Web（Next.js）、Native（Electron/移动端）和 Node.js（TaskAgent）共用。

---

## 目录结构

```
src/llm/
├── index.ts     # 统一导出入口
├── types.ts     # 基础原语类型
├── models.ts    # 支持的模型列表（静态元数据）
├── client.ts    # LlmService 接口 + Direct / Proxy 两种实现
├── chat.ts      # 高层对话工具（单次 + 多轮）
└── server.ts    # 服务端专用：支持 HTTPS_PROXY 的 Node.js HTTP 实现
```

---

## 架构概览

```
┌─────────────────────────────────────────────────────────┐
│                    调用方                                 │
│  Web (浏览器)          Native / Node.js / TaskAgent      │
└────────────┬───────────────────────┬────────────────────┘
             │                       │
    createProxyLlmService      createDirectLlmService
             │                       │
    ┌────────▼───────────────────────▼──────────────────┐
    │              LlmService 接口 (client.ts)           │
    │  getModels / verifyModel / chat / countTokens      │
    └────────────────────────┬──────────────────────────┘
                             │
                    Coding Plan API 网关
               (统一路由至 Qwen / GLM / Kimi / MiniMax)
```

**设计原则：** 上层代码只依赖 `LlmService` 接口，无需感知底层走代理还是直连。

---

## 文件详解

### `types.ts` — 基础原语类型

最小化公共类型，不依赖任何其他模块。

| 类型 | 说明 |
|------|------|
| `Role` | 消息角色：`"system" \| "user" \| "assistant"` |
| `ChatMessage` | 单条消息 `{ role, content }` |
| `TokenUsage` | Token 统计 `{ promptTokens, completionTokens, totalTokens }` |

---

### `models.ts` — 模型元数据

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

> 新增模型只需在此文件的 `MODELS` 数组中追加一条记录即可。

---

### `client.ts` — 核心服务接口与实现

#### `LlmService` 接口

所有 LLM 调用的统一抽象：

```typescript
interface LlmService {
  getModels(): ModelInfo[]                                  // 获取模型列表（无网络）
  verifyModel(modelId: string): Promise<VerifyResult>       // 探测模型连通性
  chat(request: ChatRequest): Promise<ChatResponse>         // 发起对话
  countTokens(text: string): number                         // 估算单段文本 token 数
  countMessageTokens(messages: ChatMessage[]): number       // 估算消息数组 token 数
}
```

#### 两种实现

**`createDirectLlmService(config)`** — Native / Node.js 直连模式
- 使用原生 `fetch` + `AbortController` 实现超时控制
- 配置：`{ baseUrl, apiKey, timeoutMs? }`
- 默认超时：30 秒

**`createProxyLlmService(proxyBaseUrl)`** — Web 浏览器代理模式
- 通过 Next.js BFF 中转，绕过浏览器 CORS 限制
- 代理端点：`POST {proxyBaseUrl}/llm/verify`、`POST {proxyBaseUrl}/llm/chat`

**`getDefaultService()`** — Node.js 环境快速初始化
- 读取环境变量 `CODING_PLAN_BASE_URL` 和 `CODING_PLAN_API_KEY`（或 `QWEN_API_KEY`）
- 适用于 TaskAgent 等 Node.js 服务端场景

#### 请求 / 响应类型

```typescript
interface ChatRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number       // 默认 0.7
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

#### Token 估算算法

CJK 字符（中日韩）约 1.5 字/token，其余字符约 4 字符/token；每条消息加 4 个格式开销 token，消息数组首部加 2 个 priming token。

---

### `chat.ts` — 高层对话工具

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

### `server.ts` — 服务端专用模块

> ⚠️ **客户端（浏览器/Native）请勿导入此模块**，依赖 `node:http` / `node:https`。

用于 Next.js BFF 等服务端环境，支持通过 `HTTPS_PROXY` 代理访问 Coding Plan API。

#### `verifyModelOnServer(modelId, config)` — 服务端模型验证

```typescript
const result = await verifyModelOnServer("qwen3.5-plus", {
  baseUrl: process.env.CODING_PLAN_BASE_URL!,
  apiKey: process.env.CODING_PLAN_API_KEY!,
  proxy: process.env.HTTPS_PROXY,   // 可选
  timeout: 20000,                    // 默认 20 秒
});
```

**与 `client.ts` 的区别：**
- 使用 Node.js 原生 `http`/`https` 模块，支持 `HttpsProxyAgent`
- 仅暴露 `verifyModel` 功能，完整 chat 调用仍使用 `client.ts`

---

### `index.ts` — 统一导出入口

所有外部消费方统一从此文件导入，无需关心内部文件结构。

```typescript
// 模型列表
import { MODELS, type ModelInfo } from "@repo/core/llm";

// 核心服务
import { createDirectLlmService, createProxyLlmService, getDefaultService } from "@repo/core/llm";

// 高层对话工具
import { chatOnce, Conversation } from "@repo/core/llm";

// 类型
import type { LlmService, ChatRequest, ChatResponse, ChatMessage, TokenUsage } from "@repo/core/llm";
```

---

## 快速上手

### TaskAgent / Node.js 服务端

```typescript
import { chatOnce, Conversation } from "@repo/core/llm";

// 环境变量：CODING_PLAN_BASE_URL, CODING_PLAN_API_KEY

// 单次调用
const res = await chatOnce("请总结以下内容：...", { system: "你是代码助手" });
console.log(res.content);

// 多轮对话
const conv = new Conversation({ system: "你是代码助手", model: "qwen3.5-plus" });
await conv.say("第一个问题");
await conv.say("追问");
```

### Web 前端

```typescript
import { createProxyLlmService, chatOnce, Conversation } from "@repo/core/llm";

const service = createProxyLlmService("/api");

const res = await chatOnce("你好", { service, model: "glm-5" });
const conv = new Conversation({ service, model: "kimi-k2.5" });
```

### Native / Electron

```typescript
import { createDirectLlmService, chatOnce } from "@repo/core/llm";

const service = createDirectLlmService({
  baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
  apiKey: "sk-...",
});

const res = await chatOnce("你好", { service });
```

---

## 扩展指南

| 需求 | 操作 |
|------|------|
| 新增支持的模型 | 在 `models.ts` 的 `MODELS` 数组中追加 `ModelInfo` 记录 |
| 修改默认模型 | 修改 `chat.ts` 中的 `DEFAULT_MODEL` 常量 |
| 调整 token 估算精度 | 修改 `client.ts` 中的 `estimateTokens` 函数 |
| 添加流式输出支持 | 在 `LlmService` 接口中新增 `chatStream` 方法，并分别在 Direct/Proxy 实现 |
| 更换 API 网关地址 | 修改环境变量 `CODING_PLAN_BASE_URL`，无需改代码 |

---

## 环境变量

| 变量名 | 说明 | 使用场景 |
|--------|------|----------|
| `CODING_PLAN_BASE_URL` | API 网关地址 | Node.js / TaskAgent |
| `CODING_PLAN_API_KEY` | 主 API Key | Node.js / TaskAgent |
| `QWEN_API_KEY` | 备用 API Key（兼容旧配置） | Node.js / TaskAgent |
| `HTTPS_PROXY` | HTTPS 代理地址 | 服务端（server.ts） |
