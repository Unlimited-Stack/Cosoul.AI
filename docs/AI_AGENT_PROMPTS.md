# 项目开发文档 (给 Code Agent 看的拆解版)

请将以下内容保存为 `docs/AI_AGENT_PROMPTS.md`，然后分阶段将引用框里的内容复制给你的 Cursor / Claude Code 执行。

---

## 阶段一：DevContainer 容器化配置与系统环境初始化 (标准云原生版)

**目标：** 在云端配置标准的 Node.js + Expo 开发环境，引入 Docker Compose 以便未来轻松扩展数据库，并配置 .dockerignore 保证构建极速。

🤖 **请发给你的 AI Agent：**

> 你现在是我的云原生架构师。我们要在 GitHub Codespaces / 云主机中开发一个名为“AI Photo Reviewer”的全栈应用（基于 Turborepo: Next.js + Expo）。
> 
> 请帮我在项目根目录创建 `.devcontainer` 文件夹，并生成以下完整的云原生配置文件：
> 
> **1. 创建 `.devcontainer/Dockerfile`，内容如下：**
> ```dockerfile
> FROM [mcr.microsoft.com/devcontainers/javascript-node:20](https://mcr.microsoft.com/devcontainers/javascript-node:20)
> 
> # 安装常用工具和 Expo 开发所需的依赖
> RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
>     && apt-get install -y \
>     git \
>     curl \
>     wget \
>     android-tools-adb \
>     && apt-get clean && rm -rf /var/lib/apt/lists/*
> 
> # 全局安装 expo-cli 和 eas-cli
> RUN npm install -g expo-cli eas-cli npm-check-updates
> ```
> 
> **2. 创建 `.devcontainer/docker-compose.yml`，内容如下：**
> ```yaml
> version: '3.8'
> services:
>   app:
>     build: 
>       context: .
>       dockerfile: Dockerfile
>     volumes:
>       - ../:/workspace:cached
>     # 保持容器一直运行
>     command: /bin/sh -c "while sleep 1000; do :; done"
>     # 预留给后续可能加入的 db 服务等
>     network_mode: service:app
> ```
> 
> **3. 创建 `.devcontainer/devcontainer.json`，内容如下 (注意已改为 Compose 模式)：**
> ```json
> {
>   "name": "AI Photo Reviewer Dev Env",
>   "dockerComposeFile": "docker-compose.yml",
>   "service": "app",
>   "workspaceFolder": "/workspace",
>   "customizations": {
>     "vscode": {
>       "extensions": [
>         "dbaeumer.vscode-eslint",
>         "esbenp.prettier-vscode",
>         "bradlc.vscode-tailwindcss",
>         "expo.vscode-expo-tools"
>       ]
>     }
>   },
>   "forwardPorts": [7878, 9191],
>   "remoteUser": "node"
> }
> ```
> 
> **4. 在项目根目录（不是 .devcontainer 里）创建 `.dockerignore`，内容如下：**
> ```text
> node_modules
> npm-debug.log
> .git
> .next
> .expo
> dist
> build
> .env*
> !.env.example
> ```
> 
> 请在所有文件创建完成后通知我。
*(开发者手动操作：使用 VS Code 的 `Dev Containers: Rebuild Container` 重建环境，等待完成后进入下一步)*

---

## 阶段二：Turborepo (Next.js + Expo) 骨架搭建

**目标：** 使用官方模板极速拉起 Monorepo 目录结构。

🤖 **请发给你的 AI Agent：**

> 容器环境已就绪。现在请帮我初始化项目架构。
> 
> 1. 请在当前根目录执行以下命令，使用官方的 Expo + Next.js 模板创建 Turborepo 工作区（如果在根目录直接生成有冲突，请建在 `ai-photo-reviewer` 文件夹中并帮我移动出来）：
>    `npx create-turbo@latest . --example with-expo --package-manager npm`
> 2. 执行完毕后，运行 `npm install` 确保所有工作区的依赖安装完毕。
> 3. 请向我简要汇报 `apps/web` 和 `apps/native` 的目录结构是否生成成功。

---

## 阶段三：编写 Expo 原生 5 Tab 导航 (移动端 UI MVP)

**目标：** 抛弃默认页面，使用 `expo-router` 构建符合小红书形态的底部 5 个 Tab。

🤖 **请发给你的 AI Agent：**

> 现在我们来集中处理移动端 UI。请进入 `apps/native` (或 `apps/expo`，根据上一步生成的目录名为准) 目录。
> 这个模板默认使用了 `expo-router`。请帮我重构它的路由文件，实现一个底部包含 5 个 Tab 的导航结构：
> 
> 1. 请在 `app/(tabs)` 目录下创建或修改 `_layout.tsx`，配置一个 Tabs 导航器。
> 2. 创建 5 个页面文件（只需极简的占位文本和背景色即可）：
>    - `index.tsx` (对应 Tab 1: 消息/公告)
>    - `feed.tsx` (对应 Tab 2: 瀑布流)
>    - `ai-core.tsx` (对应 Tab 3: 居中的相片锐评核心，突出显示)
>    - `cards.tsx` (对应 Tab 4: 随机神评卡片)
>    - `profile.tsx` (对应 Tab 5: 我的主页)
> 3. 在 `_layout.tsx` 中为这 5 个页面配置对应的 `Tabs.Screen`，并设置简单的文本 Icon 区分它们。
> 
> 请完成后确认，不需要写复杂的 CSS，只要确保点击底部栏能切换 5 个不同的页面即可。

---

## 阶段四：跨端启动与内网穿透真机预览

**目标：** 启动 Web 和 App 服务，并使用 tunnel 让手机直接扫码。

🤖 **请发给你的 AI Agent：**

> UI 骨架已搭好。现在我们要测试多端运行。
> 
> 1. 请帮我修改根目录的 `package.json`，在 `scripts` 中添加一个专门用于云端调试 App 的命令：
>    `"dev:mobile": "turbo run dev --filter=native -- --tunnel"`
>    *(注：如果是 `apps/expo` 请替换 filter 的名字)*
> 2. 请告诉我，如果在终端执行 `npm run dev:mobile`，系统会发生什么？并指导我如何用手机上的 Expo Go App 扫描生成的二维码来查看刚才写的 5 Tab 界面。

---

💡 **开发者下一步手动验证：**

按照 Agent 的指导，在终端跑起 `--tunnel` 模式后：
1. 打开你手机上的 **Expo Go**。
2. 扫描终端里弹出的二维码。
3. **见证魔法：** 你的手机上会出现一个流畅的原生 App，底部有 5 个 Tab，点击切换毫无卡顿！这就是你产品的基本盘了。