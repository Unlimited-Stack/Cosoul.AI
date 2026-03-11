import {
  MemoryDocument,
  MemoryDocumentSchema,
  PreferenceLearning,
} from "./types";

// ============================================================
// Memory.md 管理器 — 长期记忆的读写/追加/创建
// Memory.md 是 Persona-Agent 的"经验笔记本"，记录跨任务的匹配规律
// ============================================================

/**
 * 解析 Memory.md 原始文本为结构化 MemoryDocument
 * 格式约定：YAML frontmatter + 三个 ## 段落
 */
export function parseMemoryMd(rawText: string): MemoryDocument {
  const frontmatter = parseFrontmatter(rawText);
  const sections = parseSections(rawText);

  const doc: MemoryDocument = {
    frontmatter: {
      persona_id: frontmatter.persona_id ?? "",
      last_updated: frontmatter.last_updated ?? new Date().toISOString(),
      total_tasks_completed: Number(frontmatter.total_tasks_completed) || 0,
      total_tasks_cancelled: Number(frontmatter.total_tasks_cancelled) || 0,
    },
    sections: {
      matchingPatterns: sections["Matching Patterns"] ?? "",
      preferenceLog: sections["Preference Log"] ?? "",
      tokenStats: sections["Token Stats"] ?? "",
    },
    rawText,
  };

  return MemoryDocumentSchema.parse(doc);
}

/**
 * 将 MemoryDocument 序列化回 markdown 文本
 */
export function serializeMemoryMd(memory: MemoryDocument): string {
  const fm = memory.frontmatter;
  const s = memory.sections;

  const lines: string[] = [
    "---",
    `persona_id: ${fm.persona_id}`,
    `last_updated: ${fm.last_updated}`,
    `total_tasks_completed: ${fm.total_tasks_completed}`,
    `total_tasks_cancelled: ${fm.total_tasks_cancelled}`,
    "---",
    "",
    "## Matching Patterns",
    "",
    s.matchingPatterns.trim(),
    "",
    "## Preference Log",
    "",
    s.preferenceLog.trim(),
    "",
    "## Token Stats",
    "",
    s.tokenStats.trim(),
    "",
  ];

  return lines.join("\n");
}

/**
 * 追加偏好学习结果到 Memory.md
 * 将 insights 写入 Matching Patterns，将 suggestedUpdates 写入 Preference Log
 */
export function appendLearning(
  memory: MemoryDocument,
  learning: PreferenceLearning
): MemoryDocument {
  const now = new Date().toISOString();
  const dateStr = now.split("T")[0];

  // 拼接新的匹配模式洞察
  let newPatterns = memory.sections.matchingPatterns;
  if (learning.insights.length > 0) {
    const insightsText = learning.insights
      .map((insight) => `- ${insight}`)
      .join("\n");
    newPatterns = newPatterns
      ? `${newPatterns}\n\n### ${dateStr} (${learning.outcome})\n${insightsText}`
      : `### ${dateStr} (${learning.outcome})\n${insightsText}`;
  }

  // 拼接偏好演变日志
  let newPrefLog = memory.sections.preferenceLog;
  if (learning.suggestedUpdates.length > 0) {
    const updatesText = learning.suggestedUpdates
      .map(
        (u) =>
          `- [${dateStr}] ${u.field}: ${u.oldValue ?? "N/A"} -> ${u.newValue} (${u.reason})`
      )
      .join("\n");
    newPrefLog = newPrefLog ? `${newPrefLog}\n${updatesText}` : updatesText;
  }

  // 更新任务完成/取消计数
  const completedDelta = learning.outcome === "completed" ? 1 : 0;
  const cancelledDelta = learning.outcome === "cancelled" ? 1 : 0;

  const updated: MemoryDocument = {
    frontmatter: {
      ...memory.frontmatter,
      last_updated: now,
      total_tasks_completed:
        memory.frontmatter.total_tasks_completed + completedDelta,
      total_tasks_cancelled:
        memory.frontmatter.total_tasks_cancelled + cancelledDelta,
    },
    sections: {
      matchingPatterns: newPatterns,
      preferenceLog: newPrefLog,
      tokenStats: memory.sections.tokenStats,
    },
    rawText: "", // 序列化时重新生成
  };

  // 重新生成 rawText
  updated.rawText = serializeMemoryMd(updated);
  return MemoryDocumentSchema.parse(updated);
}

/**
 * 创建空白 Memory 文档（新分身初始化时调用）
 */
export function createEmptyMemory(personaId: string): MemoryDocument {
  const now = new Date().toISOString();

  const doc: MemoryDocument = {
    frontmatter: {
      persona_id: personaId,
      last_updated: now,
      total_tasks_completed: 0,
      total_tasks_cancelled: 0,
    },
    sections: {
      matchingPatterns: "(暂无匹配模式记录)",
      preferenceLog: "(暂无偏好变化记录)",
      tokenStats: "(暂无 Token 使用统计)",
    },
    rawText: "",
  };

  doc.rawText = serializeMemoryMd(doc);
  return MemoryDocumentSchema.parse(doc);
}

// ============================================================
// 内部辅助函数（与 soul-loader 同构，保持独立避免耦合）
// ============================================================

/** 解析 YAML frontmatter */
function parseFrontmatter(text: string): Record<string, string> {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const result: Record<string, string> = {};
  const lines = match[1].split("\n");
  for (const line of lines) {
    const kvMatch = line.match(/^(\w[\w_]*)\s*:\s*(.*)$/);
    if (kvMatch) {
      result[kvMatch[1]] = kvMatch[2].trim();
    }
  }
  return result;
}

/** 解析 ## 标题分段 */
function parseSections(text: string): Record<string, string> {
  const body = text.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const sections: Record<string, string> = {};

  const parts = body.split(/^## /m);
  for (const part of parts) {
    if (!part.trim()) continue;
    const newlineIdx = part.indexOf("\n");
    if (newlineIdx === -1) {
      sections[part.trim()] = "";
    } else {
      const title = part.substring(0, newlineIdx).trim();
      const content = part.substring(newlineIdx + 1).trim();
      sections[title] = content;
    }
  }

  return sections;
}
