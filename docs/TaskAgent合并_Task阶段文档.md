# TaskAgent 合并至 Cosoul.AI — Task 阶段文档

> 版本：v1.0 | 日期：2026-03-09
> 工程师分配：**工程师A（后端/基础设施）**、**工程师B（前端/UI）**、**工程师C（Agent核心/AI）**

---

## 工程师角色定义

| 工程师 | 主要职责 | 技术栈侧重 |
|--------|----------|------------|
| **工程师A** | 后端API路由、数据库、存储层、部署 | Next.js API Routes, PostgreSQL, Drizzle ORM, Storage |
| **工程师B** | 前端页面、组件、交互、流式显示 | React/RN, @repo/ui, SSE |
| **工程师C** | Agent核心逻辑、LLM调用、向量搜索、FSM | LLM Provider, Embedding, Dispatcher |

---

## 阶段依赖关系图

```
Phase 1 (A) ─────────────────────┐
Phase 2 (C) ──┐                  │
              ├→ Phase 4 (C)     ├→ Phase 7 (A)  ──→ Phase 10 (A+B)
Phase 3 (A) ──┘         │        │       │
                        ▼        │       ▼
                  Phase 5 (C) ───┘  Phase 8 (C)  ──→ Phase 11 (A+C)
                        │                │
                        ▼                ▼
                  Phase 6 (B) ────→ Phase 9 (B)  ──→ Phase 12 (B+C)
                                                          │
                                                          ▼
                                                    Phase 13 (全员)
```

---

## Phase 1：项目骨架与包初始化
**负责人：工程师A** | **预估：1.5天** | **前置依赖：无**

### 目标
在 Cosoul.AI monorepo 中创建 `packages/core`（业务逻辑+数据层）和 `packages/agent`（Agent智能体总包）两个新包，搭建目录结构，配置构建。

### 任务清单

#### 1a. 创建 `packages/core`（@repo/core）
- [ ] 初始化 `package.json`（名称 `@repo/core`），添加依赖：
  - `pg`, `drizzle-orm`, `pgvector`, `zod`, `dotenv`, `uuid`
  - devDependencies: `typescript`, `drizzle-kit`, `@types/pg`, `@types/uuid`, `vitest`
- [ ] 创建 `tsconfig.json` 继承根配置
- [ ] 创建 `tsup.config.ts` 构建配置
- [ ] 搭建源码目录骨架：
  ```
  packages/core/src/
  ├── index.ts                    # 统一导出
  ├── db/
  │   ├── client.ts              # Drizzle ORM + pg 连接池
  │   └── schema.ts              # 全部 Drizzle 表定义
  ├── services/
  │   ├── persona.service.ts     # 分身 CRUD + User.md 同步
  │   ├── task.service.ts        # 任务 CRUD + task.md 两阶段写
  │   ├── contact.service.ts     # 联系人管理
  │   └── chat.service.ts        # 聊天消息存取
  ├── storage/
  │   ├── task-md.ts             # task.md 序列化/反序列化
  │   └── file-store.ts          # .data/ 目录读写工具
  └── types/
      └── index.ts               # 共享类型（TaskDocument, Persona, AgentMessage 等）
  ```

#### 1b. 创建 `packages/agent`（@repo/agent）
- [ ] 初始化 `package.json`（名称 `@repo/agent`），添加依赖：
  - `@repo/core`（workspace 引用）, `openai`, `zod`
  - devDependencies: `typescript`, `vitest`
- [ ] 创建 `tsconfig.json` + `tsup.config.ts`
- [ ] 搭建源码目录骨架：
  ```
  packages/agent/src/
  ├── index.ts                        # 统一导出
  ├── shared/                         # Agent 共享基础设施
  │   ├── llm/                       (base-model.ts, openai-provider.ts, claude-provider.ts, qwen-provider.ts, provider-registry.ts, conversation.ts)
  │   ├── rag/                       (embedding.ts, retrieval.ts)
  │   └── memory/                    (context.ts, memory.ts)
  ├── task-agent/                     # 任务匹配 Agent
  │   ├── fsm/                       (schema.ts, transitions.ts, task-loop.ts)
  │   ├── dispatcher/                (dispatcher.ts, l0-filter.ts, l1-retrieval.ts, l2-sandbox.ts)
  │   ├── protocol/                  (handshake.ts, idempotency.ts)
  │   └── intake/                    (intake.ts)
  ├── persona-agent/                  # 人格管理 Agent（预留）
  │   └── index.ts
  └── social-agent/                   # 社交互动 Agent（预留）
      └── index.ts
  ```

#### 1c. Monorepo 配置
- [ ] 在根 `package.json` 的 workspaces 确认包含 `packages/core` 和 `packages/agent`
- [ ] 更新 `turbo.json` 添加 core 和 agent 构建任务
- [ ] 配置依赖关系：`@repo/agent` → `@repo/core`，`apps/web` → `@repo/core` + `@repo/agent`
- [ ] 创建 `.data/<persona_id>/` 目录结构模板：
  ```
  .data/<persona_id>/
  ├── User.md
  ├── raw_chats_summary/
  ├── logs/
  └── task_agents/
      └── <task_id>/
          ├── task.md
          ├── task_summary.md
          └── data/ (daily_log/, agent_chat/, agent_chat_summary/)
  ```
- [ ] 创建 `.env.example` 文件列出所需环境变量
- [ ] 验证 `npm install` 和 `npm run build` 通过

### 交付标准
- `@repo/core` 和 `@repo/agent` 包可被 `apps/web` 引用
- `@repo/agent` 可正确引用 `@repo/core`
- 目录结构完整，所有空文件有类型占位导出
- CI 构建通过

---

## Phase 2：BaseModel 与多厂商 LLM Provider
**负责人：工程师C** | **预估：2天** | **前置依赖：Phase 1**

