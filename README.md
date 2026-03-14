# Cosoul.AI — Agent 时代的 AI 社交社区

让私人 AI 替你全网交涉。基于**多智能体（Multi-Agent）** 架构，AI 之间进行自动化机对机（M2M）意图交涉，帮助人类精准匹配最契合的人与资源，实现 0 摩擦的社交与交易。

每位用户可创建**多个 AI 分身（Persona）**，每个分身代表独立人格，拥有独立偏好档案、任务列表和联系人——AI 替你找人、谈判、筛选，最终由真人确认达成连接。

项目专为云原生环境（GitHub Codespaces / 本地Docker）设计，采用 `TypeScript + Next.js + Expo` (Turborepo) 全栈架构，Web 端与移动端代码高度复用。

---

## 核心概念：AI 分身（Persona）

每个用户可以创建多个 AI 分身，每个分身代表一个独立人格：

```
用户 (1)
├── AI分身A "社交达人"     → User_A.md → [任务1, 任务2, 联系人...]
├── AI分身B "技术宅"       → User_B.md → [任务3, 联系人...]
└── AI分身C "健身搭子"     → User_C.md → [任务4, 任务5, 联系人...]
```

- 每个分身有独立的 `User.md`（人格偏好档案），Agent 基于此做决策
- 每个分身可独立发布任务、管理联系人、接收消息
- 分身之间数据隔离，前端可自由切换当前活跃分身

---

## 核心功能

### TaskAgent 智能匹配系统

用户选择 AI 分身后发布需求，Agent 自动完成三层漏斗匹配：

1. **发布需求** — 多轮 AI 对话收集需求（结合分身 User.md 偏好），生成 `task.md` + `task_summary.md`
2. **Agent 自动搜寻（L0/L1）** — L0 结构化硬过滤 + L1 向量语义检索（PostgreSQL pgvector）
3. **Agent 协商（L2）** — Agent 间自动握手谈判，CoT 推理写入 scratchpad（不外发），支持反问机制
4. **匹配确认** — 满意 → 发送好友申请 → 进入联系人；不满意 → 修改重新搜索

**四种消息交互模式：**
| 模式 | 说明 |
|------|------|
| 人 - 人 | 双方真人直接对话 |
| Agent - Agent | 双方 AI 自动协商（握手协议） |
| Agent - 人 | AI 代理主动联系对方 |
| 人 - Agent | 用户与对方 AI 交互 |

### 产品页面结构（5 Tab）

| Tab | 页面 | 功能 |
|-----|------|------|
| **首页** | AI 社区首页 | 未来 AI 社区入口（当前版本预留，后续承载社区核心功能） |
| **发现** | 发现/动态 | 未来关注的人/博主动态信息流（当前版本预留） |
| **发布** | 发布中心 | 创建新 Task 任务（当前核心功能）；未来扩展发帖、视频等多媒体发布 |
| **消息** | 消息 + 联系人 | 顶部分身切换器，切换后显示对应分身的任务消息和 Agent 聊天；含联系人列表与好友请求 |
| **我的** | 个人主页 | 分身管理、展示面编辑、偏好信息，可查看 AI 总结的用户侧写 User.md |

### 任务状态机（FSM）

每个任务独立追踪，每个分身下支持多任务并发：

```
选择分身 → 发布需求 → Drafting → Searching → Negotiating → Waiting_Human → Closed
                                                                 ↓
                                                         满意 → 好友申请 → 消息Tab联系人
                                                         不满意 → Revising → 重新搜索
                                                         挂起 → Listening（后台持续匹配）
```

**高级功能**：热门 Agent 可开启"高度匹配"模式，大幅提高被申请互动的条件门槛。

---

## 技术栈架构 (Turborepo Monorepo)

- **应用层 (`apps/`)**:
  - `apps/web`: Next.js 16 (App Router + Turbopack)，Web 端 + 后端 API 路由
  - `apps/native`: Expo 55 (React Native 0.83)，iOS/Android 原生应用
