# AI 相片锐评家 — 项目全景指南

> **目的**：让团队工程师或 Coding Agent 在 5 分钟内掌握项目全貌，配置完环境后直接上手开发。
>
> **最后更新**：2026-03-09

---

## 1. 项目简介

**AI 相片锐评家**（AI Photo Reviewer）是一款跨平台 AI 图片评论应用。用户上传照片后，AI 会根据不同"人格风格"（毒舌 / 彩虹屁 / 专业摄影师）对构图、光线、色彩等维度进行锐评，以流式输出的方式呈现结果。

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

---

## 3. 端口规划

| 服务 | 端口 | 启动命令 |
|------|------|----------|
| **Web**（Next.js） | `7878` | `npm run dev:web` |
| **Native**（Expo Metro） | `9191` | `npm run dev:native` |
| **ngrok Inspector** | `4040` | Expo tunnel 自动启用 |

> **重要**：Native 使用 `--tunnel` 模式通过 ngrok 暴露 Metro，手机扫码即可连接。

---

## 4. 仓库结构

```
/workspaces/
├── .devcontainer/              # Docker 开发容器配置
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── devcontainer.json
├── apps/
│   ├── web/                    # Next.js 16 Web 应用
│   │   ├── app/                # App Router 路由目录
│   │   │   ├── page.tsx        # 根路径重定向 → /feed
│   │   │   ├── layout.tsx      # 根布局（AppShell 包裹）
│   │   │   ├── api/critique/route.ts  # AI 锐评 API 代理
│   │   │   ├── feed/page.tsx          # 首页
│   │   │   ├── cards/page.tsx         # 发现
│   │   │   ├── messages/page.tsx      # 消息
│   │   │   ├── ai-core/page.tsx       # 锐评（含图片选择+压缩）
│   │   │   ├── profile/page.tsx       # 我的
│   │   │   └── settings/page.tsx      # 设置
│   │   ├── components/
│   │   │   ├── AppShell.tsx    # ThemeProvider + 分栏布局壳
│   │   │   └── Sidebar.tsx     # 液态玻璃侧边栏
│   │   ├── stubs/              # Web 端原生模块 Stub
│   │   │   ├── expo-blur.js
│   │   │   ├── react-native-svg.js
│   │   │   └── react-native-safe-area-context.js
│   │   ├── styles/global.css   # 全局样式（侧边栏、动画、布局）
│   │   ├── next.config.js      # Turbopack + 模块别名配置
│   │   └── package.json
│   └── native/                 # Expo 55 React Native 应用
│       ├── app/
│       │   ├── _layout.tsx     # 根布局（ThemeProvider + Stack）
│       │   ├── index.tsx       # 根重定向
│       │   ├── settings.tsx    # 设置页（Stack modal）
│       │   └── (tabs)/         # Tab 导航组
│       │       ├── _layout.tsx # Tab 布局（LiquidTabBar）
│       │       ├── feed.tsx    # 首页
│       │       ├── cards.tsx   # 发现
│       │       ├── index.tsx   # 消息
│       │       ├── ai-core.tsx # 锐评（expo-image-picker）
│       │       └── profile.tsx # 我的
│       ├── app.json            # Expo 配置
│       └── package.json
├── packages/
│   ├── ui/                     # 共享 UI 包（@repo/ui）
│   │   ├── src/
│   │   │   ├── index.tsx       # 统一导出入口
│   │   │   ├── theme/
│   │   │   │   └── ThemeContext.tsx  # 主题系统（深/浅/跟随系统）
│   │   │   ├── components/
│   │   │   │   ├── TabIcons.tsx     # 跨平台 SVG 图标集
│   │   │   │   ├── LiquidTabBar.tsx # Native 液态玻璃 TabBar
│   │   │   │   └── TabIcon.tsx      # 基础 TabIcon 组件
│   │   │   └── screens/
│   │   │       ├── MessageScreen.tsx
│   │   │       ├── FeedScreen.tsx
│   │   │       ├── CardsScreen.tsx
│   │   │       ├── AiCoreScreen.tsx     # AI 锐评核心 UI
│   │   │       ├── ProfileScreen.tsx
│   │   │       ├── SettingsScreen.tsx
│   │   │       ├── critiquePrompts.ts   # AI 人格/模型配置
│   │   │       └── sseParser.ts         # SSE 流解析器
│   │   ├── tsup.config.ts      # 构建配置（external 模块列表）
│   │   └── package.json
│   ├── typescript-config/      # 共享 TS 配置
│   │   ├── base.json
│   │   ├── nextjs.json
│   │   └── react-native-library.json
│   └── eslint-config-custom/   # 共享 ESLint 配置
├── docs/                       # 项目文档
├── turbo.json                  # Turborepo 任务编排
└── package.json                # 根 package.json（workspaces）
```

