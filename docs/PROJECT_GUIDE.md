# Cosoul.AI — AI 社区框架 项目全景指南

> **目的**：让团队工程师或 Coding Agent 在 5 分钟内掌握项目全貌，配置完环境后直接上手开发。
>
> **最后更新**：2026-03-09

---

## 1. 项目简介

**Cosoul.AI** 是一个基于数字孪生 Agent 的 AI 社交匹配社区框架。每位用户拥有一个 AI 分身（Agent），能够自主理解需求、搜寻匹配对象、代理协商，最终由真人确认达成连接。

核心玩法：用户发布需求 → Agent 自动三层漏斗匹配（L0硬过滤 / L1语义检索 / L2沙盒谈判） → 四种消息交互模式 → 真人确认。

项目采用 **Turborepo Monorepo** 架构，Web 端与 Native 端共享超过 80% 的 UI 代码。

---

## 2. 技术栈与版本矩阵

| 技术 | 版本 | 说明 |
|------|------|------|
| **Node.js** | ≥ 18 | 运行时要求 |
| **npm** | 11.6.2 | 包管理器（workspaces） |
| **Turborepo** | ^2.8.11 | Monorepo 构建编排 |
| **React** | 19.2.0 | 全包统一版本 |
| **Next.js** | 16.1.5 | Web 端框架（App Router + Turbopack） |
| **Expo** | ~55.0.0 | Native 端框架（New Arch 已开启） |
| **React Native** | 0.83.2 | Native 运行时 |
| **Expo Router** | ~55.0.3 | Native 端文件路由 |
| **react-native-web** | ^0.21.0 | React Native → Web 适配层 |
| **react-native-svg** | ^15.15.3 | 跨平台 SVG 图标 |
| **TypeScript** | 5.5.4 (web/ui) / ~5.9.2 (native) | 类型系统 |
| **tsup** | ^8.0.1 | 共享 UI 包构建工具 |
| **PostgreSQL** | 16 | 数据库（+ pgvector 扩展） |
| **Drizzle ORM** | latest | 类型安全 ORM（SQL-first） |
| **pgvector** | latest | PostgreSQL 向量索引扩展 |

---

## 3. 端口规划

| 服务 | 端口 | 启动命令 |
|------|------|----------|
| **Web**（Next.js） | `3030` | `npm run dev:web` |
| **Native**（Expo Metro） | `8089` | `npm run dev:native` |
| **PostgreSQL** | `5432` | Docker Compose 自动启动 |
| **ngrok Inspector** | `4040` | Expo tunnel 自动启用 |

> **重要**：Native 使用 `--tunnel` 模式通过 ngrok 暴露 Metro，手机扫码即可连接。

---

## 4. 仓库结构

