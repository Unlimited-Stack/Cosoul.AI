/**
 * AuthPages — Web 端认证页面容器
 *
 * 管理登录 / 注册 / 忘记密码三个页面的切换。
 * 内嵌在 AppShell 中，未登录时替代主内容区显示。
 */
"use client";

import { useState } from "react";
import {
  useAuth,
  useTheme,
  LoginScreen,
  RegisterScreen,
  ForgotPasswordScreen,
} from "@repo/ui";
import { createProxyAuthService } from "@repo/core/auth";

type AuthPage = "login" | "register" | "forgot";

// 创建 auth proxy（用于 forgotPassword / resetPassword）
const authService = createProxyAuthService("/api");

export function AuthPages() {
  const { colors } = useTheme();
  const { login, register } = useAuth();
  const [page, setPage] = useState<AuthPage>("login");

  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        backgroundColor: colors.bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ width: "100%", maxWidth: 480, height: "100%" }}>
        {page === "login" && (
          <LoginScreen
            onLogin={login}
            onGoToRegister={() => setPage("register")}
            onGoToForgotPassword={() => setPage("forgot")}
          />
        )}
        {page === "register" && (
          <RegisterScreen
            onRegister={register}
            onGoToLogin={() => setPage("login")}
          />
        )}
        {page === "forgot" && (
          <ForgotPasswordScreen
            onForgotPassword={(email) => authService.forgotPassword(email)}
            onResetPassword={(email, code, newPassword) =>
              authService.resetPassword({ email, code, newPassword })
            }
            onGoBack={() => setPage("login")}
          />
        )}
      </div>
    </div>
  );
}
