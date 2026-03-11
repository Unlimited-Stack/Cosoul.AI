"use client";

import { useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { AgentDebugScreen } from "@repo/ui";
import { createProxyLlmService } from "@repo/core/llm";

/** Agent 调试页 — 模型连接测试 + PersonaAgent 数据监控 */
export default function AgentDebugPage() {
  const router = useRouter();
  const llmService = useMemo(() => createProxyLlmService("/api"), []);
  const handleGoBack = useCallback(() => router.push("/agent"), [router]);

  /** 从 BFF 获取调试用分身完整数据 */
  const fetchDebugPersonas = useCallback(async () => {
    const res = await fetch("/api/debug/personas");
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
