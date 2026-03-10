/**
 * packages/core/src/llm/models.ts
 * 共享模型定义 — 所有平台（Web / Native）统一引用
 */

export interface ModelInfo {
  id: string;
  brand: string;
  capabilities: string[];
}

/** Coding Plan 平台支持的模型 */
export const MODELS: ModelInfo[] = [
  { id: "qwen3.5-plus", brand: "千问", capabilities: ["文本生成", "深度思考", "视觉理解"] },
  { id: "qwen3-max-2026-01-23", brand: "千问", capabilities: ["文本生成", "深度思考"] },
  { id: "qwen3-coder-next", brand: "千问", capabilities: ["文本生成"] },
  { id: "qwen3-coder-plus", brand: "千问", capabilities: ["文本生成"] },
  { id: "glm-5", brand: "智谱", capabilities: ["文本生成", "深度思考"] },
  { id: "glm-4.7", brand: "智谱", capabilities: ["文本生成", "深度思考"] },
  { id: "kimi-k2.5", brand: "Kimi", capabilities: ["文本生成", "深度思考", "视觉理解"] },
  { id: "MiniMax-M2.5", brand: "MiniMax", capabilities: ["文本生成", "深度思考"] },
];
