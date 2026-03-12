/**
 * Cosoul.AI — 测试数据种子脚本
 *
 * 根据项目文档生成贴合真实业务场景的测试数据：
 * - 3 个用户，共 7 个 AI 分身
 * - 覆盖所有 FSM 状态的任务
 * - 四种消息交互模式的聊天记录
 * - 联系人关系 + 握手日志
 * - 记忆摘要
 *
 * 运行方式：npm run db:seed
 */

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { v4 as uuidv4 } from "uuid";
import * as schema from "./schema";

const {
  users,
  personas,
  tasks,
  contacts,
  handshakeLogs,
  chatMessages,
  idempotencyKeys,
} = schema;

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://cosoul:cosoul@db:5432/cosoul_agent";

// ─── 固定 UUID（方便调试和跨表引用）────────────────────────────────

// 用户
const USER_ALICE = uuidv4();
const USER_BOB = uuidv4();
const USER_CAROL = uuidv4();

// Alice 的分身
const PERSONA_ALICE_SOCIAL = uuidv4(); // 社交达人
const PERSONA_ALICE_TECH = uuidv4(); // 技术宅
const PERSONA_ALICE_FITNESS = uuidv4(); // 健身搭子

// Bob 的分身
const PERSONA_BOB_BUSINESS = uuidv4(); // 商务精英
const PERSONA_BOB_FOODIE = uuidv4(); // 美食探店

// Carol 的分身
const PERSONA_CAROL_TRAVEL = uuidv4(); // 旅行达人
const PERSONA_CAROL_MUSIC = uuidv4(); // 音乐爱好者

// 任务（覆盖各 FSM 状态）
const TASK_ALICE_SOCIAL_1 = uuidv4(); // Drafting
const TASK_ALICE_SOCIAL_2 = uuidv4(); // Searching
const TASK_ALICE_TECH_1 = uuidv4(); // Negotiating
const TASK_ALICE_FITNESS_1 = uuidv4(); // Waiting_Human
const TASK_BOB_BUSINESS_1 = uuidv4(); // Closed
const TASK_BOB_BUSINESS_2 = uuidv4(); // Listening
const TASK_BOB_FOODIE_1 = uuidv4(); // Revising
const TASK_CAROL_TRAVEL_1 = uuidv4(); // Searching
const TASK_CAROL_TRAVEL_2 = uuidv4(); // Timeout
const TASK_CAROL_MUSIC_1 = uuidv4(); // Failed

async function seed() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const db = drizzle(pool, { schema });

  console.log("[seed] 清空旧数据...");
  // 按外键依赖倒序删除
  await db.delete(idempotencyKeys);
  await db.delete(chatMessages);
  await db.delete(handshakeLogs);
  await db.delete(contacts);
  await db.delete(tasks);
  await db.delete(personas);
  await db.delete(users);

  // ─── 1. 用户 ──────────────────────────────────────────────────
  console.log("[seed] 插入用户...");
  await db.insert(users).values([
    {
      userId: USER_ALICE,
      email: "alice@cosoul.ai",
      name: "Alice 张",
      avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=alice",
    },
    {
      userId: USER_BOB,
      email: "bob@cosoul.ai",
      name: "Bob 李",
      avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=bob",
    },
    {
      userId: USER_CAROL,
      email: "carol@cosoul.ai",
      name: "Carol 王",
      avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=carol",
    },
  ]);

  // ─── 2. AI 分身 ──────────────────────────────────────────────
  console.log("[seed] 插入 AI 分身...");
  await db.insert(personas).values([
    // Alice 的 3 个分身
    {
      personaId: PERSONA_ALICE_SOCIAL,
      userId: USER_ALICE,
      name: "社交达人 Alice",
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=alice-social",
      bio: "喜欢结交新朋友，热爱聚会和社交活动。外向开朗，善于破冰。",
      profileText: "# Alice 社交达人\n\n## 性格\n外向、热情、善于沟通\n\n## 偏好\n- 喜欢线下活动（聚餐、户外运动、桌游）\n- 偏好 20-35 岁的同龄人\n- 对体育和旅行感兴趣\n\n## 雷区\n- 不喜欢过于严肃的商务场合\n- 避免宗教和政治话题",
      preferences: { age_range: "20-35", interests: ["聚餐", "户外", "桌游", "旅行"], deal_breakers: ["宗教推销", "传销"] },
      settings: { high_match_mode: false, language: "zh-CN" },
    },
    {
      personaId: PERSONA_ALICE_TECH,
      userId: USER_ALICE,
      name: "技术宅 Alice",
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=alice-tech",
      bio: "全栈工程师，对 AI 和分布式系统感兴趣。更喜欢线上技术交流。",
      profileText: "# Alice 技术宅\n\n## 技术栈\nTypeScript, React, Node.js, PostgreSQL, AI/LLM\n\n## 偏好\n- 线上技术交流为主\n- 对开源项目感兴趣\n- 喜欢深度技术讨论\n\n## 雷区\n- 不喜欢纯营销性质的技术活动",
      preferences: { tech_stack: ["TypeScript", "React", "Node.js", "AI"], interaction: "online", interests: ["开源", "AI", "架构"] },
      settings: { high_match_mode: false, language: "zh-CN" },
    },
    {
      personaId: PERSONA_ALICE_FITNESS,
      userId: USER_ALICE,
      name: "健身搭子 Alice",
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=alice-fitness",
      bio: "每周健身 4 次，擅长瑜伽和力量训练。找健身伙伴一起打卡。",
      profileText: "# Alice 健身搭子\n\n## 运动习惯\n每周 4 次，上午时段\n\n## 偏好\n- 瑜伽、力量训练、HIIT\n- 找同城健身伙伴\n- 偏好有健身基础的搭子",
      preferences: { sports: ["瑜伽", "力量训练", "HIIT"], frequency: "4次/周", time_slot: "上午" },
      settings: { high_match_mode: true, language: "zh-CN" },
    },
    // Bob 的 2 个分身
    {
      personaId: PERSONA_BOB_BUSINESS,
      userId: USER_BOB,
      name: "商务精英 Bob",
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=bob-biz",
      bio: "连续创业者，专注 SaaS 和 AI 赛道。寻找联合创始人和投资人。",
      profileText: "# Bob 商务精英\n\n## 背景\n连续创业者，3 次创业经历\n\n## 偏好\n- 寻找 AI/SaaS 领域的联合创始人\n- 对技术驱动型产品感兴趣\n- 偏好有创业经验的合作伙伴",
      preferences: { industry: ["AI", "SaaS", "企业服务"], looking_for: ["联合创始人", "投资人", "技术合伙人"] },
      settings: { high_match_mode: true, language: "zh-CN" },
    },
    {
      personaId: PERSONA_BOB_FOODIE,
      userId: USER_BOB,
      name: "美食探店 Bob",
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=bob-food",
      bio: "资深吃货，每周至少探 2 家新店。偏爱日料和川菜。",
      profileText: "# Bob 美食探店\n\n## 口味\n偏爱日料和川菜，也喜欢尝试新菜系\n\n## 偏好\n- 人均 100-300 的中高端餐厅\n- 注重用餐环境和服务\n- 喜欢和会拍照的朋友一起",
      preferences: { cuisines: ["日料", "川菜", "法餐"], budget: "100-300", vibe: "精致" },
      settings: { high_match_mode: false, language: "zh-CN" },
    },
    // Carol 的 2 个分身
    {
      personaId: PERSONA_CAROL_TRAVEL,
      userId: USER_CAROL,
      name: "旅行达人 Carol",
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=carol-travel",
      bio: "数字游民，已去过 30+ 国家。偏爱小众目的地和深度文化体验。",
      profileText: "# Carol 旅行达人\n\n## 旅行风格\n深度文化体验，小众目的地\n\n## 偏好\n- 不喜欢跟团游\n- 偏爱自由行和半自助\n- 对当地美食和历史感兴趣",
      preferences: { style: "自由行", interests: ["文化体验", "当地美食", "历史古迹"], visited: "30+ 国家" },
      settings: { high_match_mode: false, language: "zh-CN" },
    },
    {
      personaId: PERSONA_CAROL_MUSIC,
      userId: USER_CAROL,
      name: "音乐爱好者 Carol",
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=carol-music",
      bio: "独立音乐人，弹吉他、写歌。寻找志同道合的乐队成员。",
      profileText: "# Carol 音乐爱好者\n\n## 音乐风格\n独立摇滚、民谣、后摇\n\n## 技能\n吉他（8年）、词曲创作\n\n## 偏好\n- 找鼓手和贝斯手组乐队\n- 喜欢 Livehouse 演出\n- 对录音制作感兴趣",
      preferences: { genres: ["独立摇滚", "民谣", "后摇"], instruments: ["吉他"], looking_for: ["鼓手", "贝斯手"] },
      settings: { high_match_mode: false, language: "zh-CN" },
    },
  ]);

  // ─── 3. 任务（覆盖 FSM 全部状态）─────────────────────────────
  console.log("[seed] 插入任务（覆盖所有 FSM 状态）...");
  await db.insert(tasks).values([
    // Drafting — Alice 社交达人刚发布的新需求
    {
      taskId: TASK_ALICE_SOCIAL_1,
      personaId: PERSONA_ALICE_SOCIAL,
      status: "Drafting",
      interactionType: "offline",
      rawDescription: "周末想找人一起去爬山，最好是朝阳区附近的，3-5人小团。",
      targetActivity: "户外爬山",
      targetVibe: "轻松愉快、热爱运动",
      detailedPlan:
        "周六上午 9 点出发，目的地香山或百望山，自带午餐，下午 3 点左右结束。",
    },
    // Searching — Alice 社交达人正在搜索
    {
      taskId: TASK_ALICE_SOCIAL_2,
      personaId: PERSONA_ALICE_SOCIAL,
      status: "Searching",
      interactionType: "any",
      rawDescription:
        "想找一起玩剧本杀的朋友，线下线上都可以，最好有一定经验。",
      targetActivity: "剧本杀",
      targetVibe: "推理爱好、有趣、配合度高",
      detailedPlan:
        "每两周组一次局，4-6人，偏好硬核推理本，可以接受情感本。",
    },
    // Negotiating — Alice 技术宅的 Agent 正在和对方 Agent 谈判
    {
      taskId: TASK_ALICE_TECH_1,
      personaId: PERSONA_ALICE_TECH,
      status: "Negotiating",
      interactionType: "online",
      currentPartnerId: TASK_CAROL_TRAVEL_1,
      rawDescription:
        "找一个会 React Native 的开发者一起搞一个开源旅行 App 项目。",
      targetActivity: "开源协作开发",
      targetVibe: "技术热情、有责任心、代码质量高",
      detailedPlan:
        "基于 Expo + React Native 的旅行日记 App，计划 2 个月完成 MVP。",
    },
    // Waiting_Human — Alice 健身搭子匹配到了，等待真人确认
    {
      taskId: TASK_ALICE_FITNESS_1,
      personaId: PERSONA_ALICE_FITNESS,
      status: "Waiting_Human",
      interactionType: "offline",
      currentPartnerId: TASK_BOB_BUSINESS_1,
      rawDescription:
        "找同城健身搭子，一起去健身房力量训练，互相监督打卡。",
      targetActivity: "健身房力量训练",
      targetVibe: "自律、有健身基础、正能量",
      detailedPlan:
        "每周一三五上午 7-9 点，在朝阳区的健身房，主要做三大项。",
    },
    // Closed — Bob 商务精英的任务已完成
    {
      taskId: TASK_BOB_BUSINESS_1,
      personaId: PERSONA_BOB_BUSINESS,
      status: "Closed",
      interactionType: "any",
      rawDescription:
        "寻找 AI 领域的技术合伙人，一起做一个 AI Agent 创业项目。",
      targetActivity: "AI 创业合伙",
      targetVibe: "有创业精神、技术过硬、执行力强",
      detailedPlan:
        "产品方向：AI 社交匹配平台。需要一个全栈工程师做技术合伙人，有股份激励。",
    },
    // Listening — Bob 商务精英挂起任务，后台持续匹配
    {
      taskId: TASK_BOB_BUSINESS_2,
      personaId: PERSONA_BOB_BUSINESS,
      status: "Listening",
      interactionType: "online",
      rawDescription:
        "寻找天使投资人，项目方向：基于多智能体的 AI 社交平台。",
      targetActivity: "融资对接",
      targetVibe: "对 AI 赛道有信心、投资过早期项目",
      detailedPlan:
        "种子轮融资 200 万人民币，释放 10% 股份。已有 MVP 和 500 个内测用户。",
    },
    // Revising — Bob 美食探店不满意结果，正在修改需求
    {
      taskId: TASK_BOB_FOODIE_1,
      personaId: PERSONA_BOB_FOODIE,
      status: "Revising",
      interactionType: "offline",
      rawDescription:
        "找同城美食搭子，一起探新店、拍美食照片。上次匹配的不太合适，对方不喜欢日料。",
      targetActivity: "美食探店",
      targetVibe: "爱吃、会拍照、对日料和川菜感兴趣",
      detailedPlan:
        "每周六下午探一家新店，主攻朝阳/海淀区域，预算人均 150-250。",
    },
    // Searching — Carol 旅行达人正在搜索
    {
      taskId: TASK_CAROL_TRAVEL_1,
      personaId: PERSONA_CAROL_TRAVEL,
      status: "Searching",
      interactionType: "any",
      rawDescription:
        "五一假期想找旅伴一起去日本关西自由行，7天6晚。",
      targetActivity: "日本关西自由行",
      targetVibe: "随和、不赶行程、对日本文化感兴趣",
      detailedPlan:
        "大阪-京都-奈良-神户路线，住民宿，重点体验当地小店和寺庙，预算 1.5 万/人。",
    },
    // Timeout — Carol 旅行达人的一个过期任务
    {
      taskId: TASK_CAROL_TRAVEL_2,
      personaId: PERSONA_CAROL_TRAVEL,
      status: "Timeout",
      interactionType: "offline",
      rawDescription:
        "春节找人一起去云南大理旅行，7 天左右。",
      targetActivity: "云南大理旅行",
      targetVibe: "文艺、热爱自然",
      detailedPlan:
        "大理古城-洱海-双廊-沙溪古镇，包车游，预算 8000/人。",
    },
    // Failed — Carol 音乐爱好者匹配失败
    {
      taskId: TASK_CAROL_MUSIC_1,
      personaId: PERSONA_CAROL_MUSIC,
      status: "Failed",
      interactionType: "offline",
      rawDescription:
        "找鼓手和贝斯手组独立摇滚乐队，每周排练 1-2 次。",
      targetActivity: "组建乐队",
      targetVibe: "热爱音乐、有乐队经验、守时靠谱",
      detailedPlan:
        "风格方向：后摇 + 独立摇滚。排练地点在朝阳区，未来目标是 Livehouse 演出。",
    },
  ]);

  // ─── 4. 联系人 ────────────────────────────────────────────────
  console.log("[seed] 插入联系人...");
  await db.insert(contacts).values([
    // Bob 商务精英 ↔ Alice 技术宅（通过创业合伙任务匹配成功）
    {
      personaId: PERSONA_BOB_BUSINESS,
      friendPersonaId: PERSONA_ALICE_TECH,
      status: "accepted",
      aiNote:
        "通过「AI 创业合伙」任务匹配。Alice 是全栈工程师，对 AI 和分布式系统有深入了解，技术能力强。",
      sourceTaskId: TASK_BOB_BUSINESS_1,
    },
    {
      personaId: PERSONA_ALICE_TECH,
      friendPersonaId: PERSONA_BOB_BUSINESS,
      status: "accepted",
      aiNote:
        "通过「AI 创业合伙」任务匹配。Bob 是连续创业者，有丰富的商业经验和行业人脉。",
      sourceTaskId: TASK_BOB_BUSINESS_1,
    },
    // Alice 健身搭子 → Carol 旅行达人（好友申请中）
    {
      personaId: PERSONA_ALICE_FITNESS,
      friendPersonaId: PERSONA_CAROL_TRAVEL,
      status: "pending",
      aiNote:
        "Carol 也有户外运动爱好，虽然不是健身方向，但可能对徒步爬山感兴趣。",
      sourceTaskId: TASK_ALICE_FITNESS_1,
    },
    // Alice 社交达人 ↔ Bob 美食探店（已是好友）
    {
      personaId: PERSONA_ALICE_SOCIAL,
      friendPersonaId: PERSONA_BOB_FOODIE,
      status: "accepted",
      aiNote: "Bob 是资深吃货，可以一起探店。之前通过美食社交活动认识。",
    },
    {
      personaId: PERSONA_BOB_FOODIE,
      friendPersonaId: PERSONA_ALICE_SOCIAL,
      status: "accepted",
      aiNote:
        "Alice 社交能力强，每次聚餐氛围很好，而且对川菜也很有研究。",
    },
  ]);

  // ─── 5. 握手日志 ──────────────────────────────────────────────
  console.log("[seed] 插入握手日志...");
  await db.insert(handshakeLogs).values([
    // Alice 技术宅的任务 ↔ Carol 旅行达人 正在谈判
    {
      taskId: TASK_ALICE_TECH_1,
      direction: "outbound",
      envelope: {
        protocol_version: "1.0",
        message_id: uuidv4(),
        action: "PROPOSE",
        sender_task_id: TASK_ALICE_TECH_1,
        receiver_task_id: TASK_CAROL_TRAVEL_1,
        round: 1,
        payload: {
          proposal:
            "我是技术宅 Alice 的 Agent。Alice 正在找 React Native 开发者做开源旅行 App，注意到您有丰富的旅行经验，可能对这个项目方向感兴趣。",
          match_score: 0.72,
        },
      },
    },
    {
      taskId: TASK_ALICE_TECH_1,
      direction: "inbound",
      envelope: {
        protocol_version: "1.0",
        message_id: uuidv4(),
        action: "COUNTER_PROPOSE",
        sender_task_id: TASK_CAROL_TRAVEL_1,
        receiver_task_id: TASK_ALICE_TECH_1,
        round: 2,
        payload: {
          counter_proposal:
            "Carol 的 Agent 回复：Carol 对旅行 App 项目非常感兴趣，但她更擅长 UI/UX 设计而非开发。是否可以接受设计师角色的合作？",
          match_score: 0.68,
          unresolved: ["Carol 的技术能力需进一步确认"],
        },
      },
    },
    // Alice 健身搭子的匹配历史
    {
      taskId: TASK_ALICE_FITNESS_1,
      direction: "outbound",
      envelope: {
        protocol_version: "1.0",
        message_id: uuidv4(),
        action: "PROPOSE",
        sender_task_id: TASK_ALICE_FITNESS_1,
        receiver_task_id: TASK_BOB_BUSINESS_1,
        round: 1,
        payload: {
          proposal:
            "Alice 健身搭子的 Agent：注意到 Bob 也在朝阳区，虽然 Bob 主要忙创业，但健身可以帮助减压。",
          match_score: 0.55,
        },
      },
    },
    {
      taskId: TASK_ALICE_FITNESS_1,
      direction: "inbound",
      envelope: {
        protocol_version: "1.0",
        message_id: uuidv4(),
        action: "ACCEPT",
        sender_task_id: TASK_BOB_BUSINESS_1,
        receiver_task_id: TASK_ALICE_FITNESS_1,
        round: 2,
        payload: {
          response:
            "Bob 的 Agent：Bob 虽然忙但确实需要运动减压，可以尝试每周一次。",
          match_score: 0.62,
        },
      },
    },
  ]);

  // ─── 6. 聊天消息（覆盖四种交互模式）──────────────────────────
  console.log("[seed] 插入聊天消息（四种交互模式）...");
  await db.insert(chatMessages).values([
    // ── 模式 1：人 - 人（Alice 社交达人 ↔ Bob 美食探店）──
    {
      taskId: null,
      personaId: PERSONA_ALICE_SOCIAL,
      senderType: "human",
      senderId: PERSONA_ALICE_SOCIAL,
      content: "Bob！上次那家川菜馆太赞了，下周六要不要再去探一家新的？",
      metadata: { mode: "human-human" },
    },
    {
      taskId: null,
      personaId: PERSONA_ALICE_SOCIAL,
      senderType: "human",
      senderId: PERSONA_BOB_FOODIE,
      content:
        "好啊！我发现朝阳大悦城新开了一家日式烧鸟店，评价很高，去试试？",
      metadata: { mode: "human-human" },
    },
    {
      taskId: null,
      personaId: PERSONA_ALICE_SOCIAL,
      senderType: "human",
      senderId: PERSONA_ALICE_SOCIAL,
      content: "烧鸟！太棒了，我最喜欢了。周六下午 5 点怎么样？",
      metadata: { mode: "human-human" },
    },

    // ── 模式 2：Agent - Agent（自动协商）──
    {
      taskId: TASK_ALICE_TECH_1,
      personaId: PERSONA_ALICE_TECH,
      senderType: "agent",
      senderId: PERSONA_ALICE_TECH,
      content:
        "[Agent 自动消息] 我是 Alice 技术宅的 Agent。Alice 正在寻找 React Native 开发者合作开源旅行 App 项目。您的分身「旅行达人 Carol」似乎有丰富的旅行经验，可能对产品方向有独到见解。",
      metadata: { mode: "agent-agent", round: 1, action: "PROPOSE" },
    },
    {
      taskId: TASK_ALICE_TECH_1,
      personaId: PERSONA_ALICE_TECH,
      senderType: "agent",
      senderId: PERSONA_CAROL_TRAVEL,
      content:
        "[Agent 自动消息] 我是旅行达人 Carol 的 Agent。Carol 对旅行 App 项目方向非常感兴趣，不过她更擅长 UI/UX 设计。是否接受设计师角色的合作方式？",
      metadata: {
        mode: "agent-agent",
        round: 2,
        action: "COUNTER_PROPOSE",
      },
    },

    // ── 模式 3：Agent - 人（Agent 主动联系真人）──
    {
      taskId: TASK_ALICE_FITNESS_1,
      personaId: PERSONA_BOB_BUSINESS,
      senderType: "agent",
      senderId: PERSONA_ALICE_FITNESS,
      content:
        "[Alice 健身搭子的 Agent] 您好 Bob！我注意到您在朝阳区工作，创业压力大的时候运动是最好的减压方式。Alice 每周一三五上午在健身房做力量训练，想邀请您一起。",
      metadata: { mode: "agent-human" },
    },
    {
      taskId: TASK_ALICE_FITNESS_1,
      personaId: PERSONA_BOB_BUSINESS,
      senderType: "human",
      senderId: PERSONA_BOB_BUSINESS,
      content:
        "谢谢推荐！确实最近忙创业缺乏运动。不过每周一三五上午我有会议，能不能改成周二周四？",
      metadata: { mode: "agent-human" },
    },

    // ── 模式 4：人 - Agent（真人和对方 Agent 交流）──
    {
      taskId: TASK_BOB_BUSINESS_2,
      personaId: PERSONA_BOB_BUSINESS,
      senderType: "human",
      senderId: PERSONA_BOB_BUSINESS,
      content:
        "你好，我是 Bob。我看到你们分身正在找投资人，能详细说说你们项目的数据吗？",
      metadata: { mode: "human-agent" },
    },
    {
      taskId: TASK_BOB_BUSINESS_2,
      personaId: PERSONA_BOB_BUSINESS,
      senderType: "agent",
      senderId: PERSONA_CAROL_TRAVEL,
      content:
        "[Carol 旅行达人的 Agent] Bob 您好！Carol 目前主要在做旅行内容，暂时没有融资计划。不过如果您对旅行领域的 AI 应用感兴趣，Carol 很乐意交流想法。",
      metadata: { mode: "human-agent" },
    },

    // ── Intake 多轮对话记录（发布 Tab 场景）──
    {
      taskId: TASK_ALICE_SOCIAL_1,
      personaId: PERSONA_ALICE_SOCIAL,
      senderType: "agent",
      senderId: PERSONA_ALICE_SOCIAL,
      content:
        "你好 Alice！我是你的社交达人 Agent 🎯 你想发布一个新的社交需求吗？可以告诉我你想做什么活动。",
      metadata: { mode: "intake", step: 1 },
    },
    {
      taskId: TASK_ALICE_SOCIAL_1,
      personaId: PERSONA_ALICE_SOCIAL,
      senderType: "human",
      senderId: PERSONA_ALICE_SOCIAL,
      content: "周末想去爬山，想找几个人一起。",
      metadata: { mode: "intake", step: 2 },
    },
    {
      taskId: TASK_ALICE_SOCIAL_1,
      personaId: PERSONA_ALICE_SOCIAL,
      senderType: "agent",
      senderId: PERSONA_ALICE_SOCIAL,
      content:
        "好的！爬山是个很棒的户外活动。根据你的偏好，你喜欢线下活动和 20-35 岁的同龄人。我再确认几个细节：\n1. 你偏好哪个区域的山？\n2. 大概几个人一起？\n3. 对同伴有什么特别要求吗？",
      metadata: { mode: "intake", step: 3 },
    },
    {
      taskId: TASK_ALICE_SOCIAL_1,
      personaId: PERSONA_ALICE_SOCIAL,
      senderType: "human",
      senderId: PERSONA_ALICE_SOCIAL,
      content:
        "朝阳区附近的就行，香山或者百望山。3-5 个人的小团，希望大家都喜欢运动。",
      metadata: { mode: "intake", step: 4 },
    },
    {
      taskId: TASK_ALICE_SOCIAL_1,
      personaId: PERSONA_ALICE_SOCIAL,
      senderType: "agent",
      senderId: PERSONA_ALICE_SOCIAL,
      content:
        '明白了！我帮你整理一下需求：\n\n📍 **活动**：周末爬山（香山/百望山）\n👥 **人数**：3-5 人小团\n🎯 **氛围**：轻松愉快、热爱运动\n🗓️ **时间**：周六上午出发\n\n确认无误的话我就开始帮你匹配啦！你也可以继续补充细节。',
      metadata: { mode: "intake", step: 5 },
    },
  ]);

  // ─── 7. 幂等记录 ──────────────────────────────────────────────
  console.log("[seed] 插入幂等记录...");
  await db.insert(idempotencyKeys).values([
    {
      key: `handshake:${TASK_ALICE_TECH_1}:propose:1`,
      response: { status: "processed", action: "COUNTER_PROPOSE" },
    },
    {
      key: `handshake:${TASK_ALICE_FITNESS_1}:propose:1`,
      response: { status: "processed", action: "ACCEPT" },
    },
  ]);

  console.log("[seed] ✅ 全部数据插入完成！");
  console.log("[seed] 统计：");
  console.log("  - 用户：3");
  console.log("  - AI 分身（含 profile）：7");
  console.log("  - 任务（覆盖全部 FSM 状态）：10");
  console.log("  - 联系人关系：5");
  console.log("  - 握手日志：4");
  console.log("  - 聊天消息（四种模式 + Intake）：15");
  console.log("  - 幂等记录：2");

  await pool.end();
}

seed().catch((err) => {
  console.error("[seed] ❌ 失败：", err);
  process.exit(1);
});
