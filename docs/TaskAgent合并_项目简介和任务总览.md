# TaskAgent 模块合并至 Cosoul.AI — 项目简介与任务总览

> 版本：v2.0 | 日期：2026-03-09

---

## 一、产品定位

**Cosoul.AI** 是一个基于多智能体（Multi-Agent）的**意图路由匹配引擎**。让私人 AI 替你全网交涉，AI 之间进行自动化机对机（M2M）意图交涉，帮助人类精准匹配最契合的人与资源，实现 0 摩擦的社交与交易。

**平台核心特色：**
1. **无痛用户偏好提取** — 针对任务的偏好 + 性格特点总结，系统越用越懂用户
2. **Agent代理第一步沟通** — 节省方案查询、需求对齐等大量时间，同时保护用户隐私

### 1.1 核心概念：AI分身（Persona）

每个用户可以创建**多个 AI 分身**，每个分身代表一个独立人格：
- 每个分身有独立的 `User.md`（人格偏好档案）
- 每个分身可以独立发布任务、管理联系人、接收消息
- 分身之间数据隔离，用户在前端可自由切换当前活跃分身
- 每个分身的 Agent 基于对应 User.md 做决策，风格和偏好各异

```
用户 (1)
├── AI分身A "社交达人"     → User_A.md → [任务1, 任务2, 联系人...]
├── AI分身B "技术宅"       → User_B.md → [任务3, 联系人...]
└── AI分身C "健身搭子"     → User_C.md → [任务4, 任务5, 联系人...]
```

### 1.2 页面结构（5 Tab）

AI 分身功能是当前版本的核心体验，但整体产品定位为 **AI 社区**，因此预留首页和发现 Tab 供后续社区功能扩展。

| Tab | 页面 | 功能 | 当前版本 |
|-----|------|------|----------|
| **首页** | AI 社区首页 | 未来 AI 社区入口，承载社区核心功能（推荐、热门、广场等） | 预留，暂不开发 |
| **发现** | 发现/动态 | 关注的人/博主动态信息流（类似朋友圈/关注动态） | 预留，暂不开发 |
| **发布** | 发布中心 | 创建新 Task 任务（AI 分身多轮对话收集需求）；未来扩展：发帖、视频、多媒体等发布功能 | **核心功能**：仅负责创建任务 |
| **消息** | 消息 + 联系人 | 顶部分身切换器，切换后展示对应分身的任务消息列表和 Agent 聊天框；同时包含联系人列表与好友请求管理 | **核心功能** |
| **我的** | 个人主页 | 各分身的展示面信息 + 偏好信息，类似社交软件主页（头像、简介、照片等），可查看 AI 总结的用户侧写 User.md | **核心功能** |

> **设计理念**：发布 Tab 只负责"创建"，消息 Tab 负责"交互+联系人"，我的 Tab 负责"管理"。任务创建后自动进入 Agent 流程，用户在消息 Tab 通过切换分身查看各任务进展和 Agent 对话。

---

## 二、项目背景

### 2.1 Cosoul.AI（基础架构 — TS全栈）

基于 **Turborepo** 的 TypeScript 全栈单体仓库，采用跨平台架构：

| 层级 | 技术栈 | 说明 |
|------|--------|------|
| Web 端 | Next.js 16 + React 19 + Turbopack | App Router, SSE流式输出 |
| 移动端 | Expo 55 + React Native 0.83 | expo-router 文件路由 |
| 共享UI | @repo/ui (packages/ui) | 跨平台Screen组件、主题系统 |
| 构建工具 | Turborepo + tsup + npm workspaces | 任务编排与包管理 |

**现有能力：**
- OpenAI兼容格式的LLM API调用（阿里千问/Kimi）
- SSE流式文本输出（Web端）+ 非流式回退（移动端）
- 跨平台主题系统（Light/Dark/System）
- DevContainer云开发环境
- 液态玻璃风格 UI（Sidebar + LiquidTabBar）

### 2.2 Task-Agents_ai（Agent灵魂分身模块 — 待合并）

Task-Agents_ai 是一个**数字孪生 Agent 双向撮合系统**，核心能力包括：

