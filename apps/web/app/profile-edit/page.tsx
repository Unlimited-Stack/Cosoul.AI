/**
 * profile-edit/page.tsx — Web 端编辑资料页
 */
"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { ProfileEditScreen, useAuth } from "@repo/ui";
import { createProxyUserService } from "@repo/core/user";

export default function ProfileEditPage() {
  const router = useRouter();
  const { accessToken } = useAuth();
  const userService = useMemo(
    () => createProxyUserService("/api", () => accessToken),
    [accessToken],
  );

  return (
    <div style={{ alignSelf: "flex-start", width: "100%" }}>
      <ProfileEditScreen
        userService={userService}
        onGoBack={() => router.push("/settings")}
      />
    </div>
  );
}
