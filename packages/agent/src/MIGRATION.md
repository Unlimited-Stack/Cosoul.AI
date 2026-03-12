# TaskAgent 迁移说明

> 从 `TaskAgent(待合并)/src/` 到 `packages/agent/src/task-agent/` 的完整迁移记录。
> （task-agent 与 persona-agent 平级，支持多 Persona 复用）

---

## 一、迁移文件对照表

```
TaskAgent(待合并)/src/                    → packages/agent/src/task-agent/
├── task_agent/context.ts                 → context.ts          ✅ 已迁移（+ soulText 注入）
├── task_agent/dispatcher.ts              → dispatcher.ts       ✅ 已迁移（精简批量函数）
├── task_agent/intake.ts                  → intake.ts           ✅ 已迁移（+ 导出 extractFromConversation / buildTaskDocument）
├── task_agent/memory.ts                  → memory.ts           ✅ 已迁移（精简注释）
├── task_agent/task_loop.ts               → task_loop.ts        ✅ 已迁移（移除 readline）
├── task_agent/friend.ts                  → friend.ts           ✅ 已迁移（同为 stub）
├── task_agent/listener.ts                → listener.ts         ✅ 已迁移（移除 SQLite 端点，新增 runtime 命令对应端点）
├── task_agent/runtime.ts                 → （不迁移）          ✅ 功能被 listener.ts HTTP API + AgentScreen 前端覆盖
├── task_agent/main.ts                    → （不迁移）          ✅ 启动入口已无用，TaskAgent 由 PersonaAgent 管理
├── task_agent/util/schema.ts             → types.ts            ✅ 已迁移（重命名）
├── task_agent/util/storage.ts            → storage.ts          ✅ 已迁移（SQLite+文件→PostgreSQL Drizzle ORM）
├── task_agent/util/sqlite.ts             → （不迁移）          ✅ 被 retrieval.ts + PostgreSQL pgvector 替代
├── task_agent/util/data_fetching.ts      → （不迁移）          ✅ 空 stub，未使用
├── task_agent/util/skill.ts              → （不迁移）          ✅ 空 stub，未使用
├── rag/embedding.ts                      → embedding.ts        ✅ 已迁移（逻辑一致）
├── rag/retrieval.ts                      → retrieval.ts        ✅ 已迁移（SQLite→PostgreSQL pgvector）
├── llm/chat.ts                           → （不迁移）          ✅ 仅 re-export @repo/core/llm，新代码直接 import
├── templates/prompts.ts                  → （不迁移）          ✅ 空数组，未使用
                                          ← index.ts            🆕 新增（TaskAgent 类 + 工厂函数）
```

**结论：18 个旧文件全部覆盖或替代，`TaskAgent(待合并)/` 可安全删除。**

---

## 二、架构对比：旧 vs 新

### 旧架构：独立进程 + CLI Shell

```
┌───────────────────────────────────────────────────┐
│  TaskAgent 独立进程（main.ts 启动）                │
│                                                    │
│  用户 ──→ readline CLI (runtime.ts)                │
│           ├─ help / list / new / select / run ...  │
│           ├─ 直接调用 task_loop / dispatcher       │
│           └─ 管理 listener 开关                    │
│                                                    │
│  外部 ──→ HTTP listener (listener.ts :8080)        │
│           ├─ POST /handshake  (被动流握手)         │
│           ├─ GET  /tasks      (任务列表)           │
│           ├─ GET  /sqlite/*   (SQLite 诊断)        │
│           └─ POST /tasks/:id/run (驱动 FSM)        │
│                                                    │
│  存储：                                            │
│  ├─ SQLite（task_agent.db）← 本地向量索引 + 任务快照│
│  ├─ PostgreSQL             ← 任务数据真相源         │
│  └─ 文件系统               ← 对话快照 / 日志       │
└───────────────────────────────────────────────────┘
```

