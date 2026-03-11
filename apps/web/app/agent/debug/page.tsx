"use client";

import { useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { AgentDebugScreen } from "@repo/ui";
import { createProxyLlmService } from "@repo/core/llm";

/** Agent 调试页 — Coding Plan 模型连接测试 */
export default function AgentDebugPage() {
  const router = useRouter();
  const llmService = useMemo(() => createProxyLlmService("/api"), []);
  const handleGoBack = useCallback(() => router.push("/agent"), [router]);

  return <AgentDebugScreen llmService={llmService} onGoBack={handleGoBack} />;
}
