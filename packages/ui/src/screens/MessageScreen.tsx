/**
 * MessageScreen.tsx
 * 「消息」页面，背景和文字颜色通过 useTheme() 响应深浅色模式切换。
 */
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "../theme/ThemeContext";

export function MessageScreen() {
  const { colors } = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <Text style={styles.emoji}>💬</Text>
      <Text style={[styles.title, { color: colors.text }]}>消息 / 公告</Text>
      <Text style={[styles.subtitle, { color: colors.subtitle }]}>
        系统通知与 AI 锐评推送将在这里展示
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    textAlign: "center",
    paddingHorizontal: 40,
  },
});
