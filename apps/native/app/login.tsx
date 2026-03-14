/**
 * login.tsx — Native 端登录页
 */
import { useRouter } from "expo-router";
import { LoginScreen, useAuth } from "@repo/ui";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();

  return (
    <LoginScreen
      onLogin={login}
      onGoToRegister={() => router.replace("/register")}
      onGoToForgotPassword={() => router.push("/forgot-password")}
    />
  );
}
