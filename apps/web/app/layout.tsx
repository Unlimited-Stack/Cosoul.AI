/**
 * layout.tsx — Web 端根布局
 * 提供左右分栏结构：左侧液态玻璃侧边栏 + 右侧页面内容区。
 * 使用 ThemeProvider 统一管理深浅色模式（与 Native 端共享同一套主题系统）。
 */
import "../styles/global.css";
import { AppShell } from "../components/AppShell";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
