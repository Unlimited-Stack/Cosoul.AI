/**
 * 集成测试：Intake LLM 提取 + buildTaskDocument
 *
 * 前置条件：
 *   - LLM 服务可达（DASHSCOPE_API_KEY 或默认 LLM 配置）
 *
 * 跳过条件：如果 LLM API 不可用则跳过
 */
import { describe, it, expect } from "vitest";
import { extractFromConversation, buildTaskDocument } from "../src/task-agent/intake";
import { TaskDocumentSchema } from "../src/task-agent/types";

const HAS_LLM_KEY = !!(process.env.DASHSCOPE_API_KEY || process.env.OPENAI_API_KEY);

describe.skipIf(!HAS_LLM_KEY)("Intake: LLM 提取 + buildTaskDocument", () => {

  it("extractFromConversation — 应从用户描述中提取结构化字段", async () => {
    const result = await extractFromConversation("用户: 我想找人这周六一起去线下打篮球，最好是轻松随意的氛围");

    console.log("[intake] extracted:", JSON.stringify(result, null, 2));

    // 基本字段检查
    expect(result.rawDescription).toBeTruthy();
    expect(result.rawDescription.length).toBeLessThanOrEqual(50);
    expect(result.targetActivity).toBeTruthy();
    expect(result.targetVibe).toBeTruthy();

    // interaction_type 应被正确识别为 offline
    expect(result.interaction_type).toBe("offline");

    // 有明确需求，应该 complete=true
    expect(result.complete).toBe(true);
  });

  it("extractFromConversation — 信息不足时应返回 complete=false + followUpQuestion", async () => {
    const result = await extractFromConversation("用户: 无聊");

    console.log("[intake] incomplete:", JSON.stringify(result, null, 2));

    // 信息太少，应该 complete=false
    expect(result.complete).toBe(false);
    expect(result.followUpQuestion).toBeTruthy();
  });

  it("buildTaskDocument — 应返回合法的 TaskDocument", async () => {
    const extracted = await extractFromConversation("用户: 想找人一起线上打游戏，最好是友好不毒的队友");
    const task = buildTaskDocument(extracted);

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

    console.log("[intake] built task:", {
      task_id: task.frontmatter.task_id,
      interaction_type: task.frontmatter.interaction_type,
      rawDescription: task.body.rawDescription,
      targetActivity: task.body.targetActivity,
      targetVibe: task.body.targetVibe
    });
  });
});
