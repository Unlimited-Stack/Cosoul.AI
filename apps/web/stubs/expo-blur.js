// 用于 expo-blur 的 Web 端框架
// 在 iOS 端，BlurView 会被使用。而在 Web 端，则会渲染一个普通的 div 元素。
export function BlurView({ children, style }) {
  return children;
}
