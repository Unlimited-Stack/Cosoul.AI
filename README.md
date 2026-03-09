# Cosoul.AI — AI 社交匹配社区

基于**数字孪生 Agent** 的智能社交匹配平台。每位用户拥有一个 AI 分身（Agent），能够自主理解需求、搜寻匹配对象、代理协商，最终由真人确认达成连接。

采用 `TypeScript + Next.js + Expo` (Turborepo) 全栈架构，实现 Web 端与移动端 (iOS/Android) 代码高度复用。项目专为云原生环境（GitHub Codespaces）设计，无需配置本地 Xcode/Android Studio 即可完成极速跨端开发与真机调试。

---

## 核心功能

### TaskAgent 智能匹配系统

用户发布需求后，AI Agent 自动完成三层漏斗匹配：

1. **发布需求（发帖）** — 通过多轮 AI 对话收集用户需求，提取结构化信息（活动类型、氛围偏好、详细计划）
2. **Agent 自动搜寻（L0/L1）** — L0 结构化硬过滤 + L1 向量语义检索（PostgreSQL pgvector），高效筛选候选
3. **Agent 协商与消息交互（L2）** — Agent 间自动握手谈判，支持四种交互模式：
   - 人 - 人：双方真人直接对话
   - Agent - Agent：双方 AI 自动协商
   - Agent - 人：AI 代理主动联系对方
   - 人 - Agent：用户与对方 AI 交互

### 产品页面结构（5 Tab）

| Tab | 页面 | 功能 |
|-----|------|------|
| 1 | 消息 | Agent 交互中心，四种对话模式，匹配结果确认 |
| 2 | 瀑布流 | 社区信息流，展示活跃需求和匹配动态 |
| 3 | 发布需求 | AI 多轮对话收集需求，生成结构化任务 |
| 4 | 发现 | 探索卡片，浏览社区内容 |
| 5 | 我的 | 个人主页，任务管理，Agent 设置 |

### 任务状态机（FSM）

每个任务独立追踪，支持多任务并发：

```
用户发帖 → Drafting → Searching → Negotiating → Waiting_Human → Closed
                                                      ↓
                                              不满意 → Revising → 重新搜索
                                              挂起 → Listening（后台持续匹配）
```

---

## 技术栈架构 (Turborepo Monorepo)

- **应用层 (`apps/`)**:
  - `apps/web`: Next.js 16 (App Router + Turbopack)，Web 端 + 后端 API 路由
  - `apps/native`: Expo 55 (React Native 0.83)，iOS/Android 原生应用
- **共享层 (`packages/`)**:
  - `packages/ui`: 跨平台 UI 组件库（@repo/ui），含主题系统、液态玻璃导航
  - `packages/task-agent`: Agent 核心包（@repo/task-agent），含 FSM、Dispatcher、LLM、向量搜索
- **数据层**:
  - PostgreSQL 16 + pgvector：任务数据、向量索引、握手记录、幂等控制
  - task.md (YAML + Markdown)：任务单一真相源
- **AI 层**:
  - 多厂商 LLM 适配：OpenAI / Claude / Qwen（以 OpenAI 格式为标准的 BaseModel 抽象）
  - DashScope text-embedding-v4：向量化引擎
  - pgvector HNSW 索引：高性能向量检索
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
├── apps/
│   ├── web/                    # Next.js 16 Web应用 + API路由
│   │   └── app/
│   │       ├── api/            # 后端API（任务、握手、LLM、Embedding）
│   │       ├── feed/           # 瀑布流页
│   │       ├── publish/        # 发布需求页
│   │       ├── messages/       # 消息交互页
│   │       ├── cards/          # 发现页
│   │       └── profile/        # 个人主页
│   └── native/                 # Expo 55 移动端应用
├── packages/
│   ├── ui/                     # 跨平台UI组件库
│   │   └── src/screens/        # 共享Screen组件
│   └── task-agent/             # Agent核心包
│       └── src/
│           ├── fsm/            # 状态机 + Schema
│           ├── dispatcher/     # L0/L1/L2 匹配漏斗
│           ├── llm/            # 多厂商LLM适配
│           ├── rag/            # Embedding + 向量检索
│           ├── protocol/       # 握手协议 + 幂等
│           ├── storage/        # PostgreSQL + task.md 持久化
│           ├── memory/         # 记忆压缩 + 上下文管理
│           ├── intake/         # 多轮对话需求收集
│           └── skills/         # Skill路由（预留）
├── .data/                      # Agent本地数据（task.md等）
├── .devcontainer/              # 云开发环境配置
├── docs/                       # 项目文档
└── drizzle.config.ts           # 数据库迁移配置
```

---

## 开发须知

- **SDK 55 版本矩阵**：Expo ~55.0.5 / React 19.2.x / React Native 0.83.x / Expo Router ~55.0.4
- **禁止在真机上手动 Reload**：经 ngrok 隧道传输 JS bundle 耗时 3 分钟以上，修改代码后直接保存即可，HMR 毫秒级响应
- 若遇到 Metro bundling 报错，清除缓存重启：`npm run dev:mobile:clear`
- 数据库迁移：修改 `schema.db.ts` 后运行 `npx drizzle-kit generate && npx drizzle-kit migrate`
