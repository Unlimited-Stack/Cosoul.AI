import { SoulDocument, MemoryDocument, PreferenceLearning } from "./types";

// ============================================================
// 偏好学习引擎 — 从任务摘要中提取偏好洞察
// 纯文本分析，不调用 LLM（LLM 增强版在 P3 阶段实现）
// ============================================================

/**
 * 从任务摘要中提取偏好学习结果
 * 分析 taskSummary 文本，对比 soul 中的现有偏好，找出新的洞察
 *
 * @param soul - 当前 Soul.md 文档（用于对比现有偏好）
 * @param memory - 当前 Memory.md 文档（用于避免重复记录）
 * @param taskSummary - 任务完成后的摘要文本
 * @returns PreferenceLearning 偏好学习结果
 */
export function learnFromTaskSummary(
  soul: SoulDocument,
  memory: MemoryDocument,
  taskSummary: string
): PreferenceLearning {
  const now = new Date().toISOString();

  // 判断任务结果类型
  const outcome = detectOutcome(taskSummary);

  // 提取洞察：从摘要中找出有价值的匹配模式
  const insights = extractInsights(taskSummary, soul);

  // 提取建议更新：对比现有偏好，找出可能需要调整的偏好
  const suggestedUpdates = extractSuggestedUpdates(taskSummary, soul);

  return {
    taskId: extractTaskId(taskSummary),
    outcome,
    insights,
    suggestedUpdates,
    learnedAt: now,
  };
}

// ============================================================
// 内部辅助函数
// ============================================================

/** 从摘要文本中判断任务结果 */
function detectOutcome(
  summary: string
): "completed" | "cancelled" | "timeout" {
  const lower = summary.toLowerCase();
  if (
    lower.includes("cancelled") ||
    lower.includes("取消") ||
    lower.includes("cancel")
  ) {
    return "cancelled";
  }
  if (
    lower.includes("timeout") ||
    lower.includes("超时") ||
    lower.includes("timed out")
  ) {
    return "timeout";
  }
  return "completed";
}

/** 从摘要中提取 taskId（如果有的话） */
function extractTaskId(summary: string): string | undefined {
  // 匹配常见的 task_id 格式：UUID 或 task-xxx
  const uuidMatch = summary.match(
    /task[_-]?id\s*[:=]\s*([0-9a-f-]{36})/i
  );
  if (uuidMatch) return uuidMatch[1];

  const simpleMatch = summary.match(/task[_-]?id\s*[:=]\s*([\w-]+)/i);
  if (simpleMatch) return simpleMatch[1];

  return undefined;
}

/**
 * 从摘要中提取有价值的洞察
 * 通过关键词匹配识别摘要中的模式和经验
 */
function extractInsights(summary: string, soul: SoulDocument): string[] {
  const insights: string[] = [];
  const lines = summary.split("\n").filter((l) => l.trim());

  // 关键词触发规则：包含这些词的句子可能是有价值的洞察
  const insightKeywords = [
    "偏好",
    "喜欢",
    "不喜欢",
    "倾向",
    "规律",
    "模式",
    "prefer",
    "pattern",
    "tendency",
    "learned",
    "发现",
    "总结",
    "特征",
  ];

  for (const line of lines) {
    const lower = line.toLowerCase();
    const isInsight = insightKeywords.some((kw) => lower.includes(kw));
    if (isInsight) {
      // 清理格式标记
      const cleaned = line.replace(/^[-*#>\s]+/, "").trim();
      if (cleaned.length > 5 && cleaned.length < 200) {
        insights.push(cleaned);
      }
    }
  }

  // 如果摘要比较长但没提取到洞察，至少记录一条概要
  if (insights.length === 0 && summary.length > 50) {
    const firstMeaningfulLine = lines.find(
      (l) => l.trim().length > 10 && !l.startsWith("#")
    );
    if (firstMeaningfulLine) {
      insights.push(
        `任务记录: ${firstMeaningfulLine.trim().substring(0, 100)}`
      );
    }
  }

  return insights;
}

/**
 * 从摘要中提取建议的偏好更新
 * 简单的基于规则的匹配（后续可接入 LLM 增强）
 */
function extractSuggestedUpdates(
  summary: string,
  soul: SoulDocument
): Array<{
  field: string;
  oldValue?: string;
  newValue: string;
  reason: string;
}> {
  const updates: Array<{
    field: string;
    oldValue?: string;
    newValue: string;
    reason: string;
  }> = [];

  // 检测"更喜欢 X"类型的表述
  const preferPatterns = [
    /更喜欢\s*(.+)/g,
    /偏好从\s*(.+?)\s*变为\s*(.+)/g,
    /不再喜欢\s*(.+)/g,
    /新增偏好\s*[:：]\s*(.+)/g,
  ];

  for (const pattern of preferPatterns) {
    const matches = summary.matchAll(pattern);
    for (const match of matches) {
      if (match[2]) {
        // "偏好从 X 变为 Y" 格式
        updates.push({
          field: "preference",
          oldValue: match[1].trim(),
          newValue: match[2].trim(),
          reason: `从任务摘要中检测到偏好变化`,
        });
      } else if (match[1]) {
        updates.push({
          field: "preference",
          newValue: match[1].trim(),
          reason: `从任务摘要中检测到新偏好`,
        });
      }
    }
  }

  return updates;
}
