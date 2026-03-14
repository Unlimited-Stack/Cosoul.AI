/**
 * register.tsx — Native 端注册页
 */
import { useRouter } from "expo-router";
import { RegisterScreen, useAuth } from "@repo/ui";

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();

  return (
    <RegisterScreen
      onRegister={register}
      onGoToLogin={() => router.replace("/login")}
    />
  );
}
