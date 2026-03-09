/**
 * settings.tsx — Native 端设置页面（Stack 页面，从"我的"齿轮图标进入）
 */
import { useRouter } from "expo-router";
import { SettingsScreen } from "@repo/ui";

export default function SettingsPage() {
  const router = useRouter();
  return <SettingsScreen onGoBack={() => router.back()} />;
}