| 模块 | 功能 |
|------|------|
| **FSM 状态机** | 9种状态 (Drafting→Searching→Negotiating→Waiting_Human→Closed等) |
| **L0 硬过滤** | interaction_type / must_match_tags / deal_breakers 结构化筛选 |
| **L1 语义检索** | Embedding向量相似度搜索（DashScope text-embedding-v4） |
| **L2 沙盒谈判** | LLM驱动的双向研判，ACCEPT/REJECT/COUNTER_PROPOSE |
| **多厂商LLM** | OpenAI / Claude / Qwen 三家适配，统一Provider接口 |
| **握手协议** | v1.0 JSON协议，幂等处理，最多5轮谈判 |
| **存储层** | task.md单一真相源 + PostgreSQL派生层 + 补偿队列 |
| **向量引擎** | DashScope Embedding + PostgreSQL pgvector 向量索引 |
| **记忆系统** | Token预算管理 + 对话压缩Summary + 归档 |
| **Intake收集** | 多轮LLM对话收集用户需求，提取结构化字段 |

---

## 三、合并目标

将 Task-Agents_ai 的 Agent 灵魂分身模块整合进 Cosoul.AI，形成完整的 **"选择分身 → 发布需求 → Agent自动匹配 → 消息交互 → 建立联系"** 闭环。

### 3.1 合并三大部分

```
┌──────────────────────────────────────────────────────────────────┐
│                     Cosoul.AI + TaskAgent                        │
│                                                                  │
│  5 Tab 产品结构：                                                  │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────────┐ ┌────────┐    │
│  │ 首页    │ │ 发现    │ │ 发布   │ │  消息+联系人   │ │ 我的    │   │
│  │(预留)   │ │(预留)   │ │创建任务 │ │ 分身切换查看   │ │分身管理 │    │
│  └────────┘ └────────┘ └───┬────┘ └──────┬───────┘ └────────┘    │
│                            │             │                       │
│  ┌─────────────┐           │             │                       │
│  │  Persona层   │ ← 用户选择/切换 AI 分身                           │
│  │  (多分身管理) │                                                 │
│  └──────┬──────┘                                                 │
│         ▼                                                        │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐          │
│  │  Part 1      │   │  Part 2      │   │  Part 3      │          │
│  │  发布Tab     │──→│  Agent搜寻    │──→│  消息Tab      │          │
│  │  创建新任务    │   │  L0/L1/L2链  │   │  交互+联系人   │          │
│  └──────────────┘   └──────────────┘   └──────────────┘          │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐      │
│  │              底层基础设施                                │      │
│  │  BaseModel多厂商适配 │ Embedding │ Storage │ Memory     │       │
│  └────────────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────────┘
```

#### Part 1：发布 Tab — 创建任务与Agent交互
- 用户**选择当前AI分身**后，在发布 Tab 以该分身身份创建任务需求
- LLM 结合分身偏好（User.md）生成针对性引导问题
- Agent 通过多轮对话收集结构化信息（Intake模块）
- 对话关键信息提取保存为 `task_summary.md`（可用于相似任务快速调用和历史回溯）
- 生成 `task.md`（YAML硬性条件 + Markdown偏好文档），任务进入FSM状态机
- 用户可随时在任务页面查看和修改 task.md

#### Part 2：Agent搜寻逻辑与数据链条（L0、L1、L2）
- **L0 硬过滤**：YAML部分的结构化字段快速筛选（interaction_type等），需设置屏蔽条件减少O(N²)开销
- **L1 语义检索**：对需求的事件(activity)、氛围(vibe)分别总结description，然后embedding搜索
- 向量存储在 PostgreSQL pgvector，三字段加权：targetActivity(0.35) + targetVibe(0.35) + rawDescription(0.30)
- **L2 Agent交流**：规定JSON schema格式交流，根据return字段判断结果，限制轮次防止超额消耗
  - Agent对对方task.md先生成CoT（写入scratchpad.md，不外发），再基于CoT回答
  - 对于己方未提及但对方有的偏好，Agent可反问用户展现在握手报告中
- 产出匹配报告（"已为您找到N个匹配结果"），开启双方对互相Agent的聊天权限

#### Part 3：消息 Tab — 消息 + 联系人四种交互（L2后续）
- **A人 - B人**：双方真人直接对话
- **A_Agent - B_Agent**：双方Agent自动协商（握手协议）
- **A_Agent - B人**：A的Agent主动联系B本人
- **A人 - B_Agent**：A本人和B的Agent交互

L2 完成 ACCEPT 后进入 Waiting_Human，用户可：
- 满意 → 向对方发送好友申请 → 出现在消息 Tab 联系人列表
- 不满意 → 修改 task.md 重新搜索
- 多次完善和精筛后 → 优化生成最终版 task.md

**高级功能**：对于多次被其他Agent握手的热门Agent，可开启"高度匹配"模式，大幅提高被申请互动的条件门槛。

---

## 四、合并后技术架构

### 4.1 目录结构（合并后完整结构）