```
Cosoul.AI/
├── .devcontainer/                     # Docker 开发容器配置
│   ├── Dockerfile
│   ├── docker-compose.yml             # 含 PostgreSQL + pgvector 服务
│   └── devcontainer.json
│
├── apps/                              # ── 表现层（薄壳，平台特定适配）──
│   ├── web/                           # Next.js 16 Web端
│   │   ├── app/                       # App Router 路由目录
│   │   │   ├── page.tsx               # 根路径重定向 → /feed
│   │   │   ├── layout.tsx             # 根布局（AppShell 包裹）
│   │   │   ├── api/                   # HTTP 路由入口（薄壳，调用 @repo/core + @repo/agent）
│   │   │   │   ├── persona/           # 分身 CRUD
│   │   │   │   ├── task/              # 任务管理 + FSM步进 + 用户意图
│   │   │   │   ├── contact/           # 联系人管理
│   │   │   │   ├── handshake/         # 握手协议入口
│   │   │   │   ├── llm/chat/          # LLM 通用对话
│   │   │   │   └── embedding/         # Embedding 服务
│   │   │   ├── home/page.tsx          # 首页（预留）
│   │   │   ├── discover/page.tsx      # 发现（预留）
│   │   │   ├── publish/page.tsx       # 发布需求
│   │   │   ├── messages/page.tsx      # 消息 + 联系人
│   │   │   ├── profile/page.tsx       # 我的
│   │   │   └── settings/page.tsx      # 设置
│   │   ├── components/
│   │   │   ├── AppShell.tsx           # ThemeProvider + 分栏布局壳
│   │   │   └── Sidebar.tsx            # 液态玻璃侧边栏
│   │   ├── stubs/                     # Web端原生模块 Stub
│   │   ├── styles/global.css
│   │   ├── next.config.js             # Turbopack + 模块别名
│   │   └── package.json
│   │
│   └── native/                        # Expo 55 移动端
│       ├── app/                       # Expo Router 文件路由
│       │   ├── _layout.tsx            # 根布局（ThemeProvider + Stack）
│       │   ├── index.tsx              # 入口重定向 → (tabs)/feed
│       │   ├── settings.tsx           # 设置页（Stack modal）
│       │   ├── task/[id].tsx          # 任务详情页（Stack push）
│       │   ├── chat/[id].tsx          # 聊天详情页（Stack push）
│       │   └── (tabs)/               # Tab 导航组
│       │       ├── _layout.tsx        # Tab布局（LiquidTabBar）
│       │       ├── feed.tsx           # 首页 → FeedScreen
│       │       ├── discover.tsx       # 发现 → DiscoverScreen
│       │       ├── publish.tsx        # 发布 → PublishScreen
│       │       ├── messages.tsx       # 消息 → MessageScreen
│       │       └── profile.tsx        # 我的 → ProfileScreen
│       ├── lib/                       # Native 端工具层
│       │   ├── api.ts                 # API客户端（baseURL → Web后端）
│       │   └── platform.ts           # 平台适配（推送通知、相机等）
│       ├── app.json
│       └── package.json
│
├── packages/                          # ── 核心资产库（共享的包）──
│   ├── ui/                            # @repo/ui — 跨平台 UI 组件库
│   │   ├── src/
│   │   │   ├── index.tsx              # 统一导出入口
│   │   │   ├── theme/
│   │   │   │   └── ThemeContext.tsx    # 主题系统
│   │   │   ├── components/
│   │   │   │   ├── TabIcons.tsx       # 跨平台 SVG 图标集
│   │   │   │   ├── LiquidTabBar.tsx   # Native 液态玻璃 TabBar
│   │   │   │   └── TabIcon.tsx
│   │   │   └── screens/              # 共享 Screen（Web + Native 复用）
│   │   │       ├── FeedScreen.tsx
│   │   │       ├── DiscoverScreen.tsx
│   │   │       ├── PublishScreen.tsx
│   │   │       ├── TaskCreateScreen.tsx
│   │   │       ├── MessageScreen.tsx
│   │   │       ├── AgentChatScreen.tsx
│   │   │       ├── TaskDetailScreen.tsx
│   │   │       ├── ProfileScreen.tsx
│   │   │       ├── SettingsScreen.tsx
│   │   │       └── sseParser.ts       # SSE 流解析器
│   │   ├── tsup.config.ts
│   │   └── package.json
│   │
│   ├── core/                          # @repo/core — 共享业务逻辑 + 数据层
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── db/                    # 数据库连接与表定义
│   │   │   │   ├── client.ts          # Drizzle ORM + pg 连接池
│   │   │   │   └── schema.ts          # 全部 Drizzle 表定义
│   │   │   ├── services/              # 业务服务层
│   │   │   │   ├── persona.service.ts
│   │   │   │   ├── task.service.ts
│   │   │   │   ├── contact.service.ts
│   │   │   │   └── chat.service.ts
│   │   │   ├── storage/               # 文件层持久化
│   │   │   │   ├── task-md.ts
│   │   │   │   └── file-store.ts
│   │   │   └── types/                 # 共享类型定义
│   │   │       └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── agent/                         # @repo/agent — Agent 智能体总包
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── shared/                # Agent 共享基础设施
│   │   │   │   ├── llm/               # 多厂商 LLM 适配（BaseModel）
│   │   │   │   ├── rag/               # Embedding + 向量检索
│   │   │   │   └── memory/            # 记忆系统
│   │   │   ├── task-agent/            # 任务匹配 Agent
│   │   │   │   ├── fsm/              # 状态机
│   │   │   │   ├── dispatcher/        # L0/L1/L2 匹配漏斗
│   │   │   │   ├── protocol/          # 握手协议 + 幂等
│   │   │   │   └── intake/            # 多轮对话需求收集
│   │   │   ├── persona-agent/         # 人格管理 Agent（预留）
│   │   │   └── social-agent/          # 社交互动 Agent（预留）
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── typescript-config/             # 共享 TS 配置
│
├── .data/                             # Agent 本地数据（per-persona）
│   └── <persona_id>/
│       ├── User.md
│       ├── raw_chats_summary/
│       ├── logs/
│       └── task_agents/<task_id>/
├── docs/                              # 项目文档
├── drizzle.config.ts                  # 数据库迁移配置
├── turbo.json                         # Turborepo 任务编排
└── package.json                       # 根 package.json（workspaces）
```