### 目标
定义统一的 LLM 调用接口，适配 OpenAI / Claude / Qwen 三个厂商。

### 任务清单
- [ ] 定义 `BaseModel` 抽象类（`packages/agent/src/shared/llm/base-model.ts`）：
  ```typescript
  abstract class BaseModel {
    abstract name: string;
    abstract defaultModel: string;
    abstract chatOnce(messages: AgentMessage[]): Promise<string>;
    abstract chatStream(messages: AgentMessage[]): AsyncGenerator<string>;
    abstract countTokens(text: string): number;
    abstract countMessageTokens(messages: AgentMessage[]): number;
  }
  ```
- [ ] 定义标准消息格式（`packages/core/src/types/index.ts`，供 core 和 agent 共用）：
  ```typescript
  interface AgentMessage {
    role: "system" | "user" | "assistant";
    data: any;
  }
  ```
- [ ] 实现 `OpenAIProvider`（基于 openai SDK）：
  - 支持 GPT-4o, GPT-4o-mini
  - 实现流式和非流式
  - CJK优化的token估算
- [ ] 实现 `ClaudeProvider`（基于 fetch 调用 Anthropic API）：
  - system 字段独立传递（不在 messages 数组中）
  - 响应格式适配（text blocks → string）
- [ ] 实现 `QwenProvider`（DashScope OpenAI兼容接口）：
  - 基于 openai SDK，修改 baseURL
  - 支持 qwen3-max, qwen-turbo
- [ ] 实现 `ProviderRegistry`（`packages/agent/src/shared/llm/provider-registry.ts`）：
  - 单例缓存 `Map<string, BaseModel>`
  - `getProvider(name, model)` 工厂方法
  - 默认配置从环境变量读取
- [ ] 实现 `Conversation` 类（`llm/conversation.ts`）：
  - 多轮对话状态管理
  - 自动历史裁剪（maxHistoryTokens）
  - 单次对话便捷方法 `chatOnce()`
- [ ] 编写单元测试：
  - Provider初始化测试
  - Token计数测试
  - Mock LLM响应测试

### 交付标准
- `getProvider("qwen", "qwen3-max")` 可正常返回实例
- `chatOnce()` 和 `Conversation` 多轮对话逻辑正确
- 三个Provider格式适配验证通过

---

## Phase 3：PostgreSQL + pgvector 初始化与 Storage 防腐层
**负责人：工程师A** | **预估：2天** | **前置依赖：Phase 1**

### 目标
搭建 PostgreSQL 数据库层，使用 Drizzle ORM + pgvector 扩展，替代原 Task-Agents_ai 的 SQLite 方案，以支持 Agent 高并发读写。

### 任务清单
- [ ] 配置 PostgreSQL 开发环境：
  - 在 `.devcontainer/docker-compose.yml` 中添加 PostgreSQL 16 + pgvector 服务
  - 配置 `DATABASE_URL` 环境变量
  - 编写 `drizzle.config.ts` 迁移配置
- [ ] 实现 `packages/core/src/db/client.ts`（数据库连接与初始化）：
  - Drizzle ORM + pg 驱动连接池初始化
  - `initDatabase()` — 启用 pgvector 扩展 (`CREATE EXTENSION IF NOT EXISTS vector`)
  - 连接池配置（max connections, idle timeout）
- [ ] 实现 `packages/core/src/db/schema.ts`（Drizzle 表定义）：
  - `users` 表 — user_id, email, created_at
  - `personas` 表 — persona_id, user_id, name, avatar, bio, settings(jsonb), created_at, updated_at
  - `persona_profiles` 表 — persona_id, profile_text, preferences(jsonb), updated_at（User.md 派生）
  - `tasks` 表 — task_id, **persona_id**, status, interaction_type, current_partner_id, raw_description, target_activity, target_vibe, detailed_plan, entered_status_at, created_at, updated_at, version, pending_sync, hidden
  - `task_summaries` 表 — task_id, summary_text, tags(jsonb), created_at（task_summary.md 派生，支持跨任务复用）
  - `task_vectors` 表 — task_id, field(activity/vibe/raw/summary), embedding(`vector(1024)`类型), model, updated_at
  - `contacts` 表 — id, persona_id, friend_persona_id, status(pending/accepted/blocked), ai_note, source_task_id, created_at
  - `handshake_logs` 表 — id, task_id, direction(inbound/outbound), envelope(jsonb), timestamp
  - `idempotency_keys` 表 — key, response(jsonb), created_at（TTL索引7天自动清理）
  - `chat_messages` 表 — id, task_id, persona_id, sender_type, sender_id, content, metadata(jsonb), created_at
  - `memory_summaries` 表 — id, persona_id, task_id, summary_text, source_log_id, turn_count, created_at
  - 为 task_vectors.embedding 创建 HNSW 索引 (`CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)`)
  - 为 tasks 创建 (persona_id, status) 联合索引
  - 为 contacts 创建 (persona_id) 索引
- [ ] 编写 Drizzle 数据库迁移脚本（`drizzle-kit generate` + `drizzle-kit migrate`）
- [ ] 实现 `packages/core/src/services/` 业务服务层（被 API 路由 + Agent 共同调用）：
  - `persona.service.ts`: `createPersona()` / `getPersonas()` / `updatePersona()` / `syncUserMd()`
  - `task.service.ts`: `upsertTask()` / `readTask()` / `listTasksByStatuses()` / `saveTaskSummary()` / `findSimilarTaskSummaries()`
  - `contact.service.ts`: `createContact()` / `listContacts()`
  - `chat.service.ts`: 聊天消息存取
- [ ] 实现向量相关 DB 操作（供 `@repo/agent` 调用）：
  - `upsertTaskVector(taskId, field, embedding)` — 写入 pgvector 列
  - `readTaskVectors(taskId)` — 读取任务所有向量
  - `vectorSearch(queryVector, field, filter, topK)` — 使用 `<=>` 运算符的原生向量检索
  - `queryL0Candidates(taskId)` — 基于 SQL WHERE 的 L0 硬过滤