> **架构原则**：`apps/` 是薄壳表现层（路由 + 平台适配），`packages/` 是核心资产库（业务逻辑、Agent、UI 全部可复用）。API 路由只做 HTTP 解析和转发，实际逻辑在 `@repo/core` 和 `@repo/agent` 中。

```
Cosoul.AI/
├── apps/                                    # ── 表现层（薄壳，平台特定适配）──
│   ├── web/                                 # Next.js 16 Web端
│   │   ├── app/
│   │   │   ├── api/                         # HTTP 路由入口（薄壳，调用 @repo/core + @repo/agent）
│   │   │   │   ├── persona/route.ts         # [新增] 分身 CRUD → core.personaService
│   │   │   │   ├── persona/[id]/route.ts    # [新增] 单分身操作
│   │   │   │   ├── task/route.ts            # [新增] 任务 CRUD → core.taskService
│   │   │   │   ├── task/[id]/route.ts       # [新增] 单任务操作
│   │   │   │   ├── task/[id]/run/route.ts   # [新增] FSM步进 → agent.taskAgent.runStep()
│   │   │   │   ├── task/[id]/intent/route.ts# [新增] 用户意图 → agent.taskAgent.handleIntent()
│   │   │   │   ├── contact/route.ts         # [新增] 联系人 → core.contactService
│   │   │   │   ├── handshake/route.ts       # [新增] 握手入口 → agent.taskAgent.protocol
│   │   │   │   ├── llm/chat/route.ts        # [新增] LLM对话 → agent.shared.llm
│   │   │   │   └── embedding/route.ts       # [新增] Embedding → agent.shared.rag
│   │   │   ├── home/page.tsx                # [新增] 首页（预留）
│   │   │   ├── discover/page.tsx            # [新增] 发现（预留）
│   │   │   ├── publish/page.tsx             # [改造] 发布（创建Task）
│   │   │   ├── messages/page.tsx            # [改造] 消息+联系人
│   │   │   └── profile/page.tsx             # [改造] 个人主页
│   │   ├── components/                      # Web 专属组件
│   │   │   ├── AppShell.tsx                 # ThemeProvider + 分栏布局壳
│   │   │   └── Sidebar.tsx                  # 液态玻璃侧边栏
│   │   ├── stubs/                           # Web端原生模块 Stub
│   │   ├── styles/global.css
│   │   └── next.config.js                   # Turbopack + 模块别名
│   │
│   └── native/                              # Expo 55 移动端
│       ├── app/                             # Expo Router 文件路由
│       │   ├── _layout.tsx                  # 根布局（ThemeProvider + Stack）
│       │   ├── index.tsx                    # 入口重定向 → (tabs)/feed
│       │   ├── settings.tsx                 # 设置页（Stack modal）
│       │   ├── task/[id].tsx                # [新增] 任务详情页（Stack push）
│       │   ├── chat/[id].tsx                # [新增] 聊天详情页（Stack push）
│       │   └── (tabs)/                      # Tab 导航组
│       │       ├── _layout.tsx              # Tab布局（LiquidTabBar）
│       │       ├── feed.tsx                 # 首页 → FeedScreen（预留）
│       │       ├── discover.tsx             # 发现 → DiscoverScreen（预留）
│       │       ├── publish.tsx              # [改造] 发布 → PublishScreen
│       │       ├── messages.tsx             # [改造] 消息 → MessageScreen
│       │       └── profile.tsx              # [改造] 我的 → ProfileScreen
│       ├── lib/                             # Native 端工具层
│       │   ├── api.ts                       # API客户端（baseURL → Web后端）
│       │   └── platform.ts                  # 平台适配（推送通知、相机等）
│       ├── app.json
│       └── package.json
│
├── packages/                                # ── 核心资产库（共享的包，Web+Native 复用）──
│   ├── ui/                                  # @repo/ui — 跨平台 UI 组件库
│   │   └── src/
│   │       ├── index.tsx                    # 统一导出入口
│   │       ├── theme/
│   │       │   └── ThemeContext.tsx          # 主题系统（Light/Dark/System）
│   │       ├── components/
│   │       │   ├── TabIcons.tsx             # 跨平台 SVG 图标集
│   │       │   └── LiquidTabBar.tsx         # Native 液态玻璃底部导航
│   │       └── screens/                     # 共享 Screen（Web + Native 复用）
│   │           ├── FeedScreen.tsx           # 首页（预留）
│   │           ├── DiscoverScreen.tsx       # 发现（预留）
│   │           ├── PublishScreen.tsx        # [改造] 发布中心
│   │           ├── TaskCreateScreen.tsx     # [新增] 创建任务（Intake对话）
│   │           ├── MessageScreen.tsx        # [改造] 消息+联系人
│   │           ├── AgentChatScreen.tsx      # [新增] Agent对话
│   │           ├── TaskDetailScreen.tsx     # [新增] 任务详情
│   │           ├── ProfileScreen.tsx        # [改造] 个人主页
│   │           └── SettingsScreen.tsx       # 设置
│   │
│   ├── core/                                # @repo/core — 共享业务逻辑 + 数据层
│   │   └── src/
│   │       ├── index.ts                     # 统一导出
│   │       ├── db/                          # 数据库连接与表定义
│   │       │   ├── client.ts               # Drizzle ORM + pg 连接池
│   │       │   └── schema.ts               # Drizzle 表定义（users, personas, tasks, contacts, ...）
│   │       ├── services/                    # 业务服务层（被 API路由 + Agent 共同调用）
│   │       │   ├── persona.service.ts      # 分身 CRUD + User.md ↔ persona_profiles 同步
│   │       │   ├── task.service.ts         # 任务 CRUD + task.md 两阶段原子写
│   │       │   ├── contact.service.ts      # 联系人管理 + AI好友备注
│   │       │   └── chat.service.ts         # 聊天消息存取（四种模式）
│   │       ├── storage/                     # 文件层持久化
│   │       │   ├── task-md.ts              # task.md YAML+Markdown 序列化/反序列化
│   │       │   └── file-store.ts           # .data/<persona_id>/ 目录读写工具
│   │       └── types/                       # 共享 TypeScript 类型定义
│   │           └── index.ts                # TaskDocument, Persona, Contact, AgentMessage 等
│   │
│   ├── agent/                               # @repo/agent — Agent 智能体总包
│   │   └── src/
│   │       ├── index.ts                     # 统一导出
│   │       │
│   │       ├── shared/                      # ── Agent 共享基础设施 ──
│   │       │   ├── llm/                     # 多厂商 LLM 适配
│   │       │   │   ├── base-model.ts        # BaseModel 抽象类（chatOnce/chatStream/countTokens）
│   │       │   │   ├── openai-provider.ts   # OpenAI 适配
│   │       │   │   ├── claude-provider.ts   # Claude 适配
│   │       │   │   ├── qwen-provider.ts     # Qwen 适配（DashScope 接口）
│   │       │   │   ├── provider-registry.ts # Provider 注册与单例缓存
│   │       │   │   └── conversation.ts      # 多轮/单轮对话封装
│   │       │   ├── rag/                     # Embedding + 向量检索
│   │       │   │   ├── embedding.ts         # DashScope text-embedding-v4 封装
│   │       │   │   └── retrieval.ts         # pgvector 向量搜索与加权聚合
│   │       │   └── memory/                  # 记忆系统
│   │       │       ├── context.ts           # Token 预算与 Prompt 构建
│   │       │       └── memory.ts            # 记忆压缩（flush）与归档
│   │       │
│   │       ├── task-agent/                  # ── 任务匹配 Agent（核心）──
│   │       │   ├── fsm/                     # 状态机
│   │       │   │   ├── schema.ts            # Zod Schema + 枚举 + 迁移表
│   │       │   │   ├── transitions.ts       # 状态迁移校验与执行
│   │       │   │   └── task-loop.ts         # FSM 引擎（单步推进 + 状态分发）
│   │       │   ├── dispatcher/              # L0/L1/L2 三层漏斗
│   │       │   │   ├── dispatcher.ts        # 撮合总线（编排 L0→L1→L2）
│   │       │   │   ├── l0-filter.ts         # 硬过滤（SQL WHERE 条件）
│   │       │   │   ├── l1-retrieval.ts      # 语义检索（pgvector 加权排序）
│   │       │   │   └── l2-sandbox.ts        # 沙盒谈判（Agent↔Agent CoT推理）
│   │       │   ├── protocol/                # 握手协议
│   │       │   │   ├── handshake.ts         # 握手收发 + 超时重试
│   │       │   │   └── idempotency.ts       # 幂等控制（7天窗口）
│   │       │   └── intake/                  # 需求收集
│   │       │       └── intake.ts            # 多轮对话 → 结构化字段提取
│   │       │
│   │       ├── persona-agent/               # ── 人格管理 Agent（预留）──
│   │       │   └── index.ts                 # User.md 自动生成/更新、性格推理、偏好学习
│   │       │
│   │       └── social-agent/                # ── 社交互动 Agent（预留）──
│   │           └── index.ts                 # 主动刷贴、评论、内容推荐、动态生成
│   │
│   └── typescript-config/                   # 共享 TypeScript 配置
│
├── .data/                                   # Agent 本地数据（per-persona 目录）
│   └── <persona_id>/
│       ├── User.md                          # 人格偏好档案
│       ├── raw_chats_summary/               # 精炼摘要（参与 Embedding/RAG）
│       ├── logs/                            # 操作日志
│       └── task_agents/
│           └── <task_id>/
│               ├── task.md                  # YAML头 + Markdown正文（唯一真相源）
│               ├── task_summary.md          # 关键信息标签总结（可跨任务复用）
│               └── data/                    # 任务专属数据
│                   ├── daily_log/           # 操作日志
│                   ├── agent_chat/          # Agent握手聊天记录 + scratchpad
│                   └── agent_chat_summary/  # 握手总结报告
├── .devcontainer/                           # 云开发环境配置
├── docs/                                    # 项目文档
└── drizzle.config.ts                        # 数据库迁移配置
```

