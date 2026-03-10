/**
 * ai-core.tsx
 * Native 端「Agent」Tab 页面
 *
 * 直连 Coding Plan API，无需经过 Next.js 3030 代理。
 * API 配置从 Expo app.config 的 extra 字段读取。
 */
import { useMemo } from "react";
import Constants from "expo-constants";
import { AiCoreScreen } from "@repo/ui";
import { createDirectLlmService, createProxyLlmService } from "@repo/core/llm";
import { Platform } from "react-native";

/** 从 Expo extra config 读取 LLM 配置 */
const extra = Constants.expoConfig?.extra ?? {};
const CODING_PLAN_BASE_URL =
  extra.codingPlanBaseUrl ?? "https://coding.dashscope.aliyuncs.com/v1";
const CODING_PLAN_API_KEY = extra.codingPlanApiKey ?? "";

export default function AiCoreTab() {
  const llmService = useMemo(() => {
    // Expo Web 走相对路径代理（同源，无 CORS 问题）
    if (Platform.OS === "web") {
      return createProxyLlmService("/api");
    }
    // 真机 / 模拟器：直连 Coding Plan API
    return createDirectLlmService({
      baseUrl: CODING_PLAN_BASE_URL,
      apiKey: CODING_PLAN_API_KEY,
    });
  }, []);

  return <AiCoreScreen llmService={llmService} />;
}
