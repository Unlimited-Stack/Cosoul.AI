/**
 * profile-edit.tsx — Native 端编辑资料页（薄壳）
 * 从设置页"个人资料"进入，注入 UserService 后渲染 ProfileEditScreen。
 */
import { useMemo } from "react";
import { useRouter } from "expo-router";
import { ProfileEditScreen, useAuth } from "@repo/ui";
import { createProxyUserService } from "@repo/core/user";
import { getPersonaPlatformConfig } from "../lib/getApiUrl";

export default function ProfileEditPage() {
  const router = useRouter();
  const { accessToken } = useAuth();

  // 复用与 Persona 相同的 API 地址推导逻辑，注入 accessToken
  const userService = useMemo(() => {
    const config = getPersonaPlatformConfig();
    return createProxyUserService(config.proxyBaseUrl ?? "/api", () => accessToken);
  }, [accessToken]);

  return (
    <ProfileEditScreen
      userService={userService}
      onGoBack={() => router.back()}
    />
  );
}
