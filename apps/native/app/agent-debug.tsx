/**
 * agent-debug.tsx
 * Native 端 Agent 调试页 — Coding Plan 模型连接测试
 *
 * 从 Agent 主页右上角扳手图标进入，以 modal 方式呈现。
 * 点击左上角返回按钮可关闭。
 */
import { useMemo, useCallback } from "react";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { AgentDebugScreen } from "@repo/ui";
import { createDirectLlmService, createProxyLlmService } from "@repo/core/llm";

const extra = Constants.expoConfig?.extra ?? {};
const CODING_PLAN_BASE_URL =
  extra.codingPlanBaseUrl ?? "https://coding.dashscope.aliyuncs.com/v1";
const CODING_PLAN_API_KEY = extra.codingPlanApiKey ?? "";
const WEB_BFF_URL = extra.webBffUrl ?? "http://localhost:3030/api";

export default function AgentDebugPage() {
  const router = useRouter();

  const llmService = useMemo(() => {
    if (Platform.OS === "web") {
      return createProxyLlmService(WEB_BFF_URL);
    }
    return createDirectLlmService({
      baseUrl: CODING_PLAN_BASE_URL,
      apiKey: CODING_PLAN_API_KEY,
    });
  }, []);

  const handleGoBack = useCallback(() => router.back(), [router]);

  return <AgentDebugScreen llmService={llmService} onGoBack={handleGoBack} />;
}
