# Persona-Agent 开发文档

> **工程约束**：所有代码必须遵守 `vibecoding_direction.md` 铁律（async-first / Zod Schema Wall / 原子写 / CoT 隔离 / 结构化日志 / 90-180天数据保留）。

---

## 实习生必读（大白话版）

> 读完这一节就能理解整个系统。后面是给工程师和 Coding Agent 的技术细节。

### 一句话

**Cosoul.AI = AI 帮你交朋友。** 你说"我想找人周末探店"，AI 自动帮你匹配合适的人。

### 三层画像 = 三份档案

| 层级 | 文件 | 类比 | 归谁 |
|------|------|------|------|
| 用户层 | `Profile.md` | 你的生活习惯（不管哪个马甲号都一样） | 所有分身共享 |
| 分身层 | `Soul.md` | 某个马甲号的人设和匹配标准 | 每个分身独有 |
| 分身层 | `Memory.md` | 这个马甲号用了几个月积累的经验 | 每个分身独有 |

**为什么分开？** 换新分身不用重填作息（Profile 共享）；不同号有不同人设（Soul 独立）；不同号积累不同经验（Memory 独立）。

### 两层调度 = 管家 + 跑腿

```
你（真人）
  ↓
管家（Persona-Agent）← 读你的 Profile + Soul + Memory
  ├── 跑腿A ← "找人周末探店"
  ├── 跑腿B ← "找人明天打球"
  └── 跑腿C ← "约人下周看展"
```

- **管家**长期存在，了解你的喜好，负责派活和总结经验
- **跑腿**（Task-Agent）临时的，执行完就可以销毁

### 一次匹配流程

```
1. 你说"找人周末探店"
2. 管家查 Profile（周末有空）+ Soul（喜欢小众餐厅）
3. 管家派跑腿执行：L0硬筛 → L1语义搜索 → L2深度研判
4. 找到人后问你"这人怎么样？"
5. 任务结束，跑腿交报告
6. 管家从报告学习 → 更新 Memory.md
```

### 三条核心原则

1. **谁的数据谁写，跨层只读** — 管家写 Soul/Memory，跑腿只能读
2. **最小侵入** — 现有 Task-Agent 只改 3 个注入点
3. **人格即 Markdown** — 所有人设都是 .md，人能编辑，AI 原生懂

---

## 1. 架构与角色

### 角色对比

| 维度 | Persona-Agent | Task-Agent |
|------|---------------|------------|
| 生命周期 | 长期（与分身同生死） | 临时（任务结束可销毁） |
| 标识 | `persona_id` | `task_id` |
| 职责 | 画像/记忆/偏好/调度 | 匹配/谈判/握手协议 |
| 数据 | Profile(只读) + Soul + Memory (读写) | task.md + raw_chats (读写) |
| 数量 | 每用户 1~N 分身 | 每分身 0~M 并发任务 |

### 数据流方向（单向）

```
Profile → Persona : 共享只读
Persona → Task   : 注入 PersonaContext（只读快照）
Task    → Persona: 回报 task_summary → 偏好学习
```

---

## 2. 三层画像文件

### 2.1 Profile.md（用户级，`.data/Profile.md`）

所有分身共享只读。内容：生活节奏（作息/时间可用性）、社交行为模式（浏览/互动习惯）、通用禁忌。

> 完整模板见 `补充/Profile模板.md`

**边界判断**：作息/浏览习惯/通用禁忌 → Profile；兴趣/人设/deal breakers/决策准则 → Soul。

### 2.2 Soul.md（分身级，`.data/<persona_id>/Soul.md`）

原名 User.md，改名避免歧义。五段式结构（借鉴 OpenClaw SOUL.md 三段式扩展）：

| 段落 | 内容 | 谁可写 |
|------|------|--------|
| Core Identity | 身份/背景/兴趣标签 | 用户手动 |
| Preferences | 交互偏好/匹配偏好/Deal Breakers | 用户手动 |
| Values & Vibe | 价值观/气质风格/决策准则 | 用户手动 |
| History Annotations | Agent 自动追加的偏好演变记录 | Persona-Agent 自动 |

