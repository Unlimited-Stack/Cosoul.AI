/**
 * metro.config.js
 * Metro 配置 + BFF 代理中间件（开发阶段临时方案）
 *
 * ⚠️ 这不是 Direct 模式，本质是 Proxy：Native → Metro → BFF → DB
 *
 * 为什么需要：
 *   Expo 隧道 / LAN 只暴露 Metro 端口（8089），
 *   手机无法直接访问 BFF 端口（3030）。
 *   → 在 Metro 上挂 /api/* 代理，转发到 localhost:3030
 *
 * 与 LLM 的区别：
 *   LLM 对接公网 API — Native 可直连（真正的 Direct 模式）
 *   Persona 对接本地 DB — 必须经过服务端，Metro 代理只是开发时的桥梁
 *
 * 上云后删除：当 Persona API 部署到公网，Native 直连云端 API，
 * 届时此代理中间件和 getApiUrl.ts 的 Metro 探测逻辑一并移除。
 * 详见 packages/core/src/docs/persona-vs-llm-网络架构差异.md
 */
const http = require('http');
const { getDefaultConfig } = require('expo/metro-config');
const { getWatchFolders } = require('@expo/metro-config/build/getWatchFolders');
const { getModulesPaths } = require('@expo/metro-config/build/getModulesPaths');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

// ── monorepo 支持 ──
config.watchFolders = getWatchFolders(projectRoot);
config.resolver.nodeModulesPaths = getModulesPaths(projectRoot);

// ── BFF 代理中间件 ──────────────────────────────────────────────
// 拦截 /api/* 请求，代理到 Next.js BFF (localhost:3030)
// 这样 Native 通过 Expo 隧道也能访问 Persona/Debug 等 BFF 接口
const BFF_PORT = 3030;

config.server = config.server || {};
const originalEnhance = config.server.enhanceMiddleware;

config.server.enhanceMiddleware = (metroMiddleware, metroServer) => {
  const enhanced = originalEnhance
    ? originalEnhance(metroMiddleware, metroServer)
    : metroMiddleware;

  return (req, res, next) => {
    // 只代理 /api/ 开头的请求
    if (req.url && req.url.startsWith('/api/')) {
      const proxyReq = http.request(
        {
          hostname: 'localhost',
          port: BFF_PORT,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: `localhost:${BFF_PORT}` },
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
        },
      );

      proxyReq.on('error', (err) => {
        console.warn(`[Metro→BFF] 代理失败: ${err.message}`);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'BFF 不可达', message: err.message }));
      });

      req.pipe(proxyReq);
      return;
    }

    // 其他请求交给 Metro 处理
    enhanced(req, res, next);
  };
};

module.exports = config;
