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
├── handshake_logs            # 协商握手日志
│   ├── id
│   ├── task_id        (FK → tasks)
│   ├── direction      ("inbound" | "outbound")
│   ├── envelope       (JSONB, 完整握手消息)
│   └── timestamp
│
├── chat_messages             # 人和agent的多轮聊天消息记录
│   ├── id
│   ├── task_id        (FK → tasks)
│   ├── persona_id     (FK → personas)
│   ├── sender_type    ("human" | "agent")
│   ├── sender_id      (UUID)
│   ├── content        (text)
│   ├── metadata       (JSONB)
│   └── created_at
│
└── idempotency_keys          # 幂等性控制（7天 TTL）
    ├── key            (varchar(255), PK)
    ├── response       (JSONB, 缓存响应)
    └── created_at


```



### 任务状态机 (FSM)

```
Drafting → Searching → Negotiating → Waiting_Human → Listening
                                   → Closed
                                   → Revising
                         → Failed
                         → Timeout
                         → Cancelled
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
| L2 | LLM 判断 | 内存 | 基于 Soul.md 的人格化决策 |

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
| `packages/agent/src/task-agent/storage.ts` | 存储 ACL 层 (949行) |
| `packages/agent/src/task-agent/types.ts` | 数据结构定义 |
| `packages/agent/src/task-agent/embedding.ts` | 向量生成 (DashScope) |
| `packages/agent/src/task-agent/retrieval.ts` | 向量检索 |
| `packages/agent/src/persona-agent/types.ts` | Persona 类型定义 |
| `packages/agent/src/persona-agent/soul-loader.ts` | Soul.md 解析器 |
| `packages/agent/src/persona-agent/memory-manager.ts` | Memory.md 管理器 |
| `packages/agent/src/persona-agent/index.ts` | PersonaAgent 主类 |
| `packages/agent/src/task-agent/dispatcher.ts` | 匹配调度器 |
