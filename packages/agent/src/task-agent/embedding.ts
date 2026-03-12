import OpenAI from "openai";

const EMBEDDING_MODEL = "text-embedding-v4";

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      throw new Error("DASHSCOPE_API_KEY is not set in environment variables");
    }
    _client = new OpenAI({
      apiKey,
      baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
    });
  }
  return _client;
}

export interface EmbeddingResult {
  field: "targetActivity" | "targetVibe" | "rawDescription";
  text: string;
  vector: number[];
  dimensions: number;
}

export interface TaskEmbeddings {
  taskId: string;
  embeddings: EmbeddingResult[];
  created_at: string;
}

/** 嵌入单条文本，返回向量 */
export async function embedText(text: string): Promise<number[]> {
  const client = getClient();
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text
  });
  return response.data[0].embedding;
}

/** 批量嵌入多条文本（单次 API 调用），结果顺序与输入一致 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const client = getClient();
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts
  });
  const sorted = response.data.sort((a, b) => a.index - b.index);
  return sorted.map((d) => d.embedding);
}

/**
 * 批量嵌入 task 三个核心字段（targetActivity / targetVibe / rawDescription），
 * 单次 API 调用，存入 PostgreSQL task_vectors 表。
 */
export async function embedTaskFields(
  taskId: string,
  targetActivity: string,
  targetVibe: string,
  rawDescription: string
): Promise<TaskEmbeddings> {
  const fields = ["targetActivity", "targetVibe", "rawDescription"] as const;
  const texts = [targetActivity, targetVibe, rawDescription];

  const vectors = await embedBatch(texts);

  const embeddings: EmbeddingResult[] = fields.map((field, i) => ({
    field,
    text: texts[i],
    vector: vectors[i],
    dimensions: vectors[i].length
  }));

  return {
    taskId,
    embeddings,
    created_at: new Date().toISOString()
  };
}

/** 计算两个向量的余弦相似度 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}
