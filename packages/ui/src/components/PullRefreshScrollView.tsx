/**
 * PullRefreshScrollView.tsx
 * 共享下拉刷新容器 — B 站风格（页面不动，顶部拉出加载圆圈）
 *
 * 用法：
 *   <PullRefreshScrollView onRefresh={async () => { await fetchData(); }}>
 *     {children}
 *   </PullRefreshScrollView>
 *
 * 特点：
 *   - 下拉时仅显示顶部加载指示器，ScrollView 内容位置不变
 *   - onRefresh 返回 Promise，自动管理 refreshing 状态
 *   - 放在 packages/ui 供所有 Tab 页面和子页面复用
 */
import { useCallback, useState, type ReactNode } from "react";
import { RefreshControl, ScrollView, type ScrollViewProps } from "react-native";
import { useTheme } from "../theme/ThemeContext";

export interface PullRefreshScrollViewProps extends ScrollViewProps {
  /** 下拉触发的刷新回调，返回 Promise 则自动管理 loading 状态 */
  onRefresh: () => Promise<void> | void;
  children: ReactNode;
}

export function PullRefreshScrollView({
  onRefresh,
  children,
  ...scrollViewProps
}: PullRefreshScrollViewProps) {
  const { colors, isDark } = useTheme();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  return (
    <ScrollView
      {...scrollViewProps}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          colors={[colors.accent]}
          tintColor={colors.accent}
          progressBackgroundColor={isDark ? "#2c2c2e" : "#fff"}
        />
      }
    >
      {children}
    </ScrollView>
  );
}
