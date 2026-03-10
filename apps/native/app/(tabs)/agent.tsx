/**
 * agent.tsx
 * Native 端「Agent」Tab 页面
 *
 * - 真机 / 模拟器：直连 Coding Plan API（无 CORS 限制）
 * - Expo Web（浏览器）：走 Next.js BFF 代理（浏览器有 CORS 限制）
 *
 * API 配置从 Expo app.config 的 extra 字段读取。
 */
import { useMemo } from "react";
import Constants from "expo-constants";
import { AiCoreScreen } from "@repo/ui";
import { createDirectLlmService, createProxyLlmService } from "@repo/core/llm";
import { Platform } from "react-native";

const extra = Constants.expoConfig?.extra ?? {};
const CODING_PLAN_BASE_URL =
  extra.codingPlanBaseUrl ?? "https://coding.dashscope.aliyuncs.com/v1";
const CODING_PLAN_API_KEY = extra.codingPlanApiKey ?? "";
const WEB_BFF_URL = extra.webBffUrl ?? "http://localhost:3030/api";

export default function AgentTab() {
  const llmService = useMemo(() => {
    if (Platform.OS === "web") {
      return createProxyLlmService(WEB_BFF_URL);
    }
    return createDirectLlmService({
      baseUrl: CODING_PLAN_BASE_URL,
      apiKey: CODING_PLAN_API_KEY,
    });
  }, []);

  return <AiCoreScreen llmService={llmService} />;
}