- **共享层 (`packages/`)**:
  - `packages/ui`: 跨平台 UI 组件库（@repo/ui），含主题系统、液态玻璃导航
  - `packages/core`: 共享业务逻辑+数据层（@repo/core），含 DB、Services、Storage、Types
  - `packages/agent`: Agent 智能体总包（@repo/agent），含 shared（LLM/RAG/Memory）+ task-agent + persona-agent + social-agent
- **数据层**:
  - PostgreSQL 18 + pgvector：用户、分身、任务、联系人、向量索引、握手记录
  - `.data/<persona_id>/` 文件层：per-persona 的 User.md、task.md（单一真相源）、对话记录
  - 双层映射：文件层 = 真相源，PostgreSQL = 可重建的派生层
- **AI 层**:
  - 多厂商 LLM 适配：OpenAI / Claude / Qwen（BaseModel 抽象，OpenAI 格式为标准）
  - DashScope text-embedding-v4：向量化引擎
  - pgvector HNSW 索引：三字段加权检索（activity 0.35 + vibe 0.35 + description 0.30）
- **开发环境**: Docker + GitHub Codespaces (Node.js, Expo CLI, PostgreSQL, ngrok)

---

## 快速开始（云原生环境 / SDK 55）

### 前置需求
- GitHub Codespaces 或本地 Docker + Dev Container
- （本地）VS Code + Dev Container Extension
- PostgreSQL 18 + pgvector 扩展（**Dev Container 已内置，无需手动安装**）

### 初次启动流程

1. **打开 Dev Container**（Codespaces 自动，或本地需执行 `Dev Containers: Reopen in Container`）
   - Dockerfile 会自动安装 Node.js、npm、Expo CLI、Git LFS 等工具
   - **Docker Compose 自动启动 PostgreSQL + pgvector 服务**（无需手动操作）
   - `app` 容器通过 `depends_on` + `healthcheck` 确保 DB 就绪后才启动

2. **安装依赖**
   ```bash
   npm install
   ```

3. **对齐 Expo 原生包版本**
   ```bash
   cd apps/native && npx expo install --fix && cd ../..
   ```
   - monorepo hoist 可能导致 Expo 原生包路径错位，此命令自动修正
   - **每次 `npm install` 或重装 `node_modules` 后都需要再跑一次**

4. **配置环境变量**
   ```bash
   cp .env.example .env
   ```
   填入必要的 API Key（`DATABASE_URL` 已在 Docker Compose 中自动注入，无需修改）：
   ```env
   DATABASE_URL=postgresql://cosoul:cosoul@db:5432/cosoul_agent  # 已自动注入
   DASHSCOPE_API_KEY=xxx          # 阿里千问/Embedding（必填）
   OPENAI_API_KEY=xxx             # OpenAI（可选）
   ANTHROPIC_API_KEY=xxx          # Claude（可选）
   DEFAULT_LLM_PROVIDER=qwen
   DEFAULT_LLM_MODEL=qwen3-max
   ```

5. **初始化数据库（建表 + 灌测试数据）**
   ```bash
   npm run db:reset
   ```
   这条命令会依次执行：
   - `drizzle-kit migrate` — 创建 11 张核心表 + pgvector HNSW 索引
   - `seed.ts` — 灌入测试数据（3 用户、7 分身、10 任务、聊天记录等）

6. **启动开发服务**
   ```bash
   npm run dev
   ```
   并行启动：
   - **Web (Next.js)**: http://localhost:3030
   - **Native Metro (Expo Tunnel)**: 终端输出二维码，用 Expo Go 扫码
   - **UI Package (tsup watch)**: 自动编译共享组件

### 预览方式

| 入口 | 说明 |
|------|------|
| http://localhost:3030 | Next.js Web 业务页面 |
| http://localhost:8089 | React Native 的浏览器渲染版（Expo Web） |
| Expo Go 扫码 | 真机预览（iOS / Android） |

### 端口说明

