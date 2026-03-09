# AI 社区 (AI Community) 

本项目是一个AI社区。采用前沿的 `TypeScript + Next.js + Expo` (基于 Turborepo) 全栈架构，实现 Web 端与移动端 (iOS/Android) 的代码高度复用与多端同构部署。项目专为云原生环境（GitHub Codespaces）设计，无需配置本地 Xcode/Android Studio 即可完成极速跨端开发与真机调试。

## 🎯 核心玩法与产品形态 (MVP 阶段)

应用采用经典的“底部 5 Tab”导航结构，重点验证跨端 UI 渲染性能与 AI 数据流：

1. 💬 **消息/公告 (Tab 1)：** 静态 UI 展示区，用于未来承载系统通知和 AI 锐评完成的推送。
2. 🌊 **灵感瀑布流 (Tab 2)：** 类似小红书的双列图片信息流，展示社区内被公开的精彩相片及点评，重点验证跨端复杂列表的滚动性能。
3. ✨ **AI 锐评核心 (Tab 3 - 居中强视觉)：** 核心交互区。用户上传/拍摄相片，选择“锐评风格”（如：🔥毒舌吐槽、🌈彩虹屁、🧐专业摄影师），调用 AI 多模态大模型输出针对构图、光影、色彩的流式评价。
4. 🃏 **随机神评卡片 (Tab 4)：** 类似探探的卡片滑动或简单的 3-5 张卡片随机展示，验证动画特效与状态管理。
5. 👤 **我的主页 (Tab 5)：** 个人设置、历史锐评记录（本地/云端 Mock 数据）。

## 🛠 技术栈架构 (Turborepo Monorepo)

- **应用层 (`apps/`)**:
  - `apps/web`: 基于 Next.js 14+ (App Router)，负责 Web 端展示与统一的 API 路由（充当后端）。
  - `apps/native`: 基于 Expo (React Native)，负责 iOS/Android 真机渲染。
- **共享层 (`packages/`)**:
  - `packages/ui`: 多端共享的 UI 组件库。
  - `packages/eslint-config-custom`: 统一的代码规范。
- **开发环境**: Docker + GitHub Codespaces (内置 Node.js, Expo CLI, Ngrok 内网穿透)。

## 🚀 快速开始（云原生环境 / SDK 55）

### 前置需求
- GitHub Codespaces 或本地 Docker + Dev Container
- （本地）VS Code + Dev Container Extension

### 初次启动流程

1. **打开 Dev Container**（Codespaces 自动，或本地需执行 `Dev Containers: Reopen in Container`）
   - Dockerfile 会自动安装 Node.js、npm、Expo CLI、Git LFS 等工具

2. **安装依赖**
   ```bash
   npm install
   ```
   - 安装根目录、apps、packages 中所有工作区的依赖

3. **启动开发服务（Monorepo）**
   ```bash
   npm run dev
   ```
   此命令并行启动全部三个任务：
   - **Web (Next.js)**: http://localhost:7878
   - **Native Metro (Expo Tunnel)**: 终端输出二维码，用 Expo Go 扫码；同时 http://localhost:9191 可在浏览器预览 React Native 的 Web 渲染版本
   - **UI Package (tsup watch)**: 自动编译共享组件

### 预览方式

`npm run dev` 一次启动所有服务，无需分别启动。

| 入口 | 说明 |
|------|------|
| http://localhost:7878 | Next.js Web 业务页面 |
| http://localhost:9191 | React Native 的浏览器渲染版（Expo Web） |
| Expo Go 扫码 | 真机预览（iOS / Android） |

- **⚠️ 禁止在真机上手动 Reload**：按 Reload 会重新下载完整 JS bundle（约 5~15MB），须经 ngrok 隧道（手机 → ngrok 云 → Codespaces → Metro）传输，实测单次耗时 **3 分钟以上**（ngrok inspector 记录：`/entry.bundle 200 OK 181s / 202s`）。**修改代码后直接保存即可**，HMR 热更新为增量推送，手机端毫秒级响应，无需 Reload。
- 若遇到缓存或路由异常，改用：
  ```bash
  npm run dev:mobile:clear
  ```

### 端口与入口说明

| 端口 | 进程 | 说明 |
|------|------|------|
| `7878` | Next.js | Web 业务入口 |
| `9191` | Expo Metro | Native bundle 服务 + Expo Web 入口 |
| `4040` | ngrok inspector | 显示所有经过 tunnel 的 HTTP 请求，可在 http://127.0.0.1:4040 打开。主要请求：`/entry.bundle`（JS bundle 下载）、`/message`（WebSocket，用于 HMR 热更新推送）、`/status`（Metro 状态轮询）。用于调试 tunnel 连通性和请求耗时。 |

### 容器环境与配置持久化
- Dev Container 基础镜像为 Alpine；已在 [/.devcontainer/Dockerfile](.devcontainer/Dockerfile) 预装 `gcompat` 与 `libstdc++` 以提升对 glibc 链接二进制的兼容性。
- 如遇到 Expo 未输出二维码/链接，请检查外部环境是否设置了 `CI` 等会导致非交互模式的环境变量。
- 若你修改了 devcontainer 配置，请在 VS Code 中执行一次容器重建：
   ```bash
   # 命令面板
   Dev Containers: Rebuild Container
   ```

### SDK 55 版本矩阵（已对齐）
- Expo SDK: ~55.0.0
- React: 19.2.x
- React Native: 0.83.x
- Expo Router: ~6.0.23

> 说明：Web 同步使用 React 19.2；`packages/ui` 对应的 peer/dev 依赖已对齐 SDK 55，避免多版本冲突。
