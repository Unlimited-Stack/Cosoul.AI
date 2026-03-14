/**
 * _layout.tsx（根布局）
 * 应用最外层布局，职责：
 *   1. ThemeProvider 主题上下文
 *   2. AuthProvider 认证状态上下文
 *   3. 根据登录状态切换导航：未登录 → auth 页面；已登录 → 主 Stack
 */
import { Stack } from "expo-router";
import { ThemeProvider, AuthProvider, useAuth } from "@repo/ui";
import { nativeTokenStorage } from "../lib/tokenStorage";
import { getPersonaPlatformConfig } from "../lib/getApiUrl";
import { Platform } from "react-native";

// 推导 API 地址
function getApiBaseUrl(): string {
  const config = getPersonaPlatformConfig();
  return config.proxyBaseUrl ?? "/api";
}

// 设备标识
const deviceInfo = Platform.OS === "web"
  ? "Expo Web"
  : `${Platform.OS} / Expo`;

function AuthenticatedStack() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="settings" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="profile-edit" options={{ headerShown: false }} />
      <Stack.Screen name="account-security" options={{ headerShown: false }} />
      <Stack.Screen name="agent-debug" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="agent-task-chat" options={{ headerShown: false }} />
      <Stack.Screen name="agent-soul-chat" options={{ headerShown: false }} />
      <Stack.Screen name="agent-task-form" options={{ headerShown: false }} />
    </Stack>
  );
}

function AuthStack() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="register" options={{ headerShown: false }} />
      <Stack.Screen name="forgot-password" options={{ headerShown: false }} />
    </Stack>
  );
}

function RootNavigator() {
  const { isAuthenticated, loading } = useAuth();

  // 加载中不渲染导航（避免闪烁）
  if (loading) return null;

  return isAuthenticated ? <AuthenticatedStack /> : <AuthStack />;
}

export default function AppLayout() {
  return (
    <ThemeProvider>
      <AuthProvider
        apiBaseUrl={getApiBaseUrl()}
        tokenStorage={nativeTokenStorage}
        deviceInfo={deviceInfo}
      >
        <RootNavigator />
      </AuthProvider>
    </ThemeProvider>
  );
}
