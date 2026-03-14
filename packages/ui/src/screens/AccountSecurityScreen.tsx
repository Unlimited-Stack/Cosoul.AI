/**
 * AccountSecurityScreen.tsx — 账号与安全页
 *
 * 功能项：邮箱、手机号（可修改+正则校验）、修改密码（双重确认+强度评估）、注销账号
 * 通过 EditModal 弹窗编辑，Web 居中弹窗，Native 居中弹窗。
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useTheme } from "../theme/ThemeContext";
import { ChevronLeftIcon, ChevronRightIcon } from "../components/TabIcons";
import { EditModal } from "../components/EditModal";

// ─── 类型 ──────────────────────────────────────────────────────────

export interface UserProfile {
  userId: string;
  email: string;
  phone: string | null;
  name: string | null;
  avatarUrl: string | null;
  gender: string | null;
  birthday: string | null;
  bio: string | null;
  interests: string[];
  school: string | null;
  location: string | null;
  subscriptionTier: string;
  subscriptionExpiresAt: string | null;
  createdAt: string;
}

export interface UserServiceLike {
  getProfile(): Promise<UserProfile>;
  updateProfile(input: Record<string, unknown>): Promise<UserProfile>;
}

export interface AccountSecurityScreenProps {
  userService: UserServiceLike;
  onGoBack?: () => void;
  /** 修改密码回调（接入真实 API） */
  onChangePassword?: (currentPassword: string, newPassword: string) => Promise<void>;
  /** 注销账号回调（接入真实 API） */
  onDeactivate?: (password: string) => Promise<void>;
}

// ─── 密码强度评估 ──────────────────────────────────────────────────

function getPasswordStrength(pw: string): { level: number; label: string; color: string } {
  if (!pw || pw.length < 8) return { level: 0, label: "弱", color: "#FF3B30" };

  let types = 0;
  if (/[a-z]/.test(pw)) types++;
  if (/[A-Z]/.test(pw)) types++;
  if (/\d/.test(pw)) types++;
  if (/[^a-zA-Z\d]/.test(pw)) types++;

  if (types <= 1) return { level: 0, label: "弱", color: "#FF3B30" };
  if (types === 2) return { level: 1, label: "一般", color: "#FF9500" };
  return { level: 2, label: "安全", color: "#34C759" };
}

// 中国大陆手机号正则
function isValidPhone(phone: string): boolean {
  return /^1[3-9]\d{9}$/.test(phone);
}

// ─── 行组件 ────────────────────────────────────────────────────────

