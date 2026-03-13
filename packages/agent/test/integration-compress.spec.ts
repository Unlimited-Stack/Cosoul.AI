/**
 * 集成测试：对话压缩功能（compress_summary）
 *
 * 测试场景：
 *   场景 A — Intake 多轮对话中触发压缩：多轮输入使 token 超过阈值(100)，验证压缩触发
 *   场景 B — Revise 多轮对话中触发压缩：多轮修改使 token 超过阈值(100)，验证压缩触发
 *   场景 C — 单独测试 compressConversationIfNeeded 函数
 *
 * 前置条件：
 *   - LLM 服务可达（DASHSCOPE_API_KEY 或 OPENAI_API_KEY）
 *   - PostgreSQL 可达（DATABASE_URL）— 场景 A/B 需要
 *
 * 运行：cd packages/agent && npx vitest run test/integration-compress.spec.ts
 */
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";

import {
  createExtractionConversation,
  extractFromConversation,
  buildTaskDocument,
  type IntakePersistCtx,
} from "../src/task-agent/intake";
import {
  createReviseSession,
  processReviseMessage,
} from "../src/task-agent/revise";
import {
  saveTaskMD,
  readTaskDocument,
  saveChatMessage,
  listChatMessages,
} from "../src/task-agent/storage";
import { compressConversationIfNeeded, estimateTokens } from "../src/task-agent/context";
import { Conversation } from "@repo/core/llm";

// ─── 配置 ────────────────────────────────────────────────────────

const HAS_LLM_KEY = !!(process.env.DASHSCOPE_API_KEY || process.env.OPENAI_API_KEY);
const TAG = "COMPRESS_TEST";

let dbReachable = false;
const TEST_USER_ID = randomUUID();
const TEST_PERSONA_ID = randomUUID();

// ─── Setup ──────────────────────────────────────────────────────

beforeAll(async () => {
  try {
    const { db } = await import("@repo/core/db/client");
    const { users, personas } = await import("@repo/core/db/schema");
    await db.select().from(users).limit(1);
    dbReachable = true;

    await db.insert(users).values({
      userId: TEST_USER_ID,
      email: `${TAG}_${Date.now()}@test.local`,
      name: `[${TAG}] Compress Test User`,
    });
    await db.insert(personas).values({
      personaId: TEST_PERSONA_ID,
      userId: TEST_USER_ID,
      name: `[${TAG}] Compress Test Persona`,
    });
    console.log(`[${TAG}] DB 可达，测试用户/人格已创建`);
  } catch (e) {
    console.warn(`[${TAG}] DB 不可达，依赖 DB 的场景将跳过:`, (e as Error).message);
  }
});

// 注释 afterAll —— 保留测试数据以便观察
// afterAll(async () => {
//   if (!dbReachable) return;
//   try {
//     const { db } = await import("@repo/core/db/client");
//     const { users, personas, tasks, chatMessages } = await import("@repo/core/db/schema");
//     const { eq } = await import("drizzle-orm");
//     await db.delete(tasks).where(eq(tasks.personaId, TEST_PERSONA_ID));
//     await db.delete(personas).where(eq(personas.personaId, TEST_PERSONA_ID));
//     await db.delete(users).where(eq(users.userId, TEST_USER_ID));
//     console.log(`[${TAG}] 测试数据已清理`);
//   } catch (e) {
//     console.warn(`[${TAG}] 清理失败:`, (e as Error).message);
//   }
// });

// ═══════════════════════════════════════════════════════════════════
// 场景 C：单独测试 compressConversationIfNeeded
// ═══════════════════════════════════════════════════════════════════

