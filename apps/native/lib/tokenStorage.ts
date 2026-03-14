/**
 * Native 端 Token 存储适配器
 *
 * 使用 expo-secure-store 加密存储 refreshToken。
 * Web 端降级为 localStorage。
 */

import { Platform } from "react-native";
import type { TokenStorage } from "@repo/ui";

const REFRESH_TOKEN_KEY = "cosoul_refresh_token";

// Native 端使用 expo-secure-store
async function getNativeStorage() {
  const SecureStore = await import("expo-secure-store");
  return SecureStore;
}

export const nativeTokenStorage: TokenStorage = {
  async getRefreshToken() {
    if (Platform.OS === "web") {
      return localStorage.getItem(REFRESH_TOKEN_KEY);
    }
    const store = await getNativeStorage();
    return store.getItemAsync(REFRESH_TOKEN_KEY);
  },
  async setRefreshToken(token: string) {
    if (Platform.OS === "web") {
      localStorage.setItem(REFRESH_TOKEN_KEY, token);
      return;
    }
    const store = await getNativeStorage();
    await store.setItemAsync(REFRESH_TOKEN_KEY, token);
  },
  async removeRefreshToken() {
    if (Platform.OS === "web") {
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      return;
    }
    const store = await getNativeStorage();
    await store.deleteItemAsync(REFRESH_TOKEN_KEY);
  },
};