| 端口 | 进程 | 说明 |
|------|------|------|
| `3030` | Next.js | Web 业务入口 + API 路由 |
| `5432` | PostgreSQL | 数据库（pgvector 扩展） |
| `8089` | Expo Metro | Native bundle 服务 + Expo Web |
| `4040` | ngrok inspector | tunnel 调试面板 |

---

## 数据库（PostgreSQL + pgvector）

### 自动启动机制

PostgreSQL 作为 Docker Compose 的一个服务，**随 Dev Container 自动启动**，无需手动操作：

```
docker-compose.yml
├── app（开发容器）── depends_on: db（等 DB 就绪后才启动）
└── db（PostgreSQL 18 + pgvector）── healthcheck 每 5s 检测
```

- **Rebuild Container** 或**打开 Codespace** 时，PostgreSQL 自动启动
- 数据持久化在 Docker Volume `pgdata` 中，Rebuild 不丢失
- 容器内通过 `db:5432` 访问（`DATABASE_URL` 已在 docker-compose.yml 中自动注入）

### pgvector 扩展持久化保障

pgvector 通过 **三重机制** 确保 Rebuild 后自动恢复，无需手动安装：

| 层级 | 文件 | 机制 |
|------|------|------|
| **Docker 镜像** | `docker-compose.yml` → `pgvector/pgvector:pg18` | 官方镜像自带 pgvector 二进制，容器启动即可用 |
| **迁移 SQL** | `drizzle/0000_melted_inertia.sql` 第 1 行 | `CREATE EXTENSION IF NOT EXISTS vector;` — 建表前自动启用 |
| **应用层** | `packages/core/src/db/client.ts` → `initDatabase()` | 应用启动时兜底执行 `CREATE EXTENSION IF NOT EXISTS vector` |

> **Rebuild 后恢复流程**：只需执行 `npm run db:reset`，即可自动完成：启用 pgvector 扩展 → 创建 11 张表 + HNSW 向量索引 → 灌入测试数据。

### pgvector 在 TaskAgent 中的作用

pgvector 是 L1 语义检索阶段的核心引擎，与 L0 硬过滤协同组成前两层匹配漏斗：

```
L0 硬过滤 (SQL WHERE)  ── PostgreSQL 结构化字段（城市、类型等）快速淘汰不匹配项
         ↓ 候选池
L1 语义检索 (pgvector) ── HNSW 索引 + 余弦距离，三字段加权检索：
                          activity 0.35 + vibe 0.35 + description 0.30
         ↓ Top-K
L2 沙盒谈判            ── Agent ↔ Agent 握手协商
```

- **向量模型**：DashScope `text-embedding-v4`，输出 `vector(1024)` 维度
- **索引类型**：HNSW（`vector_cosine_ops`），支持高效近似最近邻搜索
- **存储表**：`task_vectors`（字段：activity / vibe / raw / summary）
- **优势**：向量与业务数据同库，L0 SQL 过滤 + L1 向量检索可在一条查询中完成

### 数据库命令

| 命令 | 说明 |
|------|------|
| `npm run db:migrate` | 执行数据库迁移（建表/更新表结构） |
| `npm run db:generate` | 从 schema.ts 生成新的迁移 SQL |
| `npm run db:seed` | 灌入测试数据（先清空再插入，可重复执行） |
| `npm run db:reset` | 迁移 + 灌数据（一步到位，新成员入职首选） |
| `npm run db:studio` | 启动 Drizzle Studio Web 界面浏览数据 |

### 典型工作流

**新成员首次加入：**
```bash
# 1. 打开 Dev Container（PostgreSQL 自动启动）
# 2. 安装依赖
npm install
# 3. 建表 + 灌测试数据（一条命令搞定）
npm run db:reset
```

**修改表结构：**
```bash
# 1. 编辑 packages/core/src/db/schema.ts
# 2. 生成迁移 SQL
npm run db:generate
# 3. 执行迁移
npm run db:migrate
```

**重置测试数据：**
```bash
npm run db:seed    # 清空旧数据 + 重新插入，可随时反复执行
```

