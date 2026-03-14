/**
 * AppShell.tsx — Web 端应用外壳
 * 职责：
 *   1. ThemeProvider（主题上下文）
 *   2. AuthProvider（认证状态上下文）
 *   3. 根据登录状态：已登录 → Sidebar + 内容区；未登录 → 认证页面
 */
"use client";

import { ThemeProvider, useTheme, AuthProvider, useAuth } from "@repo/ui";
import { Sidebar } from "./Sidebar";
import { AuthPages } from "./AuthPages";
import { webTokenStorage } from "../lib/tokenStorage";

// 内层组件：根据认证状态切换布局
function ShellInner({ children }: { children: React.ReactNode }) {
  const { colors, isDark } = useTheme();
  const { isAuthenticated, loading } = useAuth();

  // 初始化中显示加载
  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          backgroundColor: colors.bg,
          color: colors.subtitle,
          fontSize: 16,
        }}
      >
        加载中...
      </div>
    );
  }

  // 未登录 → 认证页面
  if (!isAuthenticated) {
    return <AuthPages />;
  }

  // 已登录 → 正常布局
  return (
    <div className="app-shell" style={{ backgroundColor: colors.bg }}>
      <Sidebar isDark={isDark} />
      <main
        className="main-content"
        style={{ backgroundColor: colors.bg, color: colors.text }}
      >
        {children}
      </main>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider apiBaseUrl="/api" tokenStorage={webTokenStorage} deviceInfo="Chrome / Web">
        <ShellInner>{children}</ShellInner>
      </AuthProvider>
    </ThemeProvider>
  );
}
