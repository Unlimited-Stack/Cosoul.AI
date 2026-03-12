/**
 * agent-debug.tsx
 * Native 端 Agent 调试页 — 模型连接测试 + PersonaAgent 数据监控
 *
 * 从 Agent 主页右上角扳手图标进入，以 modal 方式呈现。
 * 点击左上角返回按钮可关闭。
 */
import { useMemo, useCallback } from "react";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { AgentDebugScreen } from "@repo/ui";
import { createLlmServiceForPlatform } from "@repo/core/llm";
import { getPersonaPlatformConfig, WEB_BFF_URL } from "../lib/getApiUrl";

const extra = Constants.expoConfig?.extra ?? {};
const CODING_PLAN_BASE_URL =
  extra.codingPlanBaseUrl ?? "https://coding.dashscope.aliyuncs.com/v1";
const CODING_PLAN_API_KEY = extra.codingPlanApiKey ?? "";

export default function AgentDebugPage() {
  const router = useRouter();

  /** LLM Service — 与 LLM 工厂模式对齐 */
  const llmService = useMemo(() => {
    if (Platform.OS === "web") {
      return createLlmServiceForPlatform({ platform: "expo-web", proxyBaseUrl: WEB_BFF_URL });
    }
    return createLlmServiceForPlatform({
      platform: "native",
      baseUrl: CODING_PLAN_BASE_URL,
      apiKey: CODING_PLAN_API_KEY,
    });
  }, []);

  const handleGoBack = useCallback(() => router.back(), [router]);

  /** 获取调试用分身完整数据 — 使用平台配置推导的 BFF 地址 */
  const fetchDebugPersonas = useCallback(async () => {
    const config = getPersonaPlatformConfig();
    const baseUrl = config.proxyBaseUrl ?? "/api";
    const res = await fetch(`${baseUrl}/debug/personas`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }, []);

  return (
    <AgentDebugScreen
      llmService={llmService}
      onGoBack={handleGoBack}
      fetchDebugPersonas={fetchDebugPersonas}
    />
  );
}
