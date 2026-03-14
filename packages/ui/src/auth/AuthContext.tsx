/**
 * AuthContext — 跨平台认证状态管理
 *
 * 核心职责：
 *  1. 管理 accessToken / refreshToken / user 状态
 *  2. 提供 login / register / logout / refresh 方法
 *  3. 应用启动时自动尝试用 refreshToken 静默续期
 *  4. accessToken 过期前自动刷新（用户无感知）
 *
 * Token 存储策略：
 *  - accessToken: 仅内存（不持久化）
 *  - refreshToken: 由宿主平台注入的 storage 持久化
 *    Web → localStorage（简化版；生产建议用 HttpOnly Cookie）
 *    Native → expo-secure-store（加密存储）
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// ─── 类型 ────────────────────────────────────────────────────────

export interface AuthUser {
  userId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  subscriptionTier: string;
}

/** 宿主平台注入的 Token 持久化适配器 */
export interface TokenStorage {
  getRefreshToken(): Promise<string | null>;
  setRefreshToken(token: string): Promise<void>;
  removeRefreshToken(): Promise<void>;
}

/** AuthContext 对外暴露的方法和状态 */
export interface AuthContextValue {
  /** 当前用户（未登录为 null） */
  user: AuthUser | null;
  /** 当前 access token（用于 API 请求） */
  accessToken: string | null;
  /** 是否正在初始化（首次加载、尝试自动登录中） */
  loading: boolean;
  /** 是否已登录 */
  isAuthenticated: boolean;
  /** 登录 */
  login(email: string, password: string): Promise<void>;
  /** 注册 */
  register(email: string, password: string, name?: string): Promise<void>;
  /** 登出 */
  logout(): Promise<void>;
}

// ─── Context ─────────────────────────────────────────────────────

const AuthCtx = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth 必须在 AuthProvider 内使用");
  return ctx;
}

// ─── Props ───────────────────────────────────────────────────────

export interface AuthProviderProps {
  children: React.ReactNode;
  /** BFF API 前缀，如 "/api" */
  apiBaseUrl: string;
  /** 平台 Token 存储适配器 */
  tokenStorage: TokenStorage;
  /** 设备信息标识（可选） */
  deviceInfo?: string;
}

// ─── Provider ────────────────────────────────────────────────────

export function AuthProvider({
  children,
  apiBaseUrl,
  tokenStorage,
  deviceInfo,
}: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 通用 fetch ──
  const apiRequest = useCallback(
    async <T,>(path: string, options?: RequestInit): Promise<T> => {
      const res = await fetch(`${apiBaseUrl}${path}`, {
        headers: { "Content-Type": "application/json" },
        ...options,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "请求失败" }));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      return res.json() as Promise<T>;
    },
    [apiBaseUrl],
  );

  // ── 设置自动刷新定时器（过期前 30 秒刷新）──
  const scheduleRefresh = useCallback(
    (token: string) => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      try {
        // 从 JWT 解析过期时间
        const payload = JSON.parse(atob(token.split(".")[1]!));
        const expiresMs = payload.exp * 1000;
        const delay = Math.max(expiresMs - Date.now() - 30_000, 5_000); // 至少 5 秒后
        refreshTimerRef.current = setTimeout(async () => {
          try {
            const rt = await tokenStorage.getRefreshToken();
            if (!rt) return;
            const tokens = await apiRequest<{
              accessToken: string;
              refreshToken: string;
            }>("/auth/refresh", {
              method: "POST",
              body: JSON.stringify({ refreshToken: rt, deviceInfo }),
            });
            setAccessToken(tokens.accessToken);
            await tokenStorage.setRefreshToken(tokens.refreshToken);
            scheduleRefresh(tokens.accessToken);
          } catch {
            // 静默刷新失败 → 不清状态，等用户下一次操作触发 401
          }
        }, delay);
      } catch {
        // JWT 解析失败，不设定时器
      }
    },
    [apiRequest, tokenStorage, deviceInfo],
  );

  // ── 初始化：尝试用 refreshToken 自动登录 ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rt = await tokenStorage.getRefreshToken();
        if (!rt) return;

        const tokens = await apiRequest<{
          accessToken: string;
          refreshToken: string;
        }>("/auth/refresh", {
          method: "POST",
          body: JSON.stringify({ refreshToken: rt, deviceInfo }),
        });

        if (cancelled) return;

        // 拿到新 token，获取用户信息
        setAccessToken(tokens.accessToken);
        await tokenStorage.setRefreshToken(tokens.refreshToken);

        const profile = await fetch(`${apiBaseUrl}/user/profile`, {
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
        }).then((r) => r.json());

        if (cancelled) return;
        setUser({
          userId: profile.userId,
          email: profile.email,
          name: profile.name,
          avatarUrl: profile.avatarUrl,
          subscriptionTier: profile.subscriptionTier,
        });
        scheduleRefresh(tokens.accessToken);
      } catch {
        // 自动登录失败 → 清除旧 token
        await tokenStorage.removeRefreshToken();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 登录 ──
  const loginFn = useCallback(
    async (email: string, password: string) => {
      const result = await apiRequest<{
        user: AuthUser;
        tokens: { accessToken: string; refreshToken: string };
      }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password, deviceInfo }),
      });
      setUser(result.user);
      setAccessToken(result.tokens.accessToken);
      await tokenStorage.setRefreshToken(result.tokens.refreshToken);
      scheduleRefresh(result.tokens.accessToken);
    },
    [apiRequest, tokenStorage, deviceInfo, scheduleRefresh],
  );

  // ── 注册 ──
  const registerFn = useCallback(
    async (email: string, password: string, name?: string) => {
      const result = await apiRequest<{
        user: AuthUser;
        tokens: { accessToken: string; refreshToken: string };
      }>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password, name, deviceInfo }),
      });
      setUser(result.user);
      setAccessToken(result.tokens.accessToken);
      await tokenStorage.setRefreshToken(result.tokens.refreshToken);
      scheduleRefresh(result.tokens.accessToken);
    },
    [apiRequest, tokenStorage, deviceInfo, scheduleRefresh],
  );

  // ── 登出 ──
  const logoutFn = useCallback(async () => {
    try {
      const rt = await tokenStorage.getRefreshToken();
      if (rt) {
        await apiRequest("/auth/logout", {
          method: "POST",
          body: JSON.stringify({ refreshToken: rt }),
        }).catch(() => {}); // 登出失败也继续清理
      }
    } finally {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      setUser(null);
      setAccessToken(null);
      await tokenStorage.removeRefreshToken();
    }
  }, [apiRequest, tokenStorage]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      accessToken,
      loading,
      isAuthenticated: !!user,
      login: loginFn,
      register: registerFn,
      logout: logoutFn,
    }),
    [user, accessToken, loading, loginFn, registerFn, logoutFn],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
