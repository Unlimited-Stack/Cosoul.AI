/**
 * settings.tsx — Native 端设置页面（Stack 页面，从"我的"齿轮图标进入）
 */
import { useRouter } from "expo-router";
import { SettingsScreen, useAuth } from "@repo/ui";

export default function SettingsPage() {
  const router = useRouter();
  const { logout } = useAuth();
  return (
    <SettingsScreen
      onGoBack={() => router.back()}
      onOpenProfileEdit={() => router.push("/profile-edit")}
      onOpenAccountSecurity={() => router.push("/account-security")}
      onLogout={logout}
    />
  );
}
