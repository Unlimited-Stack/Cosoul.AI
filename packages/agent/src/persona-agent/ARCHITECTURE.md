# persona-agent 架构说明

> 面向开发者的快速上手文档。

---

## 目录结构

```
persona-agent/
├── index.ts              # PersonaAgent 主类（分身画像 + 长期记忆）
├── types.ts              # Zod Schema：SoulDocument / MemoryDocument / PersonaContext
├── soul-loader.ts        # Soul.md 解析 / 序列化 / 偏好提取
├── memory-manager.ts     # Memory.md 解析 / 序列化 / 追加学习
├── preference-learner.ts # 从任务摘要中提取偏好洞察
├── soul-updater.ts       # 向 Soul.md History Annotations 追加记录
│
└── task-agent/           # TaskAgent 子模块（每个 Task 独立实例）
    ├── index.ts          # TaskAgent 主类 + createTaskAgentFromIntake()
    ├── types.ts          # Zod Schema：TaskDocument / HandshakeEnvelope / FSM 状态
    ├── storage.ts        # PostgreSQL 防腐层（tasks / handshake_logs / idempotency_keys）
    ├── listener.ts       # HTTP API 网关（被动流入口 + 前端/BFF 可调用的任务操作端点）
    ├── embedding.ts      # DashScope text-embedding-v4 向量生成
    ├── retrieval.ts      # PostgreSQL task_vectors 向量检索（L1 层）
    ├── dispatcher.ts     # L0/L1/L2 匹配漏斗 + 握手协议处理
    ├── intake.ts         # LLM 多轮对话提取任务字段（Drafting 阶段）
    ├── context.ts        # Prompt 上下文构建 + Token 预算管理
    ├── memory.ts         # 单任务对话归档（≠ 分身级 Memory.md）
    ├── task_loop.ts      # FSM 推进引擎（runTaskStep / runTaskStepById）
    └── friend.ts         # 好友动作占位（start_chat / send_friend_request）
```

---

## 层级关系

```
PersonaAgent (1个分身)
  │  持有 Soul.md（人格）+ Memory.md（长期经验）
  │  通过 getContext() 向下注入 PersonaContext 只读快照
  │
  └── TaskAgent × N（每个 Task 一个实例）
        │  接受 PersonaContext 注入，以分身视角执行
        │  驱动 Task FSM 状态流转
        └── 依赖：storage / dispatcher / embedding / retrieval
```

---

## Task FSM 状态机

```
Drafting ──LLM提取──▶ Searching ──L0/L1/L2匹配──▶ Negotiating
                                                       │
                          Revising ◀── 协商失败         │ 握手接受
                          Closed   ◀── 双方接受         │
                          Failed   ◀── 异常             ▼
                          Timeout  ◀── 超时        Waiting_Human
                          Cancelled◀── 用户取消    （等待用户确认）
```

- **Drafting**：任务刚创建，LLM 从 rawDescription 提取 targetActivity / targetVibe
- **Searching**：L0 硬过滤（PostgreSQL）→ L1 向量相似度（task_vectors）→ L2 规则研判
- **Negotiating**：向匹配方发起握手（HandshakeEnvelope），等待回复
- **Waiting_Human**：需要用户介入确认

---

## 匹配漏斗（dispatcher.ts）

```
L0  queryL0Candidates()   PostgreSQL 结构化硬过滤（状态/交互类型/版本）
 ↓
L1  runL1Retrieval()       task_vectors 余弦相似度，加权三字段
      targetActivity × 0.5
      targetVibe     × 0.3
      rawDescription × 0.2
 ↓
L2  runL2Judgment()        本地规则 + PersonaContext 偏好研判（LLM 可选）
 ↓
    向最优候选发起 PROPOSE 握手
```

---

## 数据存储

| 数据 | 存储位置 | 说明 |
|------|----------|------|
| Task 状态 / 元数据 | PostgreSQL `tasks` | 唯一真相源 |
| 握手记录 | PostgreSQL `handshake_logs` | 含幂等键 |
| 向量索引 | PostgreSQL `task_vectors` | pgvector，L1 检索用 |
| 分身画像 | PostgreSQL `persona_profiles` | Soul.md 原文 |
| 对话快照 | 文件系统 `task-scratchpad/` | 观测用，非真相源 |

所有 DB 操作通过 `@repo/core/db/client`（Drizzle ORM）；SQLite 已完全移除。

---

## 已完成 / 待接入

### ✅ 已完成