与 OpenClaw 的关键差异：Soul.md 是**活文档**，History Annotations 段会被 Agent 自动追加。

> 完整模板见 `补充/Soul模板.md`

### 2.3 Memory.md（分身级，`.data/<persona_id>/Memory.md`）

Persona-Agent 的"经验笔记本"，从多任务历史中归纳模式。包含：匹配模式总结、偏好演变日志、Token 使用统计。

**为什么归 Persona 不归 Task？** 偏好学习是跨任务的全局视野（"最近5次探店都选了小众餐厅"），不属于单个 task。

**与 task-agent memory.ts 的区别**：
- `memory.ts` = "这次对话快超 token 了，压缩一下"（短期，task-agent 完全保留不变）
- `Memory.md` = "这个人 3 个月来更喜欢日料"（长期，persona-agent 独占）

> 完整模板见 `补充/Memory模板.md`

---

## 3. 数据归属与目录

### 3.1 目录结构

```
.data/
├── Profile.md                     # 用户级·共享只读
├── logs/                          # 全局系统日志
├── sync_repair_queue.jsonl        # 全局补偿队列
│
└── <persona_id>/                  # Persona-Agent 管辖域
    ├── Soul.md                    # 分身人格（原 User.md）
    ├── Memory.md                  # 长期记忆
    ├── raw_chats_summary/         # 对话摘要归档
    │
    └── task_agents/<task_id>/     # Task-Agent 管辖域（不变）
        ├── task.md                # 任务状态机
        ├── task_summary.md        # 终态摘要（Task写→Persona读）
        └── data/                  # raw_chats/ agent_chat/ sessions.jsonl 等
```

### 3.2 读写权限

| 文件 | 用户 | Persona-Agent | Task-Agent |
|------|:---:|:---:|:---:|
| Profile.md | **读写** | 只读 | 只读 |
| Soul.md | 可编辑 | **读写** | 只读 |
| Memory.md | 可查看 | **读写** | 无权 |
| task.md | — | 只读 | **读写** |
| task_summary.md | — | 只读 | **读写** |
| scratchpad.md | — | 无权 | **读写** |

---

## 4. 模块设计

### 4.1 代码结构

```
packages/agent/src/persona-agent/
├── index.ts              # PersonaAgent 类
├── types.ts              # Zod Schema + 类型
├── profile-loader.ts     # Profile.md 只读加载
├── soul-loader.ts        # Soul.md 解析/加载/序列化
├── memory-manager.ts     # Memory.md 读写/追加/压缩
├── preference-learner.ts # 偏好学习引擎
├── task-coordinator.ts   # Task 调度 + 冲突检测
└── soul-updater.ts       # Soul.md History Annotations 自动追加
```

### 4.2 PersonaAgent 核心接口（伪代码）

```
class PersonaAgent:
  属性: personaId, profile(只读), soul, memory, preferences, activeTasks

  initialize()         → 加载 Profile + Soul + Memory，恢复未完成 task
  createTask(input)    → 组装 PersonaContext → 派生 TaskAgent
  pauseTask(taskId)    → Waiting_Human → Listening
  cancelTask(taskId)   → 任意非终态 → Cancelled
  onTaskCompleted(id, summary) → 触发偏好学习
  getSoul() / updateSoul(content) → Soul.md 读写
  shutdown()           → 持久化未落盘变更
```

### 4.3 PersonaContext — 注入给 Task-Agent 的只读快照

```typescript
interface PersonaContext {
  personaId: string;
  personaName: string;
  profileText: string;      // Profile.md — 用户习惯（共享）
  soulText: string;         // Soul.md — 分身人设
  preferences: Preferences; // 合并 Profile + Soul 的结构化偏好
  relevantMemory: string;   // Memory.md 中与本任务相关的片段
  tokenBudget: number;      // 分配给本任务的 Token 预算
}
```

### 4.4 关键模块签名（伪代码）