function SecurityRow({
  label,
  value,
  onPress,
  danger = false,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
}) {
  const { colors } = useTheme();
  const content = (
    <View style={[styles.row, { borderBottomColor: colors.switcherBorder }]}>
      <Text style={[styles.rowLabel, { color: danger ? "#FF3B30" : colors.text }]}>{label}</Text>
      <View style={styles.rowRight}>
        {value ? <Text style={[styles.rowValue, { color: colors.subtitle }]}>{value}</Text> : null}
        <ChevronRightIcon size={16} color={colors.switcherBorder} />
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

// ─── 主组件 ────────────────────────────────────────────────────────

type ModalType = "password" | "phone" | "deactivate";

export function AccountSecurityScreen({ userService, onGoBack, onChangePassword, onDeactivate }: AccountSecurityScreenProps) {
  const { colors } = useTheme();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // 弹窗状态
  const [modalType, setModalType] = useState<ModalType | null>(null);

  // 密码修改表单
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");

  // 手机号修改
  const [phoneValue, setPhoneValue] = useState("");

  // 注销密码确认
  const [deactivatePw, setDeactivatePw] = useState("");

  // ── 数据加载 ──
  const loadProfile = useCallback(async () => {
    try {
      const data = await userService.getProfile();
      setProfile(data);
    } catch (e) {
      console.error("[AccountSecurity] 加载失败:", e);
    } finally {
      setLoading(false);
    }
  }, [userService]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  // 手机号脱敏
  const maskedPhone = profile?.phone
    ? profile.phone.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2")
    : "未绑定";

  // ── 打开弹窗 ──
  const openPassword = () => {
    setModalType("password");
    setCurrentPw("");
    setNewPw("");
    setConfirmPw("");
  };

  const openPhone = () => {
    setModalType("phone");
    setPhoneValue(profile?.phone || "");
  };

  const closeModal = () => setModalType(null);

  // ── 密码逻辑 ──
  const pwStrength = getPasswordStrength(newPw);
  const pwValid =
    currentPw.length > 0 &&
    newPw.length >= 8 &&
    newPw === confirmPw &&
    pwStrength.level >= 1;

  const handlePasswordSave = async () => {
    if (!onChangePassword) return;
    try {
      await onChangePassword(currentPw, newPw);
      const msg = "密码修改成功！";
      if (Platform.OS === "web") window.alert(msg);
      else Alert.alert("成功", msg);
      closeModal();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "修改失败";
      if (Platform.OS === "web") window.alert(msg);
      else Alert.alert("失败", msg);
    }
  };

  // ── 注销账号逻辑 ──
  const handleDeactivate = async () => {
    if (!onDeactivate) return;
    try {
      await onDeactivate(deactivatePw);
      const msg = "账号已注销";
      if (Platform.OS === "web") window.alert(msg);
      else Alert.alert("完成", msg);
      closeModal();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "注销失败";
      if (Platform.OS === "web") window.alert(msg);
      else Alert.alert("失败", msg);
    }
  };

  // ── 手机号逻辑 ──
  const phoneValid = isValidPhone(phoneValue);

  const handlePhoneSave = async () => {
    try {
      const updated = await userService.updateProfile({ phone: phoneValue });
      setProfile(updated);
      closeModal();
    } catch (e) {
      console.error("[AccountSecurity] 手机号更新失败:", e);
    }
  };

  // ── Loading ──
  if (loading || !profile) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: colors.bg }]}>
        <Text style={{ color: colors.subtitle }}>加载中...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* 顶部导航 */}
        <View style={styles.header}>
          {onGoBack && (
            <TouchableOpacity onPress={onGoBack} style={styles.backBtn} activeOpacity={0.6}>
              <ChevronLeftIcon size={24} color={colors.text} />
            </TouchableOpacity>
          )}
          <Text style={[styles.headerTitle, { color: colors.text }]}>账号与安全</Text>
          <View style={{ width: 32 }} />
        </View>

        {/* ── 账号信息 ── */}
        <Text style={[styles.sectionTitle, { color: colors.subtitle }]}>账号信息</Text>
        <View style={[styles.card, { backgroundColor: colors.switcherBg }]}>
          <SecurityRow label="邮箱" value={profile.email} />
          <SecurityRow label="手机号" value={maskedPhone} onPress={openPhone} />
          <SecurityRow label="用户 ID" value={profile.userId.slice(0, 8) + "..."} />
        </View>

        {/* ── 安全设置 ── */}
        <Text style={[styles.sectionTitle, { color: colors.subtitle }]}>安全设置</Text>
        <View style={[styles.card, { backgroundColor: colors.switcherBg }]}>
          <SecurityRow label="修改登录密码" onPress={openPassword} />
          <SecurityRow label="登录设备管理" />
        </View>

        {/* ── 订阅 ── */}
        <Text style={[styles.sectionTitle, { color: colors.subtitle }]}>订阅</Text>
        <View style={[styles.card, { backgroundColor: colors.switcherBg }]}>
          <SecurityRow
            label="当前等级"
            value={
              profile.subscriptionTier === "premium"
                ? "高级版"
                : profile.subscriptionTier === "pro"
                  ? "中级版"
                  : "免费版"
            }
          />
          {profile.subscriptionExpiresAt && (
            <SecurityRow
              label="到期时间"
              value={new Date(profile.subscriptionExpiresAt).toLocaleDateString("zh-CN")}
            />
          )}
        </View>

        {/* ── 注销 ── */}
        {onDeactivate && (
          <View style={[styles.card, { backgroundColor: colors.switcherBg, marginTop: 20 }]}>
            <SecurityRow
              label="注销账号"
              danger
              onPress={() => { setModalType("deactivate"); setDeactivatePw(""); }}
            />
          </View>
        )}
      </ScrollView>

      {/* ═══ 修改密码弹窗 ═══ */}
      <EditModal
        visible={modalType === "password"}
        title="修改密码"
        onCancel={closeModal}
        onSave={handlePasswordSave}
        saveDisabled={!pwValid}
      >
        <View style={styles.modalBody}>
          {/* 当前密码 */}
          <Text style={[styles.inputLabel, { color: colors.subtitle }]}>当前密码</Text>
          <TextInput
            style={[styles.textInput, { color: colors.text, borderColor: colors.switcherBorder, backgroundColor: colors.bg }]}
            value={currentPw}
            onChangeText={setCurrentPw}
            secureTextEntry
            placeholder="请输入当前密码"
            placeholderTextColor={colors.switcherBorder}
            autoFocus
          />

          {/* 新密码 */}
          <Text style={[styles.inputLabel, { color: colors.subtitle, marginTop: 16 }]}>
            新密码（至少 8 位）
          </Text>
          <TextInput
            style={[styles.textInput, { color: colors.text, borderColor: colors.switcherBorder, backgroundColor: colors.bg }]}
            value={newPw}
            onChangeText={setNewPw}
            secureTextEntry
            placeholder="字母 + 数字 + 特殊字符"
            placeholderTextColor={colors.switcherBorder}
          />

          {/* 密码强度条：弱(红) / 一般(橙) / 安全(绿) */}
          {newPw.length > 0 && (
            <View style={styles.strengthRow}>
              <View style={styles.strengthTrack}>
                <View
                  style={[
                    styles.strengthFill,
                    {
                      backgroundColor: pwStrength.color,
                      width: `${((pwStrength.level + 1) / 3) * 100}%`,
                    },
                  ]}
                />
              </View>
              <Text style={{ fontSize: 12, color: pwStrength.color, marginLeft: 8, minWidth: 28 }}>
                {pwStrength.label}
              </Text>
            </View>
          )}

          {/* 确认新密码 */}
          <Text style={[styles.inputLabel, { color: colors.subtitle, marginTop: 16 }]}>
            确认新密码
          </Text>
          <TextInput
            style={[styles.textInput, { color: colors.text, borderColor: colors.switcherBorder, backgroundColor: colors.bg }]}
            value={confirmPw}
            onChangeText={setConfirmPw}
            secureTextEntry
            placeholder="请再次输入新密码"
            placeholderTextColor={colors.switcherBorder}
          />

          {/* 不匹配提示 */}
          {confirmPw.length > 0 && confirmPw !== newPw && (
            <Text style={{ fontSize: 12, color: "#FF3B30", marginTop: 6 }}>
              两次输入的密码不一致
            </Text>
          )}
        </View>
      </EditModal>

      {/* ═══ 修改手机号弹窗 ═══ */}
      <EditModal
        visible={modalType === "phone"}
        title="修改手机号"
        onCancel={closeModal}
        onSave={handlePhoneSave}
        saveDisabled={!phoneValid}
      >
        <View style={styles.modalBody}>
          <TextInput
            style={[styles.textInput, { color: colors.text, borderColor: colors.switcherBorder, backgroundColor: colors.bg }]}
            value={phoneValue}
            onChangeText={setPhoneValue}
            placeholder="请输入手机号"
            placeholderTextColor={colors.switcherBorder}
            keyboardType="phone-pad"
            maxLength={11}
            autoFocus
          />
          {phoneValue.length > 0 && !phoneValid && (
            <Text style={{ fontSize: 12, color: "#FF3B30", marginTop: 6 }}>
              请输入有效的手机号（11 位，以 1 开头）
            </Text>
          )}
        </View>
      </EditModal>

      {/* ═══ 注销账号确认弹窗 ═══ */}
      <EditModal
        visible={modalType === "deactivate"}
        title="注销账号"
        onCancel={closeModal}
        onSave={handleDeactivate}
        saveDisabled={!deactivatePw}
      >
        <View style={styles.modalBody}>
          <Text style={{ fontSize: 14, color: "#FF3B30", marginBottom: 16, lineHeight: 20 }}>
            注销后账号将被永久停用，所有数据无法恢复。请输入登录密码确认操作。
          </Text>
          <Text style={[styles.inputLabel, { color: colors.subtitle }]}>登录密码</Text>
          <TextInput
            style={[styles.textInput, { color: colors.text, borderColor: colors.switcherBorder, backgroundColor: colors.bg }]}
            value={deactivatePw}
            onChangeText={setDeactivatePw}
            secureTextEntry
            placeholder="请输入当前登录密码"
            placeholderTextColor={colors.switcherBorder}
            autoFocus
          />
        </View>
      </EditModal>
    </View>
  );
}

// ─── 样式 ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  content: { padding: 20, paddingTop: 48 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: "600" },
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
  // 弹窗内容区
  modalBody: { padding: 16 },
  inputLabel: { fontSize: 13, marginBottom: 6 },
  textInput: {
    fontSize: 16,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  // 密码强度条
  strengthRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
  },
  strengthTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(128,128,128,0.2)",
    overflow: "hidden",
  },
  strengthFill: {
    height: "100%",
    borderRadius: 2,
  },
});