#### 架构分层说明

```
apps/web ──────────┐
                   ├──→ packages/ui     (@repo/ui)     # 共享 UI
apps/native ───────┤
                   ├──→ packages/core   (@repo/core)   # 业务逻辑 + 数据层
                   │         │
                   └──→ packages/agent  (@repo/agent)  # Agent 智能体
                              │
                              ├──→ @repo/core（调用 services + DB）
                              ├──→ OpenAI / Claude / Qwen LLM
                              └──→ DashScope Embedding + pgvector
```

- **`apps/web/app/api/`** = 薄壳 HTTP 路由，只做请求解析 + 调用 `@repo/core` / `@repo/agent` + 返回响应
- **`packages/core/`** = 所有业务 CRUD、DB 操作、文件层读写、类型定义，Web 和 Native 都可复用
- **`packages/agent/`** = Agent 总包，`shared/` 提供 LLM/RAG/Memory 公共设施，各子 Agent 独立开发互不耦合
- **`apps/native/lib/api.ts`** = Native 端通过 HTTP 调用 Web 后端 API，不直接引用 `@repo/core` 的 DB 层

### 4.2 存储架构：文件层 + PostgreSQL 双层映射

#### 文件层（per-persona，本地/对象存储）

每个AI分身拥有独立的 `.data/<persona_id>/` 目录：

