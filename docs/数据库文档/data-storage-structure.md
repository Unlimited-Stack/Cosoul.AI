# 数据存储结构总览

> 本文档梳理了 `packages/agent` 中所有数据的存储位置、结构和用途。

---

## 一、存储层全景

```
┌──────────────────────────────────────────────────────────────┐
│                      数据存储架构                              │
├──────────────┬──────────────────┬────────────────────────────┤
│  PostgreSQL  │   pgvector 扩展   │   本地文件系统 (.data/)     │
│  (SSOT 主库) │   (向量索引)       │   (辅助/日志/会话快照)      │
└──────────────┴──────────────────┴────────────────────────────┘
```

- **PostgreSQL** 是唯一事实源 (Single Source of Truth)
- **pgvector** 提供向量相似度检索能力
- **本地文件系统** 存放辅助数据（会话快照、日志、协商记录等）

---

## 二、PostgreSQL 数据库表结构

> Schema 定义: `packages/core/src/db/schema.ts`

```
PostgreSQL
├── users                     # 用户账户
│   ├── user_id        (UUID, PK)
│   ├── email          (unique)
│   ├── name
│   ├── avatar_url
│   ├── created_at
│   └── 、、、
│
├── personas                  # 人格/分身（一个用户 → 多个分身）
│   ├── persona_id     (UUID, PK)
│   ├── user_id        (FK → users)
│   ├── name
│   ├── avatar
│   ├── profile_text   (text, 完整 User.md 内容)
│   ├── preferences    (JSONB, 结构化偏好)
│   ├── bio
│   ├── settings       (JSONB)
│   ├── created_at
│   └── updated_at
│
│
├── tasks                     # 任务记录（带 FSM 状态机）
│   ├── task_id              (UUID, PK)
│   ├── persona_id           (FK → personas)
│   ├── status               (10种状态，见下方状态机)
│   ├── interaction_type     ("online" | "offline" | "any")
│   ├── current_partner_id   (nullable UUID)
│   ├── raw_description      (text, 用户原始描述的总结)
│   ├── target_activity      (text, AI 提取的活动目标)
│   ├── target_vibe          (text, AI 提取的氛围)
│   ├── detailed_plan        (text, 详细计划)
│   ├── version              (integer, 乐观锁)
│   ├── pending_sync         (boolean)
│   ├── hidden               (boolean)
│   ├── entered_status_at
│   ├── created_at
│   └── updated_at
│
│
├── task_vectors              # 向量索引（pgvector, 1024维）
│   ├── id             (UUID, PK)
│   ├── task_id        (FK → tasks)
│   ├── field          ("targetActivity" | "targetVibe" | "rawDescription")
│   ├── embedding      (vector(1024))
│   ├── model          ("text-embedding-v4")
│   └── updated_at
│
├── contacts                  # 好友关系，现占位中
│   ├── id
│   ├── persona_id           (FK → personas)
│   ├── friend_persona_id    (FK → personas)
│   ├── status               ("pending" | "accepted" | "blocked")
│   ├── ai_note              (text, AI 生成的好友备注)
│   ├── source_task_id       (FK → tasks)
│   └── created_at
│
├── handshake_logs            # 协商握手日志 + Judge Model 裁决记录
│   ├── id
│   ├── task_id        (FK → tasks)
│   ├── direction      ("inbound" | "outbound" | "judge_request" | "judge_response")
│   ├── envelope       (JSONB, 握手报文 或 Judge Model 评估内容)
│   │                  ↳ judge_request: envelope->>'content' 为发给 Judge 的 prompt
│   │                  ↳ judge_response: envelope->'parsedDecision' 为 JudgeDecision 结构
│   │                  ↳ 详见 L2-handshake-detail.md
│   ├── round          (integer, nullable, 协商轮次)
│   ├── visible_to_user (boolean, default false, 是否节选给用户展示)
│   ├── user_summary   (text, nullable, 面向用户的一句话可读摘要)
│   ├── timestamp
│   └── 索引: idx_handshake_task(task_id), idx_handshake_task_round(task_id, round)
│
├── chat_messages             # 人和agent的多轮聊天消息记录
│   ├── id
│   ├── task_id        (FK → tasks)
│   ├── persona_id     (FK → personas)
│   ├── sender_type    ("human" | "agent")
│   ├── sender_id      (UUID)
│   ├── content        (text)
│   ├── metadata       (JSONB)
│   ├── compress_summary
│   └── created_at
│
└── idempotency_keys          # 幂等性控制（7天 TTL）
    ├── key            (varchar(255), PK)
    ├── response       (JSONB, 缓存响应)
    └── created_at


```



### 任务状态机 (FSM)

> 完整转换表定义于 `storage.ts` 的 `ALLOWED_STATUS_TRANSITIONS`

