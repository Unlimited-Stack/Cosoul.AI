# Persona vs LLM — 网络架构差异与演进计划

> **大白话版**：LLM 像打电话给外卖平台（公网 API，谁都能打），Persona 像去自家厨房拿菜（本地数据库，手机进不了厨房）。
> 所以 LLM 手机直连没问题，Persona 手机必须找个"传菜员"（BFF / 未来云端 API）帮忙拿。

---

## 一、两个模块的本质区别

| 维度 | LLM | Persona |
|------|-----|---------|
| **数据源** | Coding Plan 公网 API（dashscope） | PostgreSQL 本地数据库 |
| **Native 能否直连** | 能 — 公网无 CORS 限制 | 不能 — DB 在开发机 localhost |
| **Native 模式** | Direct（`createDirectLlmService`） | Proxy（`createProxyPersonaService`） |
| **BFF 角色** | 仅 Web 端需要（CORS + 隐藏 Key） | 所有端都需要（DB 只能服务端访问） |

### 关键结论

```
LLM:     Native → 公网 API          （Direct，无中间层）
Persona: Native → 某个服务端 → DB   （必须有中间层，问题是"哪个服务端"）
```

Persona **不可能**照搬 LLM 的 Direct 模式，除非数据库对外暴露为独立 HTTP API。

---

## 二、开发阶段的临时方案（当前状态）

### 问题：Expo 隧道只暴露 Metro 端口

```
Expo 隧道 / LAN 地址：
  Metro → exp://sfxxbfg-anonymous-8089.exp.direct   ← 手机能访问
  BFF   → http://localhost:3030                      ← 手机访问不到（没有隧道）
```

手机通过 Expo 隧道只能到达 Metro:8089，无法直接访问 BFF:3030。

### 临时方案：Metro 代理中间件

```
Native 手机 / Expo Web（浏览器）
  → fetch("/api/*")
  → Metro:8089/api/*（同源，无 CORS）
  → metro.config.js 代理中间件
  → 转发到 localhost:3030/api/*（BFF）
  → DB
```

在 `metro.config.js` 中挂一个 `/api/*` 代理中间件，把请求转发到 BFF。
**Expo Web 也走 Metro 代理**：浏览器在 `localhost:8089` 发起 `fetch("/api/...")`，
请求到达 Metro HTTP 服务器，代理中间件统一转发，避免跨域。

### ⚠️ 必须认清的事实

1. **这是 Proxy 模式，不是 Direct 模式** — 本质是 Native → Metro 代理 → BFF → DB
2. **Metro 是打包工具，不是 API 网关** — 生产环境没有 Metro，这条通路仅开发时有效
3. **这是临时方案** — 上云后将被 Direct 模式替代

---

## 三、未来云端方案（目标状态）

### 计划：将 DB 操作暴露为独立 HTTP API 服务

部署后，Persona 数据通过云端 API 对外提供，架构与 LLM 完全对齐：

```
未来 Native:
  → 直连云端 Persona API（Direct 模式）
  → 与 LLM 调用方式完全一致

未来 Web:
  → BFF Proxy（隐藏 Key / 处理 CORS）
  → 或直连（如果 CORS 配置允许）
```

### 需要做的改造

1. **部署独立 Persona API 服务**（或复用现有 BFF 部署到公网）
2. **`proxy.ts` 新增 `createDirectPersonaService`**
   — 类似 LLM 的 `createDirectLlmService`，Native 直连云端 API
3. **平台工厂新增 Direct 分支**
   — `platform: "native"` 时走 Direct 模式而非 Proxy
4. **删除 `metro.config.js` 中的 BFF 代理中间件**
   — 不再需要 Metro 当中间人
5. **简化 `getApiUrl.ts`**
   — Native 直接用云端 URL，不再探测 Metro hostUri

### 改造后通路

```
LLM     Native → createDirectLlmService(codingPlanUrl, key)      → 公网 API
Persona Native → createDirectPersonaService(cloudPersonaUrl, key) → 云端 API
                 ↑ 完全对齐
```

---

## 四、代码定位

| 文件 | 职责 | 未来变动 |
|------|------|----------|
| `packages/core/src/persona/proxy.ts` | 客户端 Proxy 工厂 | 新增 Direct 模式分支 |
| `packages/core/src/persona/service.ts` | 服务端 DB CRUD | 部署为独立 API 后可复用 |
| `apps/native/metro.config.js` | Metro 代理中间件（临时） | 上云后删除 |
| `apps/native/lib/getApiUrl.ts` | Native 平台地址推导 | 上云后改为读取云端 URL |
| `apps/web/app/api/personas/` | BFF 路由 | 保留或演化为云端 API |
