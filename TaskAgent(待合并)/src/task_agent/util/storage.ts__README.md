# util 模块文档

> `TaskAgent(待合并)/src/task_agent/util/`
>
> 任务系统的持久化防腐层（Anti-Corruption Layer）与工具集。

---

## 文件说明

```
src/task_agent/util/
├── storage.ts    # 所有持久化操作的唯一入口（本文档重点）
├── schema.ts     # 类型定义与 Zod 校验（TaskDocument、握手信封等）
└── README.md     # 本文档
```

---

## storage.ts 总览

### 设计定位

`storage.ts` 是任务系统所有"落盘写入"的**唯一入口**，遵循防腐层（ACL）模式：

- 上层业务逻辑（dispatcher、task_loop 等）只调用本模块的公开函数，**不直接操作数据库或文件系统**
- 本模块对外屏蔽所有 PostgreSQL 表结构细节和文件路径细节

### 数据存储分布

| 数据类型 | 存储位置 | 说明 |
|----------|----------|------|
| 任务主数据 | PostgreSQL `tasks` 表 | **真相源（SSOT）** |
| 握手协议日志 | PostgreSQL `handshake_logs` 表 | 入站/出站报文全量记录 |
| 幂等键 | PostgreSQL `idempotency_keys` 表 | TTL 7 天，自动清理 |
| 谈判会话 | `.data/task_agents/<task>/data/sessions.jsonl` | 无对应 DB 表，JSONL 文件 |
| 研判草稿 | `.data/task_agents/<task>/data/agent_chat/scratchpad.md` | 仅本机使用，严禁外传 |
| 对话原文快照 | `.data/task_agents/<task>/data/raw_chats/<date>-chat.md` | 按天归档，保留 90 天 |
| 全局摘要 | `.data/raw_chats_summary/<date>-summary.md` | 按天覆盖写 |
| 系统审计日志 | `.data/logs/<date>-sys.md` | JSON 行格式 |
| 派生层修复队列 | `.data/sync_repair_queue.jsonl` | DB 写成功但派生层失败时入队 |

### 关键设计原则

1. **两阶段写入**：状态迁移时先置 `pending_sync=true`，派生层同步完成后再清标记；派生层失败不回滚主写入，而是入修复队列。
2. **乐观锁**：所有写操作可传入 `expectedVersion`，版本不匹配抛 `E_VERSION_CONFLICT`，防止并发覆盖。
3. **FSM 约束**：状态迁移必须经过 `ALLOWED_STATUS_TRANSITIONS` 表校验，非法迁移抛 `E_INVALID_TRANSITION`。
4. **幂等性**：握手处理通过 `idempotency_keys` 表保证重放安全。

---

## 任务状态机（FSM）

```
                  ┌──────────┐
                  │ Drafting │
                  └────┬─────┘
                       │
                  ┌────▼──────┐
          ┌───────┤ Searching ├◄──────────────────┐
          │       └────┬──────┘                   │
          │            │                          │
          │    ┌───────▼────────┐                 │
          │    │  Negotiating   │                 │
          │    └───────┬────────┘                 │
          │            │                          │
          │    ┌───────▼────────┐    ┌──────────┐ │
          │    │ Waiting_Human  ├───►│  Closed  ├─┘
          │    └──┬──────┬──────┘    └──────────┘
          │       │      │
          │  ┌────▼──┐ ┌─▼───────┐
          │  │Revis- │ │Listening│
          │  │  ing  │ └─────────┘
          │  └───────┘
          │
     ┌────▼───┐  ┌─────────┐
     │ Failed │  │ Timeout │
     └────┬───┘  └────┬────┘
          └──────┬────┘
                 │ (resume)
            Searching
```

**允许迁移表：**

| 当前状态 | 可迁移至 |
|----------|----------|
| `Drafting` | `Searching`, `Cancelled` |
| `Searching` | `Negotiating`, `Timeout`, `Failed`, `Cancelled` |
| `Negotiating` | `Waiting_Human`, `Timeout`, `Failed`, `Cancelled` |
| `Waiting_Human` | `Revising`, `Drafting`, `Listening`, `Closed`, `Cancelled` |
| `Listening` | `Waiting_Human`, `Cancelled` |
| `Revising` | `Searching`, `Cancelled` |
| `Closed` | `Waiting_Human` |
| `Failed` | `Searching` |
| `Timeout` | `Searching` |
| `Cancelled` | `Waiting_Human` |

---

## 公开 API 分类索引

### 一、任务 CRUD

| 函数 | 说明 |
|------|------|
| `saveTaskMD(task, options?)` | 新建或覆盖写任务至 PostgreSQL（可携带乐观锁版本号） |
| `readTaskDocument(taskId)` | 按 ID 从 DB 读取并映射为 `TaskDocument` |
| `listTasksByStatuses(statuses)` | 按状态集合批量查询任务（dispatcher 轮询用） |
| `listAllTasks()` | 列出所有任务（含合成文件路径，供 UI/runtime 展示） |
| `setTaskHidden(taskId, hidden)` | 设置/取消软删除标记 |
| `getTaskFilePath(taskId)` | 获取任务对应的文件目录路径（排障用） |