- [ ] 实现 `packages/core/src/storage/task-md.ts`：
  - task.md 的 YAML头 + Markdown正文 读写
  - `serializeTaskMD(task)` / `parseTaskMD(content)`
  - 文件路径解析：`.data/<persona_id>/task_agents/<task_id>/task.md`
  - task_summary.md 读写：`.data/<persona_id>/task_agents/<task_id>/task_summary.md`
- [ ] 在 `packages/core/src/services/task.service.ts` 中实现防腐层逻辑：
  - `saveTaskMD(task, options?)` — 含乐观锁校验（写task.md + 写PostgreSQL）
  - `readTaskDocument(taskId)` — 优先读task.md，回退读PostgreSQL
  - `transitionTaskStatus(taskId, nextStatus)` — 两阶段原子写（task.md → PostgreSQL）
  - `queryL0Candidates(taskId)` — 基于PostgreSQL SQL查询的L0过滤
  - `listTasksByStatuses(statuses)` — 直接查PostgreSQL（高效）
  - `enqueueSyncRepair(job)` / `retrySyncRepairs()` — 补偿队列
  - `findIdempotencyRecord()` / `saveIdempotencyRecord()` — 读写 idempotency_keys 表
  - `appendAgentChatLog(taskId, entry)` — 写入 handshake_logs 表
  - `readLatestHandshakeExchange(taskId)` — 查询最近握手记录
- [ ] 编写测试：
  - task.md 序列化/反序列化
  - PostgreSQL CRUD（使用测试数据库或 testcontainers）
  - 乐观锁冲突测试（并发写入 version 检测）
  - 两阶段写入 + 补偿队列测试
  - pgvector 向量写入/检索正确性

### 交付标准
- Storage 所有核心方法实现且测试通过
- task.md 读写幂等
- 乐观锁能正确检测并拒绝冲突写入
- pgvector HNSW 索引可加速向量检索

---

## Phase 4：FSM 状态机与 Schema 定义
**负责人：工程师C** | **预估：1.5天** | **前置依赖：Phase 2, Phase 3**

### 目标
迁移状态机、类型定义、Zod Schema 到 `packages/agent` 中。

### 任务清单
- [ ] 实现 `packages/agent/src/task-agent/fsm/schema.ts`：
  - 所有枚举类型（TaskStatus, InteractionType, HandshakeAction, ErrorCode, SessionStatus）
  - Zod Schemas（TaskFrontmatter, TaskBody, TaskDocument, HandshakeInbound/Outbound, NegotiationSession, ListeningReport）
  - Parse 函数（parseTaskDocument, parseHandshakeInbound/Outbound）
  - 允许的状态迁移表 `ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]>`
- [ ] 实现 `packages/agent/src/task-agent/fsm/transitions.ts`：
  - `assertTransitionAllowed(from, to)` — 校验迁移合法性
  - `transitionTask(taskId, nextStatus)` — 调用 storage 执行迁移
  - 迁移时更新 `entered_status_at`, `updated_at`, `version++`
- [ ] 实现 `packages/agent/src/task-agent/fsm/task-loop.ts`：
  - `runTaskStepById(taskId)` — 单步FSM推进
  - `runTaskStep(task)` — 根据status分发到对应处理函数
  - 状态处理占位（Drafting→Searching, Searching→调用dispatcher, etc.）
- [ ] 全覆盖测试：
  - 所有9种状态 + 10种合法迁移
  - 所有禁止迁移抛错
  - Schema校验正向/反向用例

### 交付标准
- 状态迁移表100%覆盖测试
- Zod Schema 对入站/出站报文校验正确
- FSM 单步推进逻辑正确

---

## Phase 5：Dispatcher（L0/L1/L2）与 Embedding
**负责人：工程师C** | **预估：3天** | **前置依赖：Phase 4**

### 目标
实现核心的三层漏斗匹配逻辑和向量搜索。

### 任务清单

#### L0 硬过滤（`dispatcher/l0-filter.ts`）
- [ ] `runL0Filter(taskId)` — 基于 PostgreSQL 查询：
  - interaction_type 兼容性（online匹配online/any，offline匹配offline/any）
  - status = "Searching" 的其他任务
  - 排除自身 task_id
  - 利用 PostgreSQL 索引高效过滤，支持高并发
  - 返回候选 task_id[] + 过滤原因

#### Embedding（`rag/embedding.ts`）
- [ ] 封装 DashScope text-embedding-v4 API 调用
- [ ] `embedText(text): Promise<Float32Array>`
- [ ] `embedBatch(texts): Promise<Float32Array[]>`
- [ ] `embedTaskFields(taskId, activity, vibe, raw)` — 三字段分别 embedding 并存入 pgvector

#### L1 语义检索（`dispatcher/l1-retrieval.ts` + `rag/retrieval.ts`）
- [ ] `runL1Retrieval(task)` — 流程：
  1. 加载源任务三个字段的向量
  2. 调用 L0 获取候选白名单
  3. 使用 pgvector `<=>` 运算符对三个字段分别执行向量检索（单条SQL完成，无需逐一遍历）
  4. 权重：targetActivity=0.35, targetVibe=0.35, rawDescription=0.30
  5. 过滤 score >= threshold (默认0.3)
  6. 返回 Top-K 排序结果 + 各字段分数
  7. 利用 HNSW 索引加速，万级数据量下毫秒级响应

