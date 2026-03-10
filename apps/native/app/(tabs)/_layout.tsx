/**
 * (tabs)/_layout.tsx
 * Tab 导航布局，职责：
 *   1. 将默认底部栏替换为自定义的 LiquidTabBar（液态玻璃风格）
 *   2. 声明五个 Tab 页面及其标题和图标配置
 *
 * 顺序：首页、发现、Agent、消息、我的
 */
import { Tabs } from "expo-router";
import { LiquidTabBar, type LiquidTabBarProps } from "@repo/ui";

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <LiquidTabBar {...(props as unknown as LiquidTabBarProps)} />}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tabs.Screen name="home" options={{ title: "首页" }} />
      <Tabs.Screen name="discover" options={{ title: "发现" }} />
      <Tabs.Screen name="agent" options={{ title: "Agent" }} />
      <Tabs.Screen name="messages" options={{ title: "消息" }} />
      <Tabs.Screen name="profile" options={{ title: "我的" }} />
    </Tabs>
  );
}