```
# profile-loader.ts
loadProfile() → ProfileDocument          // 从 .data/Profile.md 加载（只读）
extractProfileHints(profile) → ProfileHints  // 提取时间/禁忌等结构化数据

# soul-loader.ts
loadSoul(personaId) → SoulDocument       // 从 .data/<pid>/Soul.md 加载
saveSoul(soul) → void                    // 序列化写回（version 乐观锁）
extractPreferences(soul) → Preferences   // 提取匹配偏好供 L0 用

# memory-manager.ts
loadMemory(personaId) → MemoryDocument
appendLearning(personaId, learning) → void
compactMemory(personaId) → void          // 超 8000 字符时 LLM 摘要压缩
getL2ContextSnippet(memory) → string     // 截取核心模式段给 L2

# preference-learner.ts
learnFromTaskSummary(soul, memory, summary) → PreferenceLearning
  // 输出: { taskId, outcome, insights[], suggestedUpdates[] }

# task-coordinator.ts
spawnTaskAgent(persona, input) → TaskAgentHandle
detectConflict(activeTasks, newBody) → ConflictResult | null
allocateTokenBudget(total, count) → number
```

---

## 5. 与 Task-Agent 的协作（3 个改动点）

现有 Task-Agent 代码（`TaskAgent(待合并)/src/task_agent/`）几乎不改，只在 3 处注入：

### 改动 1：intake.ts — prompt 注入画像

```
// 原: 硬编码 EXTRACT_SYSTEM_PROMPT
// 改: buildIntakeSystemPrompt(personaContext)
//     在 system prompt 中追加 profileText + soulText + relevantMemory
//     原有提取逻辑不变
```

对应现有文件：`TaskAgent(待合并)/src/task_agent/intake.ts` 的 `EXTRACT_SYSTEM_PROMPT`

### 改动 2：dispatcher.ts — L2 研判注入

```
// 原: executeL2Sandbox(task, envelope) → readUserProfile() 读全局 User.md
// 改: executeL2Sandbox(task, envelope, personaContext)
//     从 personaContext.soulText + profileText + relevantMemory 读取
```

对应现有文件：`TaskAgent(待合并)/src/task_agent/dispatcher.ts` 的 `executeL2Sandbox()`

### 改动 3：终态回调

```
// 在状态机迁移到终态时，异步通知 persona-agent:
// if (终态) → personaAgent.onTaskCompleted(taskId, buildTaskSummary(task))
```

### 完全不改的模块

`task_loop.ts`（FSM引擎）、`memory.ts`（token管理）、`context.ts`（prompt构建）、`listener.ts`（HTTP门）、`util/schema.ts`（Zod定义）、`util/storage.ts`（防腐层）、`friend.ts`

---

## 6. 关键类型定义（Zod Schema 要点）

```typescript
// Profile 相关
ProfileDocument = { frontmatter: {user_id, version, timestamps}, sections: {lifeRhythm, socialPatterns, universalTaboos}, rawText }
ProfileHints = { availableTimeSlots?, replySpeed?, universalTaboos? }

// Soul 相关
SoulDocument = { frontmatter: {persona_id, persona_name, owner_user_id, version, timestamps}, sections: {coreIdentity, preferences, valuesAndVibe, historyAnnotations}, rawText }

// Memory 相关
MemoryDocument = { frontmatter: {persona_id, last_updated, total_tasks_completed/cancelled}, sections: {matchingPatterns, preferenceLog, tokenStats} }

// 合并偏好
Preferences = {
  availableTimeSlots?, universalTaboos?,           // ← 来自 Profile
  interaction_type_tendency, interests, deal_breakers, time_preferences?  // ← 来自 Soul
}

// 配置默认值
monthlyTokenBudget: 500_000 | defaultTaskTokenBudget: 10_000 | memoryMaxChars: 8_000 | maxConcurrentTasks: 5
```

---

## 7. API 端点