---

## 5. 快速启动

### 5.1 环境准备

项目已配置 DevContainer，推荐使用 **VS Code + Docker** 一键启动：

```bash
# 1. 克隆仓库
git clone <repo-url> && cd Cosoul.AI

# 2. 用 VS Code 打开，选择 "Reopen in Container"
#    容器会自动安装依赖、启动 PostgreSQL

# 3. 或者手动安装
npm install
```

### 5.2 配置环境变量

```bash
cp .env.example .env
```

必填项：
```env
DATABASE_URL=postgresql://user:pass@localhost:5432/cosoul_agent
DASHSCOPE_API_KEY=sk-xxxxxxxxxxxx   # 阿里千问/Embedding
```

可选项：
```env
OPENAI_API_KEY=xxx                  # OpenAI
ANTHROPIC_API_KEY=xxx               # Claude
DEFAULT_LLM_PROVIDER=qwen
DEFAULT_LLM_MODEL=qwen3-max
```

### 5.3 初始化数据库

```bash
npx drizzle-kit migrate
```

### 5.4 启动开发服务器

```bash
# 同时启动 Web + Native + UI 包监听
npm run dev

# 仅启动 Web
npm run dev:web          # → http://localhost:3030

# 仅启动 Native
npm run dev:native       # → Expo Metro @ :8089 (tunnel 模式)

# Native 缓存异常时清除重启
npm run dev:mobile:clear
```

### 5.5 构建

```bash
# 构建所有包
npm run build

# 仅构建共享 UI 包（修改 packages/ui 后必须执行）
npx turbo build --filter=@repo/ui
```

---

## 6. 架构详解

### 6.1 Monorepo 依赖关系

```
apps/web ──────────┐
                   ├──→ packages/ui     (@repo/ui)     # 共享 UI 组件
apps/native ───────┤
                   ├──→ packages/core   (@repo/core)   # 业务逻辑 + 数据层
                   │         │
                   │         ├──→ PostgreSQL + pgvector
                   │         └──→ .data/ 文件层
                   │
                   └──→ packages/agent  (@repo/agent)  # Agent 智能体
                              │
                              ├──→ @repo/core（调用 services + DB）
                              ├──→ OpenAI / Claude / Qwen LLM
                              └──→ DashScope Embedding
```

> **注意**：`apps/native` 不直接引用 `@repo/core` 的 DB 层，而是通过 HTTP 调用 `apps/web/app/api/` 路由间接使用。`apps/web/app/api/` 是薄壳路由，实际逻辑在 `@repo/core` 和 `@repo/agent` 中。

