# TaskAgent 模块合并至 Cosoul.AI — 项目简介与任务总览

> 版本：v1.0 | 日期：2026-03-09

---

## 一、项目背景

### 1.1 Cosoul.AI（基础架构 — TS全栈）

Cosoul.AI 是一个基于 **Turborepo** 的 TypeScript 全栈单体仓库，采用跨平台架构：

| 层级 | 技术栈 | 说明 |
|------|--------|------|
| Web 端 | Next.js 16 + React 19 + Turbopack | App Router, SSE流式输出 |
| 移动端 | Expo 55 + React Native 0.83 | expo-router 文件路由 |
| 共享UI | @repo/ui (packages/ui) | 跨平台Screen组件、主题系统 |
| 构建工具 | Turborepo + tsup + npm workspaces | 任务编排与包管理 |

**现有页面结构（5 Tab）：**
- `/feed` — 瀑布流信息流
- `/cards` — 发现卡片
- `/ai-core` — AI核心交互区（已有LLM调用 + SSE基础设施）
- `/messages` — 消息/公告（待改造为Agent交互页）
- `/profile` — 个人主页

**现有能力：**
- OpenAI兼容格式的LLM API调用（阿里千问/Kimi）
- SSE流式文本输出（Web端）+ 非流式回退（移动端）
- 跨平台主题系统（Light/Dark/System）
- DevContainer云开发环境
- 液态玻璃风格 UI（Sidebar + LiquidTabBar）

### 1.2 Task-Agents_ai（Agent灵魂分身模块 — 待合并）

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

## 二、合并目标

将 Task-Agents_ai 的 Agent 灵魂分身模块整合进 Cosoul.AI，形成完整的**"需求发布 → Agent自动匹配 → 消息交互"**闭环。

### 2.1 合并三大部分

