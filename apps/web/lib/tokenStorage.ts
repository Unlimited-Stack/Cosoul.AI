/**
 * Web 端 Token 存储适配器
 *
 * 开发阶段用 localStorage 存储 refreshToken。
 * 生产环境建议改为 HttpOnly Cookie（防 XSS）。
 */

import type { TokenStorage } from "@repo/ui";

const REFRESH_TOKEN_KEY = "cosoul_refresh_token";

export const webTokenStorage: TokenStorage = {
  async getRefreshToken() {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  },
  async setRefreshToken(token: string) {
    if (typeof window === "undefined") return;
    localStorage.setItem(REFRESH_TOKEN_KEY, token);
  },
  async removeRefreshToken() {
    if (typeof window === "undefined") return;
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  },
};
