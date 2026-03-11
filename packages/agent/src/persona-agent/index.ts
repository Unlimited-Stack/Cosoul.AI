import {
  SoulDocument,
  MemoryDocument,
  PersonaContext,
  PersonaContextSchema,
  PERSONA_CONFIG,
} from "./types";
import { parseSoulMd, serializeSoulMd, extractPreferences } from "./soul-loader";
import {
  parseMemoryMd,
  serializeMemoryMd,
  appendLearning,
  createEmptyMemory,
} from "./memory-manager";
import { learnFromTaskSummary } from "./preference-learner";
import { appendHistoryAnnotation } from "./soul-updater";

// ============================================================
// PersonaAgent 主类 — 管理分身画像(Soul.md)和长期记忆(Memory.md)
// 职责：画像加载/偏好提取/记忆管理/偏好学习
// 不直接操作 DB，只操作内存中的文档对象；DB 持久化由 core/persona/service 负责
// ============================================================

export class PersonaAgent {
  private personaId: string;
  private soul: SoulDocument;
  private memory: MemoryDocument;

  /**
   * 构造 PersonaAgent 实例
   * @param personaId - 分身唯一标识 (UUID)
   * @param soulText - Soul.md 原始文本（如为空则需外部提供）
   * @param memoryText - Memory.md 原始文本（如为空则创建空白 Memory）
   */
  constructor(personaId: string, soulText: string, memoryText?: string) {
    this.personaId = personaId;
    this.soul = parseSoulMd(soulText);

    // Memory 可以为空（新分身首次使用时）
    if (memoryText && memoryText.trim()) {
      this.memory = parseMemoryMd(memoryText);
    } else {
      this.memory = createEmptyMemory(personaId);
    }
  }

  /**
   * 获取 PersonaContext 只读快照，注入给 TaskAgent
   * TaskAgent 拿到快照后用于 prompt 构建和 L2 研判
   *
   * @param taskDescription - 任务描述（可选，用于筛选相关记忆片段）
   * @returns PersonaContext 只读快照
   */
  getContext(taskDescription?: string): PersonaContext {
    // 从 Soul.md 提取结构化偏好
    const preferences = extractPreferences(this.soul);

    // 从 Memory.md 中提取与当前任务相关的记忆片段
    const relevantMemory = this.getRelevantMemory(taskDescription);

    const context: PersonaContext = {
      personaId: this.personaId,
      personaName: this.soul.frontmatter.persona_name,
      soulText: this.soul.rawText,
      preferences,
      relevantMemory,
      tokenBudget: PERSONA_CONFIG.defaultTaskTokenBudget,
    };

    // Zod 校验确保输出格式正确
    return PersonaContextSchema.parse(context);
  }

  /**
   * 任务完成后触发偏好学习
   * 分析 taskSummary → 提取洞察 → 更新 Memory.md → 追加 Soul.md History Annotations
   *
   * @param taskSummary - 任务完成后的摘要文本
   * @returns 更新后的 Soul.md 和 Memory.md 文本（供调用方持久化）
   */
  onTaskCompleted(taskSummary: string): {
    updatedSoul: string;
    updatedMemory: string;
  } {
    // 1. 从任务摘要中学习偏好
    const learning = learnFromTaskSummary(
      this.soul,
      this.memory,
      taskSummary
    );

    // 2. 将学习结果追加到 Memory.md
    this.memory = appendLearning(this.memory, learning);

    // 3. 如果有有价值的洞察，追加到 Soul.md 的 History Annotations
    if (learning.insights.length > 0) {
      const annotation = learning.insights
        .slice(0, 3) // 最多取前 3 条，避免 History Annotations 过长
        .join("; ");
      this.soul = appendHistoryAnnotation(this.soul, annotation);
    }

    return {
      updatedSoul: serializeSoulMd(this.soul),
      updatedMemory: serializeMemoryMd(this.memory),
    };
  }

  /**
   * 获取当前 Soul.md 的 markdown 文本
   */
  getSoulText(): string {
    return serializeSoulMd(this.soul);
  }

  /**
   * 获取当前 Memory.md 的 markdown 文本
   */
  getMemoryText(): string {
    return serializeMemoryMd(this.memory);
  }

  // ============================================================
  // 内部辅助方法
  // ============================================================

  /**
   * 从 Memory.md 中提取与任务相关的记忆片段
   * 简单实现：返回 matchingPatterns 段全文（后续可做语义检索优化）
   */
  private getRelevantMemory(taskDescription?: string): string {
    const patterns = this.memory.sections.matchingPatterns;

    // 如果没有任务描述，返回全部匹配模式
    if (!taskDescription || !patterns || patterns === "(暂无匹配模式记录)") {
      return patterns;
    }

    // 简单的关键词相关性过滤：按段落分割，保留包含任务关键词的段落
    const keywords = taskDescription
      .split(/[\s,，、。！？]+/)
      .filter((w) => w.length >= 2);

    if (keywords.length === 0) return patterns;

    const paragraphs = patterns.split(/\n\n+/);
    const relevant = paragraphs.filter((p) =>
      keywords.some((kw) => p.includes(kw))
    );

    // 如果没有相关段落，返回最近的记录（最后 3 段）
    if (relevant.length === 0) {
      return paragraphs.slice(-3).join("\n\n");
    }

    return relevant.join("\n\n");
  }
}
