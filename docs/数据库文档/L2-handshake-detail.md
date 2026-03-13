# L2 握手协商 — Judge Model 架构与技术细节

> 本文档描述 Agent 间 L2 匹配研判的完整流程，包括 Judge Model 架构、数据存储和降级机制。
> 数据存储总览见 `data-storage-structure.md`。

---

## 一、匹配漏斗总览

Agent 间匹配分三级漏斗，L2 是最后一级，由 Judge Model 执行：

| 阶段 | 执行位置 | 输入 | 输出 | 说明 |
|------|---------|------|------|------|
| L0 | `dispatcher.ts` → `queryL0Candidates` | 全量 Searching 任务 | 候选 taskId 列表 | 硬过滤：status=Searching + interaction_type 兼容 |
| L1 | `dispatcher.ts` → `runL1Retrieval` | L0 候选 | 排序后的 L1Candidate[] | 向量余弦相似度，score >= 0.3 通过 |
| **L2** | **`judge.ts`** → `executeJudgeL2` | 双方任务 + 信封 | L2Decision (ACCEPT/REJECT) | **Judge Model 中立裁决** |

---

## 二、架构变更：从单方 L2 到中立 Judge

### 旧架构（executeL2Sandbox）

```
收到对端信封 → 只看本地任务 + 对端 3 个摘要字段 → 单方面 LLM 研判 → ACCEPT/REJECT
```

- LLM 只看到本地的完整信息 + 对端的 target_activity / target_vibe / interaction_type
- 研判是单方面的，对端的 detailedPlan 不可见

### 新架构（Judge Model）

```
收到对端信封 → 获取双方完整 detailedPlan → Judge 中立评估 → MATCH/NEGOTIATE/REJECT → 映射为 L2Decision
```

- Judge 同时看到 Side A（本地）和 Side B（远端）的完整任务信息
- 三级裁决：MATCH（高度匹配）/ NEGOTIATE（部分匹配可协商）/ REJECT（不匹配）
- MATCH 和 NEGOTIATE 都映射为 ACCEPT，REJECT 映射为 REJECT（向后兼容）

### 网络层占位

远端的 detailedPlan 当前无法通过网络获取（`fetchRemoteTaskContext` 返回 stub 数据）。
Judge prompt 已设计为容忍 stub 数据：当 detailedPlan 缺失时降低置信度，但基于已有字段（targetActivity, targetVibe）仍可做出判断。

---

## 三、L2 触发场景

### 场景 A：主动流（本方发起）

```
本方 Searching → runL1Retrieval 找到候选
  → sendInitialPropose (HTTP POST PROPOSE 给对端)
  → 本方转 Negotiating
  → 对端 dispatchInboundHandshake → 调 Judge → 返回 ACCEPT/REJECT
```

### 场景 B：被动流（收到对端消息）

```
对端发来 envelope (PROPOSE / COUNTER_PROPOSE / ACCEPT / REJECT)
  → dispatchInboundHandshake
  → 记录 inbound 到 handshake_logs
  → executeJudgeL2(localTask, envelope)   ← Judge 在这里执行
  → 记录 outbound 到 handshake_logs
```

> 源码: `dispatcher.ts` (`dispatchInboundHandshake`) → `judge.ts` (`executeJudgeL2`)

---

## 四、Judge 执行流程

### 4.1 入口: `executeJudgeL2`

> 源码: `judge.ts`

```
executeJudgeL2(localTask, envelope)
  │
  │ ① 获取远端任务上下文
  ├── fetchRemoteTaskContext(envelope)
  │     → 当前: stub（从信封 payload 提取，detailedPlan 为空，isStubbed=true）
  │     → 未来: HTTP 请求获取远端完整 task 数据
  │
  │ ② 读取本地用户画像
  ├── readUserProfile() → .data/User.md
  │
  │ ③ 构建 Judge prompt（双方对称）
  ├── buildJudgePrompt(localTask, remoteContext, envelope, userProfile)
  │
  │ ④ 持久化 judge_request
  ├── appendAgentChatLog(direction="judge_request", ...)
  │
  │ ⑤ 调用 Judge LLM（chatOnce + 重试 3 次）
  ├── callJudgeWithRetry(prompt)
  │     ├── chatOnce(prompt, { system: JUDGE_SYSTEM_PROMPT })
  │     ├── extractJson → JSON.parse → Zod 校验
  │     ├── 成功 → JudgeDecision
  │     └── 失败 → 重试 / infra error 直接抛出
  │
  │ ⑥ 映射为 L2Decision（向后兼容）
  ├── judgeDecisionToL2Decision(decision)
  │     ├── MATCH / NEGOTIATE → ACCEPT
  │     └── REJECT → REJECT
  │
  │ ⑦ 持久化 judge_response + scratchpad
  ├── appendAgentChatLog(direction="judge_response", ...)
  └── appendScratchpadNote(...)

  catch → 持久化失败记录 → fallbackRuleJudge(task, envelope, error)
```

### 4.2 与旧 L2 的关键区别

