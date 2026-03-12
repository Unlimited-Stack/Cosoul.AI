/**
 * PersonaAgent — 客户端服务层（当前全 Proxy，未来 Native 改 Direct）
 *
 * 与 LLM 模块的关键区别：
 *   LLM  数据源 = 公网 API（Coding Plan） → Native 可直连（Direct 模式）
 *   Persona 数据源 = PostgreSQL 本地 DB   → 必须经过服务端（Proxy 模式）
 *
 * 当前通路（开发阶段，DB 在本地）：
 *   Web 浏览器  → createProxyPersonaService("/api")       → BFF → DB
 *   Expo Web    → createProxyPersonaService(WEB_BFF_URL)  → BFF → DB
 *   Native 手机 → createProxyPersonaService(metroApiUrl)  → Metro 代理 → BFF → DB
 *
 * 未来通路（上云后，Persona API 部署到公网）：
 *   Native 手机 → createDirectPersonaService(cloudUrl, key) → 云端 API（Direct 模式）
 *   Web 浏览器  → createProxyPersonaService("/api")         → BFF → 云端 API
 *
 * 详见 docs/persona-vs-llm-网络架构差异.md
 */

// ─── 服务接口定义 ──────────────────────────────────────────────────

/** PersonaService 统一接口，服务端与客户端 Proxy 共用 */
export interface PersonaServiceLike {
  listPersonas(): Promise<{ personaId: string; name: string; bio?: string }[]>;
  createPersona(input: {
    name: string;
    bio: string;
    coreIdentity: string;
    preferences: string;
  }): Promise<{ personaId: string; name: string; bio?: string }>;
  listTasks(
    personaId: string
  ): Promise<
    {
      taskId: string;
      rawDescription: string;
      status: string;
      targetActivity?: string;
      interactionType: string;
    }[]
  >;
  createTask(
    personaId: string,
    input: { rawDescription: string; interactionType: string }
  ): Promise<{
    taskId: string;
    rawDescription: string;
    status: string;
    interactionType: string;
  }>;
  deletePersona(personaId: string): Promise<void>;
  deleteTask(personaId: string, taskId: string): Promise<void>;
}

// ─── 通用 fetch 封装 ──────────────────────────────────────────────

/** 封装 fetch，统一处理错误和 JSON 解析 */
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new Error(`[PersonaProxy] ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ─── Proxy 工厂函数 ───────────────────────────────────────────────

/**
 * 创建客户端 Proxy 服务实例
 * @param baseUrl - BFF 路由前缀，如 "/api" 或 "http://192.168.x.x:3030/api"
 */
export function createProxyPersonaService(
  baseUrl: string
): PersonaServiceLike {
  return {
    /** 获取当前用户的分身列表 */
    async listPersonas() {
      return request(`${baseUrl}/personas`);
    },

    /** 创建新分身 */
    async createPersona(input) {
      return request(`${baseUrl}/personas`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    /** 获取指定分身的任务列表 */
    async listTasks(personaId) {
      return request(`${baseUrl}/personas/${personaId}/tasks`);
    },

    /** 为指定分身创建新任务 */
    async createTask(personaId, input) {
      return request(`${baseUrl}/personas/${personaId}/tasks`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    /** 删除分身（级联删除关联任务） */
    async deletePersona(personaId) {
      await request(`${baseUrl}/personas/${personaId}`, { method: "DELETE" });
    },

    /** 删除单个任务 */
    async deleteTask(personaId, taskId) {
      await request(`${baseUrl}/personas/${personaId}/tasks/${taskId}`, { method: "DELETE" });
    },
  };
}

// ─── 平台自适应工厂 ──────────────────────────────────────────────

/**
 * 平台标识 — App 层在初始化时传入，工厂据此选择正确的数据通路。
 * - "web-browser"：Next.js 前端，同源 BFF Proxy ("/api")
 * - "expo-web"：Expo Web 模式，跨域 BFF Proxy（需显式传 proxyBaseUrl）
 * - "native"：React Native 手机端，开发阶段走 Metro 代理 → BFF（Proxy），
 *             上云后改为直连云端 Persona API（Direct）
 */
export type PersonaPlatform = "web-browser" | "expo-web" | "native";

export interface PlatformPersonaConfig {
  platform: PersonaPlatform;
  /** BFF 地址 — expo-web / native 必须提供 */
  proxyBaseUrl?: string;
}

/**
 * 统一 Service 工厂 — 根据平台自动选择正确的数据通路。
 * App 层只需调用一次，然后注入 Screen 组件。
 *
 * @example
 * // Next.js Web（同源 BFF Proxy）
 * createPersonaServiceForPlatform({ platform: "web-browser" })
 *
 * // Expo Web（跨域 BFF Proxy）
 * createPersonaServiceForPlatform({ platform: "expo-web", proxyBaseUrl: "http://localhost:3030/api" })
 *
 * // Native 手机（开发阶段：Metro 代理 → BFF，proxyBaseUrl 由 getApiUrl.ts 从 Metro hostUri 推导）
 * createPersonaServiceForPlatform({ platform: "native", proxyBaseUrl: "http://<metro-host>/api" })
 *
 * // 未来上云后 Native 将改为：
 * // createPersonaServiceForPlatform({ platform: "native", baseUrl: "https://api.cosoul.ai", apiKey: "..." })
 */
export function createPersonaServiceForPlatform(
  config: PlatformPersonaConfig
): PersonaServiceLike {
  switch (config.platform) {
    case "web-browser":
      return createProxyPersonaService(config.proxyBaseUrl ?? "/api");

    case "expo-web":
      if (!config.proxyBaseUrl) {
        throw new Error("expo-web 平台必须提供 proxyBaseUrl（BFF 地址）");
      }
      return createProxyPersonaService(config.proxyBaseUrl);

    case "native":
      if (!config.proxyBaseUrl) {
        throw new Error("native 平台必须提供 proxyBaseUrl（BFF 地址，需从 Metro hostUri 推导）");
      }
      return createProxyPersonaService(config.proxyBaseUrl);

    default:
      throw new Error(`未知平台: ${config.platform as string}`);
  }
}