**`@repo/ui` 构建策略**：
- 使用 `tsup` 打包为 CJS + ESM，输出到 `dist/`
- 顶部注入 `'use client'` 指令（Next.js 客户端组件）
- `react`、`react-native`、`react-native-svg`、`expo-blur`、`react-native-safe-area-context` 声明为 external
- **改动 `packages/ui/src/` 后需重新 `npx turbo build --filter=@repo/ui`**，或用 `npm run dev` 时 tsup 自动 watch

### 6.2 跨平台适配策略

#### Web 端模块解析（next.config.js Turbopack 别名）

| 原生模块 | Web 替代 | 机制 |
|----------|----------|------|
| `react-native` | `react-native-web` | 内置适配 |
| `react-native-svg` | `stubs/react-native-svg.js` | 将 SVG 组件映射为 HTML `<svg>`、`<path>` 等 |
| `expo-blur` | `stubs/expo-blur.js` | 直接返回 children |
| `react-native-safe-area-context` | `stubs/react-native-safe-area-context.js` | 返回零值 insets |

#### 平台差异注入模式

共享 Screen 通过 **props 注入** 实现平台特定行为：

```tsx
// 共享组件声明可选回调
interface ScreenProps {
  onAction: () => Promise<void>;
  apiBaseUrl: string;
}

// Web 端注入浏览器 API
<Screen onAction={webHandler} apiBaseUrl="/api/..." />

// Native 端注入 Expo SDK
<Screen onAction={nativeHandler} apiBaseUrl="http://localhost:3030/api/..." />
```

---

## 7. 双端 UI 详解

### 7.1 主题系统

**文件**：`packages/ui/src/theme/ThemeContext.tsx`

| 概念 | 说明 |
|------|------|
| **ThemeMode** | `"system"` / `"light"` / `"dark"` 三种模式 |
| **ThemeProvider** | 根组件包裹，提供主题上下文 |
| **useTheme()** | Hook，返回 `{ mode, setMode, colors, isDark }` |
| **ThemeColors** | 包含 `bg`, `text`, `subtitle`, `accent`, `tabBarBg`, `pillColor`, `switcherBg`, `switcherBorder` |

| Token | 浅色值 | 深色值 |
|-------|--------|--------|
| `bg` | `#FFFFFF` | `#1C1C1E` |
| `text` | `#333333` | `#FFFFFF` |
| `subtitle` | `#999999` | `#8E8E93` |
| `accent` | `#FF2D55` | `#FF375F` |

### 7.2 SVG 图标系统

**文件**：`packages/ui/src/components/TabIcons.tsx`

所有图标采用统一的 Feather 粗线风格：`strokeWidth=2`、`strokeLinecap="round"`、`strokeLinejoin="round"`，`viewBox="0 0 24 24"`。

| 图标组件 | 用途 | 形状 |
|----------|------|------|
| `MessageIcon` | 消息 Tab | 聊天气泡 |
| `CommunityIcon` | 首页 Tab | 多人剪影 |
| `PlusCircleIcon` | 发布/AI核心 Tab | 圆圈加号 |
| `CompassIcon` | 发现 Tab | 指南针 |
| `PersonIcon` | 我的 / 头像 | 人物轮廓 |
| `SettingsIcon` | 设置入口 | 齿轮 |
| `ChevronLeftIcon` | 返回按钮 | 左箭头 `<` |
| `PaletteIcon` | Logo | 调色盘 |
| `SidebarToggleIcon` | 侧边栏展开/收起 | 面板+箭头 |

### 7.3 Web 端 UI

#### 布局结构