**`saveTaskMD` 行为说明：**
- `task_id` 已存在 → `UPDATE`（可选 `expectedVersion` 乐观锁）
- `task_id` 不存在 → `INSERT`（必须提供 `options.personaId`）
- 写入后自动调用 `syncDerivedLayers()`（当前为占位，实际由外部 embedding pipeline 处理）

---

### 二、状态迁移

| 函数 | 说明 |
|------|------|
| `transitionTaskStatus(taskId, nextStatus, options?)` | 完整两阶段迁移（乐观锁 + 审计日志 + 修复队列） |
| `updateTaskStatus(taskId, nextStatus)` | `transitionTaskStatus` 的薄封装（简化调用） |
| `resumeFailedOrTimeoutTask(taskId, triggerBy)` | `Failed/Timeout → Searching` 的显式恢复入口 |

**`transitionTaskStatus` 执行顺序：**
```
Step 1: UPDATE tasks SET status=next, pending_sync=true, version+=1
Step 2: syncDerivedLayers（派生层同步占位）
Step 3: UPDATE tasks SET pending_sync=false
        ↑ Step 2 失败时跳过此步，改为：入 sync_repair_queue + 写审计日志
```

**`TransitionOptions` 参数：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `expectedVersion` | `number` | 乐观锁，版本不匹配抛 `E_VERSION_CONFLICT` |
| `traceId` | `string` | 可观测性关联 ID |
| `messageId` | `string` | 触发此迁移的消息 ID |
| `errorCode` | `ErrorCode \| null` | 业务/系统错误码（写入审计日志） |

---

### 三、握手协议（Handshake）

| 函数 | 说明 |
|------|------|
| `appendAgentChatLog(taskId, entry)` | 将入站/出站握手报文写入 `handshake_logs` 表 |
| `readLatestHandshakeExchange(taskId)` | 读取最近一次握手收发快照（各取最新一条） |
| `findIdempotencyRecord(envelope)` | 查询幂等记录（自动清理 7 天前记录） |
| `saveIdempotencyRecord(envelope, response)` | 写入幂等记录（相同 key + 相同 response 则幂等成功；不同 response 抛冲突） |

**幂等键格式：** `{message_id}::{sender_agent_id}::{protocol_version}`

---

### 四、谈判会话（NegotiationSession）

> 存储于 `.data/task_agents/<task>/data/sessions.jsonl`，无对应 DB 表。

| 函数 | 说明 |
|------|------|
| `upsertNegotiationSession(session)` | 创建或更新会话（按 `session_id` 匹配） |
| `findSessionByRemoteAgent(taskId, remoteAgentId)` | 按远端 Agent ID 查找进行中的会话（排除 Rejected/Timeout） |
| `listNegotiationSessions(taskId)` | 列出某任务的所有会话 |
| `generateListeningReport(taskId)` | 汇总所有会话生成 `ListeningReport`（按状态和分数排序） |
| `expireTimedOutSessions(taskId)` | 将超时的 `Negotiating` 会话批量标记为 `Timeout` |

---

### 五、文件层操作

| 函数 | 说明 |
|------|------|
| `appendScratchpadNote(taskId, note, timestamp)` | 向任务研判草稿追加内容（`scratchpad.md`，仅本机使用） |
| `appendRawChat(taskId, content, timestamp)` | 归档对话原文快照（按日期写 `raw_chats/<date>-chat.md`） |
| `appendRawChatSummary(content, timestamp)` | 写全局摘要（按日期覆盖 `raw_chats_summary/<date>-summary.md`） |
| `readUserProfile()` | 读取 `.data/User.md`（用户画像，供 L2 本地研判） |

---

### 六、可观测性与审计

| 函数 | 说明 |
|------|------|
| `appendObservabilityLog(event)` | 将结构化事件以 JSON 行写入 `.data/logs/<date>-sys.md` |

**`ObservabilityLogEvent` 字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `trace_id` | `string` | 追踪 ID |
| `task_id` | `string` | 关联任务 ID |
| `message_id` | `string` | 触发事件的消息 ID |
| `from_status` | `TaskStatus \| "N/A"` | 迁移前状态 |
| `to_status` | `TaskStatus \| "N/A"` | 迁移后状态 |
| `latency_ms` | `number` | 操作耗时 |
| `error_code` | `ErrorCode \| null` | 错误码 |
| `event` | `string` | 事件名称 |
| `timestamp` | `string` | ISO 8601 时间戳 |
| `details` | `Record<string, ...>` | 可选附加信息 |

---

### 七、维护操作

| 函数 | 说明 |
|------|------|
| `enqueueSyncRepair(job)` | 向 `sync_repair_queue.jsonl` 追加修复任务 |
| `retrySyncRepairs()` | 重试修复队列（尝试重新同步派生层，成功则从队列移除） |
| `cleanupExpiredData(nowIso?)` | 清理过期文件（raw_chats 90 天，agent_chat jsonl 180 天） |
| `rebuildIndex()` | 全量重建派生索引占位（当前仅统计任务数 + 写审计日志） |

