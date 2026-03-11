import { SoulDocument } from "./types";
import { serializeSoulMd } from "./soul-loader";

// ============================================================
// Soul.md 自动更新器
// 只操作 History Annotations 段，前三段（用户手动编辑区）不可修改
// ============================================================

/**
 * 在 Soul.md 的 History Annotations 段追加一条记录
 * 自动添加时间戳前缀，并递增 version
 *
 * @param soul - 当前 SoulDocument
 * @param annotation - 要追加的注释内容
 * @returns 更新后的 SoulDocument（version +1，rawText 重新生成）
 */
export function appendHistoryAnnotation(
  soul: SoulDocument,
  annotation: string
): SoulDocument {
  const now = new Date().toISOString();
  const dateStr = now.split("T")[0];

  // 在 History Annotations 末尾追加带时间戳的记录
  const existingAnnotations = soul.sections.historyAnnotations.trim();
  const newEntry = `- [${dateStr}] ${annotation}`;
  const updatedAnnotations = existingAnnotations
    ? `${existingAnnotations}\n${newEntry}`
    : newEntry;

  // 构建更新后的 SoulDocument
  const updated: SoulDocument = {
    frontmatter: {
      ...soul.frontmatter,
      version: soul.frontmatter.version + 1,
      updated_at: now,
    },
    sections: {
      ...soul.sections,
      historyAnnotations: updatedAnnotations,
    },
    rawText: "", // 下面重新生成
  };

  // 重新序列化生成 rawText
  updated.rawText = serializeSoulMd(updated);
  return updated;
}
