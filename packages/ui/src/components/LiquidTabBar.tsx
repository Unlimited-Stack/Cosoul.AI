/**
 * LiquidTabBar.tsx
 * 液态玻璃风格浮空底部导航栏。
 *
 * 视觉效果：
 *   - 绝对定位脱离页面流，距屏幕底部 12px + 安全区高度，左右各留 16px 边距
 *   - iOS：expo-blur BlurView 实现真实毛玻璃效果，tint 随深浅色模式切换
 *   - Android：半透明背景降级，保留圆角与阴影的"浮空"质感
 *   - 选中项有白色半透明"药丸"高亮框，切换时以弹簧动画（spring）横向滑动
 *
 * 性能：
 *   - 药丸位移使用 Animated.spring + useNativeDriver: true，动画在 UI 线程执行
 *   - onLayout 完成后才显示药丸，避免首帧位置错误
 */

import { useRef, useState, useCallback, type ComponentType } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  Platform,
  StyleSheet,
  LayoutChangeEvent,
} from "react-native";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/ThemeContext";
import {
  MessageIcon, CommunityIcon, PlusCircleIcon, CompassIcon, PersonIcon,
} from "./TabIcons";

// expo-router 传入的路由单项类型（简化）
interface Route {
  key: string;
  name: string;
}

// expo-router 传入的导航状态类型（简化）
interface NavigationState {
  index: number;   // 当前激活的 tab 下标
  routes: Route[];
}

// LiquidTabBar 接收 expo-router Tabs 组件通过 tabBar prop 传入的参数
export interface LiquidTabBarProps {
  state: NavigationState;
  navigation: {
    navigate: (name: string) => void;
    // 触发 tabPress 事件，允许拦截默认跳转行为
    emit: (event: { type: string; target?: string; canPreventDefault?: boolean }) => { defaultPrevented: boolean };
  };
}

// 各 tab 的静态配置：路由名称、SVG 图标组件、显示文字
// 顺序须与 (tabs)/_layout.tsx 中 Tabs.Screen 的声明顺序一致
const TABS: { name: string; Icon: ComponentType<{ size?: number; color?: string }>; label: string }[] = [
  { name: "feed",     Icon: CommunityIcon,   label: "首页" },
  { name: "cards",    Icon: CompassIcon,     label: "发现" },
  { name: "ai-core",  Icon: PlusCircleIcon,  label: "锐评" },
  { name: "index",    Icon: MessageIcon,     label: "消息" },
  { name: "profile",  Icon: PersonIcon,      label: "我的" },
];

// ── 尺寸常量 ────────────────────────────────────────────────────────────
const PILL_VERTICAL_MARGIN = 8;   // 药丸距容器顶底的间距
const PILL_HEIGHT = 48;            // 药丸高度
const PILL_HORIZONTAL_PADDING = 4; // 药丸左右内缩量（使药丸略窄于单格宽度）
const CONTAINER_HEIGHT = PILL_HEIGHT + PILL_VERTICAL_MARGIN * 2; // 整体栏高度