#### L2 沙盒谈判（`dispatcher/l2-sandbox.ts`）
- [ ] `executeL2Sandbox(localTask, inboundEnvelope)` — 流程：
  1. 加载当前分身的 User.md 用户画像
  2. 检查 interaction_type 兼容性
  3. 先对对方 task.md 生成 CoT 思考（写入 `scratchpad.md`，**绝不外发**）
  4. 基于 CoT 构建正式回复 Prompt
  5. 调用 LLM 做研判
  6. 解析 ACCEPT / REJECT / COUNTER_PROPOSE
  7. 对于己方未提及但对方有的偏好 → 记录为 `unresolved_preferences`，展现在握手报告中
  8. 返回 L2Decision + unresolved_preferences
- [ ] 规定 Agent 交流 JSON schema：
  - 标准化交流格式，根据 `return` 字段判断结果
  - 限制最多 5 轮，防止 Agent 超额消耗
- [ ] 握手报告生成：
  - "已为您找到N个匹配结果，1为XXX，2为XXX..."
  - 每个结果包含：匹配度、关键匹配点、未握手确定的偏好
  - 用户可选择跳转修改 task.md

#### Dispatcher 总线（`dispatcher/dispatcher.ts`）
- [ ] `processDraftingTasks()` — 批量 Drafting→Searching
- [ ] `processSearchingTasks()` — L0→L1→发送PROPOSE→Negotiating
- [ ] `processWaitingHumanTasks()` — 展示结果等待人确认
- [ ] `dispatchInboundHandshake(envelope)` — 被动流入站处理
- [ ] `handleWaitingHumanIntent(taskId, intent)` — 用户意图处理

#### 测试
- [ ] L0过滤正确排除不兼容任务
- [ ] L1向量相似度计算与排序正确
- [ ] L2 Mock LLM 返回 ACCEPT/REJECT 场景
- [ ] 完整 L0→L1→L2 链路集成测试

### 交付标准
- 三层漏斗可端到端跑通（使用mock数据）
- Embedding API 调用成功，向量正确存储/检索
- Dispatcher 各处理函数逻辑正确

---

## Phase 6：发布 Tab 与 Intake 对话（前端 Part 1）
**负责人：工程师B** | **预估：2.5天** | **前置依赖：Phase 4（Schema定义完成即可开始）**

### 目标
实现发布 Tab（创建新任务）和 Intake 多轮对话交互，含分身选择。发布 Tab 当前版本仅负责创建 Task，未来扩展发帖、视频等多媒体发布功能。

### 任务清单

#### Intake 多轮对话（@repo/agent task-agent, 与工程师C协同）
- [ ] 实现 `intake/intake.ts`：
  - `collectTaskFromUser(personaId, conversation)` — 加载该分身的 User.md 偏好，结合偏好生成针对性引导问题
  - 提取字段：interaction_type, rawDescription, targetActivity, targetVibe, detailedPlan
  - 不完整时继续追问 followUpQuestion
  - 对话关键信息提取保存为 `task_summary.md`（标签总结，可跨任务复用）
  - 检查是否有历史相似任务的 task_summary 可快速调用
  - 返回 { task: TaskDocument, taskSummary: string, transcript: Message[] }

#### 发布 Tab UI
- [ ] 创建 `packages/ui/src/screens/PublishScreen.tsx`（发布中心）：
  - 顶部分身切换器（显示当前分身名称 + 头像，可切换）
  - 主入口："创建新任务" → 进入 TaskCreateScreen
  - 未来扩展区域预留：发帖、视频等多媒体发布入口（当前版本不开发）
  - 最近创建的任务快捷入口（跳转至消息 Tab 对应任务）
- [ ] 创建 `packages/ui/src/screens/TaskCreateScreen.tsx`（创建任务 / Intake对话）：
  - 聊天气泡式交互区（Agent提问 + 用户回答）
  - Agent 结合当前分身 User.md 偏好生成引导问题
  - Agent 回复使用 SSE 流式显示
  - 提取完成后显示结构化预览卡片：
    - interaction_type 标签
    - targetActivity 摘要
    - targetVibe 氛围标签
    - detailedPlan 展开详情
  - 确认按钮（"开始匹配"）和编辑按钮（"继续调整"）
  - Agent可能在任务进行中需要用户补充更多细节（通过聊天形式）
- [ ] 适配Web端：`apps/web/app/publish/page.tsx`
- [ ] 适配移动端：Tab导航中的 发布 入口
- [ ] 对接后端 API（Phase 7完成后联调）：
  - `POST /api/task` — 创建任务（含 persona_id）
  - `POST /api/llm/chat` — Intake对话
  - `GET /api/task?persona_id=xxx` — 获取分身下任务列表（用于最近创建快捷入口）

#### 样式与交互
- [ ] 聊天气泡样式（用户右侧蓝色，Agent左侧灰色）
- [ ] 打字机效果（流式文字逐字显示）
- [ ] 结构化预览卡片样式
- [ ] Loading状态 + 错误提示
- [ ] 主题适配（Light/Dark）

### 交付标准
- 完整的发帖流程 UI 可交互（先用Mock数据）
- 聊天气泡 + 流式显示效果良好
- 结构化预览卡片信息完整
- 跨平台（Web + Native）表现一致

---

## Phase 7：后端 API 路由层
**负责人：工程师A** | **预估：2天** | **前置依赖：Phase 3, Phase 5（核心Storage和Dispatcher完成）**

### 目标
在 Next.js App Router 中创建 TaskAgent 相关 API 路由。

### 任务清单

#### 分身管理 API
- [ ] `POST /api/persona` — 创建分身
  - 请求体：{ name, avatar?, bio?, settings? }
  - 初始化 `.data/<persona_id>/` 目录 + User.md 模板
  - 返回 persona_id
- [ ] `GET /api/persona` — 获取用户所有分身列表
- [ ] `GET /api/persona/[id]` — 获取分身详情（含 User.md 内容）
- [ ] `PATCH /api/persona/[id]` — 更新分身信息 + 同步 persona_profiles