```
.data/
├── <persona_id>/                              # 某个AI分身的全部数据
│   ├── User.md                                # 用户注册信息、偏好、核心设定（全局作用于该分身）
│   ├── raw_chats_summary/                     # 精炼后的语义记忆（参与Embedding，用于RAG）
│   │   ├── YYYY-MM-DD-summary.md              # 含 source_log_id 指向 raw_chats
│   │   └── ……
│   ├── logs/                                  # 该分身的操作日志
│   │   └── YYYY-MM-DD-sys.md
│   └── task_agents/                           # 任务实例目录
│       ├── <task_id>/
│       │   ├── task.md                        # YAML(硬性条件给机器) + Markdown(偏好给模型)
│       │   ├── task_summary.md                # 对话提取的关键信息标签总结（可复用于相似任务）
│       │   └── data/                          # 任务专属局部记忆/对接日志
│       │       ├── daily_log/
│       │       │   ├── YYYY-MM-DD-handshake.md   # Agent对接操作日志
│       │       │   └── ……
│       │       ├── agent_chat/
│       │       │   ├── YYYY-MM-DD-agentchat-1.md # Agent握手聊天记录
│       │       │   └── YYYY-MM-DD-scratchpad.md  # Agent思考CoT对白（不外发）
│       │       └── agent_chat_summary/
│       │           └── YYYY-MM-DD-agentchat-1-sum.md  # 握手记录总结报告（可回溯）
│       ├── raw_chats/                         # 用户对话原始流水账（不参与Embedding，仅作回溯凭证）
│       │   ├── YYYY-MM-DD.md                  # 用户和Agent的对话（自己Agent + 对方Agent）
│       │   └── ……                             # 可总结用户偏好
│       └── <task_id_2>/
│           └── ……
└── <persona_id_2>/
    └── ……
```

#### PostgreSQL 层（结构化数据 + 向量索引）

文件层的结构化数据同步到 PostgreSQL 作为派生层，支持高效查询和向量检索：