| 维度 | 旧 L2 (executeL2Sandbox) | 新 Judge (executeJudgeL2) |
|------|------------------------|--------------------------|
| LLM 调用方式 | `Conversation` 多轮对话 | `chatOnce` 单次调用 |
| 信息对称性 | 只看本地 + 对端摘要 | 看双方完整信息（Side A + Side B） |
| 裁决粒度 | 二级（ACCEPT/REJECT） | 三级（MATCH/NEGOTIATE/REJECT） |
| 远端数据 | 仅信封 payload 3 字段 | detailedPlan + 全部字段（当前 stub） |
| 上下文恢复 | 从 DB 恢复多轮 Conversation | 无需恢复（每次独立评估） |
| 持久化 direction | l2_request / l2_response | judge_request / judge_response |
| 保留状态 | 旧代码保留，作为 Judge 降级的最后 fallback | — |

---

## 五、Judge System Prompt

> 源码: `judge.ts` (`JUDGE_SYSTEM_PROMPT`)

```
你是一个中立的任务匹配裁判（Judge）。
你会收到两个用户各自的任务计划，判断这两个任务是否兼容、能否匹配成一次共同活动。

输出严格符合 JudgeDecision JSON Schema。

评估维度（按权重排序）：
1. 活动兼容性（权重最高）：双方 detailedPlan 是否互补/兼容
2. 氛围对齐：双方 vibe 是否一致
3. 交互类型兼容：online/offline/any 的组合
4. 计划具体性：detailedPlan 为空时降低置信度但不自动 REJECT

裁决规则：
- MATCH (confidence >= 0.7)：高度兼容
- NEGOTIATE (confidence 0.4~0.7)：部分重叠，可协商
- REJECT (confidence < 0.4 或硬冲突)：不兼容
```

---

## 六、Judge User Prompt 结构

> 源码: `judge.ts` (`buildJudgePrompt`)

```
## Side A（本地任务）
task_id: {task_id}
interaction_type: {interaction_type}
targetActivity: {targetActivity}
targetVibe: {targetVibe}
detailedPlan: {完整 detailedPlan 或 "（未填写）"}
rawDescription: {rawDescription}

## Side B（对端任务）
task_id: {remote_task_id}
interaction_type: {interaction_type}
targetActivity: {target_activity}
targetVibe: {target_vibe}
detailedPlan: {远端 detailedPlan 或 "（未提供）"}
data_source: {stubbed | live}
[注意: Side B 的 detailedPlan 当前不可用（网络层未就绪）]

## 握手上下文
action: {PROPOSE | COUNTER_PROPOSE | ...}
round: {round}

## 用户画像（Side A 的用户，仅作辅助参考）
{User.md 内容，截断 1500 字符}

请输出你的 JudgeDecision JSON。
```

---

## 七、输出结构

### JudgeDecision（Judge 原始输出）

> 源码: `types.ts` (`JudgeDecisionSchema`, `DimensionScoresSchema`)

```typescript
{
  dimensionScores: {                           // 各维度独立打分（0~1）
    activityCompatibility: number,             //   活动兼容性（权重 0.45）
    vibeAlignment: number,                     //   氛围对齐（权重 0.25）
    interactionTypeMatch: number,              //   交互类型匹配（权重 0.20）
    planSpecificity: number,                   //   计划具体性（权重 0.10）
  },
  verdict: "MATCH" | "NEGOTIATE" | "REJECT",  // 三级裁决
  confidence: number,                          // 0~1 综合置信度（基于维度加权）
  shouldMoveToRevising: boolean,               // 建议 Side A 回到 Revising
  reasoning: string,                           // 内部推理过程（必须包含各维度评估理由）
  userFacingSummary: string                    // 面向用户的一句话摘要
}
```

### 硬约束校验（applyHardConstraints）

LLM 返回 JudgeDecision 后，代码层做一致性兜底（源码: `judge.ts`）：

| 条件 | 修正动作 |
|------|---------|
| interaction_type 硬冲突（online vs offline 且都不是 any） | 强制 interactionTypeMatch=0, verdict=REJECT, confidence ≤ 0.2 |
| verdict=MATCH 但 confidence < 0.7 | 降级为 NEGOTIATE |
| verdict=NEGOTIATE 但 confidence < 0.4 | 降级为 REJECT |
| verdict=REJECT 但 confidence >= 0.7 | confidence 压到 ≤ 0.35（信任 verdict） |

### L2Decision（向后兼容映射）

```typescript
{
  action: "ACCEPT" | "REJECT",       // MATCH/NEGOTIATE → ACCEPT, REJECT → REJECT
  shouldMoveToRevising: boolean,
  scratchpadNote: "[judge:MATCH:0.85] ..."  // 标记来源
}
```

### RemoteTaskContext（远端任务上下文）

> 源码: `types.ts` (`RemoteTaskContextSchema`)

```typescript
{
  taskId: string,
  detailedPlan: string,        // 核心字段，stub 时为空
  targetActivity: string,
  targetVibe: string,
  interactionType: "online" | "offline" | "any",
  isStubbed: boolean           // true = 网络层未就绪，数据为占位
}
```

