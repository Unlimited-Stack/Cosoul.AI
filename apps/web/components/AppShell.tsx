/**
 * AppShell.tsx — Web 端应用外壳
 * 客户端组件，负责：
 *   1. 包裹 ThemeProvider（主题上下文需要 useState，必须在客户端渲染）
 *   2. 组合左侧 Sidebar + 右侧内容区的分栏布局
 *   3. 将当前主题状态传递给 Sidebar
 */
"use client";

import { ThemeProvider, useTheme } from "@repo/ui";
import { Sidebar } from "./Sidebar";

// 内层组件：能够访问 ThemeProvider 注入的 useTheme
function ShellInner({ children }: { children: React.ReactNode }) {
  const { colors, isDark } = useTheme();

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
      <ShellInner>{children}</ShellInner>
    </ThemeProvider>
  );
}