```
┌─────────────────────────────────────────────┐
│ AppShell (ThemeProvider)                     │
│ ┌──────────┬────────────────────────────────┐│
│ │ Sidebar  │  main-content                  ││
│ │          │  (flex 居中, overflow-y scroll) ││
│ │ [Logo]   │                                ││
│ │ [首页]   │     ┌─────────────┐            ││
│ │ [发现]   │     │ Page Content│            ││
│ │ [消息]   │     └─────────────┘            ││
│ │ [发布]   │                                ││
│ │          │                                ││
│ │ ──────── │                                ││
│ │ [头像]   │                                ││
│ │ [设置]   │                                ││
│ └──────────┴────────────────────────────────┘│
└─────────────────────────────────────────────┘
```

#### 侧边栏特性（Sidebar.tsx + global.css）

- **展开/收起**：CSS transition 动画（0.32s 贝塞尔曲线），收起 60px / 展开 192px
- **液态玻璃效果**：`backdrop-filter: blur(48px) saturate(2.0)`
- **药丸选中指示器**：绝对定位，`translateY` 随 tab 切换滑动
- **底部区域**：头像（→ /profile）+ 设置齿轮（→ /settings）

#### Web 路由映射

| URL | 页面 | 共享组件 | 说明 |
|-----|------|----------|------|
| `/` | 重定向 → `/feed` | - | `redirect()` |
| `/feed` | 瀑布流 | `FeedScreen` | 社区信息流 |
| `/cards` | 发现 | `CardsScreen` | 探索卡片 |
| `/messages` | 消息 | `MessageScreen` | Agent 四种交互模式 |
| `/publish` | 发布需求 | `PublishScreen` | Intake 多轮对话 |
| `/ai-core` | AI核心 | `AiCoreScreen` | AI 核心交互区 |
| `/profile` | 我的 | `ProfileScreen` | 任务管理、Agent 设置 |
| `/settings` | 设置 | `SettingsScreen` | 主题切换等 |

### 7.4 Native 端 UI

#### 导航结构

```
Stack (_layout.tsx, ThemeProvider 包裹)
├── (tabs)/ — Tab 导航组
│   ├── feed       → 瀑布流（FeedScreen）
│   ├── cards      → 发现（CardsScreen）
│   ├── ai-core    → AI核心（AiCoreScreen）
│   ├── index      → 消息（MessageScreen）
│   └── profile    → 我的（ProfileScreen）
└── settings — Stack modal 页面（SettingsScreen）
```

#### Tab 顺序（从左到右）

| 位置 | 路由名 | 标签 | 图标 |
|------|--------|------|------|
| 1 | `feed` | 首页 | CommunityIcon |
| 2 | `cards` | 发现 | CompassIcon |
| 3 | `ai-core` | AI核心 | PlusCircleIcon |
| 4 | `index` | 消息 | MessageIcon |
| 5 | `profile` | 我的 | PersonIcon |

#### LiquidTabBar 特性

- **浮空定位**：`position: absolute`，距底部 `12px + SafeArea`
- **毛玻璃效果**：iOS 使用 `expo-blur`（原生模糊），Android 半透明降级
- **药丸动画**：`Animated.spring`（`damping=18, stiffness=180, mass=0.9`），`useNativeDriver: true`

---

## 8. TaskAgent 核心功能

### 8.1 架构流程

```
[用户发布需求] → [Intake 多轮对话] → [生成 task.md (Drafting)]
      ↓                                       ↓
  PublishScreen                          FSM 状态机驱动
      ↓                                       ↓
  结构化字段提取              L0 硬过滤 (PostgreSQL) → L1 语义检索 (pgvector)
  (activity/vibe/plan)                         ↓
                                         候选池 Top-K
                                               ↓
                                    L2 沙盒谈判 (Agent ↔ Agent)
                                               ↓
                                    Waiting_Human → 真人确认
                                               ↓
                                    Closed / Revising / Listening
```

### 8.2 四种消息交互模式

| 模式 | 发起方 | 接收方 | 实现方式 |
|------|--------|--------|----------|
| A人-B人 | 真人 | 真人 | 常规 IM 聊天 |
| A_Agent-B_Agent | Agent | Agent | 握手协议 JSON 自动谈判 |
| A_Agent-B人 | Agent | 真人 | Agent 发起 → 推送通知 → 人回复 |
| A人-B_Agent | 真人 | Agent | 人发消息 → Agent LLM 响应（SSE 流式） |

