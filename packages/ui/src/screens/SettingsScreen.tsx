/**
 * SettingsScreen.tsx — 设置主页
 *
 * 三段式布局（参考闲鱼设置页，适配 Cosoul.AI 主题）：
 *  ① 个人：个人资料、账号与安全
 *  ② 订阅：我的订阅
 *  ③ 通用：主题切换、清除缓存、关于
 */
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useTheme } from "../theme/ThemeContext";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PersonIcon,
  ShieldIcon,
} from "../components/TabIcons";
import { ThemeToggleButton } from "../components/ThemeToggleButton";

// ─── 通用行组件 ──────────────────────────────────────────────────

/** 可点击设置行 */
function SettingRow({
  label,
  value,
  onPress,
  showArrow = true,
  children,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  showArrow?: boolean;
  children?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const content = (
    <View style={[styles.row, { borderBottomColor: colors.switcherBorder }]}>
      <Text style={[styles.rowLabel, { color: colors.text }]}>{label}</Text>
      <View style={styles.rowRight}>
        {value ? (
          <Text style={[styles.rowValue, { color: colors.subtitle }]}>{value}</Text>
        ) : null}
        {children}
        {showArrow && <ChevronRightIcon size={18} color={colors.subtitle} />}
      </View>
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.6}>
        {content}
      </TouchableOpacity>
    );
  }
  return content;
}

// ─── Props ───────────────────────────────────────────────────────

export interface SettingsScreenProps {
  onGoBack?: () => void;
  onOpenProfileEdit?: () => void;
  onOpenAccountSecurity?: () => void;
  onLogout?: () => void;
}

// ─── 主组件 ──────────────────────────────────────────────────────

export function SettingsScreen({
  onGoBack,
  onOpenProfileEdit,
  onOpenAccountSecurity,
  onLogout,
}: SettingsScreenProps) {
  const { colors } = useTheme();

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.bg }]}
      contentContainerStyle={styles.content}
    >
      {/* 顶部导航栏 */}
      <View style={styles.header}>
        {onGoBack && (
          <TouchableOpacity onPress={onGoBack} style={styles.backBtn} activeOpacity={0.6}>
            <ChevronLeftIcon size={24} color={colors.text} />
          </TouchableOpacity>
        )}
        <Text style={[styles.title, { color: colors.text }]}>设置</Text>
        <View style={{ width: 32 }} />
      </View>

      {/* ── 个人 ── */}
      <Text style={[styles.sectionTitle, { color: colors.subtitle }]}>个人</Text>
      <View style={[styles.card, { backgroundColor: colors.switcherBg }]}>
        <SettingRow
          label="个人资料"
          onPress={onOpenProfileEdit}
        />
        <SettingRow
          label="账号与安全"
          onPress={onOpenAccountSecurity}
        />
      </View>

      {/* ── 订阅 ── */}
      <Text style={[styles.sectionTitle, { color: colors.subtitle }]}>订阅</Text>
      <View style={[styles.card, { backgroundColor: colors.switcherBg }]}>
        <SettingRow label="我的订阅" value="查看详情" />
      </View>

      {/* ── 通用 ── */}
      <Text style={[styles.sectionTitle, { color: colors.subtitle }]}>通用</Text>
      <View style={[styles.card, { backgroundColor: colors.switcherBg }]}>
        <SettingRow label="主题" showArrow={false}>
          <ThemeToggleButton size={20} />
        </SettingRow>
        <SettingRow label="消息通知" />
        <SettingRow label="清除缓存" />
      </View>

      {/* ── 关于 ── */}
      <Text style={[styles.sectionTitle, { color: colors.subtitle }]}>关于</Text>
      <View style={[styles.card, { backgroundColor: colors.switcherBg }]}>
        <SettingRow label="版本" value="1.0.0 MVP" showArrow={false} />
      </View>

      {/* ── 登出 ── */}
      {onLogout && (
        <TouchableOpacity
          style={[styles.logoutBtn, { backgroundColor: colors.switcherBg }]}
          onPress={onLogout}
          activeOpacity={0.6}
        >
          <Text style={styles.logoutText}>退出登录</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

// ─── 样式 ────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, paddingTop: 48 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 28,
  },
  backBtn: { padding: 4 },
  title: { fontSize: 18, fontWeight: "600" },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "500",
    letterSpacing: 0.3,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: { borderRadius: 12, overflow: "hidden", marginBottom: 24 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 50,
    borderBottomWidth: 0.5,
  },
  rowLabel: { fontSize: 16 },
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  rowValue: { fontSize: 14 },
  logoutBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 40,
  },
  logoutText: { color: "#FF3B30", fontSize: 16, fontWeight: "500" },
});
