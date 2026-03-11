/**
 * agent.tsx
 * Native 端「Agent」Tab 主页面
 *
 * 右上角扳手图标跳转到 agent-debug 调试页（modal 方式）。
 */
import { useCallback } from "react";
import { useRouter } from "expo-router";
import { AgentScreen } from "@repo/ui";

export default function AgentTab() {
  const router = useRouter();
  const handleNavigateDebug = useCallback(() => router.push("/agent-debug"), [router]);

  return <AgentScreen onNavigateDebug={handleNavigateDebug} />;
}