### Rebuild 后完整恢复清单

Rebuild Dev Container 后，按顺序执行以下步骤即可完整恢复开发环境：

```bash
# 1. 安装依赖（Rebuild 后 node_modules 会丢失）
npm install

# 2. 对齐 Expo 原生包版本（monorepo hoist 修正）
cd apps/native && npx expo install --fix && cd ../..

# 3. 初始化数据库（自动启用 pgvector + 建表 + 灌测试数据）
npm run db:reset

# 4. 配置环境变量（如果 .env 丢失）
cp .env.example .env
# 编辑 .env 填入 API Key

# 5. 启动开发服务
npm run dev
```

> **自动恢复的内容**（Rebuild 不丢失）：
> - Docker Volume `pgdata`（PostgreSQL 数据，除非手动删除 volume）
> - Docker Volume `claude-code-data`（Claude Code 认证）
> - Docker Volume `vscode-server`（VS Code 扩展缓存）
> - Git 仓库代码和配置

> **需要手动恢复的内容**：
> - `node_modules`（`npm install`）
> - 数据库表结构和数据（如果 volume 被清除，`npm run db:reset`）
> - `.env` 文件中的 API Key

### 数据库浏览器

项目已预装 VS Code 插件 **Database Client**（`cweijan.vscode-database-client2`），Rebuild 后自动安装。

首次连接配置（仅需一次）：

| 字段 | 值 |
|------|-----|
| 服务类型 | PostgreSQL |
| 主机名 | `db` |
| 端口 | `5432` |
| 用户名 | `cosoul` |
| 密码 | `cosoul` |
| 数据库 | `cosoul_agent` |

连接后在左侧 `cosoul_agent → public → Tables` 下可像 Excel 一样浏览和编辑所有表数据。

### Seed 测试数据说明

`packages/core/src/db/seed.ts` 提供贴合业务场景的测试数据：

| 数据 | 数量 | 说明 |
|------|------|------|
| 用户 | 3 | Alice、Bob、Carol |
| AI 分身 | 7 | 社交达人、技术宅、健身搭子、商务精英、美食探店、旅行达人、音乐爱好者 |
| 偏好档案 | 7 | 每个分身对应完整的 User.md 结构化数据 |
| 任务 | 10 | 覆盖全部 9 种 FSM 状态（Drafting/Searching/Negotiating/Waiting_Human/Closed/Listening/Revising/Timeout/Failed） |
| 任务摘要 | 5 | 可跨任务复用的标签摘要 |
| 联系人 | 5 | 含 accepted/pending 状态 + AI 好友备注 |
| 握手日志 | 4 | PROPOSE → COUNTER_PROPOSE → ACCEPT 完整流程 |
| 聊天消息 | 14 | 覆盖四种交互模式（人-人、Agent-Agent、Agent-人、人-Agent）+ Intake 多轮对话 |
| 幂等记录 | 2 | 防重复握手 |
| 记忆摘要 | 4 | 对话压缩 + RAG 回溯 |

### 团队数据同步策略

- **Git 追踪的是表结构**（schema.ts + 迁移 SQL + seed.ts），不是数据本身
- 团队成员 clone 后执行 `npm run db:reset` 即可得到相同的表结构 + 测试数据
- 数据变更 → 更新 seed.ts → push → 其他人 pull 后重新 `npm run db:seed`
- 联调阶段可切换 `.env` 中 `DATABASE_URL` 指向共享云数据库（Supabase/Neon）

### 数据库文件位置

```
packages/core/src/db/
├── schema.ts     # Drizzle ORM 表定义（11 张表 + 索引）
├── client.ts     # 连接池 + initDatabase()（启用 pgvector）
└── seed.ts       # 测试数据种子脚本

drizzle/
├── 0000_melted_inertia.sql  # 自动生成的迁移 SQL（含 pgvector + HNSW 索引）
└── meta/                     # Drizzle 迁移元数据

drizzle.config.ts             # 迁移配置（指向 packages/core/src/db/schema.ts）
.env.example                  # 环境变量模板（含 DATABASE_URL）
```

