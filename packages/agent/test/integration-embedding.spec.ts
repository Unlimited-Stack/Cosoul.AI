/**
 * 集成测试：DashScope Embedding API
 *
 * 前置条件：
 *   - 环境变量 DASHSCOPE_API_KEY 已设置
 *
 * 跳过条件：如果 DASHSCOPE_API_KEY 未设置则自动跳过
 */
import { describe, it, expect, beforeAll } from "vitest";
import { embedText, embedBatch, embedTaskFields, cosineSimilarity } from "../src/persona-agent/task-agent/embedding";

const HAS_API_KEY = !!process.env.DASHSCOPE_API_KEY;

describe.skipIf(!HAS_API_KEY)("DashScope Embedding API", () => {

  describe("embedText", () => {
    it("应返回非空向量数组", async () => {
      const vec = await embedText("今天天气真好，想出去玩");
      expect(Array.isArray(vec)).toBe(true);
      expect(vec.length).toBeGreaterThan(0);
      // text-embedding-v4 通常返回 1024 维
      console.log(`[embedText] 向量维度: ${vec.length}`);
    });

    it("相同文本两次调用应返回相同向量", async () => {
      const text = "重复测试文本";
      const v1 = await embedText(text);
      const v2 = await embedText(text);
      const sim = cosineSimilarity(v1, v2);
      expect(sim).toBeCloseTo(1.0, 3);
    });
  });

  describe("embedBatch", () => {
    it("批量嵌入应返回与输入数量一致的向量", async () => {
      const texts = ["打篮球", "看电影", "写代码"];
      const vecs = await embedBatch(texts);
      expect(vecs.length).toBe(3);
      for (const v of vecs) {
        expect(v.length).toBeGreaterThan(0);
      }
    });

    it("空数组应返回空数组", async () => {
      const vecs = await embedBatch([]);
      expect(vecs).toEqual([]);
    });

    it("语义相近的文本向量相似度应高于语义不相关的文本", async () => {
      const vecs = await embedBatch(["打篮球", "踢足球", "量子物理学"]);
      const simSports = cosineSimilarity(vecs[0], vecs[1]);
      const simUnrelated = cosineSimilarity(vecs[0], vecs[2]);
      console.log(`[embedBatch] 篮球-足球: ${simSports.toFixed(4)}, 篮球-量子物理: ${simUnrelated.toFixed(4)}`);
      expect(simSports).toBeGreaterThan(simUnrelated);
    });
  });

  describe("embedTaskFields", () => {
    it("应返回三个字段的嵌入结果", async () => {
      const result = await embedTaskFields(
        "test-task-embed",
        "打羽毛球",
        "轻松愉快的氛围",
        "想在周末找人一起打羽毛球"
      );
      expect(result.taskId).toBe("test-task-embed");
      expect(result.embeddings.length).toBe(3);
      expect(result.embeddings.map(e => e.field)).toEqual([
        "targetActivity",
        "targetVibe",
        "rawDescription"
      ]);
      for (const emb of result.embeddings) {
        expect(emb.vector.length).toBeGreaterThan(0);
        expect(emb.dimensions).toBe(emb.vector.length);
        expect(emb.text.length).toBeGreaterThan(0);
      }
      expect(result.created_at).toBeTruthy();
    });
  });
});
