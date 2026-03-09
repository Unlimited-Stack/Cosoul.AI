# 架构常见 Debug 指南

## 架构概览

```
/workspaces/            ← monorepo 根（npm workspaces + Turborepo）
├── apps/
│   ├── native/         ← Expo SDK 55（React Native + expo-router）
│   └── web/            ← Next.js
├── packages/
│   └── ui/             ← 共享组件库 @repo/ui（tsup 构建）
├── package.json
└── turbo.json
```

---

## Bug 1：Native 界面渲染空白，显示 expo-router Tutorial 默认页

### 根因

`babel.config.js` 中 `transform-inline-environment-variables`（plugin）与 `babel-preset-expo`（preset）执行顺序冲突：

- Babel 执行顺序：**plugins 先于 presets**
- `transform-inline-environment-variables` 先把 `process.env.EXPO_ROUTER_APP_ROOT` 替换为字面量 `'./app'`
- `babel-preset-expo` 内置的 `expoRouterBabelPlugin` 后执行，发现 MemberExpression 已消失，无法计算正确的相对路径
- `expo-router/_ctx.ios.js` 中 `require.context('./app')` 相对于 `node_modules/expo-router/` 是错误路径
- 路由找不到 → 显示 Tutorial 默认页

同时 `expo-router/babel` 在 SDK 50 起已废弃，SDK 55 中是空 noop，保留只会输出警告。

### 修复

`apps/native/babel.config.js` 删除两个多余 plugin，只保留 `babel-preset-expo`（它已内置所有必要转换）：

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: extraPlugins, // 见 Bug 2
  };
};
```

---

## Bug 2：Android Bundling 报错 `Invalid call: process.env.EXPO_ROUTER_APP_ROOT`

### 根因

npm workspace 的 hoist 不对称，导致 `babel-preset-expo` 内部条件判断失效：

```
babel-preset-expo  → /workspaces/node_modules/       ← 被 hoist 到根
expo-router        → apps/native/node_modules/        ← 未被 hoist（版本冲突等原因）

babel-preset-expo 内部：
  if (hasModule('expo-router'))          // require.resolve 从根 node_modules 出发
    extraPlugins.push(expoRouterBabelPlugin)

hasModule('expo-router') === false       // 根 node_modules 找不到 expo-router
→ expoRouterBabelPlugin 不被加入
→ process.env.EXPO_ROUTER_APP_ROOT 永远不被替换
→ Metro collectDependencies 报错：First argument of require.context must be a string
```

### 修复

在 `babel.config.js` 中从 `apps/native/` 上下文手动检测并补充插件，绕过 `hasModule` 的路径限制：

```js
// apps/native/babel.config.js
let extraPlugins = [];
try {
  require.resolve('expo-router', { paths: [__dirname] }); // 从 apps/native/ 出发能找到
  const { expoRouterBabelPlugin } = require('babel-preset-expo/build/expo-router-plugin');
  extraPlugins = [expoRouterBabelPlugin];
} catch (_) {}

module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: extraPlugins,
  };
};
```

---

## Bug 3：`@repo/ui` 热更新失效 / 共享包无法 bundle

### 根因

Metro 默认只 watch `apps/native/` 目录，无法访问 `packages/ui/` 的源文件（symlink 目标在 projectRoot 之外）：

```
node_modules/@repo/ui → symlink → /workspaces/packages/ui/
Metro projectRoot = /workspaces/apps/native/
Metro 不 watch /workspaces/packages/ui/ → 热更新失效 / bundling 异常
```

### 修复

`apps/native/metro.config.js` 使用 Expo 官方工具自动解析 monorepo 路径：

```js
const { getDefaultConfig } = require('expo/metro-config');
const { getWatchFolders } = require('@expo/metro-config/build/getWatchFolders');
const { getModulesPaths } = require('@expo/metro-config/build/getModulesPaths');

const config = getDefaultConfig(__dirname);
config.watchFolders = getWatchFolders(__dirname);           // 自动包含所有 workspace 包目录
config.resolver.nodeModulesPaths = getModulesPaths(__dirname); // 同时查根和本包 node_modules
module.exports = config;
```

`getWatchFolders(__dirname)` 实际返回：
```
/workspaces/node_modules
/workspaces/apps/web
/workspaces/apps/native
/workspaces/packages/ui
/workspaces/packages/typescript-config
```

---

## SDK 55 + Monorepo 常见陷阱速查

### Babel

| 症状 | 原因 | 解法 |
|------|------|------|
| 警告 `expo-router/babel is deprecated` | SDK 50 起废弃，现为空 noop | 从 plugins 删除 |
| 路由找不到 / Tutorial 默认页 | `transform-inline-environment-variables` 覆盖了 babel-preset-expo 的正确路径计算 | 删除该 plugin |
| `Invalid call: process.env.EXPO_ROUTER_APP_ROOT` | `babel-preset-expo` hoist 到根但 `expo-router` 未 hoist，`hasModule` 返回 false | babel.config.js 手动补充 `expoRouterBabelPlugin` |

### Metro

| 症状 | 原因 | 解法 |
|------|------|------|
| 共享包改动无效果 | Metro 不 watch packages/ 目录 | `getWatchFolders()` |
| `Cannot resolve module '@repo/ui'` | Metro resolver 不知道根 node_modules | `getModulesPaths()` |

### npm hoist

| 症状 | 原因 | 解法 |
|------|------|------|
| 同一包在多处存在（如 react-native 0.83.0 vs 0.83.2）| workspace 间版本不一致，npm 放弃 hoist | 统一各 workspace 的版本号 |
| Babel/Metro 工具从错误位置解析模块 | 工具包在根，目标包在子 workspace | 显式传 `{ paths: [__dirname] }` 或手动 require |

### 通用

| 操作 | 时机 |
|------|------|
| `npm run dev:tunnel:clear`（加 `--clear`）| 每次修改 babel.config.js / metro.config.js 后必须执行 |
| 从 `apps/native/` 目录启动 expo | 避免 Metro projectRoot 指向 monorepo 根，导致路径全部错误 |