#### 任务管理 API
- [ ] `POST /api/task` — 创建新任务
  - 请求体：TaskDocument + **persona_id**（关联分身）
  - 调用 `saveTaskMD()` 存储 + 生成 task_summary.md
  - 返回 task_id + status
- [ ] `GET /api/task` — 获取任务列表
  - Query参数：**persona_id**, status[], hidden
  - 调用 `listTasksByStatuses(personaId, statuses)`
- [ ] `GET /api/task/[id]` — 获取任务详情
  - 返回 task + waiting_human_summary（如适用）
- [ ] `POST /api/task/[id]/run` — 执行FSM单步
  - 调用 `runTaskStepById()`
  - 返回状态变更结果
- [ ] `POST /api/task/[id]/intent` — 用户意图处理
  - 请求体：{ intent: "satisfied" | "unsatisfied" | "enable_listener" | ... }
  - 调用 `handleWaitingHumanIntent()`
- [ ] `PATCH /api/task/[id]` — 更新任务（Revising阶段）
  - 乐观锁 version 校验
  - 调用 `saveTaskMD()`

#### 握手协议 API
- [ ] `POST /api/handshake` — 接收外部Agent握手消息
  - Zod校验入站报文
  - 幂等检查
  - 调用 `dispatchInboundHandshake()`
  - 返回协议响应

#### LLM 通用 API
- [ ] `POST /api/llm/chat` — 通用LLM对话接口
  - 支持流式（SSE）和非流式
  - 请求体：{ provider?, model?, messages, stream? }
  - 复用 ProviderRegistry

#### Embedding API
- [ ] `POST /api/embedding` — 文本向量化
  - 请求体：{ texts: string[] }
  - 返回向量数组

#### 联系人 API
- [ ] `POST /api/contact` — 发送好友申请
  - 请求体：{ persona_id, friend_persona_id, source_task_id? }
- [ ] `GET /api/contact?persona_id=xxx` — 获取分身联系人列表（含AI好友备注）
- [ ] `PATCH /api/contact/[id]` — 接受/拒绝/屏蔽好友请求

#### 通用处理
- [ ] 所有路由添加 CORS headers
- [ ] 统一错误响应格式 `{ error: { code, message } }`
- [ ] 请求体 Zod 校验
- [ ] 环境变量验证（启动时检查必要 API Key）

### 交付标准
- 所有 API 路由可通过 curl/Postman 测试
- 错误码与响应格式统一
- CORS 和安全头正确配置

---

## Phase 8：记忆系统与上下文管理
**负责人：工程师C** | **预估：1.5天** | **前置依赖：Phase 5**

### 目标
实现对话记忆的压缩、归档和上下文 Token 管理。

### 任务清单

#### Context Token 管理（`memory/context.ts`）
- [ ] `estimateTokens(text)` — Token估算（LLM自带API 或 4:1近似）
- [ ] `buildPromptContext(input)` — 构建带Token预算的Prompt：
  - 估算当前对话Token数
  - 超阈值(80%)触发 memory flush
  - 截断最旧对话保留最新
  - 返回 PromptContext { taskPrompt, estimatedTokens, flushed }
- [ ] `truncateTurnsByBudget(turns, budget)` — 从最新往最旧保留

#### Memory 压缩（`memory/memory.ts`）
- [ ] `flushMemoryIfNeeded(personaId, taskId, input)` — 流程：
  1. 检查 estimated_tokens >= trigger_tokens
  2. 创建原始对话快照写入 `raw_chats/`（仅回溯凭证，不参与Embedding）
  3. 调用 LLM 生成 summary
  4. Summary 写入 `raw_chats_summary/`（参与 Embedding，用于 RAG）
  5. 提取有用信息补充更新 task.md 和 User.md
  6. Summary 同步写入 `memory_summaries` 表 + embedding 写入 `task_vectors` 表
  7. 写入观测性日志
  8. 返回 { rawLogPath, summaryPath, summaryText, updatedFields } 或 null
- [ ] `summarizeTurns(turns)` — 调用 LLM 生成对话摘要
  - 提取关键信息、决策点、未解决问题
  - 控制摘要长度 <= 600字
- [ ] `generateTaskSummary(taskId, transcript)` — 从 Intake 对话生成 task_summary.md
  - 提取关键信息标签
  - 存入 task_summaries 表，支持后续相似任务快速调用

#### Prompt 模板
- [ ] 定义各场景 Prompt 模板：
  - Intake 收集 Prompt
  - L2 研判 Prompt
  - Summary 压缩 Prompt
  - Agent 性格基础设定

### 交付标准
- Token 计数误差在 20% 以内
- Memory flush 在超阈值时正确触发
- Summary 质量测试（关键信息保留率）

---

## Phase 9：消息 Tab / 我的 Tab / 预留页面（前端 Part 3）
**负责人：工程师B** | **预估：3.5天** | **前置依赖：Phase 6, Phase 7**

### 目标
实现 5 Tab 架构：消息 Tab（合并消息+联系人，含分身切换）、我的 Tab（分身管理）、以及首页/发现两个预留 Tab。

### 任务清单

#### 首页 Tab（`HomeScreen.tsx` 新建 — 预留）
- [ ] AI 社区首页 placeholder 页面
  - 品牌 Logo + 简介
  - "敬请期待" 或 "AI 社区即将上线" 占位
  - 后续承载：推荐内容、热门匹配、社区广场等

#### 发现 Tab（`DiscoverScreen.tsx` 新建 — 预留）
- [ ] 发现/动态 placeholder 页面
  - "敬请期待" 占位
  - 后续承载：关注的人/博主动态信息流

#### 消息 Tab（`MessageScreen.tsx` 改造 — 核心）

**消息+联系人合并设计**：顶部分身切换器，切换后展示对应分身的所有任务消息和 Agent 聊天；联系人作为消息 Tab 内的子模块。

- [ ] 顶部分身切换器（与发布 Tab 共用组件）：
  - 显示当前分身名称 + 头像，点击可切换
  - 切换分身后刷新消息列表和联系人
