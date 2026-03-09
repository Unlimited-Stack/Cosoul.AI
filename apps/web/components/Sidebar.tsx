/**
 * Sidebar.tsx — Web 端液态玻璃侧边栏
 *
 * 特性：
 *   - 点击顶部 Logo / 展开按钮可切换 展开(icon+文字) / 收起(仅icon) 两种模式
 *   - 展开收起过程中药丸、标签、宽度均有平滑过渡动画
 *   - 图标与 Native 端共享同一套 react-native-svg 组件（通过 Web stub 渲染为 HTML SVG）
 *   - 选中项使用液态玻璃药丸高亮，切换 tab 时药丸纵向平滑滑动
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useMemo } from "react";
import {
  MessageIcon, CommunityIcon, PlusCircleIcon, CompassIcon, PersonIcon,
  SettingsIcon, PaletteIcon, SidebarToggleIcon,
} from "@repo/ui";

/* ================================================================
 * 导航项配置——"我的"已移至底部头像区，主导航仅保留 4 项
 * ================================================================ */
const NAV_ITEMS = [
  { href: "/feed",     Icon: CommunityIcon,  label: "首页" },
  { href: "/cards",    Icon: CompassIcon,    label: "发现" },
  { href: "/messages", Icon: MessageIcon,    label: "消息" },
  { href: "/ai-core",  Icon: PlusCircleIcon, label: "锐评" },
];

// 每个导航项的高度 + 间距，用于计算药丸 translateY
const ITEM_HEIGHT = 44;
const ITEM_GAP = 4;
const PILL_STEP = ITEM_HEIGHT + ITEM_GAP;

/* ================================================================
 * Sidebar 组件
 * ================================================================ */
interface SidebarProps {
  isDark: boolean;
}

export function Sidebar({ isDark }: SidebarProps) {
  const [expanded, setExpanded] = useState(false);
  const pathname = usePathname();

  // 当前激活项索引（-1 表示不在主导航中，如 /profile、/settings）
  const activeIndex = useMemo(() => {
    const idx = NAV_ITEMS.findIndex((item) => pathname.startsWith(item.href));
    if (idx >= 0) return idx;
    if (pathname === "/") return 0; // 根路径默认首页
    return -1;
  }, [pathname]);

  // 药丸 Y 偏移；-1 时隐藏
  const pillY = activeIndex >= 0 ? activeIndex * PILL_STEP : 0;
  const pillVisible = activeIndex >= 0;

  // 图标颜色——根据主题和激活状态决定
  const activeColor = isDark ? "#FF375F" : "#FF2D55";
  const inactiveColor = isDark ? "#9e9ea3" : "#666";

  // 组合 class
  const sidebarClass = [
    "sidebar",
    isDark ? "dark" : "",
    expanded ? "expanded" : "",
  ].filter(Boolean).join(" ");

  return (
    <aside className={sidebarClass}>
      {/* 顶部区域：Logo + 展开/收起按钮 */}
      <div className="sidebar-header">
        <button
          className="sidebar-logo-btn"
          onClick={() => setExpanded(!expanded)}
          title={expanded ? "收起侧边栏" : "展开侧边栏"}
        >
          <PaletteIcon size={28} color={isDark ? "#e0e0e0" : "#333"} />
        </button>
        {/* 展开时显示切换按钮 */}
        <button
          className="sidebar-collapse-btn"
          onClick={() => setExpanded(!expanded)}
          title={expanded ? "收起侧边栏" : "展开侧边栏"}
        >
          <SidebarToggleIcon size={20} color={isDark ? "#b0b0b5" : "#666"} flipped={expanded} />
        </button>
      </div>

      {/* 导航列表 */}
      <nav className="sidebar-nav">
        {/* 液态玻璃药丸——随 tab 切换纵向滑动；底部项激活时隐藏 */}
        <div
          className={`sidebar-pill${isDark ? " dark" : ""}`}
          style={{
            transform: `translateY(${pillY}px)`,
            opacity: pillVisible ? 1 : 0,
          }}
        />

        {NAV_ITEMS.map((item) => {
          const isActive =
            pathname.startsWith(item.href) ||
            (pathname === "/" && item.href === "/feed");  // 根路径高亮首页

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`sidebar-item${isActive ? " active" : ""}`}
            >
              <span className="sidebar-icon">
                <item.Icon size={24} color={isActive ? activeColor : inactiveColor} />
              </span>
              <span className="sidebar-label">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* 底部区域：头像（→ 我的）+ 设置齿轮 */}
      <div className="sidebar-footer">
        <Link
          href="/profile"
          className={`sidebar-footer-item${pathname.startsWith("/profile") ? " active" : ""}`}
          title="我的"
        >
          <span className="sidebar-avatar">
            <PersonIcon size={20} color={pathname.startsWith("/profile") ? activeColor : inactiveColor} />
          </span>
          <span className="sidebar-label">我的</span>
        </Link>
        <Link
          href="/settings"
          className={`sidebar-footer-item${pathname.startsWith("/settings") ? " active" : ""}`}
          title="设置"
        >
          <span className="sidebar-icon">
            <SettingsIcon size={22} color={pathname.startsWith("/settings") ? activeColor : inactiveColor} />
          </span>
          <span className="sidebar-label">设置</span>
        </Link>
      </div>
    </aside>
  );
}