---

## 5. 快速启动

### 5.1 环境准备

项目已配置 DevContainer，推荐使用 **VS Code + Docker** 一键启动：

```bash
# 1. 克隆仓库
git clone <repo-url> && cd ai-photo-reviewer

# 2. 用 VS Code 打开，选择 "Reopen in Container"
#    容器会自动安装依赖、配置代理

# 3. 或者手动安装
npm install
```

### 5.2 启动开发服务器

```bash
# 同时启动 Web + Native + UI 包监听
npm run dev

# 仅启动 Web
npm run dev:web          # → http://localhost:7878

# 仅启动 Native
npm run dev:native       # → Expo Metro @ :9191 (tunnel 模式)

# Native 缓存异常时清除重启
npm run dev:mobile:clear
```

### 5.3 构建

```bash
# 构建所有包
npm run build

# 仅构建共享 UI 包（修改 packages/ui 后必须执行）
npx turbo build --filter=@repo/ui
```

### 5.4 环境变量

Web 端需要在 `apps/web/.env.local` 中配置：

```env
DASHSCOPE_API_KEY=sk-xxxxxxxxxxxx   # 阿里百炼 API Key（服务端专用）
```

---

## 6. 架构详解

### 6.1 Monorepo 依赖关系

```
apps/web ──────┐
               ├──→ packages/ui (@repo/ui)
apps/native ───┘         │
                         ├──→ react / react-native
                         ├──→ react-native-svg
                         ├──→ expo-blur (external)
                         └──→ react-native-safe-area-context (external)
```

**`@repo/ui` 构建策略**：

- 使用 `tsup` 打包为 CJS + ESM，输出到 `dist/`
- 顶部注入 `'use client'` 指令（Next.js 客户端组件）
- `react`、`react-native`、`react-native-svg`、`expo-blur`、`react-native-safe-area-context` 声明为 external，由各端自行解析
- **改动 `packages/ui/src/` 后需重新 `npx turbo build --filter=@repo/ui`**，或用 `npm run dev` 启动时 tsup 会自动 watch

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
interface AiCoreScreenProps {
  onPickImage: () => Promise<string | null>;
  apiBaseUrl: string;
}

// Web 端注入浏览器 File API
<AiCoreScreen onPickImage={webPickImage} apiBaseUrl="/api/critique" />

// Native 端注入 expo-image-picker
<AiCoreScreen onPickImage={nativePickImage} apiBaseUrl="http://localhost:7878/api/critique" />
```

同理，`ProfileScreen` 的 `onOpenSettings` 和 `showHeader`，`SettingsScreen` 的 `onGoBack` 均采用此模式。

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
| `PlusCircleIcon` | 锐评 Tab | 圆圈加号 |
| `CompassIcon` | 发现 Tab | 指南针 |
| `PersonIcon` | 我的 / 头像 | 人物轮廓 |
| `SettingsIcon` | 设置入口 | 齿轮 |
| `ChevronLeftIcon` | 返回按钮 | 左箭头 `<` |
| `PaletteIcon` | Logo | 调色盘 |
| `SidebarToggleIcon` | 侧边栏展开/收起 | 面板+箭头（支持 `flipped` prop） |

**跨平台原理**：

- **Native**：直接使用 `react-native-svg`（原生渲染）
- **Web**：通过 `stubs/react-native-svg.js` 将 `Svg` → `<svg>`、`Path` → `<path>` 等映射为 HTML SVG 元素

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
│ │ [锐评]   │                                ││
│ │          │                                ││
│ │ ──────── │                                ││
│ │ [头像]   │                                ││
│ │ [设置]   │                                ││
│ └──────────┴────────────────────────────────┘│
└─────────────────────────────────────────────┘
```

#### 侧边栏特性（Sidebar.tsx + global.css）

- **展开/收起**：点击 Logo 或展开按钮切换，CSS transition 动画（0.32s 贝塞尔曲线）
  - 收起宽度：`60px`（仅图标）
  - 展开宽度：`192px`（图标 + 文字）
- **液态玻璃效果**：`backdrop-filter: blur(48px) saturate(2.0)`，浅色 `rgba(210,210,215,0.55)` / 深色 `rgba(60,60,65,0.6)`
- **药丸选中指示器**：绝对定位，`translateY` 随 tab 切换滑动，进入 /profile 或 /settings 时 `opacity: 0` 隐藏
- **底部区域**：头像（→ /profile）+ 设置齿轮（→ /settings），通过 CSS 分割线与主导航区分

