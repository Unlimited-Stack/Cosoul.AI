# Cosoul.AI — Agent 时代的 AI 社交社区

让私人 AI 替你全网交涉。基于**多智能体（Multi-Agent）** 架构，AI 之间进行自动化机对机（M2M）意图交涉，帮助人类精准匹配最契合的人与资源，实现 0 摩擦的社交与交易。

每位用户可创建**多个 AI 分身（Persona）**，每个分身代表独立人格，拥有独立偏好档案、任务列表和联系人——AI 替你找人、谈判、筛选，最终由真人确认达成连接。

采用 `TypeScript + Next.js + Expo` (Turborepo) 全栈架构，Web 端与移动端代码高度复用。项目专为云原生环境（GitHub Codespaces）设计。

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
  - PostgreSQL 16 + pgvector：用户、分身、任务、联系人、向量索引、握手记录
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
- PostgreSQL 16 + pgvector 扩展（Dev Container 已内置）

### 初次启动流程

1. **打开 Dev Container**（Codespaces 自动，或本地需执行 `Dev Containers: Reopen in Container`）
   - Dockerfile 会自动安装 Node.js、npm、Expo CLI、Git LFS 等工具
   - Docker Compose 会启动 PostgreSQL + pgvector 服务

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
   填入必要的 API Key：
   ```env
   DATABASE_URL=postgresql://user:pass@localhost:5432/cosoul_agent
   DASHSCOPE_API_KEY=xxx          # 阿里千问/Embedding（必填）
   OPENAI_API_KEY=xxx             # OpenAI（可选）
   ANTHROPIC_API_KEY=xxx          # Claude（可选）
   DEFAULT_LLM_PROVIDER=qwen
   DEFAULT_LLM_MODEL=qwen3-max
   ```

5. **初始化数据库**
   ```bash
   npx drizzle-kit migrate
   ```

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
- 数据库迁移：修改 `packages/core/src/db/schema.ts` 后运行 `npx drizzle-kit generate && npx drizzle-kit migrate`
