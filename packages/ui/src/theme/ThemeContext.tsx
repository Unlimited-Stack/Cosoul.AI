/**
 * ThemeContext.tsx
 * 全局主题系统：定义浅色/深色颜色方案，提供 ThemeProvider 和 useTheme hook。
 * 支持三种模式：跟随系统（system）、强制浅色（light）、强制深色（dark）。
 */

import React, { createContext, useContext, useState, useMemo } from "react";
import { useColorScheme } from "react-native";

// 主题模式枚举：跟随系统 / 浅色 / 深色
export type ThemeMode = "system" | "light" | "dark";

// 全局颜色 token 接口——所有组件通过这套 token 取色，不直接写死颜色值
export interface ThemeColors {
  bg: string;            // 页面背景色
  text: string;          // 主标题文字色
  subtitle: string;      // 副标题/说明文字色
  accent: string;        // 强调色（主品牌红）
  tabBarBg: string;      // Android 底栏降级背景（iOS 用 BlurView 不需要此项）
  pillColor: string;     // 液态药丸选中框背景色
  switcherBg: string;    // 主题切换器容器背景
  switcherBorder: string;// 主题切换器边框色
}

// ── 浅色方案 ──────────────────────────────────────────────────────────
const LIGHT: ThemeColors = {
  bg: "#FFFFFF",
  text: "#333333",
  subtitle: "#999999",
  accent: "#FF2D55",                    // 品牌主红
  tabBarBg: "rgba(245,245,245,0.93)",   // 半透明浅灰，模拟毛玻璃降级效果
  pillColor: "rgba(255,255,255,0.38)",  // 白色半透明药丸
  switcherBg: "rgba(120,120,128,0.12)", // iOS 系统风格分段控制器背景
  switcherBorder: "rgba(60,60,67,0.18)",
};

// ── 深色方案 ──────────────────────────────────────────────────────────
const DARK: ThemeColors = {
  bg: "#1C1C1E",                        // iOS 深色背景标准色
  text: "#FFFFFF",
  subtitle: "#8E8E93",                  // iOS 深色模式次要文字标准色
  accent: "#FF375F",                    // 深色下亮度稍高的红色，视觉权重一致
  tabBarBg: "rgba(28,28,30,0.93)",      // 深色半透明底栏
  pillColor: "rgba(80,80,80,0.50)",     // 深色药丸
  switcherBg: "rgba(120,120,128,0.24)",
  switcherBorder: "rgba(255,255,255,0.12)",
};

// Context 类型：向下游组件暴露模式、颜色、切换方法
interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  colors: ThemeColors;
  isDark: boolean; // 最终是否处于深色状态（已综合 system 判断结果）
}

// 默认值：未被 Provider 包裹时的兜底（实际不应发生）
const ThemeContext = createContext<ThemeContextValue>({
  mode: "system",
  setMode: () => {},
  colors: LIGHT,
  isDark: false,
});

/**
 * ThemeProvider
 * 包裹整个应用根节点，向子树注入主题状态。
 * 在 apps/native/app/_layout.tsx 的最外层使用。
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // 读取设备系统级深浅色偏好
  const systemScheme = useColorScheme();
  // 用户手动选择的模式，默认跟随系统
  const [mode, setMode] = useState<ThemeMode>("system");

  // 根据 mode 计算最终深色状态：
  // dark → 强制深色；light → 强制浅色；system → 跟随 useColorScheme
  const isDark = useMemo(() => {
    if (mode === "dark") return true;
    if (mode === "light") return false;
    return systemScheme === "dark";
  }, [mode, systemScheme]);

  // 根据 isDark 选择对应颜色方案
  const colors = isDark ? DARK : LIGHT;

  return (
    <ThemeContext.Provider value={{ mode, setMode, colors, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * useTheme
 * 在任意子组件中获取当前主题状态和颜色 token。
 * 示例：const { colors, isDark, setMode } = useTheme();
 */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