**运行方式：** `main.ts` 启动 → `runtime.ts` 进入 readline 循环 → 开发者手动输入命令驱动任务。
**问题：** 没有前端 UI，只有 CLI；SQLite + PostgreSQL 双数据源维护成本高。

---

### 新架构：PersonaAgent 子组件 + 前端 UI + BFF API

```
┌──────────────────────────────────────────────────────────────────┐
│  前端（AgentScreen）                                              │
│  ├─ 创建分身   → POST /api/personas                              │
│  ├─ 查看分身   → GET  /api/personas                              │
│  ├─ 创建任务   → POST /api/personas/:id/tasks                    │
│  ├─ 查看任务   → GET  /api/personas/:id/tasks                    │
│  └─ 驱动 FSM   → POST /api/personas/:id/tasks/:taskId/step  ❌待补│
└──────────────────────┬───────────────────────────────────────────┘
                       │ HTTP (fetch proxy)
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│  BFF 路由层（Next.js /api routes）                                │
│  ├─ /api/personas/route.ts        → @repo/core persona service   │
│  ├─ /api/personas/[id]/tasks/     → @repo/core persona service   │
│  ├─ /api/debug/personas/          → listPersonasDebug()          │
│  └─ /api/llm/*                    → @repo/core/llm (proxy)      │
│                                                                   │
│  待补路由：                                                       │
│  └─ /api/personas/[id]/tasks/[taskId]/step → TaskAgent.step()    │
└──────────────────────┬───────────────────────────────────────────┘
                       │ 内部 import
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│  PersonaAgent（@repo/agent）                                      │
│  ├─ index.ts          ← PersonaAgent 主类（Soul.md + Memory.md）  │
│  ├─ getContext()       ← 注入 PersonaContext 只读快照              │
│  │                                                                │
│  task-agent/          ← TaskAgent 平级模块（与 persona-agent 同级）│
│     ├─ index.ts       ← TaskAgent 类 + createTaskAgentFromIntake()│
│     ├─ listener.ts    ← HTTP API 网关（被动流 + 任务操作端点）     │
│     ├─ task_loop.ts   ← FSM 推进引擎                              │
│     ├─ dispatcher.ts  ← L0/L1/L2 匹配漏斗                        │
│     ├─ intake.ts      ← LLM 多轮提取                              │
│     ├─ embedding.ts   ← DashScope 向量生成                        │
│     ├─ retrieval.ts   ← PostgreSQL pgvector 检索                  │
│     ├─ storage.ts     ← PostgreSQL 防腐层（Drizzle ORM）          │
│     └─ ...                                                        │
└──────────────────────┬───────────────────────────────────────────┘
                       │ Drizzle ORM
                       ▼
              ┌─────────────────┐
              │   PostgreSQL    │
              │  ├─ personas    │
              │  ├─ persona_    │
              │  │  profiles    │
              │  ├─ tasks       │
              │  ├─ task_vectors│  ← pgvector（替代 SQLite）
              │  ├─ handshake_  │
              │  │  logs        │
              │  └─ idempotency │
              │     _keys       │
              └─────────────────┘
```

---

## 三、前后端交互全链路

### 3.1 创建分身（已实现 ✅）

```
AgentScreen 点击「创建分身」
  ↓ handleCreatePersona({ name, bio, coreIdentity, preferences })
  ↓
fetch("POST /api/personas", body)
  ↓
BFF: apps/web/app/api/personas/route.ts
  ↓ createPersona(DEFAULT_USER_ID, input)
  ↓
@repo/core/persona/service.ts
  ├─ INSERT INTO personas (userId, name, bio)
  ├─ buildSoulMd({ name, coreIdentity, preferences })  ← 生成 Soul.md 文本
  └─ INSERT INTO persona_profiles (personaId, profileText)
  ↓
返回 { personaId, name, bio } → AgentScreen 刷新列表
```

### 3.2 创建任务（已实现 ✅）

