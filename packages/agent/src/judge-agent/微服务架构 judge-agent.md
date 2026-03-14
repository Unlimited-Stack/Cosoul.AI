# Judge Agent — L2 中立裁决微服务

> **一句话概括**：两个用户各自发了一个"想一起做什么"的任务，Judge Agent 就像一个公正的裁判，
> 读取双方的完整计划，判断"你俩到底合不合适一起玩"，然后把裁决结果同时告诉双方。

---

## 1. 合并背景：两个文件夹各自做了什么

合并前存在两个目录，职责有大量重叠：

### `judge-agent/`（智能体核心）

专注 **AI 裁决能力**：

- System Prompt 设计（四维度评分 + 7 个 few-shot 示例）
- LLM 调用 + 重试 + JSON Schema 校验
- 硬约束校验（interaction_type 冲突、verdict/confidence 一致性）
- 规则 Fallback（LLM 不可用时的降级裁决）
- 类型定义（JudgeDecision、JudgeEvaluateRequest/Result）

**问题**：数据获取依赖 `task-agent/storage` 的 `readTaskDocument`，
持久化依赖 `appendAgentChatLog`，不具备独立微服务能力。

### `judge-agent业务逻辑/`（微服务壳）

专注 **HTTP 服务 + 数据层**：

- HTTP 路由（POST /judge、GET /health）
- 直查 PostgreSQL tasks 表获取双方完整数据
- 直写 handshake_logs 表持久化裁决结果
- 独立进程启动入口

**问题**：在 `handler.ts` 中**重复实现**了 prompt、硬约束、LLM 调用、工具函数，
与前者形成 ~200 行的代码冗余，且 prompt 缺少 few-shot 示例。

### 合并策略

| 能力 | 取自 | 原因 |
|------|------|------|
| Prompt（含 7 个 few-shot） | judge-agent | 更完整，裁决质量更高 |
| 硬约束校验 | judge-agent/constraints.ts | 独立文件，职责清晰 |
| LLM 调用 + 重试 + Fallback | judge-agent/index.ts | isInfraError 覆盖更全 |
| 数据获取（直查 DB） | 业务逻辑/fetch-context.ts | 微服务应自给自足，不经 task-agent 中转 |
| 结果持久化（直写 handshake_logs） | 业务逻辑/notify.ts | 同上 |
| HTTP 服务层 | 业务逻辑/server.ts + index.ts | 微服务必备 |
| `handler.ts` 中的重复逻辑 | **删除** | 统一走 `evaluateMatch` 单一入口 |

---

## 2. 合并后文件职责

```
judge-agent/
├── types.ts          类型定义层
├── prompt.ts         Prompt 工程层
├── constraints.ts    硬约束校验层
├── fetch-context.ts  数据获取层
├── notify.ts         结果持久化层
├── index.ts          核心裁决逻辑（唯一入口）
├── server.ts         HTTP 路由层
└── entry.ts          进程启动入口
```

### types.ts — 类型定义

定义模块所有 Zod Schema 和 TypeScript 类型：

- `JudgeEvaluateRequestSchema`：请求入参（initiatorTaskId / responderTaskId / round / action）
- `JudgeEvaluateResultSchema`：裁决结果（decision + l2Action 向后兼容字段）
- `JudgeTaskContextSchema`：内部使用的任务上下文（从 DB 直接读取）
- 复用 `task-agent/types` 的 `JudgeDecisionSchema`、`DimensionScoresSchema`

> `action` 和 `round` 使用 `.default()`，调用方可不传；
> `JudgeEvaluateRequest` 使用 `z.input`（输入类型），确保 default 字段可选。

### prompt.ts — Prompt 工程

- `JUDGE_SYSTEM_PROMPT`：中立裁判角色设定 + 四维度评分标准 + 7 个 few-shot 示例
- `buildJudgePrompt(sideA, sideB, round, action)`：构建对称的 user prompt

四个评分维度及权重：
- activityCompatibility（0.45）— 活动兼容性
- vibeAlignment（0.25）— 氛围对齐
- interactionTypeMatch（0.20）— 交互类型匹配
- planSpecificity（0.10）— 计划具体性

### constraints.ts — 硬约束校验

`applyHardConstraints(decision, sideA, sideB)` 对 LLM 输出做一致性兜底：

1. interaction_type 硬冲突（online vs offline）→ 强制 REJECT
2. MATCH + confidence < 0.7 → 降为 NEGOTIATE
3. NEGOTIATE + confidence < 0.4 → 降为 REJECT
4. REJECT + confidence >= 0.7 → 钳制 confidence <= 0.35

### fetch-context.ts — 数据获取

