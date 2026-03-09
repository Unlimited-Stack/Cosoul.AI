/**
 * critiquePrompts.ts
 * 锐评功能的静态配置：人格类型、可用模型列表。
 * 被 AiCoreScreen 引用来渲染选择器 UI。
 */

// 锐评人格枚举：毒舌吐槽 | 彩虹屁 | 专业摄影师
export type PersonaKey = "roast" | "flatter" | "pro";

// 单个人格选项的描述结构
export interface PersonaOption {
  key: PersonaKey;
  emoji: string;  // 显示在选择器 pill 中的表情符号
  label: string;  // 中文标签
}

// 三种锐评人格配置——顺序即 UI 中从左到右的排列顺序
export const PERSONAS: PersonaOption[] = [
  { key: "roast", emoji: "\uD83D\uDD25", label: "\u6BD2\u820C\u5410\u69FD" },
  { key: "flatter", emoji: "\uD83C\uDF08", label: "\u5F69\u8679\u5C41" },
  { key: "pro", emoji: "\uD83E\uDDD0", label: "\u4E13\u4E1A\u6444\u5F71\u5E08" },
];

// 单个模型选项的描述结构
export interface ModelOption {
  id: string;    // 发送给 API 的模型 ID
  label: string; // UI 显示名称
}

// 可用的多模态视觉模型（阿里百炼 Coding Plan）
export const MODELS: ModelOption[] = [
  { id: "kimi-k2.5", label: "Kimi K2.5" },
  { id: "qwen3.5-plus", label: "Qwen 3.5+" },
];
