# Persona-Agent 开发文档

> **定位**：Persona-Agent 是用户的"AI 分身管家"，负责人格定义、长期记忆、偏好学习和 Task-Agent 调度。
> **关系**：Persona-Agent **主导** Task-Agent，后者是按需创建的"任务执行者"。
> **参考**：OpenClaw SOUL.md 人格机制 + 现有 TaskAgent FSM 架构
>
> **工程约束**：本文档中所有代码**必须遵守 `vibecoding_direction.md` 的工程铁律**，包括：
> - 异步优先（async/await，禁止阻塞调用）
> - Zod Schema Wall（SoulDocument / MemoryDocument / PersonaContext 全部过 Schema）
> - 原子写策略（Memory.md / Soul.md / Profile.md 的写入走 version 乐观锁 + pending_sync 两阶段写）
> - CoT 隔离（persona-agent 的偏好学习中间过程不出网）
> - 可观测性（所有关键操作带 trace_id / task_id / latency_ms 结构化日志）
> - 安全隐私（Memory.md 中的用户偏好数据遵守 90/180 天保留策略）

---

## 汇总更新简介（实习生必读）

> **阅读这一节就够了**——下面用大白话解释整个系统"是什么、为什么、怎么运作"。后续章节是给工程师和 Coding Agent 看的详细设计。

### 一句话版本

**Cosoul.AI 是一个"AI 帮你交朋友"的系统。** 你告诉 AI"我想找人周末探店"，AI 就会自动帮你匹配合适的人。

### 三层画像：现实生活中的类比

想象你在现实生活中：

| 层级 | 文件名 | 现实类比 | 谁拥有 | 例子 |
|------|--------|----------|--------|------|
| **用户层** | `Profile.md` | **你这个人的生活习惯**——不管你用哪个马甲号，你的作息、浏览习惯都是一样的 | 所有分身共享（只读） | "早起型，通勤时刷帖，晚 7 点后可社交" |
| **分身层** | `Soul.md` | **你的某个社交马甲的人设**——比如"探店达人小王"这个号的性格、偏好、禁忌 | 每个分身独有 | "喜欢小众日料，不接受迟到30分钟的人" |
| **分身层** | `Memory.md` | **这个马甲号的使用经验**——用了几个月后，AI 知道你用这个号更喜欢什么 | 每个分身独有 | "最近 5 次探店都选了小众餐厅" |

**为什么要分开？**

- **Profile.md**（用户级）：你换了一个新分身号也不用重新告诉 AI "我晚上 7 点后有空"——这些习惯自动共享
- **Soul.md**（分身级）：不同号有不同人设——"探店达人"和"运动搭子"的匹配标准完全不同
- **Memory.md**（分身级）：不同号积累不同的经验——"探店达人"知道你喜欢日料，"运动搭子"知道你偏好羽毛球

### 两层调度：管家和跑腿

```
你（真人）
  │
  ▼
Persona-Agent（管家）← 读你的 Profile.md + Soul.md + Memory.md
  │                    帮你做决策、管记忆、分配资源
  │
  ├── Task-Agent #1（跑腿 A）← "帮我找人周末探店"
  ├── Task-Agent #2（跑腿 B）← "帮我找人明天打球"
  └── Task-Agent #3（跑腿 C）← "帮我约人下周看展"
```

- **管家**（Persona-Agent）：长期存在，了解你的喜好，负责"派活"和"总结经验"
- **跑腿**（Task-Agent）：临时的，接到一个任务就去执行（搜索、匹配、谈判），做完就可以销毁

### 一次完整的匹配流程（简化版）

```
1. 你说："我想找人周末去探店"
2. 管家查看你的 Profile.md（"周末全天有空"）+ Soul.md（"喜欢小众餐厅"）
3. 管家派出一个跑腿去执行
4. 跑腿先用硬条件筛选（L0）→ 再用 AI 语义搜索（L1）→ 最后 AI 深度研判（L2）
5. 找到匹配的人后，跑腿问你："这个人怎么样？"
6. 你说"不错"或"换一个"
7. 任务结束后，跑腿交出总结报告
8. 管家从报告中学习：更新 Memory.md（"原来你更喜欢日式料理"）
```

### 数据在哪里

```
.data/
├── Profile.md                     ← 用户级，所有分身共享
├── logs/                          ← 全局系统日志
├── sync_repair_queue.jsonl        ← 全局修复队列
│
└── <分身ID>/                      ← 每个分身一个文件夹
    ├── Soul.md                    ← 这个分身的人设
    ├── Memory.md                  ← 这个分身的经验
    ├── raw_chats_summary/         ← 对话摘要归档
    └── task_agents/<任务ID>/      ← 每个任务的工作目录
        ├── task.md                ← 任务状态
        └── data/                  ← 对话记录、握手日志等
```

### 核心原则（记住这三条就行）

1. **谁的数据谁写，跨层只读** —— 管家写 Soul.md/Memory.md，跑腿只能读；跑腿写 task.md，管家只能读
2. **最小侵入** —— 现有的 Task-Agent 代码几乎不改，只在 3 个点注入 persona 上下文
3. **人格即 Markdown** —— 所有人设都是 .md 文件，人类能直接编辑，AI 原生就懂

> **以上就是全部核心概念。** 如果你要开始写代码，请继续阅读下面的详细设计。

---

## 目录

