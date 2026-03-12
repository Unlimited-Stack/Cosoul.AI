/**
 * agent-task-chat.tsx
 * Native 端任务对话页 — 选择人格操作后跳转到此页面
 *
 * 路由参数：personaId, personaName, actionKey
 * 薄壳页面：仅做路由解析 + TaskService 注入，UI 逻辑在 @repo/ui
 *
 * 策略 A 流程：
 *   用户发消息 → taskService.extract() → LLM 提取
 *   提取完成 → 用户确认 → taskService.createFromIntake() → TaskAgent 创建
 */
import { useCallback, useMemo } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { TaskChatScreen } from "@repo/ui";
import { createTaskServiceForPlatform } from "@repo/core/task";
import { getPersonaPlatformConfig } from "../lib/getApiUrl";

export default function AgentTaskChatPage() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    personaId: string;
    personaName: string;
    actionKey: string;
  }>();

  const handleGoBack = useCallback(() => {
    try {
      if (router.canGoBack()) router.back();
      else router.replace("/(tabs)/agent");
    } catch {
      // canGoBack 在 Web 端可能不可靠，兜底跳转到 Agent 主页
      router.replace("/(tabs)/agent");
    }
  }, [router]);

  // ── 注入 TaskService（与 PersonaService 同源同构的平台适配） ──
  const taskService = useMemo(() => {
    const config = getPersonaPlatformConfig();
    return createTaskServiceForPlatform({
      platform: config.platform,
      proxyBaseUrl: config.proxyBaseUrl,
    });
  }, []);

  return (
    <TaskChatScreen
      personaId={params.personaId ?? ""}
      personaName={params.personaName ?? "未知人格"}
      actionKey={params.actionKey ?? "add_task"}
      onGoBack={handleGoBack}
      taskService={taskService}
    />
  );
}