- `fetchTaskContext(taskId)` — 直查 PostgreSQL tasks 表，返回 `JudgeTaskContext`
- `fetchBothTaskContexts(initiatorTaskId, responderTaskId)` — 并行拉取双方

不再经过 task-agent/storage 中转，微服务自给自足。

### notify.ts — 结果持久化

`persistJudgeResult(params)` — 并行写入双方 handshake_logs 表，
确保 A 和 B 看到同一份裁决结果（payload 相同，peerTaskId 互为对方）。

### index.ts — 核心裁决逻辑

`evaluateMatch(request)` 是**唯一的裁决入口**，HTTP 和直接 import 走同一条链路：

```
fetchBothTaskContexts → buildJudgePrompt → callJudgeWithRetry
  → applyHardConstraints → persistJudgeResult → 返回 JudgeEvaluateResult
```

内含：
- `callJudgeWithRetry` — LLM 调用 + 最多 3 次重试 + JSON Schema 校验
- `fallbackRuleJudge` — LLM 不可用时的规则降级裁决
- `extractJson` / `isInfraError` — 工具函数

### server.ts — HTTP 路由

`createJudgeServer()` 创建 Node.js HTTP 服务器：

- `POST /judge` — 解析请求体 → Zod 校验 → 调用 `evaluateMatch` → 返回 JSON
- `GET /health` — 健康检查
- `OPTIONS` — CORS 预检

### entry.ts — 进程启动入口

独立微服务启动，默认端口 4050（`JUDGE_AGENT_PORT` 环境变量可覆盖），
含 SIGINT / SIGTERM 优雅退出。

```bash
npm run judge -w packages/agent
```

---

## 3. 微服务运行流程

以一次完整的 L2 裁决请求为例：

```
┌─────────────┐    POST /judge     ┌──────────────────────────────────┐
│ task-agent   │ ─────────────────→ │ server.ts                        │
│ dispatcher   │                    │  ├ readBody + JSON.parse         │
└─────────────┘                    │  ├ JudgeEvaluateRequestSchema    │
                                   │  │   .safeParse(body)            │
                                   │  └ evaluateMatch(request) ───┐   │
                                   └──────────────────────────────┼───┘
                                                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│ index.ts — evaluateMatch                                             │
│                                                                      │
│  1. fetch-context.ts                                                 │
│     ├ SELECT * FROM tasks WHERE task_id = :initiatorTaskId           │
│     └ SELECT * FROM tasks WHERE task_id = :responderTaskId           │
│     → 得到 sideA, sideB（JudgeTaskContext）                          │
│                                                                      │
│  2. prompt.ts                                                        │
│     └ buildJudgePrompt(sideA, sideB, round, action)                 │
│     → 生成对称的 user prompt                                         │
│                                                                      │
│  3. callJudgeWithRetry(prompt)                                       │
│     ├ chatOnce(prompt, { system: JUDGE_SYSTEM_PROMPT })              │
│     ├ extractJson → JSON.parse → JudgeDecisionSchema.safeParse       │
│     └ 最多重试 3 次，失败则 throw → 触发 fallback                     │
│                                                                      │
│  4. constraints.ts                                                   │
│     └ applyHardConstraints(rawDecision, sideA, sideB)               │
│     → 修正 LLM 输出中的不一致                                        │
│                                                                      │
│  5. notify.ts                                                        │
│     ├ INSERT INTO handshake_logs (taskId=A, direction=judge_response)│
│     └ INSERT INTO handshake_logs (taskId=B, direction=judge_response)│
│                                                                      │
│  6. return { decision, l2Action, usedFallback, ... }                 │
│                                                                      │
│  ⚠ 如果步骤 3 抛出异常：                                              │
│     → fallbackRuleJudge(sideA, sideB, errorMsg) 规则降级裁决         │
│     → 同样执行步骤 5 持久化 → 返回 usedFallback: true                │
└──────────────────────────────────────────────────────────────────────┘
```

### 三种调用方式

| 调用方 | 路径 | 说明 |
|--------|------|------|
| dispatcher（进程内） | `import { evaluateMatch }` → 直接调用 | task-agent 主动流 L2 阶段 |
| Next.js BFF | `POST /api/agents/judge/evaluate` → import evaluateMatch | Web 前端触发 |
| 独立微服务 | `POST :4050/judge` → server.ts → evaluateMatch | 未来跨服务调用 |

三条路径最终都汇聚到 `evaluateMatch`，保证裁决逻辑单一来源。

---

## 4. 外部依赖

- `@repo/core/llm` — `chatOnce` LLM 调用
- `@repo/core/db/client` — Drizzle ORM 数据库连接
- `@repo/core/db/schema` — `tasks`、`handshake_logs` 表定义
- `../task-agent/types` — 复用 `JudgeDecisionSchema` 等基础 Schema
