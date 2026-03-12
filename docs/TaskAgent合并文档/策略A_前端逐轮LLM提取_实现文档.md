# 策略 A：前端逐轮 LLM 提取 — 实现文档

> 版本：v1.0 | 日期：2026-03-12 | 状态：已实现 + 构建验证通过

---

## 大白话简介

想象你去餐厅点菜：

1. **你说**："我想吃辣的" → 服务员记下来，追问"火锅还是川菜？"
2. **你说**："火锅，4 个人" → 服务员继续追问"什么锅底？"
3. **你说**："鸳鸯锅" → 服务员确认"辣的鸳鸯锅，4 人，对吗？" → **你点头** → 下单！

**策略 A 就是这个过程的数字版**：

```
用户发消息 → LLM 提取关键信息 → 没提取完？AI 继续追问
                                → 提取完了？展示摘要 → 用户确认 → 创建任务
```

**核心特点**：每轮对话都调一次 LLM，无状态重放历史（BFF 不存 session）。

---

## 一、架构总览

### 1.1 数据流全链路

```
┌───────────────────────┐
│   TaskChatScreen (UI) │
│   packages/ui/screens │
└───────┬───────────────┘
        │ taskService.extract()
        ▼
┌───────────────────────┐
│  @repo/core/task      │ ← 客户端 Proxy（浏览器/Native 安全）
│  TaskServiceLike      │
└───────┬───────────────┘
        │ POST /api/agents/task/extract
        ▼
┌──────────────────────────────┐
│  BFF — apps/web/app/api/     │ ← 薄壳路由（仅 HTTP 解析 + 转发）
│  agents/task/extract/route   │
└───────┬──────────────────────┘
        │ createExtractionConversation() + extractFromConversation()
        ▼
┌───────────────────────┐
│   @repo/agent         │ ← Intake 层 LLM 多轮提取
│   task-agent/intake   │
└───────────────────────┘
```

### 1.2 两阶段分工

| 阶段 | 触发 | 调用链 | 产物 |
|------|------|--------|------|
| **提取阶段** | 用户每次发消息 | UI → Proxy → BFF → `extractFromConversation()` | `ExtractionResult`（字段 + 追问 or 摘要） |
| **创建阶段** | 用户点击「创建任务」 | UI → Proxy → BFF → `createTaskAgentFromIntake()` → FSM `step()` | TaskAgent 实例 + task.md + embedding + Drafting→Searching |

### 1.3 包边界对齐

```
客户端安全线                    服务端
──────────────────┼──────────────────────
@repo/core/task   │  @repo/agent
(proxy.ts)        │  (intake.ts, index.ts)
                  │
@repo/ui          │  @repo/core/persona-server
(TaskChatScreen)  │  (getPersonaWithProfile)
                  │
apps/native       │  apps/web/app/api
(agent-task-chat) │  (agents/task/*)
```

**关键约束**：客户端永远不 import 含 `pg` 的包。`@repo/core/task` 子路径只导出 Proxy + 类型。

---

## 二、涉及文件清单

### 2.1 新建文件（6 个）

| 文件 | 包 | 职责 |
|------|----|----|
| `packages/core/src/task/proxy.ts` | @repo/core | TaskServiceLike 接口 + Proxy 工厂 + 平台自适应工厂 |
| `apps/web/app/api/agents/task/extract/route.ts` | apps/web | BFF：重建 Conversation + 调 extractFromConversation |
| `apps/web/app/api/agents/task/create/route.ts` | apps/web | BFF：查 persona → 构建 PersonaContext → createTaskAgentFromIntake → FSM step |
| `apps/native/app/agent-task-chat.tsx` | apps/native | Native 薄壳：路由参数解析 + TaskService 注入 |
| _(agent index.ts 修改)_ | @repo/agent | 新增 intake 层导出 |
| _(UI index.tsx 修改)_ | @repo/ui | 新增 TaskServiceLike 类型导出 |

### 2.2 重写文件（1 个）

| 文件 | 改动 |
|------|------|
| `packages/ui/src/screens/TaskChatScreen.tsx` | 从占位 UI → 完整策略 A 实现（LLM 提取 + 确认 + 创建） |

### 2.3 配置修改（2 个）

