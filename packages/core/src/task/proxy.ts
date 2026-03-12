/**
 * TaskService — 客户端服务层（Proxy 模式）
 *
 * 与 PersonaService 对齐的架构模式：
 *   客户端（浏览器/Native）→ Proxy → BFF API → @repo/agent
 *
 * 两个核心方法对应策略 A 的两个阶段：
 *   1. extract()  — 每轮用户发言调用，返回提取结果 + AI 追问
 *   2. createFromIntake() — 用户确认后调用，创建 TaskAgent + 启动 FSM
 */

// ─── 提取结果类型（与 @repo/agent ExtractionResult 对齐） ──────────

export interface ExtractedFields {
  interaction_type: "online" | "offline" | "any" | "";
  rawDescription: string;
  targetActivity: string;
  targetVibe: string;
  detailedPlan: string;
}

export interface ExtractionResult {
  /** 当前提取到的字段（可能部分为空） */
  fields: ExtractedFields;
  /** 所有必填字段是否已填充 */
  complete: boolean;
  /** 仍然缺失的字段名列表 */
  missingFields: string[];
  /** complete=false 时，LLM 生成的针对性追问 */
  followUpQuestion: string | null;
}

export interface TaskCreateResult {
  taskId: string;
  personaId: string;
  rawDescription: string;
  targetActivity?: string;
  targetVibe?: string;
  status: string;
}

// ─── 服务接口定义 ────────────────────────────────────────────────────

/** TaskService 统一接口 — 前端组件通过 props 注入 */
export interface TaskServiceLike {
  /**
   * 逐轮提取：发送用户消息 + 历史对话 → 返回 LLM 提取结果
   * complete=false → followUpQuestion 作为 AI 回复
   * complete=true  → fields 展示确认摘要
   */
  extract(params: {
    personaId: string;
    userMessage: string;
    conversationHistory: string[];
  }): Promise<ExtractionResult>;

  /**
   * 确认创建：用户确认后，将完整对话提交 → 创建 TaskAgent + 启动 FSM
   */
  createFromIntake(params: {
    personaId: string;
    conversationTurns: string[];
  }): Promise<TaskCreateResult>;
}

// ─── 通用 fetch 封装 ─────────────────────────────────────────────────

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new Error(`[TaskProxy] ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ─── Proxy 工厂函数 ──────────────────────────────────────────────────

/**
 * 创建客户端 Proxy 服务实例
 * @param baseUrl - BFF 路由前缀，如 "/api" 或 "http://192.168.x.x:3030/api"
 */
export function createProxyTaskService(baseUrl: string): TaskServiceLike {
  return {
    /** 逐轮提取 — POST /api/agents/task/extract */
    async extract(params) {
      return request<ExtractionResult>(`${baseUrl}/agents/task/extract`, {
        method: "POST",
        body: JSON.stringify(params),
      });
    },

    /** 确认创建 — POST /api/agents/task/create */
    async createFromIntake(params) {
      return request<TaskCreateResult>(`${baseUrl}/agents/task/create`, {
        method: "POST",
        body: JSON.stringify(params),
      });
    },
  };
}

// ─── 平台自适应工厂（与 PersonaService 对齐） ───────────────────────

export type TaskPlatform = "web-browser" | "expo-web" | "native";

export interface PlatformTaskConfig {
  platform: TaskPlatform;
  /** BFF 地址 — expo-web / native 必须提供 */
  proxyBaseUrl?: string;
}

/**
 * 统一 Service 工厂 — 根据平台自动选择正确的数据通路。
 * 与 PersonaService 同源同构，App 层只需调用一次并注入 Screen 组件。
 */
export function createTaskServiceForPlatform(
  config: PlatformTaskConfig,
): TaskServiceLike {
  switch (config.platform) {
    case "web-browser":
      return createProxyTaskService(config.proxyBaseUrl ?? "/api");

    case "expo-web":
      if (!config.proxyBaseUrl) {
        throw new Error("expo-web 平台必须提供 proxyBaseUrl（BFF 地址）");
      }
      return createProxyTaskService(config.proxyBaseUrl);

    case "native":
      if (!config.proxyBaseUrl) {
        throw new Error("native 平台必须提供 proxyBaseUrl（需从 Metro hostUri 推导）");
      }
      return createProxyTaskService(config.proxyBaseUrl);

    default:
      throw new Error(`未知平台: ${config.platform as string}`);
  }
}
