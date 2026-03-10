"use client";

import { useMemo } from "react";
import { AiCoreScreen } from "@repo/ui";
import { createProxyLlmService } from "@repo/core/llm";

export default function AiCorePage() {
  const llmService = useMemo(() => createProxyLlmService("/api"), []);
  return <AiCoreScreen llmService={llmService} />;
}