#### Web 路由映射

| URL | 页面 | 共享组件 | 平台包装说明 |
|-----|------|----------|--------------|
| `/` | 重定向 → `/feed` | - | `redirect()` |
| `/feed` | 首页 | `FeedScreen` | 直接渲染 |
| `/cards` | 发现 | `CardsScreen` | 直接渲染 |
| `/messages` | 消息 | `MessageScreen` | 直接渲染 |
| `/ai-core` | 锐评 | `AiCoreScreen` | 注入 Web File API 图片选择 + 压缩 |
| `/profile` | 我的 | `ProfileScreen` | `showHeader={false}`（导航由 Sidebar 处理） |
| `/settings` | 设置 | `SettingsScreen` | `onGoBack → router.push("/profile")`，顶部对齐 |
| `/api/critique` | AI API | - | Next.js Route Handler，代理阿里百炼 API |

### 7.4 Native 端 UI

#### 导航结构

```
Stack (_layout.tsx, ThemeProvider 包裹)
├── (tabs)/ — Tab 导航组
│   ├── feed       → 首页（FeedScreen）
│   ├── cards      → 发现（CardsScreen）
│   ├── ai-core    → 锐评（AiCoreScreen + expo-image-picker）
│   ├── index      → 消息（MessageScreen）
│   └── profile    → 我的（ProfileScreen + onOpenSettings）
└── settings — Stack modal 页面（SettingsScreen + onGoBack）
```

#### Tab 顺序（从左到右）

| 位置 | 路由名 | 标签 | 图标 |
|------|--------|------|------|
| 1 | `feed` | 首页 | CommunityIcon |
| 2 | `cards` | 发现 | CompassIcon |
| 3 | `ai-core` | 锐评 | PlusCircleIcon |
| 4 | `index` | 消息 | MessageIcon |
| 5 | `profile` | 我的 | PersonIcon |

#### LiquidTabBar 特性（LiquidTabBar.tsx）

- **浮空定位**：`position: absolute`，距底部 `12px + SafeArea`，左右各 `16px` 间距
- **毛玻璃效果**：
  - iOS：`expo-blur` `BlurView`（`intensity=70`），真实原生模糊
  - Android：半透明背景色降级
- **药丸动画**：`Animated.spring`（`damping=18, stiffness=180, mass=0.9`），`useNativeDriver: true`

#### ProfileScreen 平台差异

| 特性 | Native | Web |
|------|--------|-----|
| 顶部栏 | 显示（头像左 + 齿轮右） | 隐藏（`showHeader={false}`） |
| 设置入口 | 齿轮按钮 → `router.push("/settings")` | 侧边栏底部齿轮 |
| 设置返回 | `router.back()` | `router.push("/profile")` |

---

## 8. AI 锐评功能

### 8.1 架构流程

```
[用户选择照片] → [选择人格风格 + AI 模型] → [点击"开始锐评"]
      ↓                                           ↓
  Native: expo-image-picker              Web: File API + Canvas 压缩
      ↓                                           ↓
  base64 data URI ──────────────→ POST /api/critique
                                          ↓
                              Next.js Route Handler（服务端代理）
                                          ↓
                              阿里百炼 Coding Plan API
                              (https://coding.dashscope.aliyuncs.com)
                                          ↓
                              SSE 流式响应 / 非流式响应
                                          ↓
                              AiCoreScreen 逐字渲染结果
```

### 8.2 锐评人格

| Key | 标签 | 风格 |
|-----|------|------|
| `roast` | 🔥 毒舌吐槽 | 极度刻薄但幽默，脱口秀风格 |
| `flatter` | 🌈 彩虹屁 | 极度夸赞、辞藻华丽 |
| `pro` | 🧐 专业摄影师 | 专业客观有建设性 |

### 8.3 可用模型

| ID | 显示名 |
|----|--------|
| `kimi-k2.5` | Kimi K2.5 |
| `qwen3.5-plus` | Qwen 3.5+ |

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
   - 更新 `packages/ui/src/components/LiquidTabBar.tsx` 的 `TABS` 数组（顺序须与 `_layout.tsx` 一致）

### 9.2 新增 SVG 图标