```
AgentScreen 选中分身 → 输入任务描述 → 点击「创建任务」
  ↓ handleCreateTask(personaId, { rawDescription, interactionType })
  ↓
fetch("POST /api/personas/:personaId/tasks", body)
  ↓
BFF: apps/web/app/api/personas/[personaId]/tasks/route.ts
  ↓ createTask(personaId, input)
  ↓
@repo/core/persona/service.ts
  ├─ INSERT INTO tasks (taskId, personaId, status="Drafting", rawDescription, ...)
  └─ 返回 AgentTask { taskId, status: "Drafting", rawDescription }
  ↓
AgentScreen 显示新任务卡片（状态：Drafting）
```

### 3.3 驱动任务 FSM（❌ 待补 BFF 路由）

> 这是当前最关键的缺失环节。前端创建任务后 status 停留在 Drafting，无法推进。

**预期流程：**

```
AgentScreen 点击「派发任务」
  ↓
fetch("POST /api/personas/:personaId/tasks/:taskId/step")
  ↓
BFF 路由（待补）:
  ↓
  const persona = new PersonaAgent(personaId, soulMdText, memoryMdText);
  const ctx = persona.getContext(task.rawDescription);
  const agent = new TaskAgent(taskId, ctx);
  const { changed, currentStatus } = await agent.step();
  ↓
  TaskAgent.step()
    → runTaskStepById(taskId)
      → readTaskDocument(taskId)              ← 从 PostgreSQL 读取
      → runTaskStep(task)
        ├─ Drafting/Revising → processDraftingTask()
        │   → intake LLM 提取 targetActivity / targetVibe
        │   → embedTaskFields() 写入 task_vectors 表
        │   → transitionTaskStatus(Drafting → Searching)
        │
        ├─ Searching → processSearchingTask()
        │   → runL0Filter()        ← PostgreSQL 结构化过滤
        │   → runL1Retrieval()     ← pgvector 余弦相似度
        │   → sendInitialPropose() ← 向最优候选发起握手
        │   → transitionTaskStatus(Searching → Negotiating/Waiting_Human)
        │
        └─ 其他状态 → return false（不可执行）
  ↓
返回 { changed, previousStatus, currentStatus } → AgentScreen 更新任务卡片
```

### 3.4 被动流：接收握手（listener.ts）

```
对端 Agent 发起握手
  ↓
POST http://<host>:8080/handshake   ← listener.ts 处理
  ↓ handleInboundHandshake(payload)
  ↓ HandshakeInboundEnvelopeSchema.safeParse(payload)
  ↓ dispatchInboundHandshake(envelope)
    ├─ 幂等检查 (findIdempotencyRecord)
    ├─ 协议版本校验
    ├─ L2 沙盒研判 (executeL2Sandbox)
    │   ├─ interaction_type 兼容性检查
    │   ├─ 读取 UserProfile / PersonaContext 偏好
    │   └─ 规则/LLM 决策 → ACCEPT / REJECT
    ├─ 状态流转（如双方 ACCEPT → Waiting_Human）
    └─ 保存幂等记录 + agent_chat_log
  ↓
返回 HandshakeOutboundEnvelope → 对端 Agent
```

### 3.5 用户确认匹配结果（listener.ts HTTP API）

```
AgentScreen 显示匹配结果 → 用户选择操作
  ↓
fetch("POST /api/.../tasks/:taskId/waiting-human-intent", { intent })
  ↓
（经 BFF 转发到 listener.ts 或直接调用 dispatcher）
  ↓
handleWaitingHumanIntent(taskId, intent)
  ├─ "satisfied"       → start_chat()              （接受匹配，开始聊天）
  ├─ "unsatisfied"     → Waiting_Human → Revising  （不满意，修改需求重新匹配）
  ├─ "enable_listener" → Waiting_Human → Listening  （挂起后台监听）
  ├─ "friend_request"  → send_friend_request()      （发送好友申请）
  ├─ "closed"          → Waiting_Human → Closed     （关闭任务）
  └─ "exit"            → 保持 Waiting_Human          （退出但保留任务）
```

---

