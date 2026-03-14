/**
 * AuthService — 客户端 Proxy 层
 *
 * 提供统一的 AuthServiceLike 接口，客户端通过 HTTP 调用 BFF auth 路由。
 * Web / Expo Web / Native 全平台通用。
 */

// ─── 类型 ────────────────────────────────────────────────────────

export interface AuthUser {
  userId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  subscriptionTier: string;
}

export interface AuthTokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult {
  user: AuthUser;
  tokens: AuthTokenPair;
}

export interface AuthServiceLike {
  register(input: { email: string; password: string; name?: string; deviceInfo?: string }): Promise<AuthResult>;
  login(input: { email: string; password: string; deviceInfo?: string }): Promise<AuthResult>;
  refresh(refreshToken: string, deviceInfo?: string): Promise<AuthTokenPair>;
  logout(refreshToken: string): Promise<void>;
  forgotPassword(email: string): Promise<void>;
  resetPassword(input: { email: string; code: string; newPassword: string }): Promise<void>;
  changePassword(input: { currentPassword: string; newPassword: string }, accessToken: string): Promise<void>;
  deactivate(password: string, accessToken: string): Promise<void>;
}

// ─── 通用 fetch 封装 ─────────────────────────────────────────────

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "请求失败" }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Proxy 工厂 ──────────────────────────────────────────────────

/**
 * 创建客户端 Auth Proxy 服务
 * @param baseUrl BFF 路由前缀，如 "/api"
 */
export function createProxyAuthService(baseUrl: string): AuthServiceLike {
  return {
    async register(input) {
      return request(`${baseUrl}/auth/register`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async login(input) {
      return request(`${baseUrl}/auth/login`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async refresh(refreshToken, deviceInfo) {
      return request(`${baseUrl}/auth/refresh`, {
        method: "POST",
        body: JSON.stringify({ refreshToken, deviceInfo }),
      });
    },
    async logout(refreshToken) {
      await request(`${baseUrl}/auth/logout`, {
        method: "POST",
        body: JSON.stringify({ refreshToken }),
      });
    },
    async forgotPassword(email) {
      await request(`${baseUrl}/auth/forgot-password`, {
        method: "POST",
        body: JSON.stringify({ email }),
      });
    },
    async resetPassword(input) {
      await request(`${baseUrl}/auth/reset-password`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async changePassword(input, accessToken) {
      await request(`${baseUrl}/user/change-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(input),
      });
    },
    async deactivate(password, accessToken) {
      await request(`${baseUrl}/user/deactivate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ password }),
      });
    },
  };
}
