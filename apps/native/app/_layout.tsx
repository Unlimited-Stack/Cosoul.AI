/**
 * _layout.tsx（根布局）
 * 应用最外层布局，职责：
 *   1. 用 ThemeProvider 包裹整棵组件树，使所有子页面都能通过 useTheme() 获取主题
 *   2. 配置 expo-router 的 Stack 导航，隐藏顶部 Header
 */
import { Stack } from "expo-router";
import { ThemeProvider } from "@repo/ui";

export default function AppLayout() {
  return (
    // ThemeProvider 必须在根层级，确保 LiquidTabBar 和所有 Screen 都在其上下文内
    <ThemeProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ headerShown: false, presentation: "modal" }} />
      </Stack>
    </ThemeProvider>
  );
}
