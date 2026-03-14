/**
 * UserService — 客户端 Proxy 层
 *
 * 与 PersonaService proxy 相同的模式（开发阶段全部走 Metro 代理）：
 *   Web 浏览器  → createProxyUserService("/api")          → BFF → DB
 *   Expo Web    → createProxyUserService("/api")          → Metro 代理 → BFF → DB
 *   Native 手机 → createProxyUserService(metroApiUrl)     → Metro 代理 → BFF → DB
 */

// ─── 用户公开信息类型（与 service.ts 保持一致）──────────────────
export interface UserProfile {
  userId: string;
  email: string;
  phone: string | null;
  name: string | null;
  avatarUrl: string | null;
  gender: string | null;
  birthday: string | null;
  bio: string | null;
  interests: string[];
  school: string | null;
  location: string | null;
  subscriptionTier: string;
  subscriptionExpiresAt: string | null; // JSON 序列化后为 ISO string
  createdAt: string;
}

export interface UpdateProfileInput {
  name?: string;
  avatarUrl?: string;
  gender?: string;
  birthday?: string;
  bio?: string;
  interests?: string[];
  school?: string;
  location?: string;
}

/** UserService 统一接口 */
export interface UserServiceLike {
  getProfile(): Promise<UserProfile>;
  updateProfile(input: UpdateProfileInput): Promise<UserProfile>;
}

/** Token 获取器：返回当前有效的 accessToken（可选） */
export type TokenGetter = () => string | null;

// ─── 通用 fetch 封装 ──────────────────────────────────────────────
async function request<T>(url: string, options?: RequestInit, getToken?: TokenGetter): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken?.();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, { headers, ...options });
  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new Error(`[UserProxy] ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ─── Proxy 工厂 ───────────────────────────────────────────────────

/**
 * 创建客户端 User Proxy 服务
 * @param baseUrl BFF 路由前缀，如 "/api"
 * @param getToken 可选的 token 获取器，每次请求时调用获取最新 accessToken
 */
export function createProxyUserService(baseUrl: string, getToken?: TokenGetter): UserServiceLike {
  return {
    async getProfile() {
      return request(`${baseUrl}/user/profile`, undefined, getToken);
    },
    async updateProfile(input) {
      return request(`${baseUrl}/user/profile`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }, getToken);
    },
  };
}

// ─── 平台自适应工厂 ──────────────────────────────────────────────
export type UserPlatform = "web-browser" | "expo-web" | "native";

export interface PlatformUserConfig {
  platform: UserPlatform;
  proxyBaseUrl?: string;
}

export function createUserServiceForPlatform(
  config: PlatformUserConfig & { getToken?: TokenGetter },
): UserServiceLike {
  switch (config.platform) {
    case "web-browser":
      return createProxyUserService(config.proxyBaseUrl ?? "/api", config.getToken);
    case "expo-web":
    case "native":
      if (!config.proxyBaseUrl) {
        throw new Error(`${config.platform} 平台必须提供 proxyBaseUrl`);
      }
      return createProxyUserService(config.proxyBaseUrl, config.getToken);
    default:
      throw new Error(`未知平台: ${config.platform as string}`);
  }
}