## 四、旧 runtime CLI 命令 → 新 HTTP 端点映射

旧架构中用户通过 readline CLI 输入命令，新架构中全部由 HTTP API 替代：

| 旧 CLI 命令 | 新 HTTP 端点 | 前端触发方式 |
|---|---|---|
| `list [all]` | `GET /tasks?all=true` | AgentScreen 任务列表 |
| `new` | `POST /tasks` | AgentScreen「创建任务」按钮 |
| `select <taskId>` | `GET /tasks/:id` | AgentScreen 点击任务卡片 |
| `active` | — (客户端状态) | AgentScreen 当前选中态 |
| `run` | `POST /tasks/:id/run` | AgentScreen「派发任务」按钮 |
| `end [taskId]` | `POST /tasks/:id/end` | AgentScreen「结束任务」按钮 |
| `cancel [taskId]` | `POST /tasks/:id/cancel` | AgentScreen「取消任务」按钮 |
| `listen [taskId]` | `POST /tasks/:id/listener` `{enabled:true}` | AgentScreen「后台监听」开关 |
| `unlisten [taskId]` | `POST /tasks/:id/listener` `{enabled:false}` | AgentScreen「停止监听」开关 |
| `report [taskId]` | `GET /tasks/:id/report` | AgentScreen 查看协商报告 |
| `reopen [taskId]` | `POST /tasks/:id/reopen` | AgentScreen「重开任务」按钮 |
| `hide [taskId]` | `POST /tasks/:id/hidden` `{hidden:true}` | AgentScreen 隐藏操作 |
| `unhide <taskId>` | `POST /tasks/:id/hidden` `{hidden:false}` | AgentScreen 取消隐藏 |
| `path [taskId]` | `GET /tasks/:id/path` | 调试用 |

---

## 五、数据存储变化

| 数据 | 旧存储 | 新存储 |
|---|---|---|
| 任务状态/元数据 | PostgreSQL `tasks` | PostgreSQL `tasks`（不变） |
| 向量索引 | SQLite `task_vec_*` 表 | PostgreSQL `task_vectors`（pgvector） |
| 任务快照索引 | SQLite `task_index` 表 | PostgreSQL `tasks` 表直接查询 |
| 任务 frontmatter | SQLite `task_fm_*` 表 | PostgreSQL `tasks` 表直接查询 |
| 任务 body | SQLite `task_body_*` 表 | PostgreSQL `tasks` 表直接查询 |
| 握手记录 | 文件系统 JSONL | PostgreSQL `handshake_logs` |
| 幂等键 | — | PostgreSQL `idempotency_keys`（新增） |
| 分身画像 | — | PostgreSQL `persona_profiles`（新增） |
| 对话快照 | 文件系统 | 文件系统（不变，仅观测用） |
| 可观测性日志 | 文件系统 | 文件系统（不变） |

**核心变化：SQLite 完全移除，所有结构化数据统一到 PostgreSQL。**

---

## 六、当前状态与待办

### ✅ 已完成

- 全部 18 个旧文件迁移/覆盖/替代
- PersonaAgent + TaskAgent 类封装
- PostgreSQL 防腐层（替代 SQLite）
- listener.ts HTTP API（覆盖旧 runtime.ts + listener.ts）
- 前端：分身创建/列表、任务创建/列表
- tsc 零错误

### ❌ 待补

1. **BFF 路由 `POST /api/personas/:id/tasks/:taskId/step`**
   前端点击「派发任务」后调用 `TaskAgent.step()` 驱动 FSM 推进

2. **listener.ts 与 BFF 的对接方式**
   选项 A：BFF 路由直接 import TaskAgent 类（推荐）
   选项 B：BFF 路由通过 HTTP 调用 listener.ts 端点

3. **前端任务操作 UI**
   AgentScreen 需要新增按钮/交互来触发 run / end / cancel / listen 等操作

4. **friend.ts 实现**
   `start_chat()` / `send_friend_request()` 是占位桩，需对接实际 IM 系统
