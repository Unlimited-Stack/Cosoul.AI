# Turborepo 架构规范

> **面向 Coding Agent** — 写代码前必读。违反此规范 = 架构污染。

---

## 黄金法则

```
apps/ = 薄壳（路由 + 平台胶水，不写业务逻辑）
packages/ = 核心资产（所有可复用的逻辑、UI、类型）
```

**判断标准**：如果一段代码 Web 和 Native 都可能用到，它必须在 `packages/` 里。

---

## 包职责速查

```
apps/web ──────────┐
                   ├──→ @repo/ui      共享 UI 组件 + Screen
apps/native ───────┤
                   ├──→ @repo/core    业务逻辑 + 数据层 + 共享服务
                   │
                   └──→ @repo/agent   Agent 智能体（调用 @repo/core）
```

| 包 | 路径 | 放什么 | 不放什么 |
|----|------|--------|----------|
| **@repo/ui** | `packages/ui/` | Screen 组件、主题、图标、通用 UI | API 调用、业务逻辑、平台特定代码 |
| **@repo/core** | `packages/core/` | DB schema/client、service 层、LLM client、类型定义、存储工具 | UI 组件、React Hooks（除纯数据 Hook） |
| **@repo/agent** | `packages/agent/` | FSM 状态机、L0/L1/L2 匹配、握手协议、Prompt、记忆系统 | HTTP 路由、UI |
| **apps/web** | `apps/web/` | Next.js 路由页面、API Route（薄壳转发）、Web 专属组件（Sidebar 等） | 可复用业务逻辑 |
| **apps/native** | `apps/native/` | Expo Router 页面、平台适配胶水（相机、推送等） | 可复用业务逻辑 |

---

## 常犯错误 & 正确做法

### ❌ 把模型列表写在 API Route 里

```
错误：apps/web/app/api/llm/models/route.ts 里硬编码模型数组
问题：Native 端无法复用，必须走 HTTP 绕路
```

```
正确：packages/core/src/llm/models.ts 定义模型列表
      apps/web API Route 只做 import { MODELS } from "@repo/core/llm"
      apps/native 直接 import 同一份数据
```

### ❌ 在 apps/ 里写 API 调用逻辑

```
错误：apps/native/app/(tabs)/ai-core.tsx 里直接 fetch("http://localhost:3030/api/...")
问题：localhost 在手机上指向手机自身；逻辑写死在一个端
```

```
正确：packages/core/src/llm/client.ts 定义 LlmService 接口
      createDirectLlmService()  — Native 直连外部 API
      createProxyLlmService()   — Web 走 BFF 代理
      Screen 组件只接收 LlmService，不关心底层实现
```

### ❌ 在 Screen 里直接 fetch

```
错误：packages/ui/src/screens/XxxScreen.tsx 里 fetch("/api/xxx")
问题：URL 是平台特定的，Screen 组件应该平台无关
```

```
正确：Screen 通过 props/service 注入获取数据
      数据获取逻辑在 @repo/core 的 service 层
      apps/ 层负责创建 service 实例并注入
```

---

## API 路由规范

`apps/web/app/api/` 是 **BFF（Backend For Frontend）薄壳**：

```typescript
// ✅ 正确：薄壳转发，逻辑在 @repo/core
import { MODELS } from "@repo/core/llm";
export async function GET() {
  return NextResponse.json({ models: MODELS });
}

// ❌ 错误：在 route 里写业务逻辑
const MODELS = [ { id: "qwen3.5-plus", ... }, ... ]; // 不要在这里定义
```

**BFF 的存在理由**（不能删）：
1. 浏览器有 CORS 限制，无法直连外部 API
2. API Key 保留在服务端，不暴露给前端
3. 容器环境需要 HTTPS_PROXY 代理出站请求

**Native 不经过 BFF**：手机端没有 CORS 限制，通过 `@repo/core` 直连外部 API。

---