```sql
-- 用户表
users (user_id, email, created_at, ...)

-- AI分身表（一个用户多个分身）
personas (persona_id, user_id, name, avatar, bio, settings(jsonb), created_at, updated_at)

-- 分身偏好档案（User.md 的结构化派生）
persona_profiles (persona_id, profile_text, preferences(jsonb), updated_at)

-- 任务表（属于某个分身）
tasks (task_id, persona_id, status, interaction_type, current_partner_id,
       raw_description, target_activity, target_vibe, detailed_plan,
       entered_status_at, created_at, updated_at, version, pending_sync, hidden)

-- 任务摘要（task_summary.md 的派生，可用于相似任务快速调用）
task_summaries (task_id, summary_text, tags(jsonb), created_at)

-- 任务向量（embedding索引，保留在DB中加速检索）
task_vectors (task_id, field, embedding vector(1024), model, updated_at)
  → HNSW索引: CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)

-- 联系人表（分身级别好友关系）
contacts (id, persona_id, friend_persona_id, status, ai_note, source_task_id, created_at)

-- 握手日志
handshake_logs (id, task_id, direction, envelope(jsonb), timestamp)

-- 幂等记录
idempotency_keys (key, response(jsonb), created_at)  → TTL索引7天

-- 聊天消息（所有类型：人-人、Agent-Agent、Agent-人、人-Agent）
chat_messages (id, task_id, persona_id, sender_type, sender_id, content, metadata(jsonb), created_at)

-- 记忆摘要（raw_chats_summary 的派生）
memory_summaries (id, persona_id, task_id, summary_text, source_log_id, turn_count, created_at)
  → 参与Embedding的摘要同时写入 task_vectors 表，用于RAG检索
```

**文件层 ↔ PostgreSQL 映射原则：**
- `task.md` = 唯一真相源，PostgreSQL 为可重建的派生层
- `User.md` 修改 → 同步更新 `persona_profiles` 表
- `task_summary.md` → 同步 `task_summaries` 表（支持跨任务复用查询）
- `raw_chats_summary/*.md` → 同步 `memory_summaries` 表（参与 Embedding 的摘要同时写入 `task_vectors`）
- `agent_chat/` 和 `agent_chat_summary/` → 同步 `chat_messages` 和 `handshake_logs`（可回溯）
- `raw_chats/` → 仅存文件层，不入库（纯回溯凭证，降低DB负担）
- Embedding 数据 → 仅存 PostgreSQL pgvector（不落地文件，索引即数据）

### 4.3 BaseModel 多厂商适配架构

```
┌─────────────────────────────────────────┐
│            Agent / 业务调用方             │
│     chat(role, data) / embed(text)      │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│          BaseModel (抽象类)              │
│  - chatOnce(messages): Promise<string>  │
│  - chatStream(messages): AsyncGenerator │
│  - countTokens(text): number            │
│  - conversation(): Conversation         │
└──────────────┬──────────────────────────┘
               │
    ┌──────────┼──────────┐
    ▼          ▼          ▼
┌────────┐ ┌────────┐ ┌────────┐
│ OpenAI │ │ Claude │ │  Qwen  │
│Provider│ │Provider│ │Provider│
└────────┘ └────────┘ └────────┘
```

**标准数据格式：**
```typescript
interface AgentMessage {
  role: "system" | "user" | "assistant";
  data: any; // 文本、JSON、图片等
}
```

以 OpenAI 格式为标准，定义 BaseModel 类统一接口，各Provider负责适配差异（如Claude的system字段独立传递）。

### 4.4 数据流总览

```
用户选择AI分身 → 发布Tab创建任务 → Intake(多轮对话,结合User.md) → task.md + task_summary.md (Drafting)
                                    │
                              ┌─────▼─────┐
                              │ Searching │
                              └─────┬─────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
                L0 硬过滤      L1 Embedding       向量搜索
               (PostgreSQL)    (DashScope)    (pgvector索引)
                    │               │               │
                    └───────────────┼───────────────┘
                                    ▼
                               候选池 Top-K
                                    │
                              ┌─────▼──────┐
                              │ Negotiating│ ← L2 Agent对Agent谈判
                              └─────┬──────┘
                                    │
                                双方ACCEPT
                                    │
                           ┌────────▼────────┐
                           │ Waiting_Human   │
                           └────────┬────────┘
                                    │
                        ┌───────────┼───────────┐
                        ▼           ▼           ▼
                     满意→Closed→好友申请→消息Tab联系人  不满→Revising  挂起→Listening
```

---

## 五、核心技术要点

### 5.1 大模型接口调用适配
- 定义 `BaseModel` 抽象类，以 OpenAI 格式为标准
- 实现 `OpenAIProvider`、`ClaudeProvider`、`QwenProvider` 三个适配器
- `ProviderRegistry` 单例缓存，按 `${provider}:${model}` 键管理
- 支持**多轮对话**（task.md生成、Agent谈判）和**单次对话**（summary、L2研判）
- Skill Router 和 Parser 预留接口（后续扩展）

