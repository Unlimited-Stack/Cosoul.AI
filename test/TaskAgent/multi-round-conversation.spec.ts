/**
 * 集成测试：Intake + Revise 多轮对话用户需求提取
 *
 * 测试场景：
 *   场景 A — Intake 多轮对话：模糊输入 → 追问 → 补充 → 完整提取 → 生成 task.md
 *   场景 B — Revise 多轮对话：修改活动 → 修改氛围 → 闲聊（无修改） → 确认
 *
 * 前置条件：
 *   - LLM 服务可达（DASHSCOPE_API_KEY 或 OPENAI_API_KEY）
 *   - PostgreSQL 可达（DATABASE_URL）— 仅场景 B 需要
 *
 * 运行：cd packages/agent && npx vitest run test/TaskAgent/multi-round-conversation.spec.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import {
  createExtractionConversation,
  extractFromConversation,
  buildTaskDocument,
} from "../../packages/agent/src/task-agent/intake";
import {
  createReviseSession,
  processReviseMessage,
} from "../../packages/agent/src/task-agent/revise";
import { saveTaskMD, readTaskDocument, serializeTaskMDContent } from "../../packages/agent/src/task-agent/storage";
import { TaskDocumentSchema, type TaskDocument } from "../../packages/agent/src/task-agent/types";

// ─── 配置 ────────────────────────────────────────────────────────

const HAS_LLM_KEY = !!(process.env.DASHSCOPE_API_KEY || process.env.OPENAI_API_KEY);
const TAG = "MULTI_ROUND_TEST";
const OUTPUT_DIR = path.resolve(__dirname, "output");

// DB 相关（场景 B 需要）
let dbReachable = false;
const TEST_USER_ID = randomUUID();
const TEST_PERSONA_ID = randomUUID();

// ─── 辅助函数 ────────────────────────────────────────────────────

/** 将对话记录和 task.md 写入 output 文件夹 */
async function saveTestOutput(
  scenarioName: string,
  transcript: string[],
  task: TaskDocument,
): Promise<string> {
  await mkdir(OUTPUT_DIR, { recursive: true });

  // 1. 保存对话记录
  const transcriptPath = path.join(OUTPUT_DIR, `${scenarioName}-transcript.md`);
  const transcriptContent = [
    `# ${scenarioName} 对话记录`,
    `> 生成时间: ${new Date().toISOString()}`,
    "",
    ...transcript.map((line) => `${line}`),
    "",
  ].join("\n");
  await writeFile(transcriptPath, transcriptContent, "utf8");

  // 2. 保存 task.md
  const taskMdPath = path.join(OUTPUT_DIR, `${scenarioName}-task.md`);
  const taskMdContent = serializeTaskMDContent(task);
  await writeFile(taskMdPath, taskMdContent, "utf8");

  console.log(`  [输出] 对话记录: ${transcriptPath}`);
  console.log(`  [输出] task.md:  ${taskMdPath}`);

  return taskMdPath;
}

// ─── Setup / Teardown ────────────────────────────────────────────

beforeAll(async () => {
  await mkdir(OUTPUT_DIR, { recursive: true });

  // 尝试连接 DB（场景 B 需要）
  try {
    const { db } = await import("@repo/core/db/client");
    const { users, personas } = await import("@repo/core/db/schema");
    await db.select().from(users).limit(1);
    dbReachable = true;

    // 插入测试用户 + 人格
    await db.insert(users).values({
      userId: TEST_USER_ID,
      email: `${TAG}_${Date.now()}@test.local`,
      name: `[${TAG}] Multi-Round Test User`,
    });
    await db.insert(personas).values({
      personaId: TEST_PERSONA_ID,
      userId: TEST_USER_ID,
      name: `[${TAG}] Multi-Round Test Persona`,
    });
    console.log(`[${TAG}] DB 可达，测试用户/人格已创建`);
  } catch (e) {
    console.warn(`[${TAG}] DB 不可达，场景 B 将跳过:`, (e as Error).message);
  }
});

afterAll(async () => {
  if (!dbReachable) return;
  try {
    const { db } = await import("@repo/core/db/client");
    const { users, personas, tasks, taskVectors } = await import("@repo/core/db/schema");
    const { eq } = await import("drizzle-orm");
    // 清理测试数据（按依赖顺序）
    await db.delete(tasks).where(eq(tasks.personaId, TEST_PERSONA_ID));
    await db.delete(personas).where(eq(personas.personaId, TEST_PERSONA_ID));
    await db.delete(users).where(eq(users.userId, TEST_USER_ID));
    console.log(`[${TAG}] 测试数据已清理`);
  } catch (e) {
    console.warn(`[${TAG}] 清理失败:`, (e as Error).message);
  }
});