```
Drafting       → Searching, Cancelled
Searching      → Negotiating, Timeout, Failed, Cancelled
Negotiating    → Waiting_Human, Timeout, Failed, Cancelled
Waiting_Human  → Revising, Drafting, Listening, Closed, Cancelled
Listening      → Waiting_Human, Cancelled
Revising       → Searching, Cancelled
Closed         → Waiting_Human
Failed         → Searching
Timeout        → Searching
Cancelled      → Waiting_Human
```

主线流程:
```
Drafting → Searching → Negotiating → Waiting_Human → Listening
                                   ↘ Closed
                     ↘ Revising → Searching (重新匹配)
                     ↘ Failed / Timeout → Searching (可恢复)
```

---

## 三、本地文件系统结构

> 根目录: `.data/`（已 .gitignore）

```
.data/
├── logs/
│   └── {YYYY-MM-DD}-sys.md              # 可观测性日志 (JSONL 格式)
│
├── task_agents/
│   └── task_{task_id}/
│       ├── task.md                       # 任务 Markdown 文档 (YAML frontmatter)
│       └── data/
│           ├── raw_chats/
│           │   └── {YYYY-MM-DD}-chat.md  # 用户和agent聊天的原始聊天记录 (保留90天)
│           └── agent_chat/
│               ├── sessions.jsonl        # agent间协商会话记录 (JSONL)
│               └── scratchpad.md         # Agent 草稿笔记，用于后续部分展示
│
├── personal_agent_chats/                 
│   
│
├── sync_repair_queue.jsonl               # 异步同步失败队列
│
└── User.md                               # 用户档案
```

### 数据保留策略

| 数据类型 | 保留时长 |
|---------|---------|
| 原始聊天 (raw_chats) | 90 天 |
| Agent 聊天 JSONL | 180 天 |
| 幂等性键 (idempotency_keys) | 7 天 TTL |
| 可观测性日志 | 无自动清理 |

---

## 四、Persona 文档结构（Markdown 序列化）

### Soul.md — 人格身份文档

```yaml
---
persona_id: "uuid"
persona_name: "名称"
owner_user_id: "uuid"
version: 1
created_at: "ISO8601"
updated_at: "ISO8601"
---
## Core Identity          # 背景/兴趣/性格
## Preferences            # 交互与匹配偏好
## Values and Vibe        # 价值观/氛围/决策规则
## History Annotations    # 自动追加的学习历史
```

### Memory.md — 长期经验文档

```yaml
---
persona_id: "uuid"
last_updated: "ISO8601"
total_tasks_completed: 0
total_tasks_cancelled: 0
---
## Matching Patterns      # 跨任务匹配洞察
## Preference Log         # 偏好演化时间线
## Token Stats            # Token 使用统计
```

---

## 五、向量存储与嵌入管线

```
用户输入
   │
   ▼
┌─────────────────────────┐
│  DashScope Embedding    │  模型: text-embedding-v4
│  (阿里云)                │  维度: 1024
└────────┬────────────────┘
         │ 生成 3 个向量
         ▼
┌─────────────────────────────────────────┐
│  task_vectors 表 (pgvector)              │
│                                         │
│  每个任务存储 3 条向量:                    │
│  ├── targetActivity   (活动目标向量)      │
│  ├── targetVibe       (氛围向量)          │
│  └── rawDescription   (原始描述向量)      │
└─────────────────────────────────────────┘
```

### 匹配检索管线

| 阶段 | 名称 | 存储 | 说明 |
|------|------|------|------|
| L0 | 硬过滤 | PostgreSQL | status=Searching + 交互类型兼容 |
| L1 | 向量检索 | pgvector | 加权余弦相似度 (activity:0.35, vibe:0.35, desc:0.30) |
| L2 | Judge Model 裁决 | PostgreSQL (handshake_logs) | 中立第三方 Judge 单次评估 + 维度打分 (dimensionScores) + 硬约束校验 (applyHardConstraints) + Zod 结构化输出 |

---

## 六、关键数据协议

### 握手信封 (Handshake Envelope)

```
Inbound:
├── protocol_version, message_id
├── sender_agent_id, receiver_agent_id
├── task_id
├── action: PROPOSE | COUNTER_PROPOSE | ACCEPT | REJECT | CANCEL | ERROR
├── round: number
├── payload: { interaction_type, target_activity, target_vibe }
├── timestamp
└── signature

Outbound:
├── protocol_version, message_id
├── in_reply_to
├── task_id
├── action
├── error: { code, message } | null
└── timestamp
```

### Judge Model 裁决记录（存于 handshake_logs，direction = judge_request / judge_response）

> 完整流程和技术细节见 **`L2-handshake-detail.md`**

