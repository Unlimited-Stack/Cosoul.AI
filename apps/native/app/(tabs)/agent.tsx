/**
 * agent.tsx
 * Native 端「Agent」Tab 主页面
 *
 * 当前与 Web 共用 BFF Proxy，后续可根据平台切换为直连。
 */
import { useCallback, useMemo } from "react";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import { AgentScreen, type PersonaService } from "@repo/ui";
import { createProxyPersonaService } from "@repo/core/persona";

const extra = Constants.expoConfig?.extra ?? {};
/** Web BFF 绝对地址 — Native/Metro 无 API routes，必须用绝对 URL */
const WEB_BFF_URL = extra.webBffUrl ?? "http://localhost:3030/api";

export default function AgentTab() {
  const router = useRouter();
  const handleNavigateDebug = useCallback(() => router.push("/agent-debug"), [router]);

  /** Proxy 模式：走 Web BFF 绝对地址 → Next.js API → DB */
  const personaService = useMemo<PersonaService>(
    () => createProxyPersonaService(WEB_BFF_URL),
    [],
  );

  return (
    <AgentScreen
      onNavigateDebug={handleNavigateDebug}
      personaService={personaService}
    />
  );
}