1. [架构总览](#1-架构总览)
2. [核心设计原则](#2-核心设计原则)
3. [三层画像文件体系](#3-三层画像文件体系)
4. [记忆归属与分层所有权](#4-记忆归属与分层所有权)
5. [Persona-Agent 模块设计](#5-persona-agent-模块设计)
6. [与 Task-Agent 的协作协议](#6-与-task-agent-的协作协议)
7. [数据流全景图](#7-数据流全景图)
8. [接口定义](#8-接口定义)
9. [文件目录结构](#9-文件目录结构)
10. [开发阶段规划](#10-开发阶段规划)
11. [FAQ：设计抉择记录](#11-faq设计抉择记录)

---

## 1. 架构总览

### 1.1 两层调度模型

```
用户（真人）
  │
  ▼
┌──────────────────────────────────────────────────────┐
│  Persona-Agent（管家层 — 长期运行，per persona）         │
│                                                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │Profile.md│  │ Soul.md  │  │Memory.md │            │
│  │(用户习惯) │  │(分身人格) │  │(长期记忆) │            │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘            │
│       │(共享只读)     │(本分身)      │(本分身)           │
│       ▼              ▼              ▼                  │
│  ┌──────────────────────────────────────────────┐     │
│  │         PersonaAgent 核心引擎                  │     │
│  │  - 三层画像加载/更新                           │     │
│  │  - 偏好学习（从 task 历史归纳）                 │     │
│  │  - Task 生命周期管理（创建/暂停/终止）           │     │
│  │  - 跨任务协调（冲突检测/优先级）                 │     │
│  │  - Token 预算全局分配                          │     │
│  └──────────────┬─────────────────────────────┘     │
│                 │                                      │
│    ┌────────────┼────────────┐                        │
│    ▼            ▼            ▼                        │
│ ┌──────┐  ┌──────┐    ┌──────┐                       │
│ │Task-1│  │Task-2│    │Task-N│  ← 按需创建/销毁       │
│ │Agent │  │Agent │    │Agent │                        │
│ └──────┘  └──────┘    └──────┘                       │
│   FSM       FSM         FSM                           │
│  L0/L1/L2  L0/L1/L2   L0/L1/L2                       │
│  握手协议   握手协议    握手协议                          │
└──────────────────────────────────────────────────────┘
```

### 1.2 核心角色对比

| 维度 | Persona-Agent | Task-Agent |
|------|---------------|------------|
| **生命周期** | 长期存在（与 persona 同生命周期） | 临时（按任务创建，终态后可销毁） |
| **身份标识** | `persona_id`（稳定） | `task_id`（临时） |
| **职责** | 画像、记忆、偏好、调度 | 匹配、谈判、握手协议 |
| **数据读写** | Profile.md（只读）+ Soul.md + Memory.md（读写）| task.md + raw_chats（读写）|
| **对外表现** | 用户的 AI 分身代言人 | 某次任务的执行单元 |
| **数量** | 每用户 1~N 个分身 | 每分身 0~M 个并发任务 |

---

## 2. 核心设计原则

### 2.1 人格即 Markdown

参考 OpenClaw SOUL.md 理念：**Agent 的人格由 Markdown 文件定义，每次启动时"读出自己的灵魂"**。

优势：
- **人类可读可编辑**：用户可以直接修改自己的分身人格
- **Git 友好**：版本控制，可追溯演变
- **LLM 原生**：Markdown 是 LLM 最擅长理解的格式
- **零依赖**：不需要特殊的序列化/反序列化框架

### 2.2 三层画像分离

**用户级别和分身级别的画像必须分开。**

```
Profile.md（用户级，共享只读）
  → 真人的生活习惯、作息、浏览行为模式、通用禁忌
  → 换了新分身也不用重新填

Soul.md（分身级，每分身独有）
  → AI 分身的人设、匹配偏好、决策准则、deal breakers
  → 不同分身有不同的 Soul

Memory.md（分身级，每分身独有）
  → AI 从历史任务中学到的模式和教训
  → 不同分身积累不同的经验
```

**判断一条信息该放哪里的方法**：
- "所有分身都一样吗？" → 是 → Profile.md
- "不同分身不一样吗？" → 是 → Soul.md（静态人设）或 Memory.md（动态学习）

### 2.3 分层所有权

**核心规则：谁的数据谁写，跨层只读。**

```
用户级（所有分身共享）：
└── Profile.md        → 用户本人或系统自动采集（只有用户层可写）

Persona-Agent 所有物（长期，跨任务）：
├── Soul.md           → 分身人格定义（只有 persona-agent 可写）
├── Memory.md         → 长期记忆（只有 persona-agent 可写）
└── preferences       → 结构化偏好（只有 persona-agent 可写）

Task-Agent 所有物（临时，per task）：
├── task.md           → 任务状态机文档
├── raw_chats/        → 原始对话流水
├── agent_chat/       → 握手协议日志
└── scratchpad.md     → L2 研判笔记
```

**跨层数据流方向**（单向）：
```
profile → persona : 共享只读（persona 启动时加载）
persona → task    : 注入（只读上下文）
task    → persona : 回报（task_summary → 偏好学习）
```

### 2.4 最小侵入

对现有 task-agent 的改动最小化：
- task-agent 的 FSM、dispatcher、handshake 逻辑**不变**
- 只在 task-agent 创建时**注入** persona 上下文（Profile.md + Soul.md + preferences）
- 只在 task 终态时**回调** persona-agent 做偏好学习

---

## 3. 三层画像文件体系

### 3.1 Profile.md — 用户级画像（所有分身共享）

Profile.md 是真人用户的生活习惯画像，**所有分身共享只读**，不包含任何分身特有的人设信息。

```markdown
---
user_id: "U-xxxxxxxx"
created_at: "2026-03-11T10:00:00Z"
updated_at: "2026-03-11T10:00:00Z"
version: 3
---

# 生活节奏

## 作息
- 早起型：6:00 起床，晨跑 30 分钟
- 睡眠：通常 23:30-24:00 入睡

## 时间可用性
- 工作日：晚间 19:00 后可社交
- 周末：全天灵活，通常上午较懒
- 节假日：视安排而定

---

# 社交行为模式

## 浏览习惯
- 刷帖高峰：通勤时段（8:00-9:00）和睡前（23:00-23:30）
- 平均浏览时长：每次 10-15 分钟

## 互动习惯
- 评论风格：偏幽默随意
- 回复速度：工作时间慢（小时级），非工作时间快（分钟级）

---

# 通用禁忌（所有分身共享）

- 不公开真实姓名、公司、住址
- 拒绝任何形式的金融推销
- 不参与 PUA / 两性话题争论
```

**Profile.md 的来源**：
- 用户首次使用时主动填写（可选）
- 系统从多个分身的使用行为中自动归纳（需用户确认）
- 用户可随时手动编辑

**Profile.md 与 Soul.md 的边界**：

| 信息类型 | Profile.md | Soul.md |
|----------|:---:|:---:|
| 作息时间、可用时段 | ✅ | ❌ |
| 浏览/回复习惯 | ✅ | ❌ |
| 通用禁忌（真名、住址） | ✅ | ❌ |
| 分身人设（兴趣、性格） | ❌ | ✅ |
| 匹配偏好（deal breakers） | ❌ | ✅ |
| 决策准则 | ❌ | ✅ |
| 价值观与气质 | ❌ | ✅ |

### 3.2 Soul.md — 分身人格文件（借鉴 SOUL.md）

Soul.md 是每个分身的核心身份文件（原名 User.md，为避免与"用户画像"混淆而改名）。参考 OpenClaw SOUL.md 的三段式结构，扩展为五段式以适配社交匹配场景。

```markdown
---
persona_id: "P-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
persona_name: "探店达人小王"
owner_user_id: "U-xxxxxxxx"
created_at: "2026-03-11T10:00:00Z"
updated_at: "2026-03-11T10:00:00Z"
version: 1
---

# Core Identity（核心身份）

我是一个热爱探索城市美食和新鲜体验的年轻人。
喜欢和有趣的人一起发现隐藏的好店，享受边吃边聊的快乐。

## 背景
- 北京，25 岁，互联网从业者
- 周末喜欢到处逛，工作日偶尔约饭

## 兴趣标签
- 美食探店、咖啡品鉴、城市漫步
- 摄影记录、分享生活

---

# Preferences（偏好与约束）

## 交互偏好
- 互动方式倾向：线下为主，线上聊天也可以
- 沟通风格：轻松随和，不喜欢太正式

## 匹配偏好
- 希望对方也喜欢尝新、愿意走出舒适区
- 不限人数，1 对 1 或小群都可以

## Deal Breakers（绝对禁区）
- 传销、诈骗、任何形式的骚扰
- 迟到超过 30 分钟不打招呼的
- 只想推销产品/服务的

---

# Values & Vibe（价值观与气质）

## 核心价值观
- 真实 > 包装：更看重真诚交流，不在意社交地位
- 体验 > 结果：享受过程比达到目标更重要
- 尊重边界：不强迫，不道德绑架

## 气质风格
- 友善但有主见
- 幽默但不刻薄
- 随性但守时

## 决策准则
在 Agent 代我做匹配决策时：
1. 优先看对方的活动描述是否有趣、具体
2. 其次看氛围描述是否和我 vibe 合得来
3. 模糊的、敷衍的描述扣分

---

# History Annotations（历史批注 — 由 Agent 自动维护）

> 以下内容由 Persona-Agent 在偏好学习后自动追加，用户也可手动编辑。

- [2026-03-10] 完成了 3 次探店任务，发现更偏好小众日料店
- [2026-03-08] 匹配到一个摄影爱好者，体验很好，增加"摄影"权重
```

### 3.3 Soul.md 与 OpenClaw SOUL.md 的对照

| OpenClaw SOUL.md | Cosoul.AI Soul.md | 说明 |
|-----------------|-------------------|------|
| Core Truths | Core Identity | 身份/背景/核心信条 |
| Boundaries | Preferences.Deal Breakers | 边界与禁区 |
| The Vibe | Values & Vibe | 气质风格与交流调性 |
| （无） | Preferences | 扩展：匹配偏好、交互偏好 |
| （无） | History Annotations | 扩展：Agent 自动追加的偏好演变记录 |

**关键差异**：OpenClaw SOUL.md 是静态的人格定义；Cosoul.AI 的 Soul.md 是**活文档**——Persona-Agent 会根据任务历史自动追加 History Annotations，使人格随时间演化。

### 3.4 Memory.md — 长期记忆文件

Memory.md 是 Persona-Agent 独有的"经验笔记本"，从多个 task 的历史中归纳出的模式和教训。

```markdown
---
persona_id: "P-xxxxxxxx"
last_updated: "2026-03-11T10:00:00Z"
total_tasks_completed: 12
total_tasks_cancelled: 3
---

# 匹配模式总结

## 高满意度模式
- 对方描述具体（如"周六下午三里屯日料探店"比"找人吃饭"好得多）
- 双方 interaction_type 一致时匹配成功率 > 80%
- L2 谈判中，对方有明确 targetVibe 的，最终满意度更高

## 低满意度模式
- 纯"any"类型的任务匹配质量较差
- 对方 detailedPlan 为空的，后续取消率高

# 偏好演变日志

## 2026-03-10
- 从任务 T-abc123 学到：用户更喜欢小众日料，而非网红店
- 调整建议：L2 研判时对"小众""隐藏"等关键词加权

## 2026-03-08
- 从任务 T-def456 学到：用户对"摄影+探店"组合很感兴趣
- 新增兴趣标签建议：摄影探店

# Token 使用统计

| 月份 | 总 Token | Intake | L2 研判 | Memory Flush |
|------|---------|--------|---------|-------------|
| 2026-03 | 45,200 | 12,000 | 28,000 | 5,200 |
| 2026-02 | 38,100 | 10,500 | 22,600 | 5,000 |
```

### 3.5 为什么 Memory.md 归 Persona-Agent 而非 Task-Agent？

| 方案 | 优点 | 缺点 |
|------|------|------|
| **A: task-agent 各自持有 memory** | 隔离性好 | 跨任务知识无法复用；10 个 task 重复学习同样的偏好 |
| **B: persona-agent 统一持有 memory** (推荐) | 跨任务知识共享；偏好演化有全局视野 | 需要回调机制 |
| **C: 两层都有 memory** | 灵活 | 复杂度高，一致性难保证 |

**选择方案 B 的核心理由**：

1. **task-agent 的 memory.ts 已有对话归档机制**（`flushMemoryIfNeeded`），这个是 task 级别的 token 管理，保持不变
2. **跨任务的偏好学习是 persona 层的职责**，不应该分散到每个 task 里
3. **Soul.md 的更新权**只属于 persona-agent，如果 task-agent 也能写 memory 并影响 Soul.md，会产生并发写入冲突

**实际执行流**：
```
task-agent（任务结束） → 产出 task_summary.md
                          ↓
persona-agent（偏好学习） → 读取 task_summary
                          ↓
                     更新 Memory.md（追加模式/教训）
                          ↓
                     可选：更新 Soul.md（History Annotations）
```

---

## 4. 记忆归属与分层所有权

### 4.1 完整的数据归属矩阵

```
.data/
├── Profile.md                          # [用户级·共享只读] 用户生活习惯画像
├── logs/                               # [全局] 系统日志
├── sync_repair_queue.jsonl             # [全局] 派生层修复队列
│
└── <persona_id>/                       # ── Persona-Agent 管辖域 ──
    ├── Soul.md                         # [Persona 独占·读写] 分身人格文件
    ├── Memory.md                       # [Persona 独占·读写] 长期记忆
    ├── raw_chats_summary/              # [Persona 独占·读写] 全局对话摘要（参与 Embedding/RAG）
    │   └── YYYY-MM-DD-summary.md
    ├── logs/                           # [Persona 独占·读写] 分身级操作日志
    │
    └── task_agents/<task_id>/          # ── Task-Agent 管辖域 ──
        ├── task.md                     # [Task 独占·读写] 任务状态机文档（SSOT）
        ├── task_summary.md             # [Task 写 → Persona 读] 任务结束摘要
        └── data/
            ├── daily_log/              # [Task 独占·读写] 操作日志
            ├── raw_chats/              # [Task 独占·读写] 原始对话快照（保留 90 天）
            ├── agent_chat/             # [Task 独占·读写] 握手协议日志
            │   ├── *.jsonl             # 握手收发记录
            │   └── scratchpad.md       # L2 研判笔记（绝不外发）
            ├── agent_chat_summary/     # [Task 独占·读写] 握手摘要
            └── sessions.jsonl          # [Task 独占·读写] 谈判会话记录
```

### 4.2 读写权限表

| 文件/目录 | 用户层 | Persona-Agent | Task-Agent | 说明 |
|-----------|:---:|:---:|:---:|------|
| Profile.md | **读写** | **只读** | **只读** | 用户级画像，所有分身共享 |
| Soul.md | 可编辑 | **读写** | **只读** | 分身人格，task 创建时注入 |
| Memory.md | 可查看 | **读写** | **无权** | 长期记忆，task 看不到 |
| raw_chats_summary/ | 无权 | **读写** | **无权** | 全局摘要归档 |
| task.md | 无权 | 只读 | **读写** | 任务状态机，persona 可查看但不修改 |
| task_summary.md | 无权 | **只读** | **读写** | task 产出的摘要，persona 用于偏好学习 |
| raw_chats/ | 无权 | 无权 | **读写** | 原始对话，persona 不直接访问 |
| scratchpad.md | 无权 | 无权 | **读写** | L2 研判笔记，严格隔离 |

### 4.3 Task-Agent 现有 memory 机制的保留

现有 task-agent 的 `memory.ts` + `context.ts` 是**任务内的 Token 管理机制**：
- `flushMemoryIfNeeded()` — 对话 token 达 80% 阈值时归档到 `raw_chats/`
- `truncateTurnsByBudget()` — 在预算内裁剪对话
- `buildPromptContext()` — 构建 LLM 调用的 prompt

**这套机制完全保留，不变。** 它解决的是"单次任务内的对话不要爆仓"，和 persona 层的"跨任务长期记忆"是不同层面的问题。

```
Persona-Agent 的 Memory.md  =  "这个人 3 个月来更喜欢日料"（长期模式）
Task-Agent 的 memory.ts     =  "这次对话快超 token 了，压缩一下"（短期管理）
```

---

## 5. Persona-Agent 模块设计

### 5.1 模块清单

```
packages/agent/src/persona-agent/
├── index.ts                         # PersonaAgent 类 + 统一导出
├── profile-loader.ts                # Profile.md 解析/加载（只读）
├── soul-loader.ts                   # Soul.md 解析/加载/序列化
├── memory-manager.ts                # Memory.md 管理（读写/追加/归纳）
├── preference-learner.ts            # 偏好学习引擎（从 task_summary 提取模式）
├── task-coordinator.ts              # Task-Agent 生命周期管理 + 跨任务协调
├── soul-updater.ts                  # Soul.md 自动演化（History Annotations）
└── types.ts                         # Persona 相关类型定义
```

### 5.2 核心类：PersonaAgent

```typescript
/**
 * PersonaAgent — 用户 AI 分身的管家实例。
 *
 * 职责：
 * 1. 加载并维护三层画像文件（Profile.md + Soul.md + Memory.md）
 * 2. 创建/监控/协调 Task-Agent 实例
 * 3. 从已完成的 task 中学习偏好，更新长期记忆
 * 4. 全局 Token 预算分配
 *
 * 生命周期：与 persona 同生同灭。
 */
export class PersonaAgent {
  readonly personaId: string;

  // ── 用户级画像（共享只读）──
  private profile: ProfileDocument;     // Profile.md 的结构化表示

  // ── 分身级画像（本分身独有）──
  private soul: SoulDocument;           // Soul.md 的结构化表示
  private memory: MemoryDocument;       // Memory.md 的结构化表示
  private preferences: Preferences;     // 结构化偏好（合并 Profile + Soul）

  // ── 任务管理 ──
  private activeTasks: Map<string, TaskAgentHandle>;
  private taskHistory: TaskSummary[];   // 已完成任务的摘要缓存

  // ── 配置 ──
  private config: PersonaAgentConfig;

  constructor(personaId: string, config?: Partial<PersonaAgentConfig>);

  /** 启动：加载 Profile.md + Soul.md + Memory.md，恢复未完成的 task */
  async initialize(): Promise<void>;

  /** 创建新任务：注入三层画像上下文，返回 task-agent 句柄 */
  async createTask(userInput: string): Promise<TaskAgentHandle>;

  /** 暂停指定任务（Waiting_Human → Listening） */
  async pauseTask(taskId: string): Promise<void>;

  /** 终止指定任务（任意非终态 → Cancelled） */
  async cancelTask(taskId: string): Promise<void>;

  /** 任务完成回调：触发偏好学习 */
  async onTaskCompleted(taskId: string, summary: TaskSummary): Promise<void>;

  /** 获取当前所有活跃任务状态 */
  async listActiveTasks(): Promise<TaskStatusBrief[]>;

  /** 获取 Soul.md 内容（供前端展示/编辑） */
  async getSoul(): Promise<SoulDocument>;

  /** 用户手动编辑 Soul.md 后的更新入口 */
  async updateSoul(newContent: string): Promise<void>;

  /** 获取 Memory.md 摘要 */
  async getMemorySummary(): Promise<string>;

  /** 关闭：持久化所有未落盘的变更 */
  async shutdown(): Promise<void>;
}
```

### 5.3 ProfileLoader — Profile.md 加载器（只读）

```typescript
/**
 * 负责 Profile.md 文件的解析和加载。
 *
 * Profile.md 是用户级画像，所有分身共享只读。
 * Persona-Agent 只能读取，不能修改（修改权归用户层）。
 *
 * 文件位置：.data/Profile.md（全局唯一）
 */

/** 加载 Profile.md → ProfileDocument（只读） */
export async function loadProfile(): Promise<ProfileDocument>;

/** 解析 Profile.md 文本 → ProfileDocument（纯函数，无 I/O） */
export function parseProfileText(text: string): ProfileDocument;

/** 从 Profile 中提取时间可用性等结构化数据（供 L0 过滤和 intake 引导用） */
export function extractProfileHints(profile: ProfileDocument): ProfileHints;
```

### 5.4 SoulLoader — Soul.md 解析器

```typescript
/**
 * 负责 Soul.md 文件的解析、加载和序列化。
 *
 * Soul.md 格式约定：
 * - YAML frontmatter（---包围）：persona_id, persona_name, version 等元数据
 * - Markdown body：五段式结构（Core Identity / Preferences / Values & Vibe /
 *   History Annotations）
 *
 * 设计参考：OpenClaw SOUL.md 的"每次启动读出灵魂"理念。
 *
 * 文件位置：.data/<persona_id>/Soul.md
 */

/** 从文件路径加载 Soul.md → SoulDocument */
export async function loadSoul(personaId: string): Promise<SoulDocument>;

/** 将 SoulDocument 序列化回 Soul.md 格式并落盘 */
export async function saveSoul(soul: SoulDocument): Promise<void>;

/** 解析 Soul.md 文本 → SoulDocument（纯函数，无 I/O） */
export function parseSoulText(text: string): SoulDocument;

/** 序列化 SoulDocument → Soul.md 文本（纯函数，无 I/O） */
export function serializeSoulText(soul: SoulDocument): string;

/** 从 SoulDocument 中提取结构化 Preferences（供 L0 过滤用） */
export function extractPreferences(soul: SoulDocument): Preferences;
```

### 5.5 MemoryManager — 长期记忆管理

```typescript
/**
 * Memory.md 的读写管理器。
 *
 * 职责：
 * - 追加新的偏好学习记录（append-only 日志段）
 * - 定期归纳压缩（当日志段 > 阈值时，调 LLM 做摘要合并）
 * - 维护 Token 使用统计
 *
 * 设计约束：
 * - Memory.md 大小限制：≤ 8000 字符（约 2000 tokens）
 * - 超限时触发归纳压缩（保留高价值模式，丢弃细节）
 */

/** 加载 Memory.md */
export async function loadMemory(personaId: string): Promise<MemoryDocument>;

/** 追加一条偏好学习记录（不触发压缩） */
export async function appendLearning(
  personaId: string,
  learning: PreferenceLearning
): Promise<void>;

/** 归纳压缩（当内容 > 阈值时，用 LLM 做摘要合并） */
export async function compactMemory(personaId: string): Promise<void>;

/** 获取用于 L2 研判的上下文摘要（截取核心模式段） */
export function getL2ContextSnippet(memory: MemoryDocument): string;
```

### 5.6 PreferenceLearner — 偏好学习引擎

```typescript
/**
 * 从已完成 Task 的 task_summary.md 中提取偏好模式。
 *
 * 工作流：
 * 1. task-agent 终态时产出 task_summary.md
 * 2. persona-agent.onTaskCompleted() 调用本模块
 * 3. 分析 summary → 提取 learnings → 追加到 Memory.md
 * 4. 可选：更新 Soul.md 的 History Annotations
 *
 * 学习维度：
 * - 匹配满意度（satisfied / unsatisfied / cancelled）
 * - 活动类型偏好（哪类活动用户更满意）
 * - 时间/地点模式
 * - L2 研判准确率回顾
 */

export interface PreferenceLearning {
  taskId: string;
  timestamp: string;
  outcome: "satisfied" | "unsatisfied" | "cancelled" | "timeout";
  insights: string[];          // LLM 提取的偏好洞察
  suggestedUpdates: string[];  // 对 Soul.md 的更新建议
}

/** 从 task_summary 提取偏好学习记录 */
export async function learnFromTaskSummary(
  soul: SoulDocument,
  memory: MemoryDocument,
  summary: TaskSummary
): Promise<PreferenceLearning>;
```

### 5.7 TaskCoordinator — 任务调度与协调

```typescript
/**
 * 管理 Task-Agent 的生命周期，实现跨任务协调。
 *
 * 核心职责：
 * 1. 创建 task-agent 时注入三层画像上下文
 * 2. 监控活跃任务状态，响应状态变更事件
 * 3. 跨任务冲突检测（如：已有类似任务在跑）
 * 4. 全局 Token 预算分配
 */

/** 注入给 task-agent 的人格上下文（只读快照） */
export interface PersonaContext {
  personaId: string;
  personaName: string;
  // ── 用户级（所有分身共享）──
  /** Profile.md 全文 — 真人的生活习惯 */
  profileText: string;
  // ── 分身级（本分身独有）──
  /** Soul.md 全文 — 分身的人设和匹配偏好 */
  soulText: string;
  /** 结构化偏好（合并 Profile + Soul，task-agent 的 L0 阶段读取） */
  preferences: Preferences;
  /** 长期记忆中与本次任务相关的片段 */
  relevantMemory: string;
  /** 分配给本任务的 Token 预算 */
  tokenBudget: number;
}

/** 创建 task-agent 并注入三层画像上下文 */
export async function spawnTaskAgent(
  personaAgent: PersonaAgent,
  userInput: string
): Promise<TaskAgentHandle>;

/** 检测是否存在与新需求冲突/重复的活跃任务 */
export async function detectConflict(
  activeTasks: TaskAgentHandle[],
  newTaskBody: TaskBody
): Promise<ConflictResult | null>;

/** 全局 Token 预算分配（按活跃任务数均分或加权） */
export function allocateTokenBudget(
  totalBudget: number,
  activeTaskCount: number
): number;
```

---

## 6. 与 Task-Agent 的协作协议

### 6.1 创建任务时的注入

当用户发起新任务时，persona-agent 负责组装上下文并传递给 task-agent：

```
用户："我想找人周末去探店"
     │
     ▼
PersonaAgent.createTask(userInput)
     │
     ├── 1. 加载 Profile.md → 提取时间可用性、通用禁忌
     ├── 2. 加载 Soul.md → 提取交互偏好、deal breakers
     ├── 3. 加载 Memory.md → 检索与"探店"相关的历史偏好
     ├── 4. 检测冲突 → 是否已有类似任务在跑
     ├── 5. 分配 Token 预算
     ├── 6. 组装 PersonaContext（只读快照，含 profileText + soulText）
     │
     └── 7. TaskAgent.create(userInput, personaContext)
              │
              ├── intake.ts 读取 personaContext.profileText + soulText
              │   → 引导对话时参考用户习惯和分身偏好
              ├── dispatcher L0 读取 personaContext.preferences
              │   → 硬过滤参数注入（含 Profile 的时间可用性）
              └── dispatcher L2 读取 personaContext.soulText + relevantMemory
                  → 研判决策参考
```

### 6.2 对现有 task-agent 的最小改动

**改动点 1：intake.ts — 注入三层画像上下文**

```typescript
// 改动前：直接问用户
const EXTRACT_SYSTEM_PROMPT = `你是一个社交匹配需求分析助手...`;

// 改动后：在 system prompt 中注入三层画像上下文
function buildIntakeSystemPrompt(personaContext: PersonaContext): string {
  return `你是一个社交匹配需求分析助手。

## 用户习惯（Profile — 参考，不要向用户复述）
${personaContext.profileText}

## 当前分身画像（Soul — 参考，不要向用户复述）
${personaContext.soulText}

## 历史偏好参考
${personaContext.relevantMemory}

请根据对话历史，提取以下字段...（原有 prompt 不变）`;
}
```

**改动点 2：dispatcher.ts — L2 研判注入**

```typescript
// 改动前：
export async function executeL2Sandbox(task, envelope): Promise<L2Decision> {
  const userProfile = await readUserProfile(); // 读全局 User.md
  ...
}

// 改动后：从 task 的 personaContext 中读取（避免全局路径依赖）
export async function executeL2Sandbox(
  task: TaskDocument,
  envelope: HandshakeInboundEnvelope,
  personaContext: PersonaContext     // ← 新增参数
): Promise<L2Decision> {
  const userProfile = personaContext.soulText;        // 分身人设
  const profileHints = personaContext.profileText;    // 用户习惯
  const memoryHints = personaContext.relevantMemory;  // 长期记忆
  ...
}
```

**改动点 3：task 终态回调**

```typescript
// 在 transitionTaskStatus 中增加终态钩子
if (TERMINAL_STATUSES.includes(nextStatus)) {
  // 异步通知 persona-agent，不阻塞状态迁移
  personaAgent.onTaskCompleted(taskId, buildTaskSummary(task));
}
```

### 6.3 task-agent 无需改动的部分

以下模块**完全保留**，不做任何修改：

| 模块 | 保留理由 |
|------|----------|
| `task_loop.ts` | FSM 引擎逻辑通用，只是增加了 personaContext 传递 |
| `memory.ts` | 任务内 token 管理机制不变，和 persona 的 Memory.md 是不同层面 |
| `context.ts` | Prompt 构建 + token 裁剪逻辑不变 |
| `listener.ts` | HTTP 网络门不变，只需在 API 层传递 personaId |
| `util/schema.ts` | Zod 定义不变，PersonaContext 是新增类型 |
| `util/storage.ts` | 防腐层不变，persona 的存储另建 |
| `friend.ts` | 占位实现不变 |

---

## 7. 数据流全景图

```
┌──────────────────────────────────────────────────────────────────┐
│                        用户交互层                                 │
│   前端 UI（Web / Native）                                        │
│   "我想找人周末去探店" ──→ POST /personas/:id/tasks               │
└──────────────────┬───────────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────────┐
│  Persona-Agent 管家层                                            │
│                                                                   │
│  ┌─ initialize() ──────────────────┐                             │
│  │ 加载 Profile.md（用户级·只读）   │ ←─── .data/Profile.md       │
│  │ 加载 Soul.md（分身级）          │ ←─── .data/<pid>/Soul.md     │
│  │ 加载 Memory.md（分身级）        │ ←─── .data/<pid>/Memory.md   │
│  └─────────────────────────────────┘                             │
│           │                                                       │
│  ┌─ createTask() ─────────────────────────────────┐              │
│  │ 1. detectConflict() → 检查重复任务              │              │
│  │ 2. extractProfileHints() → 用户时间/禁忌        │              │
│  │ 3. extractPreferences() → 分身匹配偏好          │              │
│  │ 4. getL2ContextSnippet() → 相关记忆片段         │              │
│  │ 5. allocateTokenBudget() → 分配预算             │              │
│  │ 6. 组装 PersonaContext（只读快照）              │              │
│  └──────────┬─────────────────────────────────────┘              │
│             │                                                     │
│             ▼ spawnTaskAgent(personaContext)                       │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Task-Agent 执行层（与现有 FSM 一致）                        │  │
│  │                                                              │  │
│  │  intake.ts ──→ 读取 profileText + soulText 引导对话          │  │
│  │      ↓                                                       │  │
│  │  Drafting → Searching                                        │  │
│  │      ↓         ↓                                             │  │
│  │  dispatcher L0 ← personaContext.preferences                  │  │
│  │      ↓                                                       │  │
│  │  dispatcher L1 ← embedding + pgvector                        │  │
│  │      ↓                                                       │  │
│  │  dispatcher L2 ← soulText + profileText + relevantMemory    │  │
│  │      ↓                                                       │  │
│  │  Negotiating → Waiting_Human → Closed/Cancelled              │  │
│  │                                        │                     │  │
│  │                            产出 task_summary.md              │  │
│  └──────────────────────────────┬─────────────────────────────┘  │
│                                 │                                 │
│             ▼ onTaskCompleted(taskId, summary)                    │
│                                                                   │
│  ┌─ 偏好学习 ──────────────────────────────────────┐             │
│  │ learnFromTaskSummary() → PreferenceLearning     │             │
│  │ appendLearning() → Memory.md                    │             │
│  │ 可选: updateSoulAnnotations() → Soul.md         │             │
│  └────────────────────────────────────────────────┘              │
└──────────────────────────────────────────────────────────────────┘
```

---

## 8. 接口定义

### 8.1 类型定义（types.ts）

```typescript
import { z } from "zod";

// ── 用户级画像类型 ──

export const ProfileFrontmatterSchema = z.object({
  user_id: z.string().min(1),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  version: z.number().int().positive()
});

export const ProfileDocumentSchema = z.object({
  frontmatter: ProfileFrontmatterSchema,
  sections: z.object({
    lifeRhythm: z.string(),        // # 生活节奏
    socialPatterns: z.string(),    // # 社交行为模式
    universalTaboos: z.string()    // # 通用禁忌
  }),
  rawText: z.string()              // 原始 Markdown 全文
});

export type ProfileDocument = z.infer<typeof ProfileDocumentSchema>;

export const ProfileHintsSchema = z.object({
  availableTimeSlots: z.array(z.string()).optional(),   // 从"时间可用性"提取
  replySpeed: z.string().optional(),                    // 从"互动习惯"提取
  universalTaboos: z.array(z.string()).optional()       // 从"通用禁忌"提取
});

export type ProfileHints = z.infer<typeof ProfileHintsSchema>;

// ── Persona 核心类型 ──

export const PersonaIdSchema = z.string().regex(/^P-[0-9a-f-]{36}$/);

export const SoulFrontmatterSchema = z.object({
  persona_id: PersonaIdSchema,
  persona_name: z.string().min(1).max(50),
  owner_user_id: z.string().min(1),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  version: z.number().int().positive()
});

export const SoulDocumentSchema = z.object({
  frontmatter: SoulFrontmatterSchema,
  sections: z.object({
    coreIdentity: z.string(),       // # Core Identity 段落
    preferences: z.string(),        // # Preferences 段落
    valuesAndVibe: z.string(),      // # Values & Vibe 段落
    historyAnnotations: z.string()  // # History Annotations 段落
  }),
  rawText: z.string()               // 原始 Markdown 全文
});

export type SoulDocument = z.infer<typeof SoulDocumentSchema>;

export const MemoryDocumentSchema = z.object({
  frontmatter: z.object({
    persona_id: PersonaIdSchema,
    last_updated: z.string().datetime(),
    total_tasks_completed: z.number().int().nonnegative(),
    total_tasks_cancelled: z.number().int().nonnegative()
  }),
  sections: z.object({
    matchingPatterns: z.string(),    // # 匹配模式总结
    preferenceLog: z.string(),      // # 偏好演变日志
    tokenStats: z.string()          // # Token 使用统计
  })
});

export type MemoryDocument = z.infer<typeof MemoryDocumentSchema>;

export const PreferencesSchema = z.object({
  // 来自 Profile.md（用户级）
  availableTimeSlots: z.array(z.string()).optional(),
  universalTaboos: z.array(z.string()).optional(),
  // 来自 Soul.md（分身级）
  interaction_type_tendency: z.enum(["online", "offline", "any"]),
  interests: z.array(z.string()),
  deal_breakers: z.array(z.string()),
  time_preferences: z.string().optional(),
  custom: z.record(z.unknown()).optional()
});

export type Preferences = z.infer<typeof PreferencesSchema>;

// ── Persona 配置 ──

export interface PersonaAgentConfig {
  /** 每个 persona 的全局月 Token 预算 */
  monthlyTokenBudget: number;
  /** 单个 task 的默认 Token 预算 */
  defaultTaskTokenBudget: number;
  /** Memory.md 最大字符数（超过触发压缩） */
  memoryMaxChars: number;
  /** 最大同时活跃任务数 */
  maxConcurrentTasks: number;
}

export const DEFAULT_PERSONA_CONFIG: PersonaAgentConfig = {
  monthlyTokenBudget: 500_000,
  defaultTaskTokenBudget: 10_000,
  memoryMaxChars: 8_000,
  maxConcurrentTasks: 5
};

// ── Task 交互类型 ──

export interface TaskAgentHandle {
  taskId: string;
  personaId: string;
  status: string;
  createdAt: string;
}

export interface TaskStatusBrief {
  taskId: string;
  status: string;
  targetActivity: string;
  updatedAt: string;
}

export interface TaskSummary {
  taskId: string;
  personaId: string;
  outcome: "satisfied" | "unsatisfied" | "cancelled" | "timeout" | "failed";
  targetActivity: string;
  targetVibe: string;
  matchedPartnerId: string | null;
  totalRounds: number;
  tokenUsed: number;
  completedAt: string;
}

export interface ConflictResult {
  existingTaskId: string;
  similarity: number;
  suggestion: string;  // "已有类似任务在跑，建议合并"
}
```

### 8.2 HTTP API（listener 扩展）

Persona-Agent 在现有 listener.ts 基础上增加以下端点：

```
# Profile 管理（用户级）
GET    /profile                                      → 获取用户画像（Profile.md）
PUT    /profile                                      → 编辑用户画像

# Persona 管理
GET    /personas/:personaId                          → 获取分身信息（含 Soul.md 摘要）
PUT    /personas/:personaId/soul                     → 用户编辑 Soul.md
GET    /personas/:personaId/memory                   → 获取 Memory.md 摘要

# 通过 Persona 创建/管理任务（替代原直接创建）
POST   /personas/:personaId/tasks                    → 创建任务（persona 注入上下文）
GET    /personas/:personaId/tasks                    → 列出该分身的所有任务
DELETE /personas/:personaId/tasks/:taskId             → 取消任务

# Task 内部 API（保持原有，增加 personaId 路由前缀）
POST   /personas/:personaId/tasks/:taskId/run        → 执行任务一步
POST   /personas/:personaId/tasks/:taskId/waiting-human-intent → 处理用户意图
```

### 8.3 数据库扩展

在现有 `persona_profiles` 表基础上扩展：

```sql
-- 已有字段保持不变
-- persona_id, profile_text, preferences, updated_at

-- 新增字段
ALTER TABLE persona_profiles ADD COLUMN IF NOT EXISTS
  memory_text TEXT DEFAULT '';           -- Memory.md 全文（派生层备份）

ALTER TABLE persona_profiles ADD COLUMN IF NOT EXISTS
  soul_version INTEGER DEFAULT 1;       -- Soul.md 乐观锁版本号

ALTER TABLE persona_profiles ADD COLUMN IF NOT EXISTS
  active_task_count INTEGER DEFAULT 0;  -- 活跃任务计数（用于限流）

-- tasks 表新增 persona_id 外键（如果还没有的话）
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS
  persona_id UUID REFERENCES personas(persona_id);

-- 新增：用户级 Profile 表（或在 users 表上加字段）
ALTER TABLE users ADD COLUMN IF NOT EXISTS
  profile_text TEXT DEFAULT '';          -- Profile.md 全文
ALTER TABLE users ADD COLUMN IF NOT EXISTS
  profile_version INTEGER DEFAULT 1;    -- Profile.md 乐观锁版本号
```

---

## 9. 文件目录结构

### 9.1 代码结构（`packages/agent/src/`）

```
packages/agent/src/
├── index.ts                             # 统一导出
│
├── shared/                              # ── Agent 共享基础设施 ──
│   ├── llm/                             # 多厂商 LLM 适配（不变）
│   ├── rag/                             # Embedding + 向量检索（不变）
│   └── memory/                          # 通用记忆工具（不变）
│       ├── context.ts
│       └── memory.ts
│
├── persona-agent/                       # ── 新增：Persona-Agent ──
│   ├── index.ts                         # PersonaAgent 类 + 统一导出
│   ├── types.ts                         # Zod Schema + 类型定义
│   ├── profile-loader.ts               # Profile.md 解析/加载（只读）
│   ├── soul-loader.ts                   # Soul.md 解析/加载/序列化
│   ├── memory-manager.ts               # Memory.md 管理
│   ├── preference-learner.ts            # 偏好学习引擎
│   ├── task-coordinator.ts              # Task-Agent 调度 + 冲突检测
│   └── soul-updater.ts                  # Soul.md 自动演化
│
├── task-agent/                          # ── 现有：Task-Agent（最小改动）──
│   ├── fsm/
│   │   ├── schema.ts                    # 不变
│   │   ├── transitions.ts              # 不变
│   │   └── task-loop.ts                # 微调：接收 PersonaContext 参数
│   ├── dispatcher/
│   │   ├── dispatcher.ts               # 微调：L2 接收 PersonaContext
│   │   ├── l0-filter.ts                # 微调：读取注入的 preferences
│   │   ├── l1-retrieval.ts             # 不变
│   │   └── l2-sandbox.ts               # 微调：读取注入的 soulText + profileText + memory
│   ├── protocol/
│   │   ├── handshake.ts                # 不变
│   │   └── idempotency.ts             # 不变
│   └── intake/
│       └── intake.ts                   # 微调：system prompt 注入三层画像上下文
│
└── social-agent/                        # ── 预留 ──
    └── index.ts
```

### 9.2 数据目录结构（`.data/`）

```
.data/
├── Profile.md                          # [新增] 用户级画像（所有分身共享只读）
├── logs/                               # [保留] 全局系统日志
├── sync_repair_queue.jsonl             # [保留] 全局补偿队列
│
└── <persona_id>/                       # [保留] persona 维度隔离
    ├── Soul.md                         # [改名] 原 User.md → Soul.md，分身人格
    ├── Memory.md                       # [保留] 长期记忆（persona-agent 独占）
    ├── raw_chats_summary/              # [保留] 全局对话摘要归档
    │   └── YYYY-MM-DD-summary.md
    ├── logs/                           # [保留] 分身级日志
    │
    └── task_agents/                    # [保留] vibecoding 原有结构完全不变
        └── <task_id>/
            ├── task.md                 # [不变] 任务状态机文档
            ├── task_summary.md         # [保留] 终态摘要（Task → Persona 单向流转）
            └── data/                   # [不变] vibecoding 原有子目录全部保留
                ├── daily_log/
                ├── agent_chat/
                │   ├── scratchpad.md
                │   └── *.jsonl
                ├── agent_chat_summary/
                ├── raw_chats/
                └── embedding_data/     # [保留] vibecoding 原有
```

---

## 10. 开发阶段规划

### Phase P1：骨架搭建（基础可用）

**目标**：PersonaAgent 类可实例化，能加载三层画像文件，能创建 task-agent

| 任务 | 输出 | 说明 |
|------|------|------|
| 定义 types.ts（Zod Schema） | persona-agent/types.ts | 含 ProfileDocument + SoulDocument + MemoryDocument |
| 实现 profile-loader.ts | 可加载 Profile.md → ProfileDocument | 只读 |
| 实现 soul-loader.ts（解析/序列化） | 可加载 Soul.md → SoulDocument | 读写 |
| 实现 PersonaAgent 骨架（init/createTask/shutdown） | persona-agent/index.ts | 三层画像加载 |
| 改造 intake.ts 接受 PersonaContext | 已有 intake + 三层画像注入 | profileText + soulText |
| 单元测试 | profile-loader + soul-loader + PersonaAgent init | - |

**验收标准**：
- `new PersonaAgent(personaId).initialize()` 可以加载 Profile.md + Soul.md
- `personaAgent.createTask("找人探店")` 可以创建带三层画像上下文的 task
- intake 阶段 LLM 提示词包含 Profile + Soul 信息

### Phase P2：记忆与偏好学习

**目标**：Memory.md 可读写，task 完成后自动触发偏好学习

| 任务 | 输出 | 说明 |
|------|------|------|
| 实现 memory-manager.ts | Memory.md 加载/追加/压缩 | - |
| 实现 preference-learner.ts | 从 task_summary 提取偏好 | - |
| 实现 soul-updater.ts | 自动追加 History Annotations | - |
| 终态回调集成 | task 完成 → onTaskCompleted | - |
| 集成测试 | 创建任务 → 完成 → 验证 Memory.md 更新 | - |

**验收标准**：
- task 关闭后 Memory.md 自动追加偏好记录
- Memory.md 超过 8000 字符时自动压缩
- Soul.md 的 History Annotations 段有新条目

### Phase P3：跨任务协调与 L2 增强

**目标**：多任务冲突检测、L2 研判引入三层画像 + 长期记忆

| 任务 | 输出 | 说明 |
|------|------|------|
| 实现 task-coordinator.ts | 冲突检测 + Token 预算分配 | - |
| 改造 dispatcher L2 | 注入 soulText + profileText + relevantMemory | - |
| HTTP API 扩展 | /profile + /personas/:id/* 端点 | - |
| 数据库 migration | users.profile_text + persona_profiles 新增字段 | - |
| E2E 测试 | 完整流程验证 | - |

**验收标准**：
- 创建重复任务时给出冲突提示
- L2 研判结果的 scratchpad 中包含用户习惯 + 长期记忆参考
- API 可通过 persona_id 管理任务，Profile 可独立编辑

### 各 Phase 的依赖关系

```
Phase P1（骨架）
    ↓
Phase P2（记忆与学习）
    ↓
Phase P3（协调与增强）
```

> **重要**：P1 不依赖任何 task-agent 内部改动（只新增 PersonaContext 传参），可与 task-agent 开发并行。

---

## 11. FAQ：设计抉择记录

### Q1: 为什么不让 task-agent 直接读写 Soul.md？

**A**: 并发安全。多个 task 同时跑时，如果都能写 Soul.md，会产生写入竞争和数据丢失。让 persona-agent 作为唯一写入者，从根本上消除并发冲突。

### Q2: 为什么 Memory.md 归 persona 而不是 task？

**A**: 偏好学习是**跨任务**的全局视野，例如"用户在最近 5 次探店任务中更偏好小众餐厅"。这个结论不属于任何单个 task，而是属于 persona 的"成长经验"。

### Q3: task-agent 现有的 memory.ts 还保留吗？

**A**: **完全保留**。task-agent 的 `memory.ts` 解决的是**任务内对话 token 管理**（对话太长了压缩一下），和 persona 的 `Memory.md` 是不同层面：
- `memory.ts` = "这次对话快超 token 了"（短期、单任务）
- `Memory.md` = "这个人 3 个月来更喜欢日料"（长期、跨任务）

### Q4: Soul.md 是纯静态还是会自动变化？

**A**: **活文档**。与 OpenClaw SOUL.md（纯静态定义）不同，Cosoul.AI 的 Soul.md 有一个 `History Annotations` 段会被 persona-agent 自动追加。但前四段（Core Identity / Preferences / Values & Vibe）**只有用户手动编辑才会变**，Agent 不会擅自修改用户的自我定义。

### Q5: 如果用户只有一个分身，persona-agent 是否多余？

**A**: 不多余。即使只有一个分身，persona-agent 仍然提供：
- 偏好学习（让 Agent 越来越了解你）
- Token 预算管理
- 多任务协调（一个分身可以同时跑多个 task）
- 人格文件的结构化管理

### Q6: 与 OpenClaw SOUL.md 最大的区别是什么？

**A**: 三个核心区别：

| 维度 | OpenClaw SOUL.md | Cosoul.AI Soul.md |
|------|-----------------|-------------------|
| 生命周期 | 静态（部署时定义，运行时只读） | 活文档（Agent 可追加 History Annotations） |
| 结构 | 三段式（Core Truths / Boundaries / Vibe） | 五段式（+ Preferences + History） |
| 用途 | 通用 AI Agent 人格 | 社交匹配专用（含 deal breakers、匹配偏好） |

### Q7: persona-agent 和 social-agent 的关系？

**A**: persona-agent 管 task-agent（匹配），未来也会管 social-agent（社交内容生成）。三者是树状关系：

```
PersonaAgent（管家）
├── TaskAgent-1 ... TaskAgent-N    （匹配执行）
└── SocialAgent                     （社交内容，Phase 后续）
```

### Q8: 为什么要把 User.md 拆成 Profile.md + Soul.md？

**A**: 解决命名歧义和职责混乱。原来 User.md 既要存"真人习惯"又要存"分身人设"，导致：
- 多分身场景下，真人习惯要重复写到每个分身的 User.md 里
- 新建分身时不知道哪些信息该从旧分身复制
- "User" 这个名字让人搞不清是在说"用户"还是"分身"

拆分后：
- **Profile.md**（用户级）= 不管你有几个分身，你的作息和通用禁忌只需要维护一份
- **Soul.md**（分身级）= 每个分身的人设和匹配标准完全独立

### Q9: Profile.md 放在 .data/ 根目录而不是用户子目录下？

**A**: 因为 Profile.md 是**跨分身共享**的。放在根目录可以：
- 避免任何单个 persona_id 文件夹对它有"所有权"的暗示
- 所有分身平等访问，不存在"主分身"概念
- 未来多用户场景下，自然扩展为 `.data/users/<user_id>/Profile.md`

---

## 附录 X：与 vibecoding_direction.md 的对齐说明

### 文档关系

```
vibecoding_direction.md (v1.1)
│  定义：工程铁律、FSM 迁移表、协议 Schema、安全隐私、测试标准
│  适用：所有 Agent 代码（包括 persona-agent）
│
└── persona-agent开发文档.md（本文档）
    定义：persona 层的架构设计、三层画像、记忆归属、偏好学习、任务调度
    约束：必须遵守 vibecoding_direction 的全部工程铁律
```

### 已识别的分歧与对齐方案

| 分歧点 | vibecoding_direction | 本文档 | 对齐方案 |
|--------|---------------------|--------|----------|
| **人格文件路径** | `.data/User.md`（全局单文件） | `.data/Profile.md`（用户级）+ `.data/<pid>/Soul.md`（分身级） | **采用本文档**。三层画像分离是产品核心需求，原 `readUserProfile()` 需改为参数化 |
| **Listening 状态** | 未列入 FSM（仅 9 状态） | `pauseTask()` 使用 Listening | **补充到 vibecoding**。现有代码已实现 Listening，vibecoding 遗漏 |
| **真相源** | task.md 文件是 SSOT | PostgreSQL tasks 表是 SSOT | **以现有代码为准**（PostgreSQL）。vibecoding v1.1 写于迁移前 |
| **L1 阈值** | minScore=0.72 | 未指定 | **保留 vibecoding 的阈值**。本文档不修改 L1 参数 |
| **L2 输入** | "加载 User.md + task.md + 对方报文" | "注入 PersonaContext（含 profileText + soulText + relevantMemory）" | **兼容**。PersonaContext 是增强版，包含原有信息 + 用户画像 + 长期记忆 |

### 最终合并目录结构

在 vibecoding 原有结构基础上，增加用户级 Profile + persona 维度隔离：

```
.data/
├── Profile.md                        # [新增] 用户级画像（所有分身共享只读）
├── logs/                             # [保留] 全局系统日志
├── sync_repair_queue.jsonl           # [保留] 全局补偿队列
│
└── <persona_id>/                     # [保留] persona 维度隔离
    ├── Soul.md                       # [改名] 原 User.md → Soul.md，增加五段式结构
    ├── Memory.md                     # [保留] 长期记忆（persona-agent 独占）
    ├── raw_chats_summary/            # [移入] 从全局移入 persona 下
    │   └── YYYY-MM-DD-summary.md
    ├── logs/                         # [保留] 分身级日志
    │
    └── task_agents/                  # [保留] vibecoding 原有结构完全不变
        └── <task_id>/
            ├── task.md               # [不变] 任务状态机文档
            ├── task_summary.md       # [保留] 终态摘要（Task → Persona 单向流转）
            └── data/                 # [不变] vibecoding 原有子目录全部保留
                ├── daily_log/
                ├── agent_chat/
                │   ├── scratchpad.md
                │   └── *.jsonl
                ├── agent_chat_summary/
                ├── raw_chats/
                └── embedding_data/   # [保留] vibecoding 原有
```

### storage.ts 必须改动的路径常量

原 vibecoding 的硬编码路径需改为参数化：

```typescript
// 改动前（vibecoding 原设计）
const USER_PROFILE_FILE = ".data/User.md";
const TASK_AGENTS_DIR = ".data/task_agents";
const RAW_CHATS_SUMMARY_DIR = ".data/raw_chats_summary";

// 改动后（三层画像 + persona 维度隔离）
function getProfilePath(): string {
  return ".data/Profile.md";                         // 用户级，全局唯一
}
function getSoulPath(personaId: string): string {
  return `.data/${personaId}/Soul.md`;               // 分身级，per persona
}
function getMemoryPath(personaId: string): string {
  return `.data/${personaId}/Memory.md`;             // 分身级，per persona
}
function getTaskAgentsDir(personaId: string): string {
  return `.data/${personaId}/task_agents`;
}
function getRawChatsSummaryDir(personaId: string): string {
  return `.data/${personaId}/raw_chats_summary`;
}
```

---

## 附录 A：Profile.md 完整示例模板

```markdown
---
user_id: "U-xxxxxxxx"
created_at: "2026-03-11T10:00:00Z"
updated_at: "2026-03-11T10:00:00Z"
version: 1
---

# 生活节奏

## 作息
- （填写你的作息习惯）

## 时间可用性
- 工作日：...
- 周末：...

---

# 社交行为模式

## 浏览习惯
- （系统会从使用行为中自动归纳，也可手动填写）

## 互动习惯
- 回复速度：...
- 评论风格：...

---

# 通用禁忌（所有分身共享）

- （不想被任何分身暴露的底线）
```

## 附录 B：Soul.md 完整示例模板

```markdown
---
persona_id: "P-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
persona_name: "分身名称"
owner_user_id: "U-xxxxxxxx"
created_at: "2026-03-11T10:00:00Z"
updated_at: "2026-03-11T10:00:00Z"
version: 1
---

# Core Identity

（一段话描述这个分身的核心身份）

## 背景
- 城市/年龄/职业
- 核心经历

## 兴趣标签
- 标签 1、标签 2、标签 3

---

# Preferences

## 交互偏好
- 互动方式：线上/线下/都可以
- 沟通风格：...

## 匹配偏好
- 期望对方特质
- 人数限制（或不限）

## Deal Breakers
- 禁区 1
- 禁区 2

---

# Values & Vibe

## 核心价值观
- 价值观 1
- 价值观 2

## 气质风格
- 风格描述

## 决策准则
Agent 代我决策时的优先级：
1. ...
2. ...
3. ...

---

# History Annotations

> 以下由 Persona-Agent 自动维护

（初始为空，随任务完成自动追加）
```

## 附录 C：Memory.md 完整示例模板

```markdown
---
persona_id: "P-xxxxxxxx"
last_updated: "2026-03-11T10:00:00Z"
total_tasks_completed: 0
total_tasks_cancelled: 0
---

# 匹配模式总结

## 高满意度模式
（从已完成任务中归纳的正面模式）

## 低满意度模式
（从已完成任务中归纳的负面模式）

# 偏好演变日志

（按日期追加的偏好学习记录）

# Token 使用统计

| 月份 | 总 Token | Intake | L2 研判 | Memory Flush |
|------|---------|--------|---------|-------------|
```