---

### 八、序列化工具（供测试 / 调试使用）

| 函数 | 说明 |
|------|------|
| `parseTaskMDContent(content)` | 将 `task.md` 文本解析为 `TaskDocument` |
| `serializeTaskMDContent(task)` | 将 `TaskDocument` 序列化为 `task.md` 格式文本 |

**`task.md` 文件结构：**
```markdown
---
task_id: "..."
status: "Searching"
interaction_type: "any"
current_partner_id: null
entered_status_at: "2026-01-01T00:00:00.000Z"
created_at: "2026-01-01T00:00:00.000Z"
updated_at: "2026-01-01T00:00:00.000Z"
version: 1
pending_sync: false
hidden: false
---

### 原始描述
...

### 靶向映射
<Target_Activity>...</Target_Activity>
<Target_Vibe>...</Target_Vibe>

### 需求详情
...
```

---

## 关键接口速查

### `SaveTaskOptions`
```typescript
interface SaveTaskOptions {
  expectedVersion?: number;   // 乐观锁版本号
  personaId?: string;         // 新建任务时必填
}
```

### `TransitionResult`
```typescript
interface TransitionResult {
  previousStatus: TaskStatus;
  nextStatus: TaskStatus;
  version: number;
  updatedAt: string;
}
```

### `SyncRepairJob`
```typescript
interface SyncRepairJob {
  taskId: string;
  reason: string;
  createdAt: string;
}
```

### `IdempotencyRecord`
```typescript
interface IdempotencyRecord {
  key: string;
  taskId: string;
  createdAt: string;
  response: HandshakeOutboundEnvelope;
}
```

### `HandshakeExchangeSnapshot`
```typescript
interface HandshakeExchangeSnapshot {
  inbound: HandshakeInboundEnvelope | null;
  outbound: HandshakeOutboundEnvelope | null;
  sourceFilePath: string | null;   // DB 模式下为 null
}
```

### `RetentionCleanupResult`
```typescript
interface RetentionCleanupResult {
  deletedRawChats: number;
  deletedAgentChatJsonl: number;
}
```

---

## 文件路径常量

| 常量 | 路径 | 说明 |
|------|------|------|
| `DATA_ROOT` | `.data/` | 文件层根目录 |
| `TASK_AGENTS_ROOT` | `.data/task_agents/` | 任务子目录根 |
| `SYNC_REPAIR_QUEUE_FILE` | `.data/sync_repair_queue.jsonl` | 派生层修复队列 |
| `USER_PROFILE_FILE` | `.data/User.md` | 用户画像文件 |
| `GLOBAL_RAW_CHAT_SUMMARY_DIR` | `.data/raw_chats_summary/` | 全局摘要目录 |
| `GLOBAL_LOG_DIR` | `.data/logs/` | 系统日志目录 |
| `RAW_CHATS_RETENTION_DAYS` | 90 天 | raw_chats 保留期 |
| `AGENT_CHAT_RETENTION_DAYS` | 180 天 | agent_chat jsonl 保留期 |
| `IDEMPOTENCY_WINDOW_MS` | 7 天 | 幂等键 TTL |

---

## 错误码一览

| 错误码 | 触发场景 |
|--------|----------|
| `E_VERSION_CONFLICT` | 乐观锁版本号不匹配 |
| `E_INVALID_TRANSITION` | 非法状态迁移（不在 FSM 允许表内） |
| `E_TASK_NOT_FOUND` | 按 ID 查询任务不存在 |
| `E_MISSING_PERSONA_ID` | 新建任务时未提供 `personaId` |
| `E_IDEMPOTENCY_CONFLICT` | 同一幂等键但响应内容不一致 |
| `E_DEP_UNAVAILABLE` | 派生层同步失败（fallback 写入修复队列） |
| `E_TASK_MD_INVALID` | `task.md` 文本缺少 YAML frontmatter |
| `E_TASK_BODY_INVALID` | `task.md` body 缺少必要 section |
| `E_YAML_PARSE` | YAML 解析遇到无效行格式 |

---

## 扩展指南

| 需求 | 操作位置 |
|------|----------|
| 新增任务字段 | `schema.ts` 中扩展 `TaskFrontmatter`/`TaskBody`，`storage.ts` 中更新 `taskDocumentToDbValues` 和 `dbRowToTaskDocument` |
| 新增允许的状态迁移路径 | 修改 `ALLOWED_STATUS_TRANSITIONS` 常量 |
| 实现真正的向量索引同步 | 填充 `syncDerivedLayers()` 函数体 |
| 调整数据保留期 | 修改 `RAW_CHATS_RETENTION_DAYS` / `AGENT_CHAT_RETENTION_DAYS` 常量 |
| 将谈判会话迁移至 DB | 新建 `negotiation_sessions` 表，替换 `readAllSessions` / `rewriteSessions` 的文件读写实现 |
| 调整幂等键 TTL | 修改 `IDEMPOTENCY_WINDOW_MS` 常量 |
