/**
 * settings/page.tsx — Web 端设置页面
 */
"use client";

import { useRouter } from "next/navigation";
import { SettingsScreen } from "@repo/ui";

export default function SettingsPage() {
  const router = useRouter();
  return (
    <div style={{ alignSelf: "flex-start", width: "100%" }}>
      <SettingsScreen onGoBack={() => router.push("/profile")} />
    </div>
  );
}