- [ ] 消息列表 UI：
  - 显示**当前分身**下的所有对话消息历史条（类似社交软件）
  - 每条消息显示：对方头像、名称、最新消息摘要、时间、未读标记
  - 区分消息类型标签：人-人、Agent-Agent、Agent-人、人-Agent
  - 任务状态角标（Negotiating、Waiting_Human、Closed等）
  - 下拉刷新 + 上拉加载更多
- [ ] 页内分类 Tab：
  - "消息" | "联系人" （页内二级切换）
  - 消息列表下可进一步筛选："全部" | "匹配中" | "已完成" | "Agent自动"
- [ ] 联系人子模块（页内"联系人"Tab）：
  - 当前分身下联系人列表
  - 每个好友显示：头像、名称、AI生成的好友备注（仅自己可见，含添加时间、原因等）
  - 好友请求管理（接受/拒绝）
  - 好友搜索功能（通过历史对话、添加原因等关键词查找）
  - 点击联系人 → 进入聊天界面

#### 对话详情页（`AgentChatScreen.tsx` 新建）
- [ ] 聊天界面：
  - 消息气泡（文本、结构化卡片）
  - Agent消息带特殊标识（机器人图标）
  - 时间分割线
  - 输入框 + 发送按钮
- [ ] 四种交互模式支持：

  **A人-B人模式：**
  - 常规IM聊天界面
  - 文本输入 + 发送
  - 消息实时接收（WebSocket/轮询）

  **A_Agent-B_Agent模式：**
  - 只读查看模式（两个Agent自动协商）
  - 显示协商轮次进度
  - 显示握手动作（PROPOSE → COUNTER_PROPOSE → ACCEPT）
  - 用户可在Waiting_Human时介入

  **A_Agent-B人模式：**
  - B侧看到Agent发来的消息
  - B可以直接回复
  - 显示Agent代表的用户信息

  **A人-B_Agent模式：**
  - A发消息给B的Agent
  - Agent流式回复（SSE）
  - 显示Agent正在思考的状态

#### Waiting_Human 交互
- [ ] 握手报告展示卡片：
  - "已为您找到N个匹配结果"
  - 每个结果显示：对方 targetActivity + targetVibe + 匹配度分数 + 协商历史摘要
  - 展示未握手确定的偏好（Agent反问项）
- [ ] 操作按钮：
  - "满意，发送好友申请" → Closed → 创建联系人
  - "不满意，重新搜索" → Revising（可跳转修改 task.md）
  - "后台挂起继续找" → Listening
  - "取消任务" → Cancelled
- [ ] Listening 模式报告页：
  - 展示挂起期间收到的所有提案
  - 每个提案显示匹配度和摘要

#### 我的 Tab（`ProfileScreen.tsx` 改造）
- [ ] 分身管理区域：
  - 分身列表（卡片展示，可切换）
  - 创建新分身
  - 编辑分身：头像、简介、照片等（类似社交软件主页）
- [ ] AI侧写展示：
  - 显示当前分身的 User.md 内容（AI 总结的用户侧写）
  - 用户可根据自己定位查看和修改
- [ ] 历史任务记录
- [ ] 偏好设置

#### 任务详情页（`TaskDetailScreen.tsx` 新建）
- [ ] 任务信息展示（rawDescription, targetActivity, targetVibe）
- [ ] task.md 在线查看和修改
- [ ] FSM状态时间线（可视化状态流转历史）
- [ ] 当前状态操作按钮

### 交付标准
- 5 Tab 导航结构完整（首页/发现预留，发布/消息/我的 功能可用）
- 消息 Tab 内分身切换正确，消息和联系人二级Tab切换自然
- 四种消息交互模式切换自然
- 我的 Tab 分身管理 + User.md 查看修改正常
- 跨平台一致

---

## Phase 10：Protocol 握手与网络对接
**负责人：工程师A + 工程师B** | **预估：2天** | **前置依赖：Phase 7, Phase 9**

### 目标
实现Agent间握手协议的完整网络对接，包括幂等处理和消息存储。

### 任务清单

#### 握手协议核心（工程师A）
- [ ] 实现 `protocol/handshake.ts`：
  - `sendHandshake(targetUrl, envelope)` — 发送握手消息到对方Agent
  - 超时处理（默认30s）
  - 重试机制（指数退避，3次）
  - 响应校验（Zod SafeParse）
- [ ] 实现 `protocol/idempotency.ts`：
  - `checkIdempotency(envelope)` — 检查是否重复消息
  - `recordIdempotency(envelope, response)` — 记录处理结果
  - 幂等窗口：7天
  - 键：(message_id, sender_agent_id, protocol_version)
- [ ] 握手消息存储：
  - 所有入站/出站消息写入 `agent_chat/*.jsonl`
  - 包含方向(inbound/outbound)、时间戳、payload

#### 前端协商展示（工程师B）
- [ ] Agent协商实时状态展示：
  - 当前轮次 / 最大轮次(5)
  - 每轮动作可视化（PROPOSE → 对方ACCEPT → 我方ACCEPT）
  - 超时倒计时
  - 状态变更时推送通知

#### 对话内容存储
- [ ] 协商记录持久化到 agent_chat
- [ ] 摘要生成（协商结束时调用LLM总结）
- [ ] 前端读取展示协商历史

### 交付标准
- 两个Agent可完成完整握手流程
- 幂等：重复消息不重复处理
- 所有协商记录可追溯

---

## Phase 11：多分身 × 任务多开 与状态编排
**负责人：工程师A + 工程师C** | **预估：2.5天** | **前置依赖：Phase 8, Phase 10**

### 目标
支持用户多个分身各自独立运行多个任务，分身间数据隔离，任务独立状态追踪。

### 任务清单