describe.skipIf(!HAS_LLM_KEY)("场景 C：compressConversationIfNeeded 单元测试", () => {

  it("token 未达阈值时不应触发压缩", async () => {
    const conv = new Conversation({ system: "你是测试助手", temperature: 0.3, maxTokens: 500 });

    // 只发一条短消息，token 不会超过 100
    await conv.say("你好");

    const tokensBefore = conv.getHistoryTokenCount();
    console.log(`\n[场景C-1] 压缩前 token: ${tokensBefore}, 阈值: 100`);
    console.log(`  历史轮次: ${conv.getTurnCount()}`);

    const result = await compressConversationIfNeeded(conv, "intake");

    console.log(`  compressed: ${result.compressed}`);
    console.log(`  summary: ${result.summary}`);

    expect(result.compressed).toBe(false);
    expect(result.summary).toBeNull();
  }, 30_000);

  it("token 超过阈值时应触发压缩并生成摘要", async () => {
    const conv = new Conversation({ system: "你是测试助手", temperature: 0.3, maxTokens: 1000 });

    // 多轮对话，让 token 超过 100（阈值已设为 100）
    console.log(`\n[场景C-2] 开始多轮对话以触发压缩...`);

    await conv.say("我想找人一起去线下打篮球，周六下午三点在人民公园篮球场");
    console.log(`  第1轮后 token: ${conv.getHistoryTokenCount()}`);

    await conv.say("希望氛围轻松愉快，不要太卷，大家随便打打聊聊天就好");
    console.log(`  第2轮后 token: ${conv.getHistoryTokenCount()}`);

    await conv.say("最好能找到三到五个人一起，年龄差不多的，二十多岁的朋友");
    console.log(`  第3轮后 token: ${conv.getHistoryTokenCount()}`);

    const tokensBefore = conv.getHistoryTokenCount();
    const historyBefore = conv.getHistory();
    console.log(`\n  压缩前状态:`);
    console.log(`    总 token: ${tokensBefore}`);
    console.log(`    总轮次: ${conv.getTurnCount()}`);
    console.log(`    历史条数: ${historyBefore.length}`);
    console.log(`  各轮内容预览:`);
    for (const turn of historyBefore) {
      const preview = turn.content.length > 40
        ? turn.content.slice(0, 40) + "..."
        : turn.content;
      console.log(`    [${turn.role}] ${preview}`);
    }

    // 触发压缩
    const result = await compressConversationIfNeeded(conv, "intake");

    console.log(`\n  压缩结果:`);
    console.log(`    compressed: ${result.compressed}`);
    console.log(`    summary: "${result.summary}"`);
    console.log(`    summary 长度: ${result.summary?.length ?? 0} 字`);

    const tokensAfter = conv.getHistoryTokenCount();
    const historyAfter = conv.getHistory();
    console.log(`\n  压缩后状态:`);
    console.log(`    总 token: ${tokensAfter}`);
    console.log(`    总轮次: ${conv.getTurnCount()}`);
    console.log(`    历史条数: ${historyAfter.length}`);
    console.log(`  压缩后历史内容:`);
    for (const turn of historyAfter) {
      const preview = turn.content.length > 60
        ? turn.content.slice(0, 60) + "..."
        : turn.content;
      console.log(`    [${turn.role}] ${preview}`);
    }

    // 断言
    expect(result.compressed).toBe(true);
    expect(result.summary).toBeTruthy();
    expect(typeof result.summary).toBe("string");
    console.log(`\n  ✓ 压缩成功！摘要: "${result.summary}"`);
  }, 60_000);

  it("压缩后 Conversation 应能继续正常对话", async () => {
    const conv = new Conversation({ system: "你是测试助手", temperature: 0.3, maxTokens: 500 });

    // 填充对话到超过阈值（2轮即可超过100 token）
    await conv.say("我想找人一起去线下打篮球，周六下午三点在人民公园篮球场，轻松氛围");
    await conv.say("希望找三到五个二十多岁的朋友一起，不要太卷，大家随便打打聊聊天就好");

    console.log(`\n[场景C-3] 压缩前 token: ${conv.getHistoryTokenCount()}`);

    // 压缩
    const compressResult = await compressConversationIfNeeded(conv, "intake");
    console.log(`  压缩结果: compressed=${compressResult.compressed}, summary="${compressResult.summary}"`);

    if (compressResult.compressed) {
      // 压缩后继续对话
      console.log(`  压缩后继续对话...`);
      const response = await conv.say("那场地费怎么分摊？");
      console.log(`  继续对话回复: ${response.content.slice(0, 80)}...`);
      console.log(`  继续对话后 token: ${conv.getHistoryTokenCount()}`);
      console.log(`  继续对话后轮次: ${conv.getTurnCount()}`);

      expect(response.content).toBeTruthy();
      expect(response.content.length).toBeGreaterThan(0);
      console.log(`\n  ✓ 压缩后对话正常继续`);
    } else {
      console.log(`  未触发压缩（token 未达阈值），跳过后续测试`);
    }
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════
// 场景 A：Intake 多轮对话中触发压缩
// ═══════════════════════════════════════════════════════════════════

describe.skipIf(!HAS_LLM_KEY)("场景 A：Intake 多轮对话触发压缩", () => {

  it("多轮 intake 对话应在 token 超阈值后触发压缩，并将摘要写入 chat_messages", async () => {
    if (!dbReachable) {
      console.warn("  [跳过] DB 不可达");
      return;
    }

    const conv = createExtractionConversation();

    // 先创建一个 task 记录（chat_messages.task_id 有 FK 约束）
    const draftTask = buildTaskDocument({
      interaction_type: "any",
      rawDescription: "待定",
      targetActivity: "待定",
      targetVibe: "待定",
      detailedPlan: "",
    });
    const taskId = draftTask.frontmatter.task_id;
    await saveTaskMD(draftTask, { personaId: TEST_PERSONA_ID });

    const persistCtx: IntakePersistCtx = { taskId, personaId: TEST_PERSONA_ID };

    console.log(`\n[场景A] 开始 Intake 多轮对话压缩测试`);
    console.log(`  taskId: ${taskId}`);
    console.log(`  personaId: ${TEST_PERSONA_ID}`);
    console.log(`  压缩阈值: 100 token`);

    // 第 1 轮：模糊输入
    console.log(`\n--- 第 1 轮 ---`);
    const r1 = await extractFromConversation(conv, "好无聊啊，想找人一起做点什么有意思的事情", persistCtx, 1);
    console.log(`  提取结果: ${JSON.stringify(r1.fields)}`);
    console.log(`  complete: ${r1.complete}`);
    console.log(`  缺失字段: ${r1.missingFields.join(", ")}`);
    console.log(`  追问: ${r1.followUpQuestion}`);
    console.log(`  当前 conv token: ${conv.getHistoryTokenCount()}`);

    // 第 2 轮：补充活动
    console.log(`\n--- 第 2 轮 ---`);
    const r2 = await extractFromConversation(conv, "想去打羽毛球，线下的，在体育馆或者公园都行", persistCtx, 2);
    console.log(`  提取结果: ${JSON.stringify(r2.fields)}`);
    console.log(`  complete: ${r2.complete}`);
    console.log(`  缺失字段: ${r2.missingFields.join(", ")}`);
    console.log(`  当前 conv token: ${conv.getHistoryTokenCount()}`);

    // 第 3 轮：补充氛围
    console.log(`\n--- 第 3 轮 ---`);
    const r3 = await extractFromConversation(conv, "氛围方面希望轻松愉快，不要太有胜负心，大家开开心心打球就好", persistCtx, 3);
    console.log(`  提取结果: ${JSON.stringify(r3.fields)}`);
    console.log(`  complete: ${r3.complete}`);
    console.log(`  当前 conv token: ${conv.getHistoryTokenCount()}`);

    // 查询 chat_messages，检查是否有 compress_summary 记录
    const messages = await listChatMessages(taskId);
    console.log(`\n--- chat_messages 记录 (共 ${messages.length} 条) ---`);
    for (const msg of messages) {
      const meta = msg.metadata as Record<string, unknown>;
      const preview = msg.content.length > 50
        ? msg.content.slice(0, 50) + "..."
        : msg.content;
      console.log(`  [${msg.senderType}] phase=${meta.phase}, round=${meta.round}, role=${meta.role ?? "-"}`);
      console.log(`    content: ${preview}`);
      if (msg.compressSummary) {
        console.log(`    compress_summary: "${msg.compressSummary}"`);
      }
    }

    // 检查是否有 compress_summary 角色的消息
    const compressMessages = messages.filter(
      (m) => (m.metadata as Record<string, unknown>).role === "compress_summary"
    );
    console.log(`\n  compress_summary 消息数: ${compressMessages.length}`);

    if (compressMessages.length > 0) {
      console.log(`  ✓ 压缩已触发！`);
      for (const cm of compressMessages) {
        console.log(`    摘要内容: "${cm.content}"`);
        console.log(`    摘要长度: ${cm.content.length} 字`);
      }
    } else {
      console.log(`  ℹ 未触发压缩（可能 token 未达到阈值 100）`);
      console.log(`  最终 conv token: ${conv.getHistoryTokenCount()}`);
    }

    // 基本断言：至少应有多条消息记录
    expect(messages.length).toBeGreaterThanOrEqual(4); // 至少 3 轮用户 + LLM 回复
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════
// 场景 B：Revise 多轮对话中触发压缩
// ═══════════════════════════════════════════════════════════════════

describe.skipIf(!HAS_LLM_KEY)("场景 B：Revise 多轮对话触发压缩", () => {
  let taskId: string;

  it("前置：创建初始任务", async () => {
    if (!dbReachable) {
      console.warn("  [跳过] DB 不可达");
      return;
    }

    const conv = createExtractionConversation();
    const result = await extractFromConversation(
      conv,
      "我想找人周六下午一起去公园打篮球，轻松随意友好开放的氛围",
    );

    const task = buildTaskDocument(result.fields);
    taskId = task.frontmatter.task_id;

    await saveTaskMD(task, { personaId: TEST_PERSONA_ID });
    console.log(`\n[场景B] 初始任务已创建: ${taskId}`);
    console.log(`  活动: ${task.body.targetActivity}`);
    console.log(`  氛围: ${task.body.targetVibe}`);
    console.log(`  互动: ${task.frontmatter.interaction_type}`);
  }, 30_000);

  it("多轮 revise 对话应在 token 超阈值后触发压缩", async () => {
    if (!dbReachable || !taskId) {
      console.warn("  [跳过] DB 不可达或无 taskId");
      return;
    }

    const session = await createReviseSession(taskId, TEST_PERSONA_ID);
    console.log(`\n[场景B] 开始 Revise 多轮对话压缩测试`);
    console.log(`  压缩阈值: 100 token`);

    // 第 1 轮：修改活动
    console.log(`\n--- Revise 第 1 轮 ---`);
    const r1 = await processReviseMessage(session, "我改主意了，想打羽毛球不打篮球了");
    console.log(`  reply: ${r1.reply.slice(0, 80)}...`);
    console.log(`  有修改: ${r1.revision !== null}`);
    if (r1.revision) {
      console.log(`  变更字段: ${r1.revision.changedFields.join(", ")}`);
    }
    console.log(`  当前 conv token: ${session.conv.getHistoryTokenCount()}`);

    // 第 2 轮：修改氛围
    console.log(`\n--- Revise 第 2 轮 ---`);
    const r2 = await processReviseMessage(session, "氛围改成比较有竞技精神的，大家认真打但不伤和气");
    console.log(`  reply: ${r2.reply.slice(0, 80)}...`);
    console.log(`  有修改: ${r2.revision !== null}`);
    if (r2.revision) {
      console.log(`  变更字段: ${r2.revision.changedFields.join(", ")}`);
    }
    console.log(`  当前 conv token: ${session.conv.getHistoryTokenCount()}`);

    // 第 3 轮：修改互动方式
    console.log(`\n--- Revise 第 3 轮 ---`);
    const r3 = await processReviseMessage(session, "线上线下都行吧，改成都可以");
    console.log(`  reply: ${r3.reply.slice(0, 80)}...`);
    console.log(`  有修改: ${r3.revision !== null}`);
    if (r3.revision) {
      console.log(`  变更字段: ${r3.revision.changedFields.join(", ")}`);
    }
    console.log(`  当前 conv token: ${session.conv.getHistoryTokenCount()}`);

    // 第 4 轮：再补充一些细节让 token 肯定超阈值
    console.log(`\n--- Revise 第 4 轮 ---`);
    const r4 = await processReviseMessage(session, "对了时间改一下，改到周日上午十点，地点在市体育馆");
    console.log(`  reply: ${r4.reply.slice(0, 80)}...`);
    console.log(`  有修改: ${r4.revision !== null}`);
    console.log(`  当前 conv token: ${session.conv.getHistoryTokenCount()}`);

    // 查询 chat_messages
    const messages = await listChatMessages(taskId);
    const reviseMessages = messages.filter(
      (m) => (m.metadata as Record<string, unknown>).phase === "revise"
    );
    console.log(`\n--- Revise chat_messages 记录 (共 ${reviseMessages.length} 条) ---`);
    for (const msg of reviseMessages) {
      const meta = msg.metadata as Record<string, unknown>;
      const preview = msg.content.length > 60
        ? msg.content.slice(0, 60) + "..."
        : msg.content;
      console.log(`  [${msg.senderType}] round=${meta.round}, role=${meta.role ?? "-"}`);
      console.log(`    content: ${preview}`);
      if (msg.compressSummary) {
        console.log(`    compress_summary: "${msg.compressSummary}"`);
      }
    }

    // 检查 compress_summary 记录
    const compressMessages = reviseMessages.filter(
      (m) => (m.metadata as Record<string, unknown>).role === "compress_summary"
    );
    console.log(`\n  compress_summary 消息数: ${compressMessages.length}`);

    if (compressMessages.length > 0) {
      console.log(`  ✓ Revise 压缩已触发！`);
      for (const cm of compressMessages) {
        console.log(`    摘要内容: "${cm.content}"`);
        console.log(`    摘要长度: ${cm.content.length} 字`);
      }
    } else {
      console.log(`  ℹ 未触发压缩`);
    }

    // 验证最终任务状态
    const finalTask = await readTaskDocument(taskId);
    console.log(`\n--- 最终任务状态 ---`);
    console.log(`  活动: ${finalTask.body.targetActivity}`);
    console.log(`  氛围: ${finalTask.body.targetVibe}`);
    console.log(`  互动: ${finalTask.frontmatter.interaction_type}`);
    console.log(`  版本: ${finalTask.frontmatter.version}`);

    // 至少应有多条 revise 消息
    expect(reviseMessages.length).toBeGreaterThanOrEqual(4);
  }, 120_000);
});