### 5.2 Embedding与向量搜索
- 使用 DashScope `text-embedding-v4` 模型
- 对 targetActivity、targetVibe、rawDescription 三个字段分别 Embedding
- 向量存储在 PostgreSQL pgvector 列（`vector(1024)` 类型）
- 使用 pgvector 原生距离运算符 `<=>` (余弦距离) 进行向量检索，支持 HNSW/IVFFlat 索引加速
- 加权聚合三字段分数（0.35/0.35/0.30），高并发下性能远优于暴力遍历

### 5.3 存储与数据一致性
- `task.md` YAML头 + Markdown正文 = 唯一真相源
- PostgreSQL 为派生层，可从 task.md 全量重建
- 两阶段原子写：先写task.md(pending_sync=true)，再写PostgreSQL，成功后清标记
- 失败进入 `sync_repair_queue` 补偿队列
- 乐观锁（version字段）防并发冲突
- PostgreSQL MVCC 天然支持高并发读写，无单写锁瓶颈

### 5.4 记忆与上下文管理（Memory Flush 策略）
- 整体采用 **memory flush** 策略：对将要达到上下文限制的对话进行压缩总结
- Token预算控制，超阈值(80%)触发 flush
- 压缩总结提取有用信息补充 task.md 与 User.md
- 原始对话归档到 `raw_chats/`（仅回溯凭证，不参与 Embedding）
- 精炼摘要存入 `raw_chats_summary/`（参与 Embedding，用于 RAG 检索）
- 截断策略：保留最新对话，丢弃最旧对话

### 5.5 多分身 × 任务多开 独立状态追踪
- 每个**分身**有独立的 User.md 和数据目录
- 每个分身下可创建多个任务，每个任务有独立的 task.md
- FSM状态机独立运行，分身间、任务间互不干扰
- 支持待机(Listening)和运行模式切换
- 通过 `persona_id + task_id` 做全局唯一标识
- task_summary.md 可跨任务复用（相似任务快速调用）

### 5.6 四种消息交互模式
| 模式 | 发起方 | 接收方 | 实现方式 |
|------|--------|--------|----------|
| A人-B人 | 真人 | 真人 | 常规IM聊天 |
| A_Agent-B_Agent | Agent | Agent | 握手协议JSON自动谈判 |
| A_Agent-B人 | Agent | 真人 | Agent发起 → 推送通知 → 人回复 |
| A人-B_Agent | 真人 | Agent | 人发消息 → Agent LLM响应 |

---

## 六、已完成的基础能力（来自Task-Agents_ai）

- [x] 阿里千问平台API调用跑通
- [x] 多厂商大模型适配（OpenAI / Claude / Qwen Provider）
- [x] 模拟后端数据库（原SQLite，将迁移至PostgreSQL + pgvector）
- [x] 向量匹配（Embedding + 余弦相似度检索）
- [x] 数据存储（task.md + 数据库两阶段写入）
- [x] FSM状态机基础逻辑
- [x] Intake多轮对话收集
- [x] Zod Schema类型校验
- [x] 握手协议v1.0 + 幂等处理
- [x] 记忆压缩基础功能
- [x] Listener HTTP网关
- [x] 基础测试套件（schema/embedding/llm/idempotency/intake）

---

## 七、待完成的工作模块

### @repo/core — 业务逻辑 + 数据层（`packages/core/`）
- [ ] `db/schema.ts` — Drizzle 表定义（users, personas, tasks, contacts, task_vectors 等）
- [ ] `db/client.ts` — PostgreSQL + pgvector 连接池初始化
- [ ] `services/persona.service.ts` — 分身 CRUD + User.md ↔ persona_profiles 同步
- [ ] `services/task.service.ts` — 任务 CRUD + task.md 两阶段原子写 + 乐观锁 + 补偿队列
- [ ] `services/contact.service.ts` — 联系人管理 + AI好友备注
- [ ] `services/chat.service.ts` — 聊天消息存取（四种模式）
- [ ] `storage/task-md.ts` — task.md YAML+Markdown 序列化/反序列化
- [ ] `storage/file-store.ts` — .data/ per-persona 目录初始化与读写
- [ ] `types/index.ts` — 共享类型定义（TaskDocument, Persona, AgentMessage 等）

### @repo/agent — Agent 智能体总包（`packages/agent/`）

