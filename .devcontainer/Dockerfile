FROM mcr.microsoft.com/devcontainers/javascript-node:20

ENV DEBIAN_FRONTEND=noninteractive

# 安装常用工具与 React Native DevTools 可执行所需系统依赖（Chromium/Electron 运行时依赖）
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    git-lfs \
    curl \
    wget \
    lsof \
    psmisc \
    ca-certificates \
    xdg-utils \
    fonts-liberation \
    # Electron/Chromium 常见依赖（GTK/GLib/Pango/Cairo/X11 等）
    libgtk-3-0 \
    libnss3 \
    libasound2 \
    libcups2 \
    libxss1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libdrm2 \
    libxshmfence1 \
    libxcomposite1 \
    libxcursor1 \
    libxi6 \
    libxtst6 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libpangocairo-1.0-0 \
    libpango-1.0-0 \
    libcairo2 \
    libx11-6 \
    libx11-xcb1 \
    && rm -rf /var/lib/apt/lists/* \
    && git lfs install --system

# 预创建 volume 挂载点并设置正确权限
# 这样 Docker 挂载命名 volume 时目录已存在且 owner 是 node，
# 避免 Docker 自动创建 root 权限目录导致 VS Code Server 写入失败
RUN mkdir -p /home/node/.vscode-server /home/node/.claude \
    && chown -R node:node /home/node/.vscode-server /home/node/.claude