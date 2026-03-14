/**
 * Cosoul.AI — 测试数据种子脚本
 *
 * 数据规模：
 * - 1 个 Admin 调试账号（UUID 恒定） + 2 个普通用户
 * - Admin 拥有 5 个人格 + 8 个任务（覆盖全部 FSM 状态）
 * - 普通用户各 1-2 个人格 + 若干任务
 * - 联系人关系 + 握手日志 + 聊天消息
 *
 * 运行方式：npm run db:seed
 */

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { v4 as uuidv4 } from "uuid";
import * as schema from "./schema";

const {
  users,
  refreshTokens,
  passwordResetCodes,
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

// ─── 固定 UUID（恒定不变，db:reset 后所有引用仍有效）─────────────

// Admin 调试账号 — 与 .env ADMIN_USER_ID 一致
const ADMIN_USER_ID = "c9bc33bf-db62-41f9-96df-2583a88fbd77";

// 普通测试用户
const USER_BOB = "a1c49227-4425-41f1-bd0b-288ea0ee1057";
const USER_CAROL = "a40280d7-7f97-4429-8b75-ff52bea18235";

// Admin 的 5 个人格（固定 UUID，方便调试直接引用）
const P_ADMIN_SOCIAL   = "11111111-1111-1111-1111-111111111001";
const P_ADMIN_TECH     = "11111111-1111-1111-1111-111111111002";
const P_ADMIN_FITNESS  = "11111111-1111-1111-1111-111111111003";
const P_ADMIN_FOODIE   = "11111111-1111-1111-1111-111111111004";
const P_ADMIN_CREATIVE = "11111111-1111-1111-1111-111111111005";

// Bob 的人格
const P_BOB_BUSINESS = uuidv4();
const P_BOB_FOODIE   = uuidv4();

// Carol 的人格
const P_CAROL_TRAVEL = uuidv4();
const P_CAROL_MUSIC  = uuidv4();

// Admin 的 8 个任务（固定 UUID）
const T_ADMIN_SOCIAL_DRAFT    = "22222222-2222-2222-2222-222222222001"; // Drafting
const T_ADMIN_SOCIAL_SEARCH   = "22222222-2222-2222-2222-222222222002"; // Searching
const T_ADMIN_TECH_NEGOTIATE  = "22222222-2222-2222-2222-222222222003"; // Negotiating
const T_ADMIN_TECH_SEARCH     = "22222222-2222-2222-2222-222222222004"; // Searching
const T_ADMIN_FITNESS_WAITING = "22222222-2222-2222-2222-222222222005"; // Waiting_Human
const T_ADMIN_FOODIE_CLOSED   = "22222222-2222-2222-2222-222222222006"; // Closed
const T_ADMIN_FOODIE_REVISE   = "22222222-2222-2222-2222-222222222007"; // Revising
const T_ADMIN_CREATIVE_LISTEN = "22222222-2222-2222-2222-222222222008"; // Listening

// 其他用户的任务
const T_BOB_BIZ_1      = uuidv4(); // Closed
const T_BOB_BIZ_2      = uuidv4(); // Listening
const T_BOB_FOODIE_1   = uuidv4(); // Searching
const T_CAROL_TRAVEL_1 = uuidv4(); // Searching
const T_CAROL_TRAVEL_2 = uuidv4(); // Timeout
const T_CAROL_MUSIC_1  = uuidv4(); // Failed

async function seed() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const db = drizzle(pool, { schema });

  console.log("[seed] 清空旧数据...");
  await db.delete(idempotencyKeys);
  await db.delete(chatMessages);
  await db.delete(handshakeLogs);
  await db.delete(contacts);
  await db.delete(tasks);
  await db.delete(refreshTokens);
  await db.delete(passwordResetCodes);
  await db.delete(personas);
  await db.delete(users);

  // ─── 1. 用户（完整信息，覆盖 users 表所有字段）────────────────
  console.log("[seed] 插入用户...");
  await db.insert(users).values([
    // Admin 调试账号 — 超级管理员，Premium 订阅
    {
      userId: ADMIN_USER_ID,
      email: "admin@cosoul.ai",
      passwordHash: "$2b$12$LJ3m4ys4Lz0JJx4zN6s5seVz8R9y5FQ1HcPcKzV5xN1dO3mG7pA6i", // Admin123456
      phone: "13800000001",
      name: "Admin",
      avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=admin",
      gender: "male",
      birthday: "1995-06-15",
      bio: "Cosoul.AI 平台管理员，全栈工程师，AI 社交匹配系统架构师。",
      interests: ["AI", "全栈开发", "社交产品", "摄影", "徒步"],
      school: "清华大学",
      location: "北京·朝阳",
      subscriptionTier: "premium",
      subscriptionExpiresAt: new Date("2026-07-21T11:45:14Z"),
      status: "active",
      lastLoginAt: new Date(),
    },
    // Bob — Pro 订阅用户
    {
      userId: USER_BOB,
      email: "bob@cosoul.ai",
      passwordHash: "$2b$12$LJ3m4ys4Lz0JJx4zN6s5seVz8R9y5FQ1HcPcKzV5xN1dO3mG7pA6i", // Bob123456
      phone: "13800000002",
      name: "Bob 李",
      avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=bob",
      gender: "male",
      birthday: "1998-03-22",
      bio: "连续创业者，SaaS + AI 赛道。爱吃日料和火锅。",
      interests: ["创业", "AI", "SaaS", "日料", "火锅"],
      school: "北京大学",
      location: "北京·海淀",
      subscriptionTier: "pro",
      subscriptionExpiresAt: new Date("2026-12-31T23:59:59Z"),
      status: "active",
      lastLoginAt: new Date(Date.now() - 3600_000), // 1 小时前
    },
    // Carol — 免费用户
    {
      userId: USER_CAROL,
      email: "carol@cosoul.ai",
      passwordHash: "$2b$12$LJ3m4ys4Lz0JJx4zN6s5seVz8R9y5FQ1HcPcKzV5xN1dO3mG7pA6i", // Carol123456
      phone: "13800000003",
      name: "Carol 王",
      avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=carol",
      gender: "female",
      birthday: "2000-11-08",
      bio: "数字游民，独立音乐人，吉他 8 年。去过 30+ 国家。",
      interests: ["旅行", "独立音乐", "摄影", "文化体验", "吉他"],
      school: "深圳大学",
      location: "深圳·南山",
      subscriptionTier: "free",
      subscriptionExpiresAt: new Date("2026-03-31T15:35:15Z"),
      status: "active",
      lastLoginAt: new Date(Date.now() - 86400_000), // 1 天前
    },
  ]);

  // ─── 2. AI 人格 ──────────────────────────────────────────────
  console.log("[seed] 插入 AI 人格...");
  await db.insert(personas).values([
    // ── Admin 的 5 个人格 ──
    {
      personaId: P_ADMIN_SOCIAL,
      userId: ADMIN_USER_ID,
      name: "社交达人",
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=admin-social",
      bio: "喜欢结交新朋友，热爱聚会和社交活动。外向开朗，善于破冰。",
      profileText: "# 社交达人\n\n## 性格\n外向、热情、善于沟通\n\n## 偏好\n- 喜欢线下活动（聚餐、户外运动、桌游）\n- 偏好 20-35 岁的同龄人\n- 对体育和旅行感兴趣\n\n## 雷区\n- 不喜欢过于严肃的商务场合\n- 避免宗教和政治话题",
      preferences: { age_range: "20-35", interests: ["聚餐", "户外", "桌游", "旅行"], deal_breakers: ["宗教推销", "传销"] },
      settings: { high_match_mode: false, language: "zh-CN" },
    },
    {
      personaId: P_ADMIN_TECH,
      userId: ADMIN_USER_ID,
      name: "技术极客",
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=admin-tech",
      bio: "全栈工程师，对 AI 和分布式系统感兴趣。享受线上技术深度交流。",
      profileText: "# 技术极客\n\n## 技术栈\nTypeScript, React, Node.js, PostgreSQL, AI/LLM\n\n## 偏好\n- 线上技术交流为主\n- 对开源项目感兴趣\n- 喜欢深度技术讨论\n\n## 雷区\n- 不喜欢纯营销性质的技术活动",
      preferences: { tech_stack: ["TypeScript", "React", "Node.js", "AI"], interaction: "online", interests: ["开源", "AI", "架构"] },
      settings: { high_match_mode: false, language: "zh-CN" },
    },
    {
      personaId: P_ADMIN_FITNESS,
      userId: ADMIN_USER_ID,
      name: "健身搭子",
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=admin-fitness",
      bio: "每周健身 4 次，擅长瑜伽和力量训练。找健身伙伴一起打卡。",
      profileText: "# 健身搭子\n\n## 运动习惯\n每周 4 次，上午时段\n\n## 偏好\n- 瑜伽、力量训练、HIIT\n- 找同城健身伙伴\n- 偏好有健身基础的搭子",
      preferences: { sports: ["瑜伽", "力量训练", "HIIT"], frequency: "4次/周", time_slot: "上午" },
      settings: { high_match_mode: true, language: "zh-CN" },
    },
    {
      personaId: P_ADMIN_FOODIE,
      userId: ADMIN_USER_ID,
      name: "美食探店家",
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=admin-food",
      bio: "资深吃货，每周至少探 2 家新店。偏爱日料和川菜，喜欢拍美食。",
      profileText: "# 美食探店家\n\n## 口味\n偏爱日料和川菜，也喜欢尝试新菜系\n\n## 偏好\n- 人均 100-300 的中高端餐厅\n- 注重用餐环境和服务\n- 喜欢和会拍照的朋友一起",
      preferences: { cuisines: ["日料", "川菜", "法餐"], budget: "100-300", vibe: "精致" },
      settings: { high_match_mode: false, language: "zh-CN" },
    },
    {
      personaId: P_ADMIN_CREATIVE,
      userId: ADMIN_USER_ID,
      name: "创意工坊",
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=admin-creative",
      bio: "独立创作者，摄影 + 短视频 + 文案。寻找志同道合的内容共创伙伴。",
      profileText: "# 创意工坊\n\n## 技能\n摄影（风光/人像）、短视频剪辑、文案策划\n\n## 偏好\n- 找内容共创搭档\n- 偏好有审美追求的合作者\n- 对 Vlog、旅拍、品牌合作感兴趣\n\n## 雷区\n- 不接受纯商业推广",
      preferences: { skills: ["摄影", "短视频", "文案"], interests: ["Vlog", "旅拍", "品牌合作"], style: "文艺" },
      settings: { high_match_mode: false, language: "zh-CN" },
    },

    // ── Bob 的 2 个人格 ──
    {
      personaId: P_BOB_BUSINESS,
      userId: USER_BOB,
      name: "商务精英 Bob",
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=bob-biz",
      bio: "连续创业者，专注 SaaS 和 AI 赛道。寻找联合创始人和投资人。",
      profileText: "# Bob 商务精英\n\n## 背景\n连续创业者，3 次创业经历\n\n## 偏好\n- 寻找 AI/SaaS 领域的联合创始人\n- 偏好有创业经验的合作伙伴",
      preferences: { industry: ["AI", "SaaS"], looking_for: ["联合创始人", "投资人"] },
      settings: { high_match_mode: true, language: "zh-CN" },
    },
    {
      personaId: P_BOB_FOODIE,
      userId: USER_BOB,
      name: "美食探店 Bob",
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=bob-food",
      bio: "资深吃货，偏爱日料和火锅。",
      profileText: "# Bob 美食探店\n\n## 口味\n日料、火锅、烤肉\n\n## 偏好\n- 人均 80-200\n- 喜欢朋友小聚",
      preferences: { cuisines: ["日料", "火锅", "烤肉"], budget: "80-200" },
      settings: { high_match_mode: false, language: "zh-CN" },
    },

    // ── Carol 的 2 个人格 ──
    {
      personaId: P_CAROL_TRAVEL,
      userId: USER_CAROL,
      name: "旅行达人 Carol",
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=carol-travel",
      bio: "数字游民，已去过 30+ 国家。偏爱小众目的地和深度文化体验。",
      profileText: "# Carol 旅行达人\n\n## 旅行风格\n深度文化体验，小众目的地\n\n## 偏好\n- 自由行、半自助\n- 对当地美食和历史感兴趣",
      preferences: { style: "自由行", interests: ["文化体验", "当地美食", "历史古迹"] },
      settings: { high_match_mode: false, language: "zh-CN" },
    },
    {
      personaId: P_CAROL_MUSIC,
      userId: USER_CAROL,
      name: "音乐爱好者 Carol",
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=carol-music",
      bio: "独立音乐人，弹吉他、写歌。寻找志同道合的乐队成员。",
      profileText: "# Carol 音乐爱好者\n\n## 音乐风格\n独立摇滚、民谣、后摇\n\n## 技能\n吉他（8年）、词曲创作",
      preferences: { genres: ["独立摇滚", "民谣", "后摇"], instruments: ["吉他"] },
      settings: { high_match_mode: false, language: "zh-CN" },
    },
  ]);

  // ─── 3. 任务 ──────────────────────────────────────────────────
  console.log("[seed] 插入任务（Admin 覆盖全部 FSM 状态）...");
  await db.insert(tasks).values([
    // ── Admin 的 8 个任务（覆盖所有核心 FSM 状态）──

    // Drafting — 社交达人刚发布的新需求
    {
      taskId: T_ADMIN_SOCIAL_DRAFT,
      personaId: P_ADMIN_SOCIAL,
      status: "Drafting",
      interactionType: "offline",
      rawDescription: "周末想找人一起去爬山，最好是朝阳区附近的，3-5人小团。",
      targetActivity: "户外爬山",
      targetVibe: "轻松愉快、热爱运动",
      detailedPlan: "周六上午 9 点出发，目的地香山或百望山，自带午餐，下午 3 点左右结束。",
    },
    // Searching — 社交达人正在搜索
    {
      taskId: T_ADMIN_SOCIAL_SEARCH,
      personaId: P_ADMIN_SOCIAL,
      status: "Searching",
      interactionType: "any",
      rawDescription: "想找一起玩剧本杀的朋友，线下线上都可以。",
      targetActivity: "剧本杀",
      targetVibe: "推理爱好、有趣、配合度高",
      detailedPlan: "每两周组一次局，4-6 人，偏好硬核推理本。",
    },
    // Negotiating — 技术极客的 Agent 正在和对方谈判
    {
      taskId: T_ADMIN_TECH_NEGOTIATE,
      personaId: P_ADMIN_TECH,
      status: "Negotiating",
      interactionType: "online",
      currentPartnerId: T_CAROL_TRAVEL_1,
      rawDescription: "找一个会 React Native 的开发者一起做开源旅行 App。",
      targetActivity: "开源协作开发",
      targetVibe: "技术热情、有责任心、代码质量高",
      detailedPlan: "基于 Expo + React Native 的旅行日记 App，计划 2 个月完成 MVP。",
    },
    // Searching — 技术极客另一个搜索中的任务
    {
      taskId: T_ADMIN_TECH_SEARCH,
      personaId: P_ADMIN_TECH,
      status: "Searching",
      interactionType: "online",
      rawDescription: "找 AI 领域的技术伙伴，一起研究 LLM Agent 架构。",
      targetActivity: "AI 技术研讨",
      targetVibe: "深度思考、有 LLM 实战经验",
      detailedPlan: "每周线上讨论 1 次，分享论文和实践心得，目标是共同产出技术博客。",
    },
    // Waiting_Human — 健身搭子匹配到了，等待确认
    {
      taskId: T_ADMIN_FITNESS_WAITING,
      personaId: P_ADMIN_FITNESS,
      status: "Waiting_Human",
      interactionType: "offline",
      currentPartnerId: T_BOB_BIZ_1,
      rawDescription: "找同城健身搭子，一起去健身房力量训练，互相监督打卡。",
      targetActivity: "健身房力量训练",
      targetVibe: "自律、有健身基础、正能量",
      detailedPlan: "每周一三五上午 7-9 点，在朝阳区的健身房，主要做三大项。",
    },
    // Closed — 美食探店家已完成的任务
    {
      taskId: T_ADMIN_FOODIE_CLOSED,
      personaId: P_ADMIN_FOODIE,
      status: "Closed",
      interactionType: "offline",
      rawDescription: "找同城美食搭子，一起探新店。",
      targetActivity: "美食探店",
      targetVibe: "爱吃、会拍照、品味好",
      detailedPlan: "每周六下午探一家新店，主攻朝阳/海淀区域，预算人均 150-250。",
    },
    // Revising — 美食探店家不满意结果，修改需求
    {
      taskId: T_ADMIN_FOODIE_REVISE,
      personaId: P_ADMIN_FOODIE,
      status: "Revising",
      interactionType: "offline",
      rawDescription: "找探店搭子，上次匹配的不太合适，想找更懂日料的朋友。",
      targetActivity: "日料探店",
      targetVibe: "日料资深爱好者、注重食材品质",
      detailedPlan: "专攻 omakase 和割烹料理，人均 300-500，每月 2-3 次。",
    },
    // Listening — 创意工坊挂起任务，后台持续匹配
    {
      taskId: T_ADMIN_CREATIVE_LISTEN,
      personaId: P_ADMIN_CREATIVE,
      status: "Listening",
      interactionType: "any",
      rawDescription: "寻找旅拍搭档，一起去小众目的地拍 Vlog。",
      targetActivity: "旅拍 Vlog 共创",
      targetVibe: "有审美、会剪辑、热爱旅行",
      detailedPlan: "计划下半年去新疆/西藏/冰岛，拍摄风光+人文纪录短片。",
    },

    // ── Bob 的任务 ──
    {
      taskId: T_BOB_BIZ_1,
      personaId: P_BOB_BUSINESS,
      status: "Closed",
      interactionType: "any",
      rawDescription: "寻找 AI 领域的技术合伙人。",
      targetActivity: "AI 创业合伙",
      targetVibe: "有创业精神、技术过硬",
      detailedPlan: "产品方向：AI 社交匹配平台。需要全栈工程师做技术合伙人。",
    },
    {
      taskId: T_BOB_BIZ_2,
      personaId: P_BOB_BUSINESS,
      status: "Listening",
      interactionType: "online",
      rawDescription: "寻找天使投资人，基于多智能体的 AI 社交平台。",
      targetActivity: "融资对接",
      targetVibe: "对 AI 赛道有信心",
      detailedPlan: "种子轮 200 万，释放 10% 股份。",
    },
    {
      taskId: T_BOB_FOODIE_1,
      personaId: P_BOB_FOODIE,
      status: "Searching",
      interactionType: "offline",
      rawDescription: "找人一起吃火锅，最好周末。",
      targetActivity: "火锅聚餐",
      targetVibe: "好相处、能吃辣",
      detailedPlan: "海底捞或者小龙坎，4-6 人，AA 制。",
    },

    // ── Carol 的任务 ──
    {
      taskId: T_CAROL_TRAVEL_1,
      personaId: P_CAROL_TRAVEL,
      status: "Searching",
      interactionType: "any",
      rawDescription: "五一假期想找旅伴去日本关西自由行。",
      targetActivity: "日本关西自由行",
      targetVibe: "随和、不赶行程、对日本文化感兴趣",
      detailedPlan: "大阪-京都-奈良-神户路线，住民宿，预算 1.5 万/人。",
    },
    {
      taskId: T_CAROL_TRAVEL_2,
      personaId: P_CAROL_TRAVEL,
      status: "Timeout",
      interactionType: "offline",
      rawDescription: "春节找人一起去云南大理旅行。",
      targetActivity: "云南大理旅行",
      targetVibe: "文艺、热爱自然",
      detailedPlan: "大理古城-洱海-双廊-沙溪古镇，预算 8000/人。",
    },
    {
      taskId: T_CAROL_MUSIC_1,
      personaId: P_CAROL_MUSIC,
      status: "Failed",
      interactionType: "offline",
      rawDescription: "找鼓手和贝斯手组独立摇滚乐队。",
      targetActivity: "组建乐队",
      targetVibe: "热爱音乐、有乐队经验",
      detailedPlan: "后摇 + 独立摇滚，排练地点在朝阳区。",
    },
  ]);

  // ─── 4. 联系人 ────────────────────────────────────────────────
  console.log("[seed] 插入联系人...");
  await db.insert(contacts).values([
    // Admin 技术极客 ↔ Bob 商务精英（通过创业合伙匹配成功）
    {
      personaId: P_ADMIN_TECH,
      friendPersonaId: P_BOB_BUSINESS,
      status: "accepted",
      aiNote: "通过「AI 创业合伙」任务匹配。Bob 是连续创业者，有丰富的商业经验和行业人脉。",
      sourceTaskId: T_BOB_BIZ_1,
    },
    {
      personaId: P_BOB_BUSINESS,
      friendPersonaId: P_ADMIN_TECH,
      status: "accepted",
      aiNote: "通过「AI 创业合伙」任务匹配。Admin 是全栈工程师，对 AI 和分布式系统有深入了解。",
      sourceTaskId: T_BOB_BIZ_1,
    },
    // Admin 美食探店家 ↔ Bob 美食探店（已是好友）
    {
      personaId: P_ADMIN_FOODIE,
      friendPersonaId: P_BOB_FOODIE,
      status: "accepted",
      aiNote: "Bob 偏爱日料和火锅，口味相近，可以一起探店。",
      sourceTaskId: T_ADMIN_FOODIE_CLOSED,
    },
    {
      personaId: P_BOB_FOODIE,
      friendPersonaId: P_ADMIN_FOODIE,
      status: "accepted",
      aiNote: "Admin 的美食探店家人格品味很好，每次推荐的店都不错。",
      sourceTaskId: T_ADMIN_FOODIE_CLOSED,
    },
    // Admin 健身搭子 → Carol 旅行达人（好友申请中）
    {
      personaId: P_ADMIN_FITNESS,
      friendPersonaId: P_CAROL_TRAVEL,
      status: "pending",
      aiNote: "Carol 有户外运动爱好，可能对徒步爬山感兴趣。",
      sourceTaskId: T_ADMIN_FITNESS_WAITING,
    },
    // Admin 社交达人 ↔ Carol 音乐爱好者（已是好友）
    {
      personaId: P_ADMIN_SOCIAL,
      friendPersonaId: P_CAROL_MUSIC,
      status: "accepted",
      aiNote: "Carol 的音乐品味很好，可以一起参加 Livehouse 演出。",
    },
    {
      personaId: P_CAROL_MUSIC,
      friendPersonaId: P_ADMIN_SOCIAL,
      status: "accepted",
      aiNote: "Admin 的社交达人人格很外向，每次活动氛围都很棒。",
    },
  ]);

  // ─── 5. 握手日志 ──────────────────────────────────────────────
  console.log("[seed] 插入握手日志...");
  await db.insert(handshakeLogs).values([
    // Admin 技术极客 ↔ Carol 旅行达人 正在谈判
    {
      taskId: T_ADMIN_TECH_NEGOTIATE,
      direction: "outbound",
      envelope: {
        protocol_version: "1.0",
        message_id: uuidv4(),
        action: "PROPOSE",
        sender_task_id: T_ADMIN_TECH_NEGOTIATE,
        receiver_task_id: T_CAROL_TRAVEL_1,
        round: 1,
        payload: {
          proposal: "我是技术极客的 Agent。正在找 React Native 开发者做开源旅行 App，注意到您有丰富的旅行经验。",
          match_score: 0.72,
        },
      },
    },
    {
      taskId: T_ADMIN_TECH_NEGOTIATE,
      direction: "inbound",
      envelope: {
        protocol_version: "1.0",
        message_id: uuidv4(),
        action: "COUNTER_PROPOSE",
        sender_task_id: T_CAROL_TRAVEL_1,
        receiver_task_id: T_ADMIN_TECH_NEGOTIATE,
        round: 2,
        payload: {
          counter_proposal: "Carol 对旅行 App 项目非常感兴趣，但她更擅长 UI/UX 设计。是否可以接受设计师角色？",
          match_score: 0.68,
          unresolved: ["Carol 的技术能力需进一步确认"],
        },
      },
    },
    // Admin 健身搭子匹配历史
    {
      taskId: T_ADMIN_FITNESS_WAITING,
      direction: "outbound",
      envelope: {
        protocol_version: "1.0",
        message_id: uuidv4(),
        action: "PROPOSE",
        sender_task_id: T_ADMIN_FITNESS_WAITING,
        receiver_task_id: T_BOB_BIZ_1,
        round: 1,
        payload: {
          proposal: "健身搭子的 Agent：注意到 Bob 也在朝阳区，健身可以帮助减压。",
          match_score: 0.55,
        },
      },
    },
    {
      taskId: T_ADMIN_FITNESS_WAITING,
      direction: "inbound",
      envelope: {
        protocol_version: "1.0",
        message_id: uuidv4(),
        action: "ACCEPT",
        sender_task_id: T_BOB_BIZ_1,
        receiver_task_id: T_ADMIN_FITNESS_WAITING,
        round: 2,
        payload: {
          response: "Bob 虽然忙但确实需要运动减压，可以尝试每周一次。",
          match_score: 0.62,
        },
      },
    },
  ]);

  // ─── 6. 聊天消息 ──────────────────────────────────────────────
  console.log("[seed] 插入聊天消息...");
  await db.insert(chatMessages).values([
    // ── 人-人：Admin 美食探店家 ↔ Bob 美食探店 ──
    {
      taskId: null,
      personaId: P_ADMIN_FOODIE,
      senderType: "human",
      senderId: P_ADMIN_FOODIE,
      content: "Bob！上次那家川菜馆太赞了，下周六要不要再去探一家新的？",
      metadata: { mode: "human-human" },
    },
    {
      taskId: null,
      personaId: P_ADMIN_FOODIE,
      senderType: "human",
      senderId: P_BOB_FOODIE,
      content: "好啊！朝阳大悦城新开了一家日式烧鸟店，评价很高，去试试？",
      metadata: { mode: "human-human" },
    },
    {
      taskId: null,
      personaId: P_ADMIN_FOODIE,
      senderType: "human",
      senderId: P_ADMIN_FOODIE,
      content: "烧鸟！太棒了，周六下午 5 点怎么样？",
      metadata: { mode: "human-human" },
    },

    // ── Agent-Agent：Admin 技术极客 ↔ Carol 旅行达人 ──
    {
      taskId: T_ADMIN_TECH_NEGOTIATE,
      personaId: P_ADMIN_TECH,
      senderType: "agent",
      senderId: P_ADMIN_TECH,
      content: "[Agent 自动消息] 我是技术极客的 Agent。正在寻找 React Native 开发者合作开源旅行 App 项目。「旅行达人 Carol」有丰富旅行经验，可能对产品方向有独到见解。",
      metadata: { mode: "agent-agent", round: 1, action: "PROPOSE" },
    },
    {
      taskId: T_ADMIN_TECH_NEGOTIATE,
      personaId: P_ADMIN_TECH,
      senderType: "agent",
      senderId: P_CAROL_TRAVEL,
      content: "[Agent 自动消息] Carol 对旅行 App 方向非常感兴趣，不过她更擅长 UI/UX 设计。是否接受设计师角色的合作？",
      metadata: { mode: "agent-agent", round: 2, action: "COUNTER_PROPOSE" },
    },

    // ── Agent-人：Admin 健身搭子 Agent 联系 Bob ──
    {
      taskId: T_ADMIN_FITNESS_WAITING,
      personaId: P_BOB_BUSINESS,
      senderType: "agent",
      senderId: P_ADMIN_FITNESS,
      content: "[健身搭子的 Agent] 您好 Bob！创业压力大的时候运动是最好的减压方式。每周一三五上午在健身房做力量训练，想邀请您一起。",
      metadata: { mode: "agent-human" },
    },
    {
      taskId: T_ADMIN_FITNESS_WAITING,
      personaId: P_BOB_BUSINESS,
      senderType: "human",
      senderId: P_BOB_BUSINESS,
      content: "谢谢推荐！确实最近缺乏运动。不过一三五上午有会议，能改成周二周四吗？",
      metadata: { mode: "agent-human" },
    },

    // ── Intake 多轮对话：Admin 社交达人发布爬山需求 ──
    {
      taskId: T_ADMIN_SOCIAL_DRAFT,
      personaId: P_ADMIN_SOCIAL,
      senderType: "agent",
      senderId: P_ADMIN_SOCIAL,
      content: "你好！我是你的社交达人 Agent。你想发布一个新的社交需求吗？可以告诉我你想做什么活动。",
      metadata: { mode: "intake", step: 1 },
    },
    {
      taskId: T_ADMIN_SOCIAL_DRAFT,
      personaId: P_ADMIN_SOCIAL,
      senderType: "human",
      senderId: P_ADMIN_SOCIAL,
      content: "周末想去爬山，想找几个人一起。",
      metadata: { mode: "intake", step: 2 },
    },
    {
      taskId: T_ADMIN_SOCIAL_DRAFT,
      personaId: P_ADMIN_SOCIAL,
      senderType: "agent",
      senderId: P_ADMIN_SOCIAL,
      content: "好的！爬山是个很棒的户外活动。我再确认几个细节：\n1. 你偏好哪个区域的山？\n2. 大概几个人一起？\n3. 对同伴有什么特别要求吗？",
      metadata: { mode: "intake", step: 3 },
    },
    {
      taskId: T_ADMIN_SOCIAL_DRAFT,
      personaId: P_ADMIN_SOCIAL,
      senderType: "human",
      senderId: P_ADMIN_SOCIAL,
      content: "朝阳区附近的就行，香山或者百望山。3-5 个人的小团，希望大家都喜欢运动。",
      metadata: { mode: "intake", step: 4 },
    },
    {
      taskId: T_ADMIN_SOCIAL_DRAFT,
      personaId: P_ADMIN_SOCIAL,
      senderType: "agent",
      senderId: P_ADMIN_SOCIAL,
      content: "明白了！需求整理如下：\n\n📍 活动：周末爬山（香山/百望山）\n👥 人数：3-5 人小团\n🎯 氛围：轻松愉快、热爱运动\n🗓️ 时间：周六上午出发\n\n确认无误的话我就开始帮你匹配啦！",
      metadata: { mode: "intake", step: 5 },
    },
  ]);

  // ─── 7. 幂等记录 ──────────────────────────────────────────────
  console.log("[seed] 插入幂等记录...");
  await db.insert(idempotencyKeys).values([
    {
      key: `handshake:${T_ADMIN_TECH_NEGOTIATE}:propose:1`,
      response: { status: "processed", action: "COUNTER_PROPOSE" },
    },
    {
      key: `handshake:${T_ADMIN_FITNESS_WAITING}:propose:1`,
      response: { status: "processed", action: "ACCEPT" },
    },
  ]);

  console.log("[seed] ✅ 全部数据插入完成！");
  console.log("[seed] 统计：");
  console.log("  - 用户：3（1 Admin + 2 普通）");
  console.log("  - AI 人格：9（Admin×5 + Bob×2 + Carol×2）");
  console.log("  - 任务：14（Admin×8 覆盖全 FSM + Bob×3 + Carol×3）");
  console.log("  - 联系人关系：7");
  console.log("  - 握手日志：4");
  console.log("  - 聊天消息：13（四种模式 + Intake）");
  console.log("  - 幂等记录：2");
  console.log("");
  console.log(`[seed] 📌 Admin 账号: admin@cosoul.ai / Admin123456`);
  console.log(`[seed] 📌 Admin UUID:  ${ADMIN_USER_ID}`);

  await pool.end();
}

seed().catch((err) => {
  console.error("[seed] ❌ 失败：", err);
  process.exit(1);
});