#### shared/ — 共享基础设施
- [ ] `shared/llm/base-model.ts` — BaseModel 抽象类 + AgentMessage 标准格式
- [ ] `shared/llm/` — OpenAI / Claude / Qwen 三家 Provider + ProviderRegistry 单例
- [ ] `shared/rag/embedding.ts` — DashScope Embedding API 封装
- [ ] `shared/rag/retrieval.ts` — pgvector 向量搜索与加权聚合
- [ ] `shared/memory/` — Token预算 + memory flush + 对话压缩归档

#### task-agent/ — 任务匹配 Agent
- [ ] `task-agent/fsm/` — FSM 状态机（9状态 + 迁移表 + Zod Schema）
- [ ] `task-agent/dispatcher/` — L0硬过滤 + L1语义检索 + L2沙盒谈判 完整链路
- [ ] `task-agent/protocol/` — 握手协议 + 幂等处理
- [ ] `task-agent/intake/` — 多轮对话需求收集（结合 User.md 偏好）
- [ ] 握手报告生成（"已为您找到N个匹配结果"）
- [ ] 多分身 × 任务多开 独立状态追踪
- [ ] startTask 和 listener 逻辑编排（冲突处理）
- [ ] 高度匹配模式（热门Agent可开启高门槛过滤）

#### persona-agent/ — 人格管理 Agent（预留）
- [ ] User.md 自动生成/更新、性格推理、偏好学习

#### social-agent/ — 社交互动 Agent（预留）
- [ ] 主动刷贴、评论、内容推荐、动态生成

### 前端交互层
- [ ] 首页 Tab — AI 社区首页（预留，当前版本 placeholder）
- [ ] 发现 Tab — 发现/动态信息流（预留，当前版本 placeholder）
- [ ] 发布 Tab — 创建新 Task（Intake 对话）；未来扩展发帖、视频等多媒体发布
- [ ] 消息 Tab — 顶部分身切换器 + 消息列表 + 联系人列表 + 好友请求 + 四种交互模式
- [ ] 我的 Tab — 分身管理 + 展示面编辑 + User.md 查看修改
- [ ] Waiting_Human阶段产品逻辑（满意→好友申请→联系人）
- [ ] Agent对话实时展示（SSE流式）

### Skills与扩展
- [ ] skills.md Agent性格文本设定
- [ ] Skill Router预留接口
- [ ] Prompt模板与Agent性格协同

---

## 八、技术依赖总结

### 需要新增的依赖

**@repo/core（`packages/core`）**：
| 包名 | 用途 |
|------|------|
| `pg` | PostgreSQL 原生驱动 |
| `drizzle-orm` | 类型安全 ORM（轻量，SQL-first） |
| `drizzle-kit` | 数据库迁移工具（devDependency） |
| `pgvector` | pgvector JS 绑定（向量类型序列化） |
| `zod` | 运行时Schema校验 |
| `dotenv` | 环境变量加载 |
| `uuid` | 生成task_id和message_id |

**@repo/agent（`packages/agent`）**：
| 包名 | 用途 |
|------|------|
| `@repo/core` | workspace 引用，调用 services + DB |
| `openai` | OpenAI SDK（同时用于Qwen兼容调用） |
| `zod` | 运行时Schema校验 |

### 需要的环境变量
```env
DATABASE_URL=postgresql://user:pass@localhost:5432/cosoul_agent  # PostgreSQL连接串
DASHSCOPE_API_KEY=xxx          # 阿里千问/Embedding
OPENAI_API_KEY=xxx             # OpenAI (可选)
ANTHROPIC_API_KEY=xxx          # Claude (可选)
DEFAULT_LLM_PROVIDER=qwen     # 默认Provider
DEFAULT_LLM_MODEL=qwen3-max   # 默认模型
```

---

## 九、风险与注意事项

1. **架构原有功能已清理** — 合并时只关注核心Agent模块，原有非相关功能已移除
2. **前后端对齐** — Agent核心逻辑先在后端跑通，再对接前端UI
3. **多分身 × 任务多开** — 需确保分身隔离 + 任务FSM独立，避免状态串扰
4. **Token成本** — 多轮对话 + L2谈判 + memory flush 会消耗大量Token，需做好预算控制
5. **数据库运维** — PostgreSQL 需要独立部署（本地开发可用 Docker Compose，生产环境推荐云托管如 Supabase/Neon/阿里云RDS）
6. **N² 握手开销** — L2阶段 Agent 互相交流的组合数可能爆炸，需通过L0/L1充分过滤 + 屏蔽条件 + 高度匹配模式控制
7. **文件层一致性** — per-persona 文件目录可能在多端同时修改，需通过 PostgreSQL 乐观锁保证一致性
8. **User.md 隐私边界** — Agent 代理交流时需严格控制暴露给对方的信息范围（CoT/scratchpad 绝不外发）