### 8.3 FSM 状态机

9 种状态，10 种合法迁移：

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

### 8.4 多厂商 LLM 适配

以 OpenAI 格式为标准的 `BaseModel` 抽象类，三个 Provider 实现：

| Provider | 模型 | 用途 |
|----------|------|------|
| QwenProvider | qwen3-max, qwen-turbo | 主力（DashScope 接口） |
| OpenAIProvider | GPT-4o, GPT-4o-mini | 备选 |
| ClaudeProvider | Claude 系列 | 备选 |

### 8.5 数据存储

- **task.md**（YAML头 + Markdown正文）= 唯一真相源
- **PostgreSQL** = 派生层（可从 task.md 重建）
- **pgvector** = 向量索引（HNSW，`vector(1024)` 类型）
- 两阶段原子写 + 乐观锁 + 补偿队列

---

## 9. 开发规范与注意事项

### 9.1 新增页面的标准流程

1. **在 `packages/ui/src/screens/` 创建共享 Screen 组件**
   - 使用 `react-native` 的 `View`、`Text`、`StyleSheet` 等
   - 通过 `useTheme()` 获取主题色
   - 平台差异通过 props 注入

2. **在 `packages/ui/src/index.tsx` 导出**

3. **重新构建 UI 包**：`npx turbo build --filter=@repo/ui`

4. **Web 端**：在 `apps/web/app/<route>/page.tsx` 创建路由页面
   - 必须标记 `"use client"`
   - 如需顶部对齐（非居中），外包 `<div style={{ alignSelf: "flex-start", width: "100%" }}>`

5. **Native 端**：在 `apps/native/app/(tabs)/<name>.tsx` 或 `apps/native/app/<name>.tsx` 创建路由页面

6. **如果是 Tab 页**：
   - 更新 `apps/web/components/Sidebar.tsx` 的 `NAV_ITEMS`
   - 更新 `apps/native/app/(tabs)/_layout.tsx` 的 `Tabs.Screen` 顺序
   - 更新 `packages/ui/src/components/LiquidTabBar.tsx` 的 `TABS` 数组

### 9.2 新增 SVG 图标

1. 在 `packages/ui/src/components/TabIcons.tsx` 新增组件
2. 遵循统一风格：`viewBox="0 0 24 24"`, `fill="none"`, `strokeWidth={2}`, `strokeLinecap="round"`, `strokeLinejoin="round"`
3. 接收 `{ size, color }` props
4. 在 `packages/ui/src/index.tsx` 导出

### 9.3 原生模块 Web Stub

如果新引入了 React Native 专属模块，需要：

1. 在 `apps/web/stubs/` 创建对应的 `.js` stub 文件
2. 在 `apps/web/next.config.js` 的 `turbopack.resolveAlias` 中添加映射
3. 在 `packages/ui/tsup.config.ts` 的 `external` 数组中添加该模块

### 9.4 数据库变更流程

1. 修改 `packages/core/src/db/schema.ts` 中的 Drizzle 表定义
2. 生成迁移：`npx drizzle-kit generate`
3. 执行迁移：`npx drizzle-kit migrate`
4. 验证：检查 PostgreSQL 表结构与代码一致

### 9.5 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| `EADDRINUSE` 端口被占用 | 上次 dev server 未正常退出 | `ss -tlnp \| grep <端口>` 找到 PID → `kill <PID>` |
| Native 修改 UI 包后不生效 | 未重新构建 | `npx turbo build --filter=@repo/ui` |
| Web 出现 `Module not found: react-native-xxx` | 缺少 Web Stub | 见 9.3 创建 stub |
| Native HMR 失效 | Metro 缓存异常 | `npm run dev:mobile:clear` |
| 手机端加载慢 | ngrok tunnel 首次全量下载 | 等待首次加载完成，后续为增量 HMR |
| PostgreSQL 连接失败 | Docker 服务未启动 | `docker compose up -d` 或检查 `DATABASE_URL` |
| pgvector 扩展未找到 | 未安装 pgvector | 确保使用 `pgvector/pgvector:pg16` 镜像 |