Judge Model 采用**单次 chatOnce 调用**，作为中立第三方同时评估双方任务的匹配度。每次匹配产生 1 条 judge_request + 1 条 judge_response。

```
judge_request envelope:
├── content         (string, 发给 Judge 的完整 prompt，包含双方任务摘要)
├── round           (number, 协商轮次)
└── 说明: system prompt 含维度评分指引 + 7 个 few-shot 示例

judge_response envelope:
├── content         (string, LLM 原始回复文本)
├── parsedDecision  (JudgeDecision JSON, Zod 校验通过后)
│   ├── dimensionScores:
│   │   ├── activityCompatibility  (0-1, 权重 0.45)
│   │   ├── vibeAlignment          (0-1, 权重 0.25)
│   │   ├── interactionTypeMatch   (0-1, 权重 0.20)
│   │   └── planSpecificity        (0-1, 权重 0.10)
│   ├── verdict: "MATCH" | "NEGOTIATE" | "REJECT"
│   ├── confidence: number (0-1)
│   ├── shouldMoveToRevising: boolean
│   ├── reasoning: string (推理过程)
│   └── userFacingSummary: string (面向用户的可读摘要)
├── mappedL2Action  ("ACCEPT" | "REJECT", 向后兼容映射)
└── error?          (string, 仅调用失败时记录)
```

**裁决流程**:

```
  executeJudgeL2(localTask, envelope)
          │
          ▼
  构建 Judge prompt（双方任务信息）
          │
          ▼
  chatOnce() → LLM 单次调用
          │
          ▼
  Zod 校验 → JudgeDecision
          │
          ▼
  applyHardConstraints() — 硬约束校验:
  ├── interaction_type 冲突 → 强制 REJECT
  ├── MATCH + confidence < 0.7 → 降为 NEGOTIATE
  ├── NEGOTIATE + confidence < 0.4 → 降为 REJECT
  └── REJECT + confidence >= 0.7 → 钳制 confidence ≤ 0.35
          │
          ▼
  verdict → L2Decision 映射:
  ├── MATCH    → ACCEPT
  ├── NEGOTIATE → ACCEPT (进入人工确认)
  └── REJECT   → REJECT
          │
          ▼
  写入 handshake_logs (judge_request + judge_response)
```

- `visible_to_user=true` 的 `judge_response` 行可被前端查询，通过 `readUserVisibleNegotiationSummary()` 获取
- `user_summary` 字段存储 `userFacingSummary` 的自然语言摘要

### 协商会话 (NegotiationSession)

```
├── session_id, task_id
├── remote_agent_id, remote_task_id
├── status: Negotiating | Accepted | Rejected | Timeout
├── match_score: number | null
├── l2_action: ACCEPT | REJECT | null
├── rounds: number
├── started_at, updated_at, timeout_at
```

---

## 七、存储关键设计模式

| 模式 | 说明 |
|------|------|
| **乐观锁** | tasks 表 `version` 字段，冲突返回 `E_VERSION_CONFLICT` |
| **幂等性** | key = `{message_id}::{sender_agent_id}::{protocol_version}`，7天自动清理 |
| **两阶段同步** | Phase1: 写 PostgreSQL → Phase2: 同步派生层 → 失败进修复队列 |
| **Markdown 序列化** | YAML frontmatter + Markdown sections，人类可读 |
| **Token 预算管理** | 软限制，80% 阈值触发 memory flush，月预算 500k tokens |

---

## 八、关键源码索引

| 文件 | 用途 |
|------|------|
| `packages/core/src/db/schema.ts` | 数据库表定义 (Drizzle ORM) |
| `packages/agent/src/task-agent/storage.ts` | 存储 ACL 层 |
| `packages/agent/src/task-agent/types.ts` | 数据结构定义 |
| `packages/agent/src/task-agent/embedding.ts` | 向量生成 (DashScope) |
| `packages/agent/src/task-agent/retrieval.ts` | 向量检索 |
| `packages/agent/src/persona-agent/types.ts` | Persona 类型定义 |
| `packages/agent/src/persona-agent/soul-loader.ts` | Soul.md 解析器 |
| `packages/agent/src/persona-agent/memory-manager.ts` | Memory.md 管理器 |
| `packages/agent/src/persona-agent/index.ts` | PersonaAgent 主类 |
| `packages/agent/src/task-agent/dispatcher.ts` | 匹配调度器（调用 Judge Model） |
| `packages/agent/src/task-agent/judge.ts` | Judge Model 裁决逻辑（含 applyHardConstraints） |
| `packages/core/src/llm/chat.ts` | LLM 调用封装（chatOnce / Conversation） |
| `docs/数据库文档/L2-handshake-detail.md` | L2 Judge 裁决流程技术细节文档 |
