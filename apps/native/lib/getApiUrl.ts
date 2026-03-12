/**
 * getApiUrl.ts
 * Native App 层 — 平台检测 + API 地址推导（开发阶段临时方案）
 *
 * ⚠️ Persona ≠ LLM Direct 模式
 *   LLM: Native 直连公网 API（真 Direct）
 *   Persona: Native → Metro 代理 → BFF → DB（本质是 Proxy，Metro 只是桥梁）
 *
 * 当前通路：
 *   Web 浏览器  → 同源 BFF "/api"                         → DB
 *   Expo Web    → 跨域 BFF "http://localhost:3030/api"    → DB
 *   Native 手机 → Metro:8089/api/* → 代理中间件 → BFF:3030 → DB
 *
 * 为什么 Native 不能直连 BFF:3030？
 *   Expo 隧道只暴露 Metro 端口，手机访问不到 3030。
 *
 * 上云后改造：Native 直连云端 Persona API（真 Direct 模式），
 * 届时删除 Metro 代理中间件和本文件的 Metro hostUri 探测逻辑。
 * 详见 packages/core/src/docs/persona-vs-llm-网络架构差异.md
 */
import { NativeModules, Platform } from "react-native";
import Constants from "expo-constants";
import type { PersonaPlatform, PlatformPersonaConfig } from "@repo/core/persona";

const extra = Constants.expoConfig?.extra ?? {};
const WEB_BFF_URL = extra.webBffUrl ?? "http://localhost:3030/api";

// ─── Metro 开发服务器地址探测 ────────────────────────────────────

/**
 * 从多个来源获取 Metro 开发服务器的主机地址（含端口）
 * 返回值示例：
 *   LAN 模式: "192.168.x.x:8089"
 *   隧道模式: "sfxxbfg-anonymous-8089.exp.direct"（无端口）
 */
function getDevServerHost(): string | null {
  // 方式1: expoConfig.hostUri（@expo/cli 开发模式注入）
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) return hostUri;

  // 方式2: manifest.hostUri（兼容旧版 Expo SDK）
  const manifestHostUri = (Constants as any).manifest?.hostUri;
  if (manifestHostUri) return manifestHostUri;

  // 方式3: manifest.debuggerHost
  const debuggerHost = (Constants as any).manifest?.debuggerHost;
  if (debuggerHost) return debuggerHost;

  // 方式4: 从 JS bundle URL 中提取（最可靠，Metro 一定在服务 bundle）
  try {
    const scriptURL =
      NativeModules?.SourceCode?.scriptURL ??
      NativeModules?.SourceCode?.getConstants?.()?.scriptURL;
    if (scriptURL) {
      const match = scriptURL.match(/^https?:\/\/([^/]+)/);
      if (match) return match[1];
    }
  } catch {
    // ignore
  }

  return null;
}

// ─── 平台配置推导 ────────────────────────────────────────────────

/**
 * 推导当前运行平台的 Persona API 地址。
 *
 * Native 使用 Metro 地址 + /api 路径，由 Metro 代理中间件转发到 BFF:3030。
 * 这是开发阶段的临时方案（Expo 隧道只暴露 Metro 端口，手机无法直连 BFF）。
 * 上云后改为直连云端 Persona API URL，不再依赖 Metro 探测。
 */
export function getPersonaPlatformConfig(): PlatformPersonaConfig {
  if (Platform.OS === "web") {
    return { platform: "expo-web" as PersonaPlatform, proxyBaseUrl: WEB_BFF_URL };
  }

  // Native — 通过 Metro 代理中间件访问 BFF（Proxy 模式，非 Direct）
  const host = getDevServerHost();
  if (host) {
    return {
      platform: "native" as PersonaPlatform,
      proxyBaseUrl: `http://${host}/api`,
    };
  }

  return { platform: "native" as PersonaPlatform, proxyBaseUrl: WEB_BFF_URL };
}

/** 打印诊断信息（排查网络问题后可删除） */
export function logApiDiagnostics(tag: string): void {
  if (!__DEV__) return;
  const config = getPersonaPlatformConfig();
  console.log(`[${tag}] Platform: ${Platform.OS}`);
  console.log(`[${tag}] devServerHost: ${getDevServerHost()}`);
  console.log(`[${tag}] personaConfig:`, JSON.stringify(config));
}

export { WEB_BFF_URL };
