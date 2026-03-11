/**
 * PersonaAgent — 客户端 Proxy 服务层
 *
 * 浏览器端使用，通过 fetch 调用 BFF 路由，不依赖 drizzle/pg。
 * 适用于 Web（Next.js 客户端组件）和 Native（Expo）。
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
 * @param baseUrl - BFF 路由前缀，如 "/api" 或 "https://example.com/api"
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
  };
}
