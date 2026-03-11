"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { AgentScreen } from "@repo/ui";

/** Agent 主页面 — 点击扳手图标跳转到 /agent/debug 调试页 */
export default function AgentPage() {
  const router = useRouter();
  const handleNavigateDebug = useCallback(() => router.push("/agent/debug"), [router]);

  return <AgentScreen onNavigateDebug={handleNavigateDebug} />;
}