```
GET/PUT  /profile                              # 用户级画像
GET      /personas/:pid                        # 分身信息
PUT      /personas/:pid/soul                   # 编辑 Soul.md
GET      /personas/:pid/memory                 # Memory 摘要
POST     /personas/:pid/tasks                  # 创建任务（注入上下文）
GET      /personas/:pid/tasks                  # 列出任务
DELETE   /personas/:pid/tasks/:tid             # 取消任务
POST     /personas/:pid/tasks/:tid/run         # 执行一步
POST     /personas/:pid/tasks/:tid/waiting-human-intent  # 处理用户意图
```

### DB 扩展

```sql
ALTER TABLE users ADD COLUMN profile_text TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN profile_version INTEGER DEFAULT 1;
ALTER TABLE persona_profiles ADD COLUMN memory_text TEXT DEFAULT '';
ALTER TABLE persona_profiles ADD COLUMN soul_version INTEGER DEFAULT 1;
ALTER TABLE persona_profiles ADD COLUMN active_task_count INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN persona_id UUID REFERENCES personas(persona_id);
```

---

## 8. 开发阶段

| Phase | 目标 | 关键产出 |
|-------|------|----------|
| **P1 骨架** | PersonaAgent 可实例化，能加载三层画像，能创建 task | types.ts, profile-loader, soul-loader, PersonaAgent 骨架, intake.ts 改造 |
| **P2 记忆** | Memory.md 可读写，task 完成后自动偏好学习 | memory-manager, preference-learner, soul-updater, 终态回调 |
| **P3 协调** | 冲突检测、L2 增强、API 端点、DB migration | task-coordinator, dispatcher L2 改造, HTTP API, E2E 测试 |

P1 → P2 → P3 串行。P1 不依赖 task-agent 内部改动，可并行开发。

---

## 9. 与 vibecoding_direction.md 对齐

| 分歧 | vibecoding | 本文档 | 对齐方案 |
|------|-----------|--------|----------|
| 人格文件路径 | `.data/User.md`（全局） | Profile.md(用户级) + `<pid>/Soul.md`(分身级) | **采用本文档**，三层画像是核心需求 |
| Listening 状态 | FSM 未列入 | pauseTask 使用 | **补充到 vibecoding**，代码已实现 |
| 真相源 | task.md 是 SSOT | PostgreSQL 是 SSOT | **以代码为准**（PG），vibecoding 写于迁移前 |
| L1 阈值 | minScore=0.72 | 未指定 | **保留 vibecoding** |
| L2 输入 | User.md+task.md+对方报文 | PersonaContext 注入 | **兼容**，PersonaContext 是增强版 |

### storage.ts 路径改动

```
// 原: ".data/User.md" / ".data/task_agents"
// 改:
getProfilePath()                  → ".data/Profile.md"
getSoulPath(personaId)            → ".data/<pid>/Soul.md"
getMemoryPath(personaId)          → ".data/<pid>/Memory.md"
getTaskAgentsDir(personaId)       → ".data/<pid>/task_agents"
getRawChatsSummaryDir(personaId)  → ".data/<pid>/raw_chats_summary"
```

---

## 10. FAQ 速查

| 问题 | 答案 |
|------|------|
| 为什么 Task 不能写 Soul.md？ | 并发安全。多 task 同时跑会写入竞争，persona-agent 是唯一写入者 |
| Memory.md 归谁？ | Persona。偏好学习是跨任务全局视野 |
| task-agent 的 memory.ts 保留吗？ | 完全保留。它管 token 压缩（短期），和 Memory.md（长期）不同层 |
| Soul.md 会自动变吗？ | History Annotations 段自动追加，前三段只有用户手动编辑才变 |
| 只有一个分身，persona-agent 多余吗？ | 不多余。仍提供偏好学习、token 管理、多任务协调 |
| 为什么拆 User.md 为 Profile+Soul？ | 消除命名歧义；真人习惯（共享）和分身人设（独立）职责不同 |
| Profile.md 为什么在根目录？ | 跨分身共享，不属于任何单个 persona_id 文件夹 |

---

> **模板文件**：Profile / Soul / Memory 的完整示例模板见 `补充/` 文件夹。