export function LiquidTabBar({ state, navigation }: LiquidTabBarProps) {
  // 读取底部安全区高度（用于适配 iPhone 底部 Home 条区域）
  const insets = useSafeAreaInsets();
  // 当前主题颜色 token 和深浅色状态
  const { colors, isDark } = useTheme();

  // 容器实际渲染宽度，通过 onLayout 获取（设备屏幕宽度 - 左右 margin）
  const [containerWidth, setContainerWidth] = useState(0);
  // 首次 onLayout 完成前隐藏药丸，防止位置跳变
  const [pillVisible, setPillVisible] = useState(false);

  // 单个 tab 的宽度 = 容器总宽 / tab 数量
  const tabWidth = containerWidth > 0 ? containerWidth / state.routes.length : 0;

  // 药丸 X 轴位置的动画值（translateX），不使用 state 避免触发 re-render
  const pillX = useRef(new Animated.Value(0)).current;

  // 容器布局完成回调：计算 tabWidth 并将药丸定位到初始激活项（无动画）
  const handleLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const width = e.nativeEvent.layout.width;
      setContainerWidth(width);
      const tw = width / state.routes.length;
      // 直接设值而非动画，确保首次渲染时药丸位置正确
      pillX.setValue(state.index * tw + PILL_HORIZONTAL_PADDING);
      setPillVisible(true);
    },
    [state.index, state.routes.length, pillX]
  );

  // Tab 点击回调：触发路由跳转 + 启动药丸弹簧动画
  const handleTabPress = useCallback(
    (routeName: string, routeKey: string, index: number) => {
      const isFocused = state.index === index;

      // 向 expo-router 发送 tabPress 事件（允许其他监听者拦截）
      const event = navigation.emit({
        type: "tabPress",
        target: routeKey,
        canPreventDefault: true,
      });

      // 未被拦截且非当前页时才执行跳转
      if (!isFocused && !event.defaultPrevented) {
        navigation.navigate(routeName);
      }

      // 启动药丸滑动动画：弹簧参数模拟液态弹性手感
      if (tabWidth > 0) {
        Animated.spring(pillX, {
          toValue: index * tabWidth + PILL_HORIZONTAL_PADDING,
          damping: 18,    // 阻尼：值越大弹性越小
          stiffness: 180, // 刚度：值越大弹簧越"硬"、移动越快
          mass: 0.9,      // 质量：值越小运动越轻盈
          useNativeDriver: true, // 在原生 UI 线程执行，避免 JS 线程卡顿
        }).start();
      }
    },
    [state.index, navigation, pillX, tabWidth]
  );

  // 药丸宽度略小于单格宽度，形成左右内缩的"药丸"视觉
  const pillWidth = tabWidth > 0 ? tabWidth - PILL_HORIZONTAL_PADDING * 2 : 0;
  const isAndroid = Platform.OS === "android";

  // BlurView tint：深色模式使用暗色材质，浅色使用亮色材质
  const blurTint = isDark ? "systemUltraThinMaterialDark" : "systemUltraThinMaterial";

  // 内部渲染：药丸 + 各 tab 按钮（抽成函数以复用于 iOS/Android 两种容器）
  function renderInner() {
    return (
      <View style={styles.innerRow} onLayout={handleLayout}>
        {/* 液态药丸选中框：onLayout 完成后才渲染，避免首帧闪烁 */}
        {pillVisible && tabWidth > 0 && (
          <Animated.View
            style={[
              styles.pill,
              {
                width: pillWidth,
                backgroundColor: colors.pillColor,        // 颜色跟随主题
                transform: [{ translateX: pillX }],        // 弹簧动画位移
              },
            ]}
          />
        )}

        {/* 遍历渲染各 tab 按钮 */}
        {state.routes.map((route, index) => {
          // 根据路由名称匹配静态 TABS 配置；匹配不到时按下标取（兜底）
          const tab = TABS.find((t) => t.name === route.name) ?? TABS[index] ?? TABS[0];
          const isFocused = state.index === index;
          // 图标颜色：选中时品牌色，未选中时副标题色
          const iconColor = isFocused ? colors.accent : colors.subtitle;

          return (
            <TouchableOpacity
              key={route.key}
              style={styles.tab}
              onPress={() => handleTabPress(route.name, route.key, index)}
              activeOpacity={0.7} // 点按时轻微变暗，提供视觉反馈
            >
              <tab.Icon size={22} color={iconColor} />
              <Text
                style={[
                  styles.label,
                  { color: colors.subtitle },                              // 默认副标题色
                  isFocused && { color: colors.accent, fontWeight: "700" }, // 激活时品牌色加粗
                ]}
                numberOfLines={1}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  }

  return (
    // 浮空定位容器：bottom 动态计算以适配各机型安全区
    <View style={[styles.wrapper, { bottom: 12 + insets.bottom }]}>
      {isAndroid ? (
        // Android 降级：半透明纯色背景模拟毛玻璃质感
        <View style={[styles.container, { backgroundColor: colors.tabBarBg }]}>
          {renderInner()}
        </View>
      ) : (
        // iOS：原生 BlurView 真实毛玻璃效果，intensity=70 接近 macOS 26 风格
        <BlurView intensity={70} tint={blurTint} style={styles.container}>
          {renderInner()}
        </BlurView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // 绝对定位的外层包装，left/right 留出边距使栏悬浮于屏幕两侧内
  wrapper: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 999,
  },
  // 毛玻璃容器：圆角 + 玻璃边框高光 + 阴影
  container: {
    borderRadius: 32,
    overflow: "hidden",
    borderWidth: 0.5,
    borderColor: "rgba(255,255,255,0.6)", // 白色半透明边框，形成玻璃边缘高光
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 16, // Android 阴影
  },
  // 横向排列各 tab 的行容器
  innerRow: {
    flexDirection: "row",
    height: CONTAINER_HEIGHT,
    alignItems: "center",
  },
  // 药丸选中框：绝对定位叠在 tab 按钮下层
  pill: {
    position: "absolute",
    height: PILL_HEIGHT,
    top: PILL_VERTICAL_MARGIN,
    borderRadius: 22,
    borderWidth: 0.5,
    borderColor: "rgba(255,255,255,0.8)", // 药丸内边框高光，增强玻璃感
  },
  // 单个 tab 触摸区域
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    height: CONTAINER_HEIGHT,
  },
  // SVG 图标容器
  icon: {
    width: 22,
    height: 22,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  // 文字标签（基础样式，激活状态通过内联覆盖）
  label: {
    fontSize: 10,
    marginTop: 1,
    fontWeight: "500",
  },
});
