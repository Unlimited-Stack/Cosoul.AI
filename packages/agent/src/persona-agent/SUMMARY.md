# Persona-Agent 功能总结

## 一、整体定位

Persona-Agent 是**长期人格档案管理层**，负责维护每个 Persona 的"灵魂文件"（Soul.md）和"跨任务记忆"（Memory.md）。它**不直接执行任务**，而是为 Task-Agent 提供只读的 `PersonaContext`，让任务执行时带上人格偏好。

核心职责：
- 加载 & 解析 Soul.md（人格身份文档）
- 管理 Memory.md（跨任务经验笔记）
- 从任务完成结果中学习偏好
- 向 Task-Agent 注入人格上下文

---

## 二、文件结构与功能

### 1. `index.ts` — PersonaAgent 主类

| 方法 | 说明 |
|------|------|
| `getContext()` | 构建只读 PersonaContext，注入给 TaskAgent |
| `onTaskCompleted()` | 任务完成后触发学习流程，更新 Memory.md |
| `getSoulText()` | 返回 Soul.md 原始文本 |
| `getMemoryText()` | 返回 Memory.md 原始文本 |

**设计原则**：不直接操作 DB，委托给各 service 层。

### 2. `soul-loader.ts` — Soul.md 加载与偏好提取

- `parseSoulMd()` — 解析 Soul.md 为结构化对象
- `serializeSoulMd()` — 结构化对象序列化回 Markdown
- `extractPreferences()` — 从 Soul.md 中提取结构化偏好

**Soul.md 四大板块**：
1. **Core Identity** — 核心人格定义
2. **Preferences** — 偏好设定
3. **Values & Vibe** — 价值观与调性
4. **History Annotations** — 历史注释（由 agent 自动追加）

**Frontmatter 字段**：`persona_id`, `persona_name`, `owner_user_id`, `version`, `created_at`, `updated_at`

### 3. `soul-updater.ts` — Soul.md 自动更新

- 仅追加 History Annotations 板块（用户不可通过 agent 编辑其他板块）
- 自动递增 version 号
- 每条注释带时间戳

### 4. `memory-manager.ts` — Memory.md 读写管理

- `parseMemoryMd()` / `serializeMemoryMd()` — 解析/序列化
- `appendLearning()` — 将学习结果追加到 Memory
- `createEmptyMemory()` — 为新 Persona 创建空 Memory

**Memory.md 三大板块**：
1. **Matching Patterns** — 匹配模式（跨任务聚合）
2. **Preference Log** — 偏好变化日志
3. **Token Stats** — Token 消耗统计

**Frontmatter 字段**：`persona_id`, `last_updated`, 任务计数

### 5. `preference-learner.ts` — 偏好学习（纯文本分析）

- P1 阶段：**纯规则匹配，不调用 LLM**
- 检测任务结果（completed / cancelled / timeout）
- 从任务摘要中提取 insights 和 suggested updates
- 基于关键词的偏好检测

### 6. `types.ts` — Zod Schema 与类型定义

| Schema | 说明 |
|--------|------|
| `SoulDocumentSchema` | Soul.md 结构验证 |
| `MemoryDocumentSchema` | Memory.md 结构验证 |
| `PersonaContextSchema` | 注入给 TaskAgent 的上下文 |
| `PreferenceLearningSchema` | 偏好学习结果 |

**PERSONA_CONFIG 常量**：月度 Token 预算 (500K)、默认单任务预算 (10K)、Memory 大小上限 (8K chars)

---

## 三、与 Task-Agent 的可复用分析

### 高度重叠（建议提取为共享模块）

| 领域 | Persona-Agent | Task-Agent | 建议 |
|------|--------------|------------|------|
| Markdown 解析 | `parseSoulMd()`, `parseMemoryMd()` | 类似的文档解析逻辑 | 提取 `shared/markdown-parser.ts` |
| Token 预算 | `PERSONA_CONFIG` 中的预算常量 | `context.ts` 中的 Token 估算与截断 | 提取 `shared/token-budget.ts` |
| Zod 校验模式 | 时间戳/UUID/枚举校验 | 同样的 Zod 模式 | 提取 `shared/zod-schemas.ts` |
| 版本管理 | Soul.md version 递增 | `storage.ts` 乐观锁 version 检查 | 提取 `shared/optimistic-lock.ts` |
| 时间戳工具 | ISO 格式化 | ISO 格式化 | 提取 `shared/timestamp-utils.ts` |

### 功能互补（不应合并）

| Persona-Agent 独有 | Task-Agent 独有 |
|-------------------|----------------|
| Soul.md 四板块人格文档 | 向量嵌入（DashScope API） |
| 跨任务偏好学习 | PostgreSQL 存储 + Drizzle ORM |
| Memory.md 经验聚合 | 三层匹配漏斗 (L0/L1/L2) |
| 纯文本规则分析 | Handshake 协议 & HTTP Listener |
| — | FSM 状态机 & 乐观锁 |
| — | 可观测性日志 |

### 集成关系

```
PersonaAgent.getContext()
        │
        ▼  (注入只读 PersonaContext)
  TaskAgent(taskId, personaContext)
        │
        ▼  (任务执行完毕)
PersonaAgent.onTaskCompleted(taskSummary)
        │
        ▼  (更新 Memory.md & Soul.md)
```

---

## 四、推荐重构方案

```
packages/agent/src/
├── shared/                    ← 新建共享模块
│   ├── markdown-parser.ts     ← frontmatter 解析 + section 分割
│   ├── token-budget.ts        ← Token 估算 + 截断 + 阈值检查
│   ├── zod-schemas.ts         ← 通用 Zod 校验器
│   ├── optimistic-lock.ts     ← 版本冲突检测 + 递增
│   └── timestamp-utils.ts     ← ISO 格式化 + 日期解析
├── persona-agent/             ← 保留人格领域逻辑
└── task-agent/                ← 保留任务领域逻辑
```

**核心原则**：提取工具层复用，保持领域逻辑隔离。
