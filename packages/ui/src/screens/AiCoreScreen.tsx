/**
 * AiCoreScreen.tsx
 * 「AI 锐评」页面占位，背景和文字颜色通过 useTheme() 响应深浅色模式切换。
 */
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "../theme/ThemeContext";

export function AiCoreScreen() {
  const { colors } = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <Text style={styles.emoji}>✨</Text>
      <Text style={[styles.title, { color: colors.text }]}>AI 锐评</Text>
      <Text style={[styles.subtitle, { color: colors.subtitle }]}>
        上传照片，获取 AI 对构图、光影、色彩的专业点评
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
