/**
 * 集成测试：Intake LLM 提取 + buildTaskDocument
 *
 * 前置条件：
 *   - LLM 服务可达（DASHSCOPE_API_KEY 或默认 LLM 配置）
 *
 * 跳过条件：如果 LLM API 不可用则跳过
 */
import { describe, it, expect } from "vitest";
import {
  createExtractionConversation,
  extractFromConversation,
  buildTaskDocument,
} from "../src/task-agent/intake";
import { TaskDocumentSchema } from "../src/task-agent/types";

const HAS_LLM_KEY = !!(process.env.DASHSCOPE_API_KEY || process.env.OPENAI_API_KEY);

describe.skipIf(!HAS_LLM_KEY)("Intake: LLM 提取 + buildTaskDocument", () => {

  it("extractFromConversation — 应从用户描述中提取结构化字段", async () => {
    const conv = createExtractionConversation();
    const result = await extractFromConversation(conv, "我想找人这周六一起去线下打篮球，最好是轻松随意的氛围");

    console.log("[intake] extracted:", JSON.stringify(result, null, 2));

    // 基本字段检查
    expect(result.fields.rawDescription).toBeTruthy();
    expect(result.fields.rawDescription.length).toBeLessThanOrEqual(50);
    expect(result.fields.targetActivity).toBeTruthy();
    expect(result.fields.targetVibe).toBeTruthy();

    // interaction_type 应被正确识别为 offline
    expect(result.fields.interaction_type).toBe("offline");

    // 有明确需求，应该 complete=true
    expect(result.complete).toBe(true);
    expect(result.missingFields).toHaveLength(0);
  });

  it("extractFromConversation — 信息不足时应返回 complete=false + missingFields", async () => {
    const conv = createExtractionConversation();
    const result = await extractFromConversation(conv, "无聊");

    console.log("[intake] incomplete:", JSON.stringify(result, null, 2));

    // 信息太少，应该 complete=false
    expect(result.complete).toBe(false);
    expect(result.missingFields.length).toBeGreaterThan(0);
    expect(result.followUpQuestion).toBeTruthy();
  });

  it("extractFromConversation — 多轮对话应逐步补全字段", async () => {
    const conv = createExtractionConversation();

    // 第一轮：模糊输入
    const r1 = await extractFromConversation(conv, "想找人一起玩");
    console.log("[intake] round 1:", JSON.stringify(r1, null, 2));
    expect(r1.complete).toBe(false);

    // 第二轮：补充活动信息
    const r2 = await extractFromConversation(conv, "想线下打羽毛球，轻松愉快的那种");
    console.log("[intake] round 2:", JSON.stringify(r2, null, 2));

    // 第二轮应该拿到更多字段
    expect(r2.fields.targetActivity).toBeTruthy();
    expect(r2.fields.interaction_type).toBe("offline");
    expect(r2.missingFields.length).toBeLessThan(r1.missingFields.length);
  });

  it("buildTaskDocument — 应返回合法的 TaskDocument", () => {
    const task = buildTaskDocument({
      interaction_type: "online",
      rawDescription: "找人线上打游戏",
      targetActivity: "线上组队打游戏",
      targetVibe: "友好不毒的队友",
      detailedPlan: "## 需求\n想找友好队友一起打游戏",
    });

    // Zod 校验
    const validation = TaskDocumentSchema.safeParse(task);
    expect(validation.success).toBe(true);

    // 初始状态检查
    expect(task.frontmatter.status).toBe("Drafting");
    expect(task.frontmatter.version).toBe(1);
    expect(task.frontmatter.pending_sync).toBe(false);
    expect(task.frontmatter.hidden).toBe(false);
    expect(task.frontmatter.current_partner_id).toBeNull();

    // body 检查
    expect(task.body.rawDescription).toBeTruthy();
    expect(task.body.targetActivity).toBeTruthy();

    // task_id 应为 UUID 格式
    expect(task.frontmatter.task_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });
});