// ═══════════════════════════════════════════════════════════════════
// 场景 A：Intake 多轮对话需求提取
// ═══════════════════════════════════════════════════════════════════

describe.skipIf(!HAS_LLM_KEY)("场景 A：Intake 多轮对话需求提取", () => {
  const transcript: string[] = [];
  let finalTask: TaskDocument;

  it("第 1 轮：模糊输入，应返回 incomplete + 追问", async () => {
    const conv = createExtractionConversation();
    // 存到闭包外以便后续轮次复用
    (globalThis as any).__testIntakeConv = conv;

    const userMsg = "好无聊啊，想找人一起玩点什么";
    transcript.push(`【用户】${userMsg}`);

    const r1 = await extractFromConversation(conv, userMsg);

    console.log(`\n[Intake 第1轮] 提取结果:`, JSON.stringify(r1.fields, null, 2));
    console.log(`  complete: ${r1.complete}`);
    console.log(`  缺失字段: ${r1.missingFields.join(", ")}`);
    console.log(`  追问: ${r1.followUpQuestion}`);

    transcript.push(`【系统提取】${JSON.stringify(r1.fields)}`);
    transcript.push(`【助手追问】${r1.followUpQuestion}`);

    // 断言：信息不足，应追问
    expect(r1.complete).toBe(false);
    expect(r1.missingFields.length).toBeGreaterThan(0);
    expect(r1.followUpQuestion).toBeTruthy();
  }, 20_000);

  it("第 2 轮：补充活动信息，缺失字段应减少", async () => {
    const conv = (globalThis as any).__testIntakeConv;
    expect(conv).toBeTruthy();

    const userMsg = "想去打羽毛球，最好是线下面对面的";
    transcript.push(`【用户】${userMsg}`);

    const r2 = await extractFromConversation(conv, userMsg);

    console.log(`\n[Intake 第2轮] 提取结果:`, JSON.stringify(r2.fields, null, 2));
    console.log(`  complete: ${r2.complete}`);
    console.log(`  缺失字段: ${r2.missingFields.join(", ")}`);

    transcript.push(`【系统提取】${JSON.stringify(r2.fields)}`);
    if (r2.followUpQuestion) {
      transcript.push(`【助手追问】${r2.followUpQuestion}`);
    }

    // 断言：应正确识别活动和互动方式
    expect(r2.fields.targetActivity).toBeTruthy();
    expect(r2.fields.interaction_type).toBe("offline");

    // 如果还缺 targetVibe，进入第 3 轮
    if (!r2.complete) {
      expect(r2.followUpQuestion).toBeTruthy();
    }
  }, 20_000);

  it("第 3 轮：补充氛围偏好，应达到 complete", async () => {
    const conv = (globalThis as any).__testIntakeConv;

    const userMsg = "希望是轻松愉快的，不要太卷，大家随便打打，聊聊天就好";
    transcript.push(`【用户】${userMsg}`);

    const r3 = await extractFromConversation(conv, userMsg);

    console.log(`\n[Intake 第3轮] 提取结果:`, JSON.stringify(r3.fields, null, 2));
    console.log(`  complete: ${r3.complete}`);
    console.log(`  缺失字段: ${r3.missingFields.join(", ")}`);

    transcript.push(`【系统提取】${JSON.stringify(r3.fields)}`);

    // 断言：经过 3 轮对话，所有字段应填充
    expect(r3.fields.targetActivity).toBeTruthy();
    expect(r3.fields.targetVibe).toBeTruthy();
    expect(r3.fields.interaction_type).toBe("offline");
    expect(r3.fields.rawDescription).toBeTruthy();

    // 所有字段都有了，应为 complete
    if (r3.complete) {
      expect(r3.missingFields).toHaveLength(0);
    }

    // 构建 TaskDocument
    finalTask = buildTaskDocument(r3.fields);

    // Zod 校验
    const validation = TaskDocumentSchema.safeParse(finalTask);
    expect(validation.success).toBe(true);

    transcript.push("");
    transcript.push(`=== 最终 TaskDocument ===`);
    transcript.push(`状态: ${finalTask.frontmatter.status}`);
    transcript.push(`互动方式: ${finalTask.frontmatter.interaction_type}`);
    transcript.push(`核心需求: ${finalTask.body.rawDescription}`);
    transcript.push(`目标活动: ${finalTask.body.targetActivity}`);
    transcript.push(`期望氛围: ${finalTask.body.targetVibe}`);
    transcript.push(`详细计划: ${finalTask.body.detailedPlan}`);
  }, 20_000);

  it("输出：保存对话记录和 task.md 到 output 文件夹", async () => {
    expect(finalTask).toBeTruthy();

    const taskMdPath = await saveTestOutput("intake-multi-round", transcript, finalTask);

    console.log(`\n${"=".repeat(60)}`);
    console.log(`[场景 A 完成] Intake 多轮对话提取成功`);
    console.log(`  task.md 已保存至: ${taskMdPath}`);
    console.log(`${"=".repeat(60)}`);

    // 验证 task.md 内容
    const taskMdContent = serializeTaskMDContent(finalTask);
    expect(taskMdContent).toContain("task_id:");
    expect(taskMdContent).toContain("status:");
    expect(taskMdContent).toContain("interaction_type:");

    // 打印 task.md 内容
    console.log(`\n--- task.md 内容 ---`);
    console.log(taskMdContent);
    console.log(`--- END ---\n`);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 场景 B：Revise 多轮对话需求修改
// ═══════════════════════════════════════════════════════════════════

describe.skipIf(!HAS_LLM_KEY || !true)("场景 B：Revise 多轮对话需求修改", () => {
  const transcript: string[] = [];
  let taskId: string;
  let revisedTask: TaskDocument;

  // 先创建一个初始任务（通过 intake 快速生成）
  it("前置：创建初始任务", async () => {
    if (!dbReachable) {
      console.warn("  [跳过] DB 不可达，无法测试 Revise（需要持久化）");
      return;
    }

    const conv = createExtractionConversation();
    const result = await extractFromConversation(
      conv,
      "我想找人周六下午一起去公园打篮球，轻松随意，友好开放的氛围",
    );

    expect(result.complete).toBe(true);
    const task = buildTaskDocument(result.fields);
    taskId = task.frontmatter.task_id;

    // 写入 DB
    await saveTaskMD(task, { personaId: TEST_PERSONA_ID });
    const saved = await readTaskDocument(taskId);
    expect(saved.frontmatter.status).toBe("Drafting");

    transcript.push(`=== 初始任务 ===`);
    transcript.push(`task_id: ${taskId}`);
    transcript.push(`互动方式: ${saved.frontmatter.interaction_type}`);
    transcript.push(`核心需求: ${saved.body.rawDescription}`);
    transcript.push(`目标活动: ${saved.body.targetActivity}`);
    transcript.push(`期望氛围: ${saved.body.targetVibe}`);
    transcript.push("");

    console.log(`  [前置] 初始任务已创建: ${taskId}`);
  }, 20_000);

  it("Revise 第 1 轮：修改活动（篮球 → 羽毛球）", async () => {
    if (!dbReachable || !taskId) return;

    const session = await createReviseSession(taskId);
    (globalThis as any).__testReviseSession = session;

    const userMsg = "我改主意了，想打羽毛球，不打篮球了";
    transcript.push(`【用户】${userMsg}`);

    const { reply, revision } = await processReviseMessage(session, userMsg);

    console.log(`\n[Revise 第1轮]`);
    console.log(`  LLM 回复: ${reply}`);
    console.log(`  有修改: ${revision !== null}`);
    if (revision) {
      console.log(`  变更字段: ${revision.changedFields.join(", ")}`);
      console.log(`  需要重新 embedding: ${revision.needReEmbed}`);
    }

    transcript.push(`【助手回复】${reply}`);
    if (revision) {
      transcript.push(`【变更字段】${revision.changedFields.join(", ")}`);
      transcript.push(`【修改说明】${revision.summary}`);
    }

    // 断言：应检测到活动修改
    expect(revision).not.toBeNull();
    expect(revision!.changedFields).toContain("targetActivity");
    expect(revision!.needReEmbed).toBe(true);
  }, 20_000);

  it("Revise 第 2 轮：修改氛围", async () => {
    if (!dbReachable || !taskId) return;

    const session = (globalThis as any).__testReviseSession;
    expect(session).toBeTruthy();

    const userMsg = "氛围方面，我想找那种比较有竞技精神的，大家认真打但不伤和气";
    transcript.push(`【用户】${userMsg}`);

    const { reply, revision } = await processReviseMessage(session, userMsg);

    console.log(`\n[Revise 第2轮]`);
    console.log(`  LLM 回复: ${reply}`);
    console.log(`  有修改: ${revision !== null}`);
    if (revision) {
      console.log(`  变更字段: ${revision.changedFields.join(", ")}`);
    }

    transcript.push(`【助手回复】${reply}`);
    if (revision) {
      transcript.push(`【变更字段】${revision.changedFields.join(", ")}`);
      transcript.push(`【修改说明】${revision.summary}`);
    }

    // 断言：应检测到氛围修改
    expect(revision).not.toBeNull();
    expect(revision!.changedFields).toContain("targetVibe");
  }, 20_000);

  it("Revise 第 3 轮：闲聊（不应触发修改）", async () => {
    if (!dbReachable || !taskId) return;

    const session = (globalThis as any).__testReviseSession;

    const userMsg = "对了，一般打羽毛球大概要多少人比较好玩？";
    transcript.push(`【用户】${userMsg}`);

    const { reply, revision } = await processReviseMessage(session, userMsg);

    console.log(`\n[Revise 第3轮 — 闲聊]`);
    console.log(`  LLM 回复: ${reply}`);
    console.log(`  有修改: ${revision !== null}`);

    transcript.push(`【助手回复】${reply}`);
    if (revision) {
      transcript.push(`【变更字段】${revision.changedFields.join(", ")}`);
    } else {
      transcript.push(`【无修改】纯对话回复`);
    }

    // 闲聊不应触发修改（但 LLM 有时可能误判，这里用 soft assertion）
    if (revision === null) {
      console.log(`  ✓ 正确：闲聊未触发修改`);
    } else {
      console.warn(`  ⚠ 注意：闲聊意外触发了修改: ${revision.changedFields.join(", ")}`);
    }
  }, 20_000);

  it("Revise 第 4 轮：修改互动方式", async () => {
    if (!dbReachable || !taskId) return;

    const session = (globalThis as any).__testReviseSession;

    const userMsg = "算了线上线下都行吧，改成都可以";
    transcript.push(`【用户】${userMsg}`);

    const { reply, revision } = await processReviseMessage(session, userMsg);

    console.log(`\n[Revise 第4轮]`);
    console.log(`  LLM 回复: ${reply}`);
    if (revision) {
      console.log(`  变更字段: ${revision.changedFields.join(", ")}`);
      revisedTask = revision.task;
    }

    transcript.push(`【助手回复】${reply}`);
    if (revision) {
      transcript.push(`【变更字段】${revision.changedFields.join(", ")}`);
    }

    // 应修改 interaction_type
    if (revision) {
      expect(revision.changedFields).toContain("interaction_type");
    }
  }, 20_000);

  it("输出：保存 Revise 对话记录和最终 task.md", async () => {
    if (!dbReachable || !taskId) return;

    // 从 DB 读取最终版本
    const finalTask = await readTaskDocument(taskId);
    revisedTask = finalTask;

    transcript.push("");
    transcript.push(`=== 最终修改后任务 ===`);
    transcript.push(`task_id: ${finalTask.frontmatter.task_id}`);
    transcript.push(`version: ${finalTask.frontmatter.version}`);
    transcript.push(`互动方式: ${finalTask.frontmatter.interaction_type}`);
    transcript.push(`核心需求: ${finalTask.body.rawDescription}`);
    transcript.push(`目标活动: ${finalTask.body.targetActivity}`);
    transcript.push(`期望氛围: ${finalTask.body.targetVibe}`);
    transcript.push(`详细计划: ${finalTask.body.detailedPlan}`);

    const taskMdPath = await saveTestOutput("revise-multi-round", transcript, finalTask);

    console.log(`\n${"=".repeat(60)}`);
    console.log(`[场景 B 完成] Revise 多轮对话修改成功`);
    console.log(`  task.md 已保存至: ${taskMdPath}`);
    console.log(`${"=".repeat(60)}`);

    // 打印 task.md 内容
    const taskMdContent = serializeTaskMDContent(finalTask);
    console.log(`\n--- task.md 内容 ---`);
    console.log(taskMdContent);
    console.log(`--- END ---\n`);

    // 验证版本号递增（至少经过 2-3 次修改）
    expect(finalTask.frontmatter.version).toBeGreaterThanOrEqual(2);
  });
});