```
┌─────────────────────────────────────────────────────────┐
│                    Cosoul.AI + TaskAgent                  │
│                                                          │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐ │
│  │  Part 1       │   │  Part 2       │   │  Part 3       │ │
│  │  发布需求页面  │──→│  Agent搜寻    │──→│  消息页面      │ │
│  │  + Agent交互  │   │  L0/L1数据链  │   │  四种交互逻辑  │ │
│  └──────────────┘   └──────────────┘   └──────────────┘ │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │              底层基础设施                            │  │
│  │  BaseModel多厂商适配 │ Embedding │ Storage │ Memory  │  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

#### Part 1：发布需求（发帖）页面与Agent交互
- 用户在前端创建任务需求（类似发帖）
- Agent通过多轮对话收集结构化信息（Intake模块）
- 生成task.md，包含rawDescription、targetActivity、targetVibe、detailedPlan
- 任务进入FSM状态机流转

#### Part 2：Agent搜寻逻辑与数据链条（L0、L1）
- **L0 硬过滤**：基于interaction_type等结构化字段快速筛选
- **L1 语义检索**：Embedding向量化 + 余弦相似度匹配
- 向量存储在 PostgreSQL pgvector，支持三个字段加权：targetActivity(0.35) + targetVibe(0.35) + rawDescription(0.30)
- 产出候选池，送入L2谈判

#### Part 3：消息页面Agent与人的四种交互（L2）
- **A人 - B人**：双方都是真人直接对话
- **A_Agent - B_Agent**：双方Agent自动协商（握手协议）
- **A_Agent - B人**：A的Agent主动联系B本人
- **A人 - B_Agent**：A本人和B的Agent交互

L2阶段完成ACCEPT后进入Waiting_Human，等待真人确认。

---

## 三、合并后技术架构

### 3.1 目录结构（新增部分）

```
Cosoul.AI/
├── apps/
│   └── web/
│       └── app/
│           ├── api/
│           │   ├── critique/route.ts          # (已有) LLM调用基础设施
│           │   ├── task/route.ts              # [新增] 任务CRUD API
│           │   ├── task/[id]/route.ts         # [新增] 单任务操作
│           │   ├── task/[id]/run/route.ts     # [新增] 执行FSM步进
│           │   ├── task/[id]/intent/route.ts  # [新增] 用户意图处理
│           │   ├── handshake/route.ts         # [新增] 握手协议入口
│           │   ├── llm/chat/route.ts          # [新增] LLM通用对话
│           │   └── embedding/route.ts         # [新增] Embedding服务
│           ├── publish/page.tsx               # [新增] 发布需求页
│           └── messages/page.tsx              # [改造] 消息交互页
│
├── packages/
│   ├── ui/src/
│   │   └── screens/
│   │       ├── PublishScreen.tsx              # [新增] 发布需求UI
│   │       ├── MessageScreen.tsx              # [改造] 消息交互UI
│   │       ├── TaskDetailScreen.tsx           # [新增] 任务详情UI
│   │       └── AgentChatScreen.tsx            # [新增] Agent对话UI
│   │
│   └── task-agent/                            # [新增] Agent核心包
│       ├── src/
│       │   ├── index.ts                       # 统一导出
│       │   ├── fsm/
│       │   │   ├── schema.ts                  # Zod Schema + 类型定义
│       │   │   ├── transitions.ts             # 状态迁移函数
│       │   │   └── task-loop.ts               # 状态机引擎
│       │   ├── dispatcher/
│       │   │   ├── dispatcher.ts              # L0/L1/L2 撮合总线
│       │   │   ├── l0-filter.ts               # 硬过滤逻辑
│       │   │   ├── l1-retrieval.ts            # 语义检索逻辑
│       │   │   └── l2-sandbox.ts              # 沙盒谈判逻辑
│       │   ├── llm/
│       │   │   ├── base-model.ts              # BaseModel抽象类
│       │   │   ├── openai-provider.ts         # OpenAI适配
│       │   │   ├── claude-provider.ts         # Claude适配
│       │   │   ├── qwen-provider.ts           # Qwen适配
│       │   │   ├── provider-registry.ts       # Provider注册与缓存
│       │   │   └── conversation.ts            # 多轮/单轮对话封装
│       │   ├── rag/
│       │   │   ├── embedding.ts               # Embedding API封装
│       │   │   └── retrieval.ts               # 向量搜索与聚类
│       │   ├── protocol/
│       │   │   ├── handshake.ts               # 握手协议处理
│       │   │   └── idempotency.ts             # 幂等控制
│       │   ├── storage/
│       │   │   ├── storage.ts                 # 持久化防腐层
│       │   │   ├── db.ts                      # PostgreSQL连接与操作（Drizzle ORM）
│       │   │   ├── schema.db.ts               # Drizzle数据库表定义
│       │   │   └── task-md.ts                 # task.md读写解析
│       │   ├── memory/
│       │   │   ├── context.ts                 # Token预算与Prompt构建
│       │   │   └── memory.ts                  # 记忆压缩与归档
│       │   ├── intake/
│       │   │   └── intake.ts                  # 多轮对话需求收集
│       │   └── skills/
│       │       └── skill-router.ts            # Skill路由（预留）
│       ├── package.json
│       └── tsconfig.json
│
├── .data/                                     # [新增] Agent数据目录
│   ├── User.md                                # 用户画像
│   ├── task_agents/                           # 任务数据
│   └── logs/                                  # 系统日志
│   # PostgreSQL + pgvector 为外部数据库服务（通过 DATABASE_URL 连接）
```

### 3.2 BaseModel 多厂商适配架构

```
┌─────────────────────────────────────────┐
│            Agent / 业务调用方              │
│     chat(role, data) / embed(text)       │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│          BaseModel (抽象类)               │
│  - chatOnce(messages): Promise<string>   │
│  - chatStream(messages): AsyncGenerator  │
│  - countTokens(text): number             │
│  - conversation(): Conversation          │
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

### 3.3 数据流总览

```
用户发帖 → Intake(多轮对话) → task.md(Drafting)
                                    │
                              ┌─────▼─────┐
                              │ Searching  │
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
                              │ Negotiating │ ← L2 Agent对Agent谈判
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
                     满意→Closed  不满→Revising  挂起→Listening
```

---

## 四、核心技术要点

### 4.1 大模型接口调用适配
- 定义 `BaseModel` 抽象类，以 OpenAI 格式为标准
- 实现 `OpenAIProvider`、`ClaudeProvider`、`QwenProvider` 三个适配器
- `ProviderRegistry` 单例缓存，按 `${provider}:${model}` 键管理
- 支持**多轮对话**（task.md生成、Agent谈判）和**单次对话**（summary、L2研判）
- Skill Router 和 Parser 预留接口（后续扩展）

### 4.2 Embedding与向量搜索
- 使用 DashScope `text-embedding-v4` 模型
- 对 targetActivity、targetVibe、rawDescription 三个字段分别 Embedding
- 向量存储在 PostgreSQL pgvector 列（`vector(1024)` 类型）
- 使用 pgvector 原生距离运算符 `<=>` (余弦距离) 进行向量检索，支持 HNSW/IVFFlat 索引加速
- 加权聚合三字段分数（0.35/0.35/0.30），高并发下性能远优于暴力遍历