1. 在 `packages/ui/src/components/TabIcons.tsx` 新增组件
2. 遵循统一风格：`viewBox="0 0 24 24"`, `fill="none"`, `strokeWidth={2}`, `strokeLinecap="round"`, `strokeLinejoin="round"`
3. 接收 `{ size, color }` props
4. 在 `packages/ui/src/index.tsx` 导出

### 9.3 原生模块 Web Stub

如果新引入了 React Native 专属模块（如新的 Expo SDK 模块），需要：

1. 在 `apps/web/stubs/` 创建对应的 `.js` stub 文件
2. 在 `apps/web/next.config.js` 的 `turbopack.resolveAlias` 中添加映射
3. 在 `packages/ui/tsup.config.ts` 的 `external` 数组中添加该模块

### 9.4 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| `EADDRINUSE` 端口被占用 | 上次 dev server 未正常退出 | `ss -tlnp \| grep <端口>` 找到 PID → `kill <PID>` |
| Native 修改 UI 包后不生效 | 未重新构建 | `npx turbo build --filter=@repo/ui` |
| Web 出现 `Module not found: react-native-xxx` | 缺少 Web Stub | 见 9.3 创建 stub |
| Native HMR 失效 | Metro 缓存异常 | `npm run dev:mobile:clear` |
| 手机端加载慢 | ngrok tunnel 首次全量下载 | 等待首次加载完成，后续为增量 HMR |

### 9.5 代码风格

- **格式化**：`npm run format`（Prettier 3.1.1）
- **文件注释**：每个文件顶部保留 JSDoc 风格注释说明用途
- **命名**：组件 PascalCase，变量/函数 camelCase，常量 UPPER_SNAKE_CASE
- **Git 提交前缀**：`feat:`, `fix:`, `docs:`, `refactor:` 等

---

## 10. 关键文件索引

### 配置文件

| 文件 | 作用 |
|------|------|
| `/workspaces/package.json` | 根 Monorepo 配置，workspaces 声明 |
| `/workspaces/turbo.json` | Turborepo 任务编排（build/dev/lint/clean） |
| `/workspaces/apps/web/next.config.js` | Turbopack 别名、Web 扩展名解析 |
| `/workspaces/apps/native/app.json` | Expo 配置（scheme、plugins、permissions） |
| `/workspaces/packages/ui/tsup.config.ts` | UI 包构建（entry、external、format） |
| `/workspaces/.devcontainer/devcontainer.json` | Docker 开发容器 + 端口转发 + VS Code 插件 |

### 核心源码

| 文件 | 作用 |
|------|------|
| `packages/ui/src/index.tsx` | 共享 UI 统一导出入口 |
| `packages/ui/src/theme/ThemeContext.tsx` | 主题系统（Provider + Hook + 颜色定义） |
| `packages/ui/src/components/TabIcons.tsx` | 跨平台 SVG 图标集 |
| `packages/ui/src/components/LiquidTabBar.tsx` | Native 液态玻璃底部导航栏 |
| `packages/ui/src/screens/AiCoreScreen.tsx` | AI 锐评核心 UI |
| `packages/ui/src/screens/critiquePrompts.ts` | AI 人格/模型配置 |
| `packages/ui/src/screens/sseParser.ts` | SSE 流式响应解析 |
| `apps/web/components/Sidebar.tsx` | Web 液态玻璃侧边栏 |
| `apps/web/components/AppShell.tsx` | Web 应用外壳（ThemeProvider + 布局） |
| `apps/web/styles/global.css` | 全局样式（侧边栏动画、布局、玻璃效果） |
| `apps/web/app/api/critique/route.ts` | AI API 代理（阿里百炼 → SSE） |

### Web Stub 文件

| 文件 | 替代模块 |
|------|----------|
| `apps/web/stubs/react-native-svg.js` | `react-native-svg` → HTML SVG 元素 |
| `apps/web/stubs/expo-blur.js` | `expo-blur` → 透传 children |
| `apps/web/stubs/react-native-safe-area-context.js` | `react-native-safe-area-context` → 零值 insets |

---

## 11. DevContainer 配置摘要

- **基础镜像**：Node.js 环境
- **持久卷**：Claude Code 认证数据 + VS Code Server 缓存（容器 rebuild 不丢失）
- **代理**：自动配置 HTTP/HTTPS 代理指向宿主机 `host.docker.internal:7897`
- **端口转发**：7878 (Web)、9191 (Metro)、4040 (ngrok)
- **预装插件**：ESLint、Prettier、Expo Tools、Claude Code、GitHub Copilot
- **安全**：`seccomp: unconfined` + `SYS_ADMIN`（Metro/Docker 需要）
