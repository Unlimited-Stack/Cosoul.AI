/**
 * (tabs)/_layout.tsx
 * Tab 导航布局，职责：
 *   1. 将默认底部栏替换为自定义的 LiquidTabBar（液态玻璃风格）
 *   2. 声明五个 Tab 页面及其标题和图标配置
 *
 * 顺序：首页、发现、锐评、消息、我的
 */
import { Tabs } from "expo-router";
import { TabIcon, LiquidTabBar } from "@repo/ui";

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <LiquidTabBar {...props} />}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="feed"
        options={{
          title: "首页",
          tabBarIcon: ({ color }) => (
            <TabIcon label="🌊" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="cards"
        options={{
          title: "发现",
          tabBarIcon: ({ color }) => (
            <TabIcon label="🃏" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="ai-core"
        options={{
          title: "锐评",
          tabBarIcon: ({ color }) => (
            <TabIcon label="✨" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: "消息",
          tabBarIcon: ({ color }) => (
            <TabIcon label="💬" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "我的",
          tabBarIcon: ({ color }) => (
            <TabIcon label="👤" color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