### 9.6 代码风格

- **格式化**：`npm run format`（Prettier 3.1.1）
- **命名**：组件 PascalCase，变量/函数 camelCase，常量 UPPER_SNAKE_CASE
- **Git 提交前缀**：`feat:`, `fix:`, `docs:`, `refactor:` 等

---

## 10. 关键文件索引

### 配置文件

| 文件 | 作用 |
|------|------|
| `package.json` | 根 Monorepo 配置，workspaces 声明 |
| `turbo.json` | Turborepo 任务编排（build/dev/lint/clean） |
| `drizzle.config.ts` | 数据库迁移配置 |
| `apps/web/next.config.js` | Turbopack 别名、Web 扩展名解析 |
| `apps/native/app.json` | Expo 配置（scheme、plugins、permissions） |
| `packages/ui/tsup.config.ts` | UI 包构建（entry、external、format） |
| `.devcontainer/devcontainer.json` | Docker 开发容器 + 端口转发 + VS Code 插件 |

### 核心源码

| 文件 | 作用 |
|------|------|
| `packages/ui/src/index.tsx` | 共享 UI 统一导出入口 |
| `packages/ui/src/theme/ThemeContext.tsx` | 主题系统 |
| `packages/ui/src/components/TabIcons.tsx` | 跨平台 SVG 图标集 |
| `packages/ui/src/components/LiquidTabBar.tsx` | Native 液态玻璃底部导航栏 |
| `packages/ui/src/screens/MessageScreen.tsx` | 消息交互（四种模式） |
| `packages/ui/src/screens/PublishScreen.tsx` | 发布需求 UI |
| `packages/ui/src/screens/sseParser.ts` | SSE 流式响应解析 |
| `packages/core/src/db/schema.ts` | Drizzle 数据库表定义 |
| `packages/core/src/db/client.ts` | 数据库连接池 |
| `packages/core/src/services/` | 业务服务层（persona/task/contact/chat） |
| `packages/core/src/storage/task-md.ts` | task.md 序列化/反序列化 |
| `packages/core/src/types/index.ts` | 共享类型定义 |
| `packages/agent/src/shared/llm/` | 多厂商 LLM 适配（BaseModel） |
| `packages/agent/src/shared/rag/` | Embedding + 向量检索 |
| `packages/agent/src/shared/memory/` | 记忆系统 |
| `packages/agent/src/task-agent/fsm/` | FSM 状态机 + Schema |
| `packages/agent/src/task-agent/dispatcher/` | L0/L1/L2 匹配漏斗 |
| `packages/agent/src/task-agent/protocol/` | 握手协议 + 幂等 |
| `packages/agent/src/task-agent/intake/` | 多轮对话需求收集 |
| `apps/web/components/Sidebar.tsx` | Web 液态玻璃侧边栏 |
| `apps/web/components/AppShell.tsx` | Web 应用外壳 |

---

## 11. DevContainer 配置摘要

- **基础镜像**：Node.js 环境
- **附加服务**：PostgreSQL 16 + pgvector（Docker Compose）
- **持久卷**：Claude Code 认证数据 + VS Code Server 缓存（容器 rebuild 不丢失）
- **代理**：自动配置 HTTP/HTTPS 代理指向宿主机
- **端口转发**：3030 (Web)、5432 (PostgreSQL)、8089 (Metro)、4040 (ngrok)
- **预装插件**：ESLint、Prettier、Expo Tools、Claude Code、GitHub Copilot
- **安全**：`seccomp: unconfined` + `SYS_ADMIN`（Metro/Docker 需要）
