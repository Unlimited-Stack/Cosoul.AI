/**
 * profile.tsx — Native 端「我的」Tab 页
 * 传入 onOpenSettings 回调跳转到设置页面。
 */
import { useRouter } from "expo-router";
import { ProfileScreen } from "@repo/ui";

export default function ProfileTab() {
  const router = useRouter();
  return (
    <ProfileScreen
      onOpenSettings={() => router.push("/settings")}
    />
  );
}
