/**
 * settings/page.tsx — Web 端设置页面
 */
"use client";

import { useRouter } from "next/navigation";
import { SettingsScreen, useAuth } from "@repo/ui";

export default function SettingsPage() {
  const router = useRouter();
  const { logout } = useAuth();
  return (
    <div style={{ alignSelf: "flex-start", width: "100%" }}>
      <SettingsScreen
        onGoBack={() => router.push("/profile")}
        onOpenProfileEdit={() => router.push("/profile-edit")}
        onOpenAccountSecurity={() => router.push("/account-security")}
        onLogout={logout}
      />
    </div>
  );
}
