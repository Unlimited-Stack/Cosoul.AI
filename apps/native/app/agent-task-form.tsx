/**
 * agent-task-form.tsx
 * 任务填表页（从人格气泡浮层选择已有人格后跳转）
 *
 * 后续会改为对话形式生成 task 需求，当前为占位表单验证技术栈。
 */
import { useCallback } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTheme } from "@repo/ui";

export default function AgentTaskFormPage() {
  const { personaId } = useLocalSearchParams<{ personaId: string }>();
  const router = useRouter();
  const { colors, isDark } = useTheme();

  const cardBg = isDark ? "rgba(120,120,128,0.16)" : "rgba(142,142,147,0.08)";
  const inputBg = isDark ? "rgba(120,120,128,0.24)" : "rgba(142,142,147,0.10)";

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={[styles.backText, { color: colors.accent }]}>返回</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>创建任务</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={[styles.card, { backgroundColor: cardBg }]}>
          <Text style={[styles.label, { color: colors.subtitle }]}>
            人格 ID
          </Text>
          <Text style={[styles.value, { color: colors.text }]} selectable>
            {personaId ?? "(未传入)"}
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: cardBg }]}>
          <Text style={[styles.label, { color: colors.subtitle }]}>任务描述</Text>
          <TextInput
            style={[styles.input, { color: colors.text, backgroundColor: inputBg }]}
            placeholder="例：找人周末去探店"
            placeholderTextColor={colors.subtitle}
            multiline
            numberOfLines={4}
          />

          <Text style={[styles.label, { color: colors.subtitle, marginTop: 12 }]}>
            互动方式
          </Text>
          <Text style={[styles.hint, { color: colors.subtitle }]}>
            （占位 — 后续改为对话式生成）
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: colors.accent }]}
          activeOpacity={0.7}
        >
          <Text style={styles.submitText}>派发任务（占位）</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingTop: 56, paddingHorizontal: 20, paddingBottom: 12 },
  backBtn: { marginRight: 12 },
  backText: { fontSize: 16, fontWeight: "600" },
  title: { fontSize: 20, fontWeight: "bold" },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 120 },
  card: { borderRadius: 14, padding: 16, marginBottom: 12 },
  label: { fontSize: 13, fontWeight: "600", marginBottom: 6 },
  value: { fontSize: 14, fontFamily: "monospace" },
  hint: { fontSize: 12, fontStyle: "italic" },
  input: { borderRadius: 10, padding: 12, fontSize: 15, minHeight: 100, textAlignVertical: "top" },
  submitBtn: { borderRadius: 12, padding: 16, alignItems: "center", marginTop: 8 },
  submitText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
