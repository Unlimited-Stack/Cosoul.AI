// 用于 react-native-safe-area-context 的 Web 组件
// LiquidTabBar 使用了 useSafeAreaInsets ，但这一功能仅在原生环境中才需要使用。
// 在Web端，我们将返回全为零的内边距。
export function useSafeAreaInsets() {
  return { top: 0, bottom: 0, left: 0, right: 0 };
}

export function SafeAreaProvider({ children }) {
  return children;
}

export function SafeAreaView({ children }) {
  return children;
}
