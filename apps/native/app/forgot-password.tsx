/**
 * forgot-password.tsx — Native 端找回密码页
 */
import { useRouter } from "expo-router";
import { ForgotPasswordScreen } from "@repo/ui";
import { createProxyAuthService } from "@repo/core/auth";
import { getPersonaPlatformConfig } from "../lib/getApiUrl";

const config = getPersonaPlatformConfig();
const authService = createProxyAuthService(config.proxyBaseUrl ?? "/api");

export default function ForgotPasswordPage() {
  const router = useRouter();

  return (
    <ForgotPasswordScreen
      onForgotPassword={(email) => authService.forgotPassword(email)}
      onResetPassword={(email, code, newPassword) =>
        authService.resetPassword({ email, code, newPassword })
      }
      onGoBack={() => router.replace("/login")}
    />
  );
}
