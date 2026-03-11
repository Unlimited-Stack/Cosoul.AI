import { SoulDocument, SoulDocumentSchema } from "./types";

// ============================================================
// Soul.md 加载器 — 解析/序列化分身人格文档
// 使用正则解析 markdown，不引入外部 markdown 库
// ============================================================

/**
 * 解析 Soul.md 原始文本为结构化 SoulDocument
 * 格式约定：YAML frontmatter (---包裹) + 四个 ## 段落
 */
export function parseSoulMd(rawText: string): SoulDocument {
  const frontmatter = parseFrontmatter(rawText);
  const sections = parseSections(rawText);

  const doc: SoulDocument = {
    frontmatter: {
      persona_id: frontmatter.persona_id ?? "",
      persona_name: frontmatter.persona_name ?? "",
      owner_user_id: frontmatter.owner_user_id ?? "",
      version: Number(frontmatter.version) || 1,
      created_at: frontmatter.created_at ?? new Date().toISOString(),
      updated_at: frontmatter.updated_at ?? new Date().toISOString(),
    },
    sections: {
      coreIdentity: sections["Core Identity"] ?? "",
      preferences: sections["Preferences"] ?? "",
      valuesAndVibe: sections["Values & Vibe"] ?? "",
      historyAnnotations: sections["History Annotations"] ?? "",
    },
    rawText,
  };

  // Zod 校验，确保结构完整
  return SoulDocumentSchema.parse(doc);
}

/**
 * 将 SoulDocument 序列化回 markdown 文本
 * 保持 frontmatter + 四段式结构
 */
export function serializeSoulMd(soul: SoulDocument): string {
  const fm = soul.frontmatter;
  const s = soul.sections;

  const lines: string[] = [
    "---",
    `persona_id: ${fm.persona_id}`,
    `persona_name: ${fm.persona_name}`,
    `owner_user_id: ${fm.owner_user_id}`,
    `version: ${fm.version}`,
    `created_at: ${fm.created_at}`,
    `updated_at: ${fm.updated_at}`,
    "---",
    "",
    "## Core Identity",
    "",
    s.coreIdentity.trim(),
    "",
    "## Preferences",
    "",
    s.preferences.trim(),
    "",
    "## Values & Vibe",
    "",
    s.valuesAndVibe.trim(),
    "",
    "## History Annotations",
    "",
    s.historyAnnotations.trim(),
    "",
  ];

  return lines.join("\n");
}

/**
 * 从 Soul.md 中提取匹配偏好（供 L0 硬筛使用）
 * 解析 Preferences 段中的 key: value 格式
 */
export function extractPreferences(
  soul: SoulDocument
): Record<string, unknown> {
  const prefs: Record<string, unknown> = {};
  const text = soul.sections.preferences;

  // 逐行解析 "- key: value" 或 "key: value" 格式
  const lines = text.split("\n");
  for (const line of lines) {
    const match = line.match(/^[-*]?\s*(.+?):\s*(.+)$/);
    if (match) {
      const key = match[1].trim().toLowerCase().replace(/\s+/g, "_");
      const value = match[2].trim();
      // 尝试解析列表值（逗号分隔）
      if (value.includes(",")) {
        prefs[key] = value.split(",").map((v) => v.trim());
      } else {
        prefs[key] = value;
      }
    }
  }

  return prefs;
}

// ============================================================
// 内部辅助函数
// ============================================================

/** 解析 YAML frontmatter（--- 包裹的部分） */
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

/** 解析 ## 标题分段，返回 { 标题: 内容 } */
function parseSections(text: string): Record<string, string> {
  // 去掉 frontmatter 部分
  const body = text.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const sections: Record<string, string> = {};

  // 按 ## 标题分割
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
