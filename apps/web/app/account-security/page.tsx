/**
 * account-security/page.tsx — Web 端账号与安全页
 * 注入 UserService + AuthService，接入修改密码和注销账号。
 */
"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { AccountSecurityScreen, useAuth } from "@repo/ui";
import { createProxyUserService } from "@repo/core/user";
import { createProxyAuthService } from "@repo/core/auth";

const authService = createProxyAuthService("/api");

export default function AccountSecurityPage() {
  const router = useRouter();
  const { accessToken, logout } = useAuth();
  const userService = useMemo(
    () => createProxyUserService("/api", () => accessToken),
    [accessToken],
  );

  /** 修改密码：调用 BFF /api/user/change-password */
  const handleChangePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      if (!accessToken) throw new Error("未登录");
      await authService.changePassword({ currentPassword, newPassword }, accessToken);
    },
    [accessToken],
  );

  /** 注销账号：调用 BFF /api/user/deactivate，成功后登出 */
  const handleDeactivate = useCallback(
    async (password: string) => {
      if (!accessToken) throw new Error("未登录");
      await authService.deactivate(password, accessToken);
      await logout();
    },
    [accessToken, logout],
  );

  return (
    <div style={{ alignSelf: "flex-start", width: "100%" }}>
      <AccountSecurityScreen
        userService={userService}
        onGoBack={() => router.push("/settings")}
        onChangePassword={handleChangePassword}
        onDeactivate={handleDeactivate}
      />
    </div>
  );
}
