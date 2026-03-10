/**
 * SettingsScreen.tsx — 设置页面
 * 主题切换已移至 ThemeToggleButton（Sidebar / ProfileScreen 顶栏）。
 * 本页面仅保留"关于"等非主题设置项。
 */
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useTheme } from "../theme/ThemeContext";
import { SettingsIcon, ChevronLeftIcon } from "../components/TabIcons";

/** 单行设置项 */
function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, { borderBottomColor: colors.switcherBorder }]}>
      <Text style={[styles.rowLabel, { color: colors.text }]}>{label}</Text>
      <View style={styles.rowRight}>{children}</View>
    </View>
  );
}

export interface SettingsScreenProps {
  onGoBack?: () => void;
}

/** 设置页面主体 */
export function SettingsScreen({ onGoBack }: SettingsScreenProps) {
  const { colors } = useTheme();

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.bg }]}
      contentContainerStyle={styles.content}
    >
      {/* 页面标题 */}
      <View style={styles.header}>
        {onGoBack && (
          <TouchableOpacity onPress={onGoBack} style={styles.backBtn} activeOpacity={0.6}>
            <ChevronLeftIcon size={24} color={colors.text} />
          </TouchableOpacity>
        )}
        <SettingsIcon size={28} color={colors.text} />
        <Text style={[styles.title, { color: colors.text }]}>设置</Text>
      </View>

      {/* 关于 */}
      <Text style={[styles.sectionTitle, { color: colors.subtitle }]}>关于</Text>
      <View style={[styles.card, { backgroundColor: colors.switcherBg }]}>
        <SettingRow label="版本">
          <Text style={[styles.rowValue, { color: colors.subtitle }]}>1.0.0 MVP</Text>
        </SettingRow>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, paddingTop: 48 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 28 },
  backBtn: { marginRight: 4, padding: 4 },
  title: { fontSize: 24, fontWeight: "bold" },
  sectionTitle: { fontSize: 13, fontWeight: "500", letterSpacing: 0.3, marginBottom: 8, marginLeft: 4 },
  card: { borderRadius: 12, overflow: "hidden", marginBottom: 24 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 12, minHeight: 48, borderBottomWidth: 0.5 },
  rowLabel: { fontSize: 16 },
  rowRight: { flexShrink: 0 },
  rowValue: { fontSize: 14 },
});
