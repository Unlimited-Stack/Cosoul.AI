/**
 * entry.ts — Judge Agent 微服务独立启动入口
 *
 * 启动命令：npm run judge -w packages/agent
 * 默认端口：4050（可通过 JUDGE_AGENT_PORT 环境变量覆盖）
 */

import { createJudgeServer } from "./server";

const PORT = Number(process.env.JUDGE_AGENT_PORT) || 4050;

const server = createJudgeServer();

server.listen(PORT, () => {
  console.log(`[JudgeAgent] 中立裁决服务已启动 → http://localhost:${PORT}`);
  console.log(`[JudgeAgent] POST /judge  — 执行 L2 裁决`);
  console.log(`[JudgeAgent] GET  /health — 健康检查`);
});

// 优雅退出
process.on("SIGINT", () => {
  console.log("\n[JudgeAgent] 收到 SIGINT，正在关闭...");
  server.close(() => process.exit(0));
});
process.on("SIGTERM", () => {
  console.log("[JudgeAgent] 收到 SIGTERM，正在关闭...");
  server.close(() => process.exit(0));
});
