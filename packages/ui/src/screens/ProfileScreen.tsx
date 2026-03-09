/**
 * ProfileScreen.tsx — 「我的」页面
 * 展示用户头像和个人信息。主题切换已迁移到 SettingsScreen。
 *
 * Native 端：左上角头像、右上角齿轮（点击进入设置）
 * Web 端：纯内容展示（导航由 Sidebar 处理）
 *
 * onOpenSettings 回调：由平台层注入，用于导航到设置页。
 */
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTheme } from "../theme/ThemeContext";
import { SettingsIcon, PersonIcon } from "../components/TabIcons";

export interface ProfileScreenProps {
  /** 点击齿轮时的回调——由平台层注入路由跳转 */
  onOpenSettings?: () => void;
  /** 是否显示顶部导航栏（Native 显示，Web 隐藏） */
  showHeader?: boolean;
}

export function ProfileScreen({ onOpenSettings, showHeader = true }: ProfileScreenProps) {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {/* 顶部栏：头像（左） + 齿轮（右） */}
      {showHeader && (
        <View style={styles.topBar}>
          <View style={[styles.avatarCircle, { backgroundColor: colors.switcherBg }]}>
            <PersonIcon size={28} color={colors.subtitle} />
          </View>
          {onOpenSettings && (
            <TouchableOpacity onPress={onOpenSettings} style={styles.gearBtn} activeOpacity={0.6}>
              <SettingsIcon size={24} color={colors.subtitle} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* 主体内容 */}
      <View style={styles.body}>
        <View style={[styles.avatarLarge, { backgroundColor: colors.switcherBg }]}>
          <PersonIcon size={56} color={colors.subtitle} />
        </View>
        <Text style={[styles.title, { color: colors.text }]}>我的主页</Text>
        <Text style={[styles.subtitle, { color: colors.subtitle }]}>
          个人设置与历史锐评记录
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 8,
  },
  avatarCircle: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
  },
  gearBtn: { padding: 8 },
  body: { flex: 1, alignItems: "center", justifyContent: "center" },
  avatarLarge: {
    width: 96, height: 96, borderRadius: 48,
    alignItems: "center", justifyContent: "center", marginBottom: 16,
  },
  title: { fontSize: 24, fontWeight: "bold", marginBottom: 8 },
  subtitle: { fontSize: 14, textAlign: "center", paddingHorizontal: 40 },
});
