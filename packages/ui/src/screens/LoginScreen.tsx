/**
 * LoginScreen — 登录页
 *
 * 简洁设计：邮箱 + 密码 + 登录按钮
 * 底部跳转：注册、忘记密码
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

export interface LoginScreenProps {
  onLogin: (email: string, password: string) => Promise<void>;
  onGoToRegister?: () => void;
  onGoToForgotPassword?: () => void;
}

export function LoginScreen({
  onLogin,
  onGoToRegister,
  onGoToForgotPassword,
}: LoginScreenProps) {
  const { colors } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const canSubmit = email.trim().length > 0 && password.length >= 8;

  const handleLogin = async () => {
    if (!canSubmit || loading) return;
    setError("");
    setLoading(true);
    try {
      await onLogin(email.trim(), password);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "登录失败";
      setError(msg);
      if (Platform.OS !== "web") Alert.alert("登录失败", msg);
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
        {/* Logo / 标题 */}
        <Text style={[styles.brand, { color: colors.text }]}>Cosoul.AI</Text>
        <Text style={[styles.subtitle, { color: colors.subtitle }]}>
          AI 社交匹配，遇见对的人
        </Text>

        {/* 表单 */}
        <View style={styles.form}>
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
            placeholder="密码（至少 8 位）"
            placeholderTextColor={colors.switcherBorder}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          {/* 错误提示 */}
          {error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : null}

          {/* 登录按钮 */}
          <TouchableOpacity
            style={[
              styles.button,
              { backgroundColor: canSubmit && !loading ? "#007AFF" : "rgba(0,122,255,0.4)" },
            ]}
            onPress={handleLogin}
            disabled={!canSubmit || loading}
            activeOpacity={0.8}
          >
            <Text style={styles.buttonText}>
              {loading ? "登录中..." : "登录"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* 底部链接 */}
        <View style={styles.links}>
          {onGoToRegister && (
            <TouchableOpacity onPress={onGoToRegister}>
              <Text style={[styles.link, { color: "#007AFF" }]}>
                没有账号？立即注册
              </Text>
            </TouchableOpacity>
          )}
          {onGoToForgotPassword && (
            <TouchableOpacity onPress={onGoToForgotPassword}>
              <Text style={[styles.link, { color: colors.subtitle }]}>
                忘记密码？
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center" },
  inner: { paddingHorizontal: 32, alignItems: "center" },
  brand: { fontSize: 32, fontWeight: "700", marginBottom: 8 },
  subtitle: { fontSize: 14, marginBottom: 40 },
  form: { width: "100%", maxWidth: 360 },
  input: {
    fontSize: 16,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  errorText: { color: "#FF3B30", fontSize: 13, marginBottom: 8, textAlign: "center" },
  button: {
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  links: { marginTop: 24, gap: 12, alignItems: "center" },
  link: { fontSize: 14 },
});
