/**
 * CardsScreen.tsx
 * 「发现」页面，背景和文字颜色通过 useTheme() 响应深浅色模式切换。
 */
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "../theme/ThemeContext";

export function CardsScreen() {
  const { colors } = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <Text style={[styles.title, { color: colors.text }]}>发现</Text>
      <Text style={[styles.subtitle, { color: colors.subtitle }]}>
        探索感兴趣的人与内容
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