### 4.3 存储与数据一致性
- `task.md` YAML头 + Markdown正文 = 唯一真相源
- PostgreSQL 为派生层，可从 task.md 全量重建
- 两阶段原子写：先写task.md(pending_sync=true)，再写PostgreSQL，成功后清标记
- 失败进入 `sync_repair_queue` 补偿队列
- 乐观锁（version字段）防并发冲突
- PostgreSQL MVCC 天然支持高并发读写，无单写锁瓶颈

### 4.4 记忆与上下文管理
- Token预算控制，超阈值(80%)触发 memory flush
- 调用LLM生成对话摘要(summary)
- 原始对话归档到 raw_chats/，摘要存入 raw_chats_summary/
- 截断策略：保留最新对话，丢弃最旧对话

### 4.5 任务多开与独立状态追踪
- 每个任务有独立的 task.md 和数据目录
- FSM状态机独立运行，互不干扰
- 支持待机(Listening)和运行模式切换
- 通过 task_id 做全局唯一标识

### 4.6 四种消息交互模式
| 模式 | 发起方 | 接收方 | 实现方式 |
|------|--------|--------|----------|
| A人-B人 | 真人 | 真人 | 常规IM聊天 |
| A_Agent-B_Agent | Agent | Agent | 握手协议JSON自动谈判 |
| A_Agent-B人 | Agent | 真人 | Agent发起 → 推送通知 → 人回复 |
| A人-B_Agent | 真人 | Agent | 人发消息 → Agent LLM响应 |

---

## 五、已完成的基础能力（来自Task-Agents_ai）

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

## 六、待完成的工作模块

### 基础设施层
- [ ] BaseModel抽象类定义与多Provider注册机制迁移至Cosoul.AI
- [ ] Embedding API封装迁移与对接
- [ ] PostgreSQL + pgvector 初始化与数据库表结构搭建
- [ ] Storage防腐层适配Cosoul.AI后端路由
- [ ] task.md格式最终确定与解析函数

### Agent核心逻辑层
- [ ] L0筛查条件优化（当前仅online/offline/any）
- [ ] L1向量检索函数完善
- [ ] L2沙盒谈判与Agent握手完整流程
- [ ] Dispatcher L0→L1→L2 完整链路跑通
- [ ] Listener网络握手对接
- [ ] 任务多开与独立状态追踪
- [ ] startTask和listener逻辑编排（冲突处理）

### 上下文与记忆层
- [ ] Context Token计算（LLM自带token计算或4:1估算）
- [ ] 对话token控制 + memory flush联动
- [ ] 记忆压缩：LLM summary + storage存储
- [ ] Prompt模板编写

### 前端交互层
- [ ] 发布需求页面UI + Intake对话交互
- [ ] 消息页面改造 — 四种交互模式
- [ ] 任务详情页面
- [ ] Waiting_Human阶段产品逻辑跳转
- [ ] Agent对话实时展示（SSE流式）

### Skills与扩展
- [ ] skills.md Agent性格文本设定
- [ ] Skill Router预留接口
- [ ] Prompt模板与Agent性格协同

---

## 七、技术依赖总结

### 需要新增的依赖
| 包名 | 用途 |
|------|------|
| `pg` | PostgreSQL 原生驱动 |
| `drizzle-orm` | 类型安全 ORM（轻量，SQL-first） |
| `drizzle-kit` | 数据库迁移工具（devDependency） |
| `pgvector` | pgvector JS 绑定（向量类型序列化） |
| `zod` | 运行时Schema校验 |
| `openai` | OpenAI SDK（同时用于Qwen兼容调用） |
| `dotenv` | 环境变量加载 |
| `uuid` | 生成task_id和message_id |

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

## 八、风险与注意事项

1. **架构原有功能已清理** — 合并时只关注核心Agent模块，原有非相关功能已移除
2. **前后端对齐** — Agent核心逻辑先在后端跑通，再对接前端UI
3. **任务多开** — 需确保每个任务FSM独立，避免状态串扰
4. **Token成本** — 多轮对话 + L2谈判 会消耗大量Token，需做好预算控制
5. **数据库运维** — PostgreSQL 需要独立部署（本地开发可用 Docker Compose，生产环境推荐云托管如 Supabase/Neon/阿里云RDS）