#### 任务调度器（工程师C）
- [ ] 实现任务调度管理：
  - 每个分身(persona)下的任务独立FSM实例，互不干扰
  - 分身间完全隔离：A分身的任务不会匹配到自己B分身的任务
  - 任务队列管理（活跃任务 vs 挂起任务），按 persona_id 分组
  - startTask 和 listener 逻辑编排：
    - 新建任务不影响已有任务状态
    - 挂起任务(Listening)仍可接收入站握手
    - 活跃任务(Searching/Negotiating)有独立生命周期
- [ ] `TaskScheduler` 类：
  - `startTask(personaId, taskId)` — 激活任务，进入主动流
  - `pauseTask(taskId)` — 挂起任务到Listening
  - `resumeTask(taskId)` — 从Listening恢复
  - `cancelTask(taskId)` — 取消任务
  - `getActiveTasks(personaId)` — 获取分身下所有活跃任务
  - `getTaskStatus(taskId)` — 查询任务当前状态
- [ ] 高度匹配模式：
  - 对于多次被其他Agent握手的热门分身，可开启高门槛过滤
  - 配置在 persona.settings.high_match_mode = true
  - 开启后仅高度匹配的 Agent 才能对该分身发起聊天申请

#### 并发安全（工程师A）
- [ ] 乐观锁强化：
  - 多任务并发写入时的version冲突检测
  - 利用 PostgreSQL `UPDATE ... WHERE version = $1 RETURNING *` 原子操作
  - 冲突时自动重读重试（最多3次）
- [ ] PostgreSQL 连接池调优：
  - 配置合适的 max connections（建议 20-50）
  - 设置 idle timeout 和 connection timeout
  - 利用 MVCC 天然支持多写并发，无需手动序列化
- [ ] 后台轮询引擎：
  - 定期扫描所有活跃任务
  - 按优先级执行FSM步进
  - 错误隔离：单任务失败不影响其他任务
  - 利用 PostgreSQL `SELECT ... FOR UPDATE SKIP LOCKED` 防止多worker重复处理

#### API 扩展
- [ ] `GET /api/task?active=true` — 获取活跃任务列表
- [ ] `POST /api/task/[id]/pause` — 挂起任务
- [ ] `POST /api/task/[id]/resume` — 恢复任务
- [ ] 前端任务列表页展示多个任务状态

### 交付标准
- 3个以上任务可同时运行
- 任务间状态完全隔离
- 并发写入不丢数据

---

## Phase 12：Skills/性格设定与 Prompt 协同
**负责人：工程师B + 工程师C** | **预估：1.5天** | **前置依赖：Phase 8, Phase 9**

### 目标
定义Agent性格文本、完善Prompt模板、预留Skill路由接口。

### 任务清单

#### Agent 性格设定（工程师C）
- [ ] 创建 `skills/` 目录下性格模板文件：
  - `agent-persona.md` — Agent 默认性格描述（友善、高效、尊重隐私）
  - 性格参数可配置：正式度、幽默度、主动性
- [ ] 完善各场景 Prompt：
  - **Intake Prompt**：引导用户描述需求，提取结构化字段
  - **L2 研判 Prompt**：分析兼容性，输出 ACCEPT/REJECT + 原因
  - **Summary Prompt**：压缩对话保留关键信息
  - **对话 Prompt**：Agent代替用户和对方交流时的人设
  - **Listening Report Prompt**：汇总挂起期间的提案

#### Skill Router 预留（工程师C）
- [ ] 实现 `skills/skill-router.ts`：
  - 定义 Skill 接口：`{ name, description, execute(input) }`
  - 路由注册机制
  - 目前注册 memory、protocol 两个基础skill
  - Parser 预留接口（后续可扩展意图解析）

#### 前端Agent人设展示（工程师B）
- [ ] Agent头像 + 名称 + 性格标签展示
- [ ] Agent"正在思考"状态动画
- [ ] Agent消息气泡特殊样式（区别于真人消息）

### 交付标准
- Agent 在各场景输出风格一致
- Prompt 模板可配置
- Skill Router 可注册和路由

---

## Phase 13：集成测试与端到端联调
**负责人：全员** | **预估：2-3天** | **前置依赖：Phase 10, 11, 12 全部完成**

### 目标
全链路联调，确保"发帖 → 匹配 → 对话 → 确认"闭环跑通。

### 任务清单

#### 端到端流程测试（全员）
- [ ] **场景1：完整主动流**
  1. 用户A在发布Tab创建任务 → Intake对话 → 生成task.md(Drafting)
  2. 自动转入Searching → L0过滤 → L1向量检索
  3. 找到匹配 → 发送PROPOSE → 进入Negotiating
  4. 对方Agent ACCEPT → 进入Waiting_Human
  5. 用户A确认 → Closed

- [ ] **场景2：完整被动流**
  1. 收到外部PROPOSE → Schema校验 → 幂等检查
  2. L2沙盒研判 → ACCEPT → Waiting_Human
  3. 用户确认 → Closed

- [ ] **场景3：多轮谈判**
  1. PROPOSE → COUNTER_PROPOSE → COUNTER_PROPOSE → ACCEPT → ACCEPT
  2. 验证轮次计数正确
  3. 验证超过5轮自动Timeout

- [ ] **场景4：用户不满意重搜**
  1. Waiting_Human → 用户选"不满意" → Revising
  2. 修改需求 → Searching → 重新匹配

- [ ] **场景5：多分身 × 任务多开**
  1. 用户创建2个分身（A、B）
  2. 分身A同时创建2个任务，分身B创建1个任务
  3. 验证各自独立运行，分身间不串扰
  4. A分身的任务Closed不影响B分身的任务

- [ ] **场景6：Listening挂起**
  1. Waiting_Human → Listening → 后台接收多个提案
  2. 恢复后查看报告 → 选择最优匹配

