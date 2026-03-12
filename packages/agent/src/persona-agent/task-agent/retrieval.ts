import { db } from "@repo/core/db/client";
import { taskVectors, tasks } from "@repo/core/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { cosineSimilarity } from "./embedding";

// ─── 类型定义 ─────────────────────────────────────────────────────

export interface VectorSearchQuery {
  /** 发起搜索的源任务 ID（从结果中排除） */
  sourceTaskId: string;
  /** 源任务各字段的查询向量 */
  queryVectors: {
    targetActivity?: number[];
    targetVibe?: number[];
    rawDescription?: number[];
  };
  /** 返回结果数量上限 */
  topK: number;
  /**
   * 各字段权重（默认 targetActivity=0.35, targetVibe=0.35, rawDescription=0.30）
   */
  weights?: {
    targetActivity?: number;
    targetVibe?: number;
    rawDescription?: number;
  };
  /**
   * L0 预过滤白名单（由 queryL0Candidates 产生）。
   * 不传时回退到从 PostgreSQL tasks 表按 status=Searching 查询。
   */
  candidateTaskIds?: string[];
}

export interface VectorSearchResult {
  taskId: string;
  /** 加权综合得分 */
  score: number;
  /** 各字段单独得分（用于调试和可解释性） */
  fieldScores: {
    targetActivity: number | null;
    targetVibe: number | null;
    rawDescription: number | null;
  };
}

const DEFAULT_WEIGHTS = {
  targetActivity: 0.35,
  targetVibe: 0.35,
  rawDescription: 0.30
} as const;

// ─── 核心向量检索（PostgreSQL task_vectors 表）────────────────────

/**
 * L1 语义检索：从 PostgreSQL task_vectors 表批量读取候选向量，
 * 在应用层计算加权余弦相似度，返回 topK 结果。
 *
 * 替换原 SQLite 版本的 searchByVector，接口保持不变。
 */
export async function searchByVector(query: VectorSearchQuery): Promise<VectorSearchResult[]> {
  const weights = {
    targetActivity: query.weights?.targetActivity ?? DEFAULT_WEIGHTS.targetActivity,
    targetVibe: query.weights?.targetVibe ?? DEFAULT_WEIGHTS.targetVibe,
    rawDescription: query.weights?.rawDescription ?? DEFAULT_WEIGHTS.rawDescription
  };

  // Step 1: 确定候选任务 ID 集合
  let candidateIds: string[];
  if (query.candidateTaskIds && query.candidateTaskIds.length > 0) {
    candidateIds = query.candidateTaskIds.filter((id) => id !== query.sourceTaskId);
  } else {
    // 回退：从 PostgreSQL 查询所有 Searching 状态任务
    const rows = await db
      .select({ taskId: tasks.taskId })
      .from(tasks)
      .where(eq(tasks.status, "Searching"));
    candidateIds = rows.map((r) => r.taskId).filter((id) => id !== query.sourceTaskId);
  }

  if (candidateIds.length === 0) return [];

  // Step 2: 批量从 task_vectors 表读取所有候选任务的向量
  const vectorRows = await db
    .select({
      taskId: taskVectors.taskId,
      field: taskVectors.field,
      embedding: taskVectors.embedding
    })
    .from(taskVectors)
    .where(inArray(taskVectors.taskId, candidateIds));

  // 按 taskId 分组
  const byTask = new Map<string, Map<string, number[]>>();
  for (const row of vectorRows) {
    if (!byTask.has(row.taskId)) byTask.set(row.taskId, new Map());
    byTask.get(row.taskId)!.set(row.field, row.embedding);
  }

  // Step 3: 计算加权余弦相似度
  const results: VectorSearchResult[] = [];

  for (const [candidateId, fieldMap] of byTask) {
    const actVec = fieldMap.get("targetActivity");
    const vibeVec = fieldMap.get("targetVibe");
    const rawVec = fieldMap.get("rawDescription");

    const fieldScores = {
      targetActivity: computeFieldScore(query.queryVectors.targetActivity, actVec),
      targetVibe: computeFieldScore(query.queryVectors.targetVibe, vibeVec),
      rawDescription: computeFieldScore(query.queryVectors.rawDescription, rawVec)
    };

    let totalWeight = 0;
    let totalScore = 0;

    if (fieldScores.targetActivity !== null) {
      totalScore += fieldScores.targetActivity * weights.targetActivity;
      totalWeight += weights.targetActivity;
    }
    if (fieldScores.targetVibe !== null) {
      totalScore += fieldScores.targetVibe * weights.targetVibe;
      totalWeight += weights.targetVibe;
    }
    if (fieldScores.rawDescription !== null) {
      totalScore += fieldScores.rawDescription * weights.rawDescription;
      totalWeight += weights.rawDescription;
    }

    if (totalWeight === 0) continue;

    results.push({ taskId: candidateId, score: totalScore / totalWeight, fieldScores });
  }

  // Step 4: 按得分降序，取 topK
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, query.topK);
}

/**
 * 从 PostgreSQL task_vectors 表读取指定任务的所有字段向量。
 * 用于在 dispatcher 的 L1 检索前获取源任务查询向量。
 */
export async function readTaskVectors(
  taskId: string
): Promise<{ field: string; vector: number[] }[]> {
  const rows = await db
    .select({ field: taskVectors.field, embedding: taskVectors.embedding })
    .from(taskVectors)
    .where(eq(taskVectors.taskId, taskId));

  return rows.map((r) => ({ field: r.field, vector: r.embedding }));
}

// ─── 向量写入（对应旧 sqlite.ts 的 upsertTaskVector）─────────────

/**
 * 将 embedTaskFields() 的结果写入 PostgreSQL task_vectors 表。
 * 对每个字段执行 upsert（taskId + field 联合唯一索引）。
 */
export async function saveTaskVectors(
  taskId: string,
  vectors: { field: string; vector: number[] }[]
): Promise<void> {
  for (const v of vectors) {
    const existing = await db
      .select({ id: taskVectors.id })
      .from(taskVectors)
      .where(and(eq(taskVectors.taskId, taskId), eq(taskVectors.field, v.field)));

    if (existing.length > 0) {
      await db
        .update(taskVectors)
        .set({ embedding: v.vector, updatedAt: new Date() })
        .where(and(eq(taskVectors.taskId, taskId), eq(taskVectors.field, v.field)));
    } else {
      await db.insert(taskVectors).values({
        taskId,
        field: v.field,
        embedding: v.vector
      });
    }
  }
}

// ─── 内部辅助 ─────────────────────────────────────────────────────

function computeFieldScore(
  queryVec: number[] | undefined,
  candidateVec: number[] | undefined
): number | null {
  if (!queryVec || !candidateVec) return null;
  return cosineSimilarity(queryVec, candidateVec);
}