---

## 项目结构

```
Cosoul.AI/
├── apps/                       # 表现层（薄壳，平台特定适配）
│   ├── web/                    #   Next.js 16 Web端 + API 路由
│   │   ├── app/api/            #     HTTP 薄壳路由（persona/task/handshake/llm/embedding等）
│   │   ├── app/[pages]/        #     页面路由（首页/动态/发布/消息/个人）
│   │   ├── components/         #     Web 专属组件（AppShell, Sidebar）
│   │   └── stubs/              #     原生模块 Web Stub
│   └── native/                 #   Expo 55 移动端（iOS / Android）
│       ├── app/(tabs)/         #     5 Tab 导航（feed/discover/publish/messages/profile）
│       └── lib/                #     API 客户端 + 平台适配
│
├── packages/                   # 核心资产库（共享的包）
│   ├── ui/                     #   @repo/ui — 跨平台 UI 组件库
│   │   └── src/
│   │       ├── theme/          #     主题系统（Light/Dark/System）
│   │       ├── components/     #     基础组件（TabIcons, LiquidTabBar）
│   │       └── screens/        #     共享 Screen（Web + Native 复用，9 个页面）
│   ├── core/                   #   @repo/core — 业务逻辑 + 数据层
│   │   └── src/
│   │       ├── db/             #     PostgreSQL + pgvector（Drizzle ORM）
│   │       ├── services/       #     业务服务（persona/task/contact/chat）
│   │       ├── storage/        #     文件层持久化（task.md 读写）
│   │       └── types/          #     共享 TypeScript 类型
│   ├── agent/                  #   @repo/agent — Agent 智能体总包
│   │   └── src/
│   │       ├── shared/         #     共享基础设施（LLM 多厂商适配 / RAG / Memory）
│   │       ├── task-agent/     #     任务匹配 Agent（FSM / L0-L1-L2 / 握手协议 / Intake）
│   │       ├── persona-agent/  #     人格管理 Agent（预留）
│   │       └── social-agent/   #     社交互动 Agent（预留）
│   └── typescript-config/      #   共享 TypeScript 配置
│
├── .data/<persona_id>/         # Agent 本地数据（per-persona，含 User.md / task.md）
├── .devcontainer/              # Docker 云开发环境
├── docs/                       # 项目文档
└── drizzle.config.ts           # 数据库迁移配置
```

---

## 数据库核心表

```sql
users          — 用户账号
personas       — AI分身（一个用户多个分身，含name/avatar/bio/settings）
persona_profiles — 分身偏好档案（User.md的结构化派生）
tasks          — 任务（属于某个分身，含FSM状态、匹配条件）
task_summaries — 任务摘要（可跨任务复用）
task_vectors   — Embedding向量索引（pgvector HNSW）
contacts       — 联系人（分身级别好友关系 + AI备注）
handshake_logs — 握手日志
chat_messages  — 聊天消息（人-人/Agent-Agent/混合模式）
memory_summaries — 记忆摘要（参与RAG检索）
idempotency_keys — 幂等控制（TTL 7天）
```

---

## 开发须知

- **SDK 55 版本矩阵**：Expo ~55.0.5 / React 19.2.x / React Native 0.83.x / Expo Router ~55.0.4
- **禁止在真机上手动 Reload**：经 ngrok 隧道传输 JS bundle 耗时 3 分钟以上，修改代码后直接保存即可，HMR 毫秒级响应
- 若遇到 Metro bundling 报错，清除缓存重启：`npm run dev:mobile:clear`
- **数据库迁移**：修改 `packages/core/src/db/schema.ts` 后运行 `npm run db:generate && npm run db:migrate`
- **数据库重置**：`npm run db:seed` 可随时清空并重灌测试数据
- **PostgreSQL 连接失败**：确认 Dev Container 已启动（PostgreSQL 随容器自动运行），或检查 `DATABASE_URL` 环境变量