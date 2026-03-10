/**
 * ThemeToggleButton.tsx
 * 主题切换按钮——点击在深色/浅色之间切换。
 * 深色模式显示月亮图标，浅色模式显示太阳图标。
 * 跨平台（React Native + Web）。
 */
import { TouchableOpacity } from "react-native";
import { useTheme } from "../theme/ThemeContext";
import { SunIcon, MoonIcon } from "./TabIcons";

interface ThemeToggleButtonProps {
  size?: number;
  style?: object;
}

export function ThemeToggleButton({ size = 22, style }: ThemeToggleButtonProps) {
  const { isDark, setMode, colors } = useTheme();

  return (
    <TouchableOpacity
      onPress={() => setMode(isDark ? "light" : "dark")}
      style={[{ padding: 8 }, style]}
      activeOpacity={0.6}
      accessibilityLabel={isDark ? "切换为浅色模式" : "切换为深色模式"}
    >
      {isDark
        ? <MoonIcon size={size} color={colors.subtitle} />
        : <SunIcon  size={size} color={colors.subtitle} />
      }
    </TouchableOpacity>
  );
}