---

## 八、数据存储

### handshake_logs 中每轮协商的记录

| 序号 | direction | envelope 内容 | 说明 |
|------|-----------|-------------|------|
| 1 | `inbound` | 对端握手信封 | 原始报文存档 |
| 2 | `judge_request` | `{ content: prompt, localTaskId, remoteTaskId, remoteIsStubbed, round }` | Judge 的输入 |
| 3 | `judge_response` | `{ content: LLM原始回复, parsedDecision: JudgeDecision, mappedL2Action }` | Judge 的裁决 |
| 4 | `outbound` | 本方回复的握手信封 | 发给对端的响应 |

### 数据查询

```sql
-- 查看某个任务的 Judge 裁决历史
SELECT direction, round, visible_to_user, user_summary,
       envelope->>'content' AS content,
       envelope->'parsedDecision'->>'verdict' AS verdict,
       envelope->'parsedDecision'->>'confidence' AS confidence,
       envelope->'parsedDecision'->>'reasoning' AS reasoning
FROM handshake_logs
WHERE task_id = '<task_id>'
  AND direction IN ('judge_request', 'judge_response')
ORDER BY timestamp;

-- 查看用户可见的裁决摘要
SELECT round, user_summary,
       envelope->'parsedDecision'->>'verdict' AS verdict,
       timestamp
FROM handshake_logs
WHERE task_id = '<task_id>' AND visible_to_user = true
ORDER BY timestamp;

-- 查看全部握手记录
SELECT direction, round, envelope->>'action' AS action,
       user_summary, timestamp
FROM handshake_logs
WHERE task_id = '<task_id>'
ORDER BY timestamp;
```

---

## 九、错误处理与降级

```
Judge LLM 调用
  │
  ├── 成功 → JudgeDecision → 映射为 L2Decision
  │
  └── 失败
      ├── 基础设施错误 (网络/认证/超时) → 立即降级，不重试
      ├── 格式不合规 → 带错误信息重试，最多 3 次
      ├── 空响应 → 立即降级
      │
      └── 全部失败 → fallbackRuleJudge（规则引擎）
          ├── 对端 REJECT → REJECT
          ├── COUNTER_PROPOSE + Waiting_Human → REJECT + shouldMoveToRevising
          ├── interaction_type 不兼容 → REJECT
          ├── 有实质内容 + 正向 action → ACCEPT
          └── 其他 → REJECT
```

fallback 的 `scratchpadNote` 标记 `[judge-fallback]` 便于排查。

---

## 十、占位说明与未来扩展

### 当前占位（isStubbed=true）

| 组件 | 当前状态 | 未来替换 |
|------|---------|---------|
| `fetchRemoteTaskContext` | 从信封 payload 提取，detailedPlan 为空 | HTTP 请求远端 API 获取完整 task 数据 |
| `RemoteTaskContext.detailedPlan` | 始终为空字符串 | 远端的实际 detailedPlan |
| `RemoteTaskContext.isStubbed` | 始终为 true | 根据实际获取结果设置 |

### 扩展点

- **网络层就绪后**：只需修改 `fetchRemoteTaskContext` 函数体，其余逻辑不变
- **Judge prompt 调优**：修改 `JUDGE_SYSTEM_PROMPT` 常量
- **裁决粒度**：可在 `JUDGE_VERDICT_VALUES` 中增加新级别（如 `PARTIAL_MATCH`）
- **旧 L2 代码**：`executeL2Sandbox` / `callL2WithRetry` / `restoreConversation` 等保留在 `dispatcher.ts` 中，可作为备用路径或 A/B 测试

---

## 十一、关键源码索引

| 文件 | 函数/类 | 说明 |
|------|--------|------|
| **`packages/agent/src/task-agent/judge.ts`** | `executeJudgeL2` | **Judge 入口（替代旧 executeL2Sandbox）** |
| 同上 | `fetchRemoteTaskContext` | 远端任务获取（当前 stub） |
| 同上 | `buildJudgePrompt` | 构建双方对称 prompt |
| 同上 | `callJudgeWithRetry` | LLM 调用 + 重试 |
| 同上 | `judgeDecisionToL2Decision` | 三级裁决 → L2Decision 映射 |
| 同上 | `fallbackRuleJudge` | 规则引擎降级 |
| `packages/agent/src/task-agent/dispatcher.ts` | `dispatchInboundHandshake` | 被动流入口（调用 Judge） |
| 同上 | `executeL2Sandbox` | 旧 L2 入口（保留，不再是主路径） |
| `packages/agent/src/task-agent/types.ts` | `JudgeDecisionSchema` | Judge 输出 Zod Schema |
| 同上 | `RemoteTaskContextSchema` | 远端任务上下文 Schema |
| `packages/agent/src/task-agent/storage.ts` | `appendAgentChatLog` | 写入 handshake_logs |
| `packages/core/src/llm/chat.ts` | `chatOnce` | Judge 使用的单次 LLM 调用 |
