/**
 * agent-task-chat.tsx
 * Native 端任务对话页 — 选择人格操作后跳转到此页面
 *
 * 路由参数：personaId, personaName, actionKey
 * 薄壳页面：仅做路由解析 + 参数传递，UI 逻辑在 @repo/ui
 */
import { useCallback } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { TaskChatScreen } from "@repo/ui";

export default function AgentTaskChatPage() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    personaId: string;
    personaName: string;
    actionKey: string;
  }>();

  const handleGoBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/agent");
  }, [router]);

  return (
    <TaskChatScreen
      personaId={params.personaId ?? ""}
      personaName={params.personaName ?? "未知人格"}
      actionKey={params.actionKey ?? "add_task"}
      onGoBack={handleGoBack}
    />
  );
}
