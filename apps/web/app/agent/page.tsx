"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";
import { AgentScreen, type PersonaService } from "@repo/ui";
import { createProxyPersonaService } from "@repo/core/persona";

/**
 * Agent 主页面 — 真实 PersonaService（走 BFF → PostgreSQL）
 *
 * 调用链：浏览器 → /api/personas → @repo/core/persona-server → PG
 */
export default function AgentPage() {
  const router = useRouter();
  const handleNavigateDebug = useCallback(() => router.push("/agent/debug"), [router]);

  /** Proxy 模式：浏览器 fetch → BFF → DB */
  const personaService = useMemo<PersonaService>(
    () => createProxyPersonaService("/api"),
    [],
  );

  return (
    <AgentScreen
      onNavigateDebug={handleNavigateDebug}
      personaService={personaService}
    />
  );
}