## 依赖注入模式

Screen 组件不直接依赖平台特定的 URL 或配置，而是通过 **服务注入**：

```
┌─────────────────────────────────────────────────────┐
│  @repo/core/llm                                      │
│  ├── LlmService 接口（getModels / verifyModel）       │
│  ├── createDirectLlmService(baseUrl, apiKey)          │
│  └── createProxyLlmService(proxyBaseUrl)              │
└──────────────┬───────────────────┬──────────────────┘
               │                   │
     ┌─────────▼────────┐  ┌──────▼──────────┐
     │  apps/web         │  │  apps/native     │
     │  page.tsx:        │  │  ai-core.tsx:    │
     │  createProxy      │  │  createDirect    │
     │  LlmService("/api")│  │  LlmService(...)│
     └─────────┬─────────┘  └──────┬──────────┘
               │                   │
         ┌─────▼───────────────────▼──────┐
         │  @repo/ui AiCoreScreen          │
         │  props: { llmService }          │
         │  不关心走代理还是直连              │
         └─────────────────────────────────┘
```

---

## 子路径导出（Subpath Exports）

`@repo/core` 包含 DB 层（pg 驱动），客户端组件不能导入完整包。使用子路径：

```typescript
// ✅ 客户端组件（"use client"）— 只导入轻量模块
import { createProxyLlmService } from "@repo/core/llm";

// ✅ 服务端代码（API Route / Server Component）— 可导入完整包
import { db, MODELS } from "@repo/core";

// ❌ 客户端组件导入完整包 — 会拉入 pg 驱动导致构建失败
import { createProxyLlmService } from "@repo/core";
```

要求 `tsconfig.json` 设置 `"moduleResolution": "bundler"` 才能解析子路径。

---

## 新功能开发清单

添加任何新功能时，按此顺序：

1. **类型 / 数据** → `packages/core/src/types/` 或对应模块
2. **业务逻辑 / 服务** → `packages/core/src/services/` 或 `packages/core/src/<module>/`
3. **Agent 逻辑** → `packages/agent/src/`（如涉及 LLM / FSM）
4. **UI 组件** → `packages/ui/src/screens/` 或 `packages/ui/src/components/`
5. **构建** → `npm run build -w packages/core && npm run build -w packages/ui`
6. **Web 路由页面** → `apps/web/app/<route>/page.tsx`（薄壳，注入 service）
7. **Native 路由页面** → `apps/native/app/(tabs)/<name>.tsx`（薄壳，注入 service）
8. **API Route（如需 BFF）** → `apps/web/app/api/`（薄壳转发 @repo/core）

---

## 当前已实现模块

```
packages/core/src/
├── db/           ✅ Drizzle ORM + PostgreSQL + pgvector（11 张表）
├── llm/          ✅ 模型定义 + LlmService（Direct / Proxy 双模式）
├── services/     🔲 业务 CRUD（persona / task / contact / chat）
├── storage/      🔲 task.md 序列化 + 文件层
└── types/        🔲 共享类型定义

packages/agent/src/
├── shared/llm/   🔲 BaseModel + 多厂商 Provider
├── shared/rag/   🔲 Embedding + pgvector 检索
├── shared/memory/ 🔲 记忆压缩 + Token 预算
├── task-agent/   🔲 FSM + L0/L1/L2 + 握手协议 + Intake
├── persona-agent/ 🔲 人格管理（预留）
└── social-agent/  🔲 社交互动（预留）

packages/ui/src/screens/
├── AiCoreScreen  ✅ 模型切换 + 状态反馈（接收 LlmService 注入）
├── FeedScreen    ✅ 首页占位
├── CardsScreen   ✅ 发现占位
├── MessageScreen ✅ 消息占位
├── ProfileScreen ✅ 个人主页占位
└── SettingsScreen ✅ 设置（主题切换）
```

`✅` = 已实现 | `🔲` = 待开发
