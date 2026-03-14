/**
 * RegisterScreen — 注册页
 *
 * 邮箱 + 密码 + 昵称（可选） + 密码强度指示
 */
import React, { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useTheme } from "../theme/ThemeContext";

export interface RegisterScreenProps {
  onRegister: (email: string, password: string, name?: string) => Promise<void>;
  onGoToLogin?: () => void;
}

// 密码强度评估
function getStrength(pw: string): { label: string; color: string; width: string } {
  if (!pw || pw.length < 8) return { label: "弱", color: "#FF3B30", width: "33%" };
  let types = 0;
  if (/[a-z]/.test(pw)) types++;
  if (/[A-Z]/.test(pw)) types++;
  if (/\d/.test(pw)) types++;
  if (/[^a-zA-Z\d]/.test(pw)) types++;
  if (types <= 1) return { label: "弱", color: "#FF3B30", width: "33%" };
  if (types === 2) return { label: "一般", color: "#FF9500", width: "66%" };
  return { label: "安全", color: "#34C759", width: "100%" };
}

export function RegisterScreen({ onRegister, onGoToLogin }: RegisterScreenProps) {
  const { colors } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const strength = getStrength(password);
  const canSubmit =
    email.trim().length > 0 &&
    password.length >= 8 &&
    password === confirmPw &&
    !loading;

  const handleRegister = async () => {
    if (!canSubmit) return;
    setError("");
    setLoading(true);
    try {
      await onRegister(email.trim(), password, name.trim() || undefined);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "注册失败";
      setError(msg);
      if (Platform.OS !== "web") Alert.alert("注册失败", msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.inner}>
        <Text style={[styles.title, { color: colors.text }]}>创建账号</Text>
        <Text style={[styles.subtitle, { color: colors.subtitle }]}>
          加入 Cosoul.AI，开启 AI 社交之旅
        </Text>

        <View style={styles.form}>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.switcherBorder, backgroundColor: colors.switcherBg }]}
            placeholder="昵称（选填）"
            placeholderTextColor={colors.switcherBorder}
            value={name}
            onChangeText={setName}
            maxLength={100}
          />
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.switcherBorder, backgroundColor: colors.switcherBg }]}
            placeholder="邮箱"
            placeholderTextColor={colors.switcherBorder}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.switcherBorder, backgroundColor: colors.switcherBg }]}
            placeholder="密码（至少 8 位，字母+数字）"
            placeholderTextColor={colors.switcherBorder}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          {/* 密码强度条 */}
          {password.length > 0 && (
            <View style={styles.strengthRow}>
              <View style={styles.strengthTrack}>
                <View style={[styles.strengthFill, { backgroundColor: strength.color, width: strength.width as unknown as number }]} />
              </View>
              <Text style={{ fontSize: 12, color: strength.color, marginLeft: 8 }}>
                {strength.label}
              </Text>
            </View>
          )}

          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.switcherBorder, backgroundColor: colors.switcherBg }]}
            placeholder="确认密码"
            placeholderTextColor={colors.switcherBorder}
            value={confirmPw}
            onChangeText={setConfirmPw}
            secureTextEntry
          />
          {confirmPw.length > 0 && confirmPw !== password && (
            <Text style={styles.errorHint}>两次输入的密码不一致</Text>
          )}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.button, { backgroundColor: canSubmit ? "#007AFF" : "rgba(0,122,255,0.4)" }]}
            onPress={handleRegister}
            disabled={!canSubmit}
            activeOpacity={0.8}
          >
            <Text style={styles.buttonText}>
              {loading ? "注册中..." : "注册"}
            </Text>
          </TouchableOpacity>
        </View>

        {onGoToLogin && (
          <TouchableOpacity onPress={onGoToLogin} style={styles.linkWrap}>
            <Text style={[styles.link, { color: "#007AFF" }]}>
              已有账号？去登录
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center" },
  inner: { paddingHorizontal: 32, alignItems: "center" },
  title: { fontSize: 26, fontWeight: "700", marginBottom: 8 },
  subtitle: { fontSize: 14, marginBottom: 32 },
  form: { width: "100%", maxWidth: 360 },
  input: {
    fontSize: 16,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  strengthRow: { flexDirection: "row", alignItems: "center", marginBottom: 14, marginTop: -6 },
  strengthTrack: { flex: 1, height: 4, borderRadius: 2, backgroundColor: "rgba(128,128,128,0.2)", overflow: "hidden" },
  strengthFill: { height: "100%", borderRadius: 2 },
  errorHint: { color: "#FF3B30", fontSize: 12, marginTop: -8, marginBottom: 8 },
  errorText: { color: "#FF3B30", fontSize: 13, marginBottom: 8, textAlign: "center" },
  button: { borderRadius: 10, paddingVertical: 14, alignItems: "center", marginTop: 4 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  linkWrap: { marginTop: 24 },
  link: { fontSize: 14 },
});