- [ ] **场景7：匹配成功 → 好友申请 → 消息Tab联系人**
  1. 匹配成功 → 用户确认 → 发送好友申请
  2. 对方接受 → 双方在消息Tab联系人子模块可见
  3. 验证 AI 好友备注自动生成

#### 故障测试（工程师A + C）
- [ ] LLM API 超时处理
- [ ] PostgreSQL 连接失败/写入失败 → 补偿队列
- [ ] 网络断连 → 重试机制
- [ ] 乐观锁冲突 → 重读重试

#### 前端联调（工程师B）
- [ ] 发布Tab → 后端API → 任务创建流程
- [ ] 消息Tab → 四种交互模式真实数据 + 联系人子模块
- [ ] 5 Tab 导航 → 首页/发现预留页正常展示
- [ ] 状态变更 → 前端实时更新
- [ ] SSE流式 → Agent回复流畅

#### 性能与稳定性
- [ ] 10个并发任务压力测试
- [ ] Embedding批量调用性能
- [ ] PostgreSQL 查询延迟监控（含 pgvector 检索）
- [ ] Token消耗统计

### 交付标准
- 7个场景全部通过
- 无阻塞性Bug
- 前后端数据一致
- 错误有明确的错误码和日志

---

## 时间线总览

```
Week 1:
├── Day 1:    Phase 1 (A) — 项目骨架
├── Day 1-2:  Phase 2 (C) — LLM Provider      ← 与Phase 3并行
├── Day 1-2:  Phase 3 (A) — PostgreSQL + Storage ← 与Phase 2并行
├── Day 3:    Phase 4 (C) — FSM + Schema
├── Day 4-5:  Phase 6 (B) — 发布Tab + Intake对话  ← Phase 4完成后开始

Week 2:
├── Day 1-3:  Phase 5 (C) — Dispatcher L0/L1/L2
├── Day 2-3:  Phase 7 (A) — 后端API路由
├── Day 3-4:  Phase 8 (C) — 记忆系统
├── Day 3-5:  Phase 9 (B) — 消息Tab+我的Tab+预留页面

Week 3:
├── Day 1-2:  Phase 10 (A+B) — 握手协议网络对接
├── Day 1-2:  Phase 11 (A+C) — 任务多开
├── Day 2-3:  Phase 12 (B+C) — Skills与Prompt
├── Day 3-5:  Phase 13 (全员) — 集成测试联调
```

---

## 每日站会检查点

| 检查点 | 判定条件 | 阻塞后果 |
|--------|----------|----------|
| Phase 1 完成 | `npm run build` 通过 | 阻塞所有后续Phase |
| Phase 2+3 完成 | LLM可调用 + PostgreSQL可读写 + pgvector可检索 | 阻塞Phase 4 |
| Phase 4 完成 | FSM迁移测试100%通过 | 阻塞Phase 5, 6 |
| Phase 5 完成 | L0→L1→L2链路mock跑通 | 阻塞Phase 7, 10 |
| Phase 7 完成 | API curl测试全通 | 阻塞前后端联调 |
| Phase 9 完成 | 消息Tab 4种模式可切换 + 联系人子模块 + 5Tab导航完整 | 阻塞Phase 10 |
| Phase 13 完成 | 7个E2E场景通过 | **初级Demo可演示** |

---

## 附录：关键接口约定（供工程师间对齐）

### A. 前后端数据契约

```typescript
// === 分身管理 ===
POST /api/persona
Request:  { name, avatar?, bio?, settings? }
Response: { persona_id, created_at }

GET /api/persona
Response: { personas: Persona[] }

PATCH /api/persona/:id
Request:  { name?, avatar?, bio?, settings?, user_md_content? }
Response: { persona: Persona }

// === 任务管理 ===
POST /api/task
Request:  { persona_id, interaction_type, rawDescription, targetActivity, targetVibe, detailedPlan }
Response: { task_id, status, created_at }

GET /api/task?persona_id=xxx&status=Searching,Negotiating&hidden=false
Response: { tasks: TaskDocument[] }

GET /api/task/:id
Response: { task: TaskDocument, summary?: WaitingHumanSummary, handshakeReport?: HandshakeReport }

POST /api/task/:id/run
Response: { changed: boolean, task: TaskDocument }

POST /api/task/:id/intent
Request:  { intent: "satisfied" | "unsatisfied" | "enable_listener" | "closed" | "exit" }
Response: { status, listenerEnabled?, contactCreated? }

// === 联系人 ===
POST /api/contact
Request:  { persona_id, friend_persona_id, source_task_id? }
Response: { contact_id, status: "pending" }

GET /api/contact?persona_id=xxx
Response: { contacts: Contact[] }  // 含 ai_note

PATCH /api/contact/:id
Request:  { status: "accepted" | "blocked" }
Response: { contact: Contact }

// === LLM对话（流式） ===
POST /api/llm/chat
Request:  { persona_id?, provider?, model?, messages: AgentMessage[], stream?: boolean }
Response: SSE stream | { content: string }
```

### B. Provider 统一接口

```typescript
interface AgentMessage {
  role: "system" | "user" | "assistant";
  data: any;
}

abstract class BaseModel {
  abstract chatOnce(messages: AgentMessage[]): Promise<string>;
  abstract chatStream(messages: AgentMessage[]): AsyncGenerator<string>;
  abstract countTokens(text: string): number;
}
```

### C. 状态迁移合法表

```
Drafting     → [Searching, Cancelled]
Searching    → [Negotiating, Timeout, Failed, Cancelled]
Negotiating  → [Waiting_Human, Timeout, Failed, Cancelled]
Waiting_Human→ [Revising, Listening, Closed, Cancelled]
Listening    → [Waiting_Human, Cancelled]
Revising     → [Searching, Cancelled]
Closed       → [Waiting_Human]  // 重开
Timeout      → [Searching]      // 重试
Failed       → [Searching]      // 重试
```