- PersonaAgent 主类：Soul.md 解析、偏好提取、Memory.md 管理、偏好学习
- TaskAgent 主类：FSM 状态机、PersonaContext 注入
- storage.ts：PostgreSQL 防腐层（完整 CRUD + 状态流转 + 幂等键）
- retrieval.ts：PostgreSQL 向量检索替代 SQLite
- dispatcher.ts：L0/L1/L2 匹配漏斗 + 握手协议
- intake.ts：LLM 提取 + buildTaskDocument()
- listener.ts：HTTP API 网关（完全覆盖旧 runtime.ts CLI 功能 + 被动流握手）
- `@repo/agent` 构建通过（tsc 零错误）

### ❌ 待补充

1. **BFF 路由 `/api/personas/:id/tasks/:taskId/step`**
   调用 `TaskAgent.step()` 驱动 FSM 推进，前端"派发任务"后 status 才会从 Drafting 变化

2. **embedding pipeline 触发时机**
   `processDraftingTask()` 执行后需调用 `embedTaskFields()` 写入 `task_vectors`，
   dispatcher.ts 中 `syncDerivedLayers()` 目前是 placeholder

3. **L2 研判 LLM 化**
   `runL2Judgment()` 现在是纯规则，可替换为调用 `buildPromptContext()` + LLM 打分

4. **friend.ts 实现**
   `start_chat()` / `send_friend_request()` 是占位桩，需对接实际 IM 系统

5. **PersonaAgent ↔ PersonaService 持久化对接**
   `onTaskCompleted()` 返回的 `updatedSoul` / `updatedMemory` 需调用方写回 DB

---

## 快速上手

### 环境变量

```env
DATABASE_URL=postgresql://...
DASHSCOPE_API_KEY=sk-...          # 向量嵌入（text-embedding-v4）
CODING_PLAN_API_KEY=sk-...        # LLM 对话（intake / L2）
CODING_PLAN_BASE_URL=https://...  # 默认 DashScope coding plan endpoint
```

### 构建

```bash
cd packages/agent
npm run build    # tsup 构建，产物在 dist/
npx tsc --noEmit # 类型检查
```

### 调用示例

```typescript
import { PersonaAgent, TaskAgent } from "@repo/agent";

// 1. 创建分身
const persona = new PersonaAgent(personaId, soulMdText, memoryMdText);
const ctx = persona.getContext("周末探店");

// 2. 用已有 taskId 创建 TaskAgent（taskId 已在 DB 中存在）
const agent = new TaskAgent(taskId, ctx);

// 3. 驱动单步 FSM
const { changed, currentStatus } = await agent.step();

// 4. 任务完成后更新分身记忆
const { updatedSoul, updatedMemory } = persona.onTaskCompleted(summary);
// → 调用方负责将 updatedSoul / updatedMemory 写回 DB
```

### listener.ts HTTP API 端点（完全覆盖旧 runtime.ts CLI）

| 旧 CLI 命令 | HTTP 端点 | 方法 |
|---|---|---|
| `list [all]` | `GET /tasks?all=true` | GET |
| `new` | `POST /tasks` | POST |
| `select` / `active` | `GET /tasks/:id` | GET |
| `run` | `POST /tasks/:id/run` | POST |
| `end` | `POST /tasks/:id/end` | POST |
| `cancel` | `POST /tasks/:id/cancel` | POST |
| `listen` | `POST /tasks/:id/listener` `{enabled:true}` | POST |
| `unlisten` | `POST /tasks/:id/listener` `{enabled:false}` | POST |
| `report` | `GET /tasks/:id/report` | GET |
| `reopen` | `POST /tasks/:id/reopen` | POST |
| `hide` / `unhide` | `POST /tasks/:id/hidden` `{hidden:bool}` | POST |
| `path` | `GET /tasks/:id/path` | GET |
| — | `POST /handshake` (被动流握手) | POST |
| — | `POST /tasks/:id/waiting-human-intent` | POST |
| — | `GET /listener/status` | GET |

> **注意**：旧 `runtime.ts`（CLI readline shell）已不再需要。其所有功能由 listener.ts HTTP API + AgentScreen 前端 UI 完全覆盖。SQLite 相关端点已移除（由 PostgreSQL pgvector 替代）。

### 当前前端联动路径

```
AgentScreen（前端）
  → POST /api/personas          → createPersona()  ✅
  → GET  /api/personas          → listPersonas()   ✅
  → POST /api/personas/:id/tasks → createTask()    ✅  (status=Drafting)
  → GET  /api/personas/:id/tasks → listTasks()     ✅
  → POST /api/.../tasks/:id/step → TaskAgent.step() ❌ 待补路由
```
