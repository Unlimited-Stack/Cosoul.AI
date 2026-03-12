/**
 * agent.tsx
 * Native 端「Agent」Tab 主页面
 *
 * 数据刷新：下拉刷新（PullRefreshScrollView），用户主动拉取最新数据。
 *
 * 添加入口：Native 端使用长按 Agent Tab → 气泡浮层 → SoulChat 创建人格，
 * 因此隐藏底部"添加人格 Agent"按钮（Web 端仍保留）。
 */
import { useCallback, useMemo } from "react";
import { useRouter } from "expo-router";
import { AgentScreen, type PersonaService } from "@repo/ui";
import { createPersonaServiceForPlatform } from "@repo/core/persona";
import { getPersonaPlatformConfig, logApiDiagnostics } from "../../lib/getApiUrl";

export default function AgentTab() {
  const router = useRouter();
  const handleNavigateDebug = useCallback(() => router.push("/agent-debug"), [router]);

  const personaService = useMemo<PersonaService>(() => {
    logApiDiagnostics("AgentTab");
    return createPersonaServiceForPlatform(getPersonaPlatformConfig());
  }, []);

  return (
    <AgentScreen
      onNavigateDebug={handleNavigateDebug}
      personaService={personaService}
      hideAddPersona
    />
  );
}