| 文件 | 改动 |
|------|------|
| `packages/core/package.json` | 新增 `"./task"` 子路径导出 |
| `packages/core/tsup.config.ts` | entry 数组新增 `"src/task/proxy.ts"` |

---

## 三、核心接口定义

### 3.1 ExtractionResult（提取结果）

```typescript
interface ExtractionResult {
  fields: {
    interaction_type: "online" | "offline" | "any" | "";
    rawDescription: string;      // 核心需求描述
    targetActivity: string;      // 目标活动
    targetVibe: string;          // 期望氛围
    detailedPlan: string;        // 详细计划
  };
  complete: boolean;             // 所有必填字段是否已填充
  missingFields: string[];       // 仍缺失的字段名
  followUpQuestion: string | null; // complete=false 时 LLM 生成的追问
}
```

### 3.2 TaskServiceLike（服务接口）

```typescript
interface TaskServiceLike {
  extract(params: {
    personaId: string;
    userMessage: string;
    conversationHistory: string[];  // ["用户：xxx", "AI：xxx", ...]
  }): Promise<ExtractionResult>;

  createFromIntake(params: {
    personaId: string;
    conversationTurns: string[];    // 完整对话历史
  }): Promise<TaskCreateResult>;
}
```

### 3.3 PersonaContext（创建阶段用）

```typescript
interface PersonaContext {
  personaId: string;
  personaName: string;
  soulText: string;         // persona_profiles.profile_text
  preferences: Record<string, unknown>;
  relevantMemory: string;
  tokenBudget: number;      // 默认 4000
}
```

---

## 四、各文件实现要点

### 4.1 TaskServiceLike Proxy — `packages/core/src/task/proxy.ts`

**设计模式**：与 PersonaService 完全对齐的 Proxy + 平台工厂模式。

```
createTaskServiceForPlatform({ platform, proxyBaseUrl })
  ├─ web-browser  → createProxyTaskService("/api")
  ├─ expo-web     → createProxyTaskService(proxyBaseUrl)  // 必须提供
  └─ native       → createProxyTaskService(proxyBaseUrl)  // 必须提供
```

**子路径导出配置**：
```jsonc
// package.json
"./task": {
  "import": "./dist/task/proxy.mjs",
  "require": "./dist/task/proxy.js",
  "types": "./dist/task/proxy.d.ts"
}
```

### 4.2 提取路由 — `apps/web/app/api/agents/task/extract/route.ts`

**核心难点**：无状态 BFF 如何还原有状态的多轮对话？

**解法：每次请求重放历史**

```
请求到达 → 创建新 Conversation → 逐条注入历史 user 消息（conv.say）
→ 执行本轮 extractFromConversation(conv, userMessage) → 返回结果
```

> AI 回复不需要手动注入 — `conv.say()` 内部调 LLM 后会自动记录 assistant 消息。

**性能注意**：每次请求都会对历史消息逐条调 LLM。对话轮次多时开销大，后续可优化为直接注入 message 数组（跳过 LLM 调用）。

### 4.3 创建路由 — `apps/web/app/api/agents/task/create/route.ts`

**流程**：

```
1. 校验参数
2. getPersonaWithProfile(personaId) → 查 DB 获取人格档案
3. 构建 PersonaContext { personaId, personaName, soulText, preferences, ... }
4. createTaskAgentFromIntake(conversationTurns, personaContext)
   → LLM 提取 → buildTaskDocument → saveTaskMD → embedding
5. taskAgent.step() → Drafting → Searching（自动开始匹配）
   → 失败不影响任务创建（已持久化，后续 task_loop 可重试）
6. 返回 { taskId, personaId, rawDescription, targetActivity, targetVibe, status }
```

### 4.4 TaskChatScreen — `packages/ui/src/screens/TaskChatScreen.tsx`

**状态机（UI 侧）**：

```
初始 → [用户发消息] → extracting=true
  → LLM 返回 complete=false → AI 追问气泡 → 回到初始
  → LLM 返回 complete=true  → 确认摘要气泡 → extractionComplete=true
    → [用户点击 ✦] → creating=true → createFromIntake → 成功 → 1.5s 后返回
```

**向后兼容**：
- 有 `taskService` → 策略 A 完整流程
- 无 `taskService` + 有 `onCreateTask` → 旧模式占位回复

