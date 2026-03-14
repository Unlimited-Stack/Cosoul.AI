/**
 * ForgotPasswordScreen — 找回密码页
 *
 * 两阶段：
 *  1. 输入邮箱 → 发送验证码
 *  2. 输入验证码 + 新密码 → 重置密码
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

export interface ForgotPasswordScreenProps {
  onForgotPassword: (email: string) => Promise<void>;
  onResetPassword: (email: string, code: string, newPassword: string) => Promise<void>;
  onGoBack?: () => void;
}

export function ForgotPasswordScreen({
  onForgotPassword,
  onResetPassword,
  onGoBack,
}: ForgotPasswordScreenProps) {
  const { colors } = useTheme();
  // 阶段：send = 发送验证码，reset = 输入验证码重置
  const [step, setStep] = useState<"send" | "reset">("send");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [countdown, setCountdown] = useState(0);

  // 发送验证码
  const handleSend = async () => {
    if (!email.trim() || loading) return;
    setError("");
    setLoading(true);
    try {
      await onForgotPassword(email.trim());
      setStep("reset");
      // 60 秒倒计时
      setCountdown(60);
      const timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) { clearInterval(timer); return 0; }
          return prev - 1;
        });
      }, 1000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "发送失败";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // 重置密码
  const handleReset = async () => {
    if (!code || newPw.length < 8 || newPw !== confirmPw || loading) return;
    setError("");
    setLoading(true);
    try {
      await onResetPassword(email.trim(), code, newPw);
      const msg = "密码重置成功，请重新登录";
      if (Platform.OS === "web") window.alert(msg);
      else Alert.alert("成功", msg);
      onGoBack?.();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "重置失败";
      setError(msg);
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
        <Text style={[styles.title, { color: colors.text }]}>找回密码</Text>

        {step === "send" ? (
          /* ── 第一步：发送验证码 ── */
          <View style={styles.form}>
            <Text style={[styles.hint, { color: colors.subtitle }]}>
              输入注册邮箱，我们将发送验证码
            </Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.switcherBorder, backgroundColor: colors.switcherBg }]}
              placeholder="邮箱"
              placeholderTextColor={colors.switcherBorder}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoFocus
            />
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <TouchableOpacity
              style={[styles.button, { backgroundColor: email.trim() && !loading ? "#007AFF" : "rgba(0,122,255,0.4)" }]}
              onPress={handleSend}
              disabled={!email.trim() || loading}
              activeOpacity={0.8}
            >
              <Text style={styles.buttonText}>{loading ? "发送中..." : "发送验证码"}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          /* ── 第二步：输入验证码和新密码 ── */
          <View style={styles.form}>
            <Text style={[styles.hint, { color: colors.subtitle }]}>
              验证码已发送至 {email}
            </Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.switcherBorder, backgroundColor: colors.switcherBg }]}
              placeholder="6 位验证码"
              placeholderTextColor={colors.switcherBorder}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
            />
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.switcherBorder, backgroundColor: colors.switcherBg }]}
              placeholder="新密码（至少 8 位）"
              placeholderTextColor={colors.switcherBorder}
              value={newPw}
              onChangeText={setNewPw}
              secureTextEntry
            />
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.switcherBorder, backgroundColor: colors.switcherBg }]}
              placeholder="确认新密码"
              placeholderTextColor={colors.switcherBorder}
              value={confirmPw}
              onChangeText={setConfirmPw}
              secureTextEntry
            />
            {confirmPw.length > 0 && confirmPw !== newPw && (
              <Text style={styles.errorHint}>两次输入的密码不一致</Text>
            )}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <TouchableOpacity
              style={[styles.button, { backgroundColor: code && newPw.length >= 8 && newPw === confirmPw && !loading ? "#007AFF" : "rgba(0,122,255,0.4)" }]}
              onPress={handleReset}
              disabled={!code || newPw.length < 8 || newPw !== confirmPw || loading}
              activeOpacity={0.8}
            >
              <Text style={styles.buttonText}>{loading ? "重置中..." : "重置密码"}</Text>
            </TouchableOpacity>
            {/* 重新发送 */}
            <TouchableOpacity
              onPress={handleSend}
              disabled={countdown > 0 || loading}
              style={styles.resendWrap}
            >
              <Text style={{ fontSize: 14, color: countdown > 0 ? colors.subtitle : "#007AFF" }}>
                {countdown > 0 ? `${countdown}s 后重新发送` : "重新发送验证码"}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {onGoBack && (
          <TouchableOpacity onPress={onGoBack} style={styles.backWrap}>
            <Text style={[styles.link, { color: "#007AFF" }]}>返回登录</Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center" },
  inner: { paddingHorizontal: 32, alignItems: "center" },
  title: { fontSize: 26, fontWeight: "700", marginBottom: 16 },
  hint: { fontSize: 14, marginBottom: 20, textAlign: "center" },
  form: { width: "100%", maxWidth: 360 },
  input: {
    fontSize: 16,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  errorHint: { color: "#FF3B30", fontSize: 12, marginTop: -8, marginBottom: 8 },
  errorText: { color: "#FF3B30", fontSize: 13, marginBottom: 8, textAlign: "center" },
  button: { borderRadius: 10, paddingVertical: 14, alignItems: "center", marginTop: 4 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  resendWrap: { alignItems: "center", marginTop: 16 },
  backWrap: { marginTop: 24 },
  link: { fontSize: 14 },
});
