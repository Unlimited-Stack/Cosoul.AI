/**
 * account-security.tsx — Native 端账号与安全页（薄壳）
 * 从设置页"账号与安全"进入，注入 UserService + AuthService 后渲染。
 */
import { useCallback, useMemo } from "react";
import { useRouter } from "expo-router";
import { AccountSecurityScreen, useAuth } from "@repo/ui";
import { createProxyUserService } from "@repo/core/user";
import { createProxyAuthService } from "@repo/core/auth";
import { getPersonaPlatformConfig } from "../lib/getApiUrl";

export default function AccountSecurityPage() {
  const router = useRouter();
  const { accessToken, logout } = useAuth();

  const config = useMemo(() => getPersonaPlatformConfig(), []);
  const baseUrl = config.proxyBaseUrl ?? "/api";

  const userService = useMemo(
    () => createProxyUserService(baseUrl, () => accessToken),
    [baseUrl, accessToken],
  );

  const authService = useMemo(() => createProxyAuthService(baseUrl), [baseUrl]);

  /** 修改密码 */
  const handleChangePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      if (!accessToken) throw new Error("未登录");
      await authService.changePassword({ currentPassword, newPassword }, accessToken);
    },
    [accessToken, authService],
  );

  /** 注销账号，成功后登出 */
  const handleDeactivate = useCallback(
    async (password: string) => {
      if (!accessToken) throw new Error("未登录");
      await authService.deactivate(password, accessToken);
      await logout();
    },
    [accessToken, authService, logout],
  );

  return (
    <AccountSecurityScreen
      userService={userService}
      onGoBack={() => router.back()}
      onChangePassword={handleChangePassword}
      onDeactivate={handleDeactivate}
    />
  );
}