**UI 特性**：
- 液态玻璃输入栏（iOS BlurView / Android 降级）
- 确认摘要消息带高亮边框（`accent + 40` 透明度）
- 提取中显示 ActivityIndicator 思考气泡
- `✦` 创建按钮仅在 extractionComplete 时出现

### 4.5 Native 薄壳 — `apps/native/app/agent-task-chat.tsx`

**极简注入模式**（与架构规范对齐：apps/ 不写业务逻辑）：

```typescript
const taskService = useMemo(() => {
  const config = getPersonaPlatformConfig();
  return createTaskServiceForPlatform({
    platform: config.platform,
    proxyBaseUrl: config.proxyBaseUrl,
  });
}, []);

return (
  <TaskChatScreen
    personaId={params.personaId}
    personaName={params.personaName}
    actionKey={params.actionKey}
    onGoBack={handleGoBack}
    taskService={taskService}    // ← 注入
  />
);
```

### 4.6 Agent 导出 — `packages/agent/src/index.ts`

新增的 intake 层导出：

```typescript
// Intake 层 — BFF 路由直接调用
export { createExtractionConversation, extractFromConversation, buildTaskDocument } from "./task-agent/intake";
export type { ExtractionResult, IntakePersistCtx } from "./task-agent/intake";
```

> **注意**：`@repo/agent` 没有子路径导出。BFF 只能 `import { xxx } from "@repo/agent"` 从主入口导入。

---

## 五、对话序列化协议

前端和 BFF 之间的对话历史采用字符串数组格式：

```typescript
// 序列化规则
[
  "用户：我想找人一起打羽毛球",
  "AI：好的！你偏好线上还是线下活动？",
  "用户：线下，最好在北京",
  "AI：了解，什么时间段比较方便？",
  "用户：周末下午",
]
```

**解析规则（BFF 侧）**：
- `用户：` 或 `用户:` 前缀 → user 消息，调 `conv.say(content)`
- `AI：` 前缀 → 跳过（Conversation 内部自动记录 assistant 消息）

---

## 六、构建依赖链

```
npm run build -w packages/core    ← 先构建 core（生成 task/proxy 的 dist）
npm run build -w packages/agent   ← 再构建 agent（生成 intake 导出的 dist）
npm run build -w packages/ui      ← 再构建 ui（TaskChatScreen 依赖 core/task 类型）
npx tsc --noEmit -p apps/web      ← 最后检查 web（BFF 依赖 agent + core）
```

**已验证**：全链路 0 TypeScript 错误。

---

## 七、已知限制与优化方向

| 限制 | 原因 | 优化思路 |
|------|------|---------|
| 历史重放每轮调 LLM | `conv.say()` 每次都触发 LLM 推理 | 后续改为直接注入 message 数组，跳过历史轮次的 LLM 调用 |
| 无 SSE 流式 | extract 返回完整 JSON | 追问消息可改为流式逐字显示 |
| 无错误重试 | 单次失败直接提示用户 | 可加指数退避自动重试 |
| 无离线缓存 | 每次请求都走网络 | Native 端可加本地 draft 缓存 |

---

## 八、与已有文档的关系

| 文档 | 关系 |
|------|------|
| `TaskAgent_任务总览文档.md` | 本文档是其中 **Part 1（发布 Tab）** 的具体实现 |
| `TaskAgent_开发阶段文档.md` | 对应 **Phase 6（Intake 对话前端）** + 部分 **Phase 7（BFF 路由）** |
| `Turborepo架构规范.md` | 本实现严格遵循薄壳 + 服务注入 + 子路径导出规范 |

---

## 九、快速验证

```bash
# 1. 构建全链路
npm run build -w packages/core && \
npm run build -w packages/agent && \
npm run build -w packages/ui

# 2. 类型检查
npx tsc --noEmit -p apps/web/tsconfig.json

# 3. 端到端测试（需要运行 web server + DB）
# POST /api/agents/task/extract
curl -X POST http://localhost:3030/api/agents/task/extract \
  -H "Content-Type: application/json" \
  -d '{"personaId":"test","userMessage":"我想找人打羽毛球","conversationHistory":[]}'
```
