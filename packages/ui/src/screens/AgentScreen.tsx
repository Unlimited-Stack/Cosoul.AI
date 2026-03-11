/**
 * AgentScreen.tsx
 * Agent 主页面 — 智能匹配与社交协作入口
 *
 * 右上角扳手图标可进入调试工具页（模型连接测试等）。
 * 主体区域为后续 Agent 功能的容器，当前显示占位内容。
 */
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTheme } from "../theme/ThemeContext";
import { WrenchIcon } from "../components/TabIcons";

export interface AgentScreenProps {
  /** 点击扳手图标时的回调，由 App 层注入跳转逻辑 */
  onNavigateDebug: () => void;
}

export function AgentScreen({ onNavigateDebug }: AgentScreenProps) {
  const { colors, isDark } = useTheme();

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      {/* 顶部标题栏 */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.text }]}>Agent</Text>
            <Text style={[styles.subtitle, { color: colors.subtitle }]}>
              AI Agent 智能匹配与社交协作
            </Text>
          </View>
          {/* 右上角调试入口：扳手图标 */}
          <TouchableOpacity
            onPress={onNavigateDebug}
            style={[styles.debugBtn, { backgroundColor: isDark ? "rgba(120,120,128,0.16)" : "rgba(142,142,147,0.08)" }]}
            activeOpacity={0.6}
          >
            <WrenchIcon size={20} color={colors.subtitle} />
          </TouchableOpacity>
        </View>
      </View>

      {/* 主体内容区 — 后续 Agent 功能在此扩展 */}
      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.placeholder}>
          <Text style={[styles.placeholderEmoji]}>🤖</Text>
          <Text style={[styles.placeholderTitle, { color: colors.text }]}>
            Agent 功能开发中
          </Text>
          <Text style={[styles.placeholderDesc, { color: colors.subtitle }]}>
            智能匹配、自动协作等 Agent 能力即将上线
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    paddingTop: 48,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
  },
  /* 调试入口按钮：圆角方形，视觉上融入标题栏 */
  debugBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 40,
    paddingBottom: 120,
    alignItems: "center",
  },
  placeholder: {
    alignItems: "center",
    paddingTop: 80,
  },
  placeholderEmoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  placeholderTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  placeholderDesc: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
});
