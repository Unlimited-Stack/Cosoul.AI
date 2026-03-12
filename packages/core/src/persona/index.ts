/**
 * PersonaAgent — 统一导出
 *
 * - service.ts：服务端 DB CRUD（含 pg 依赖，仅 BFF/服务端使用）
 * - proxy.ts：客户端 Proxy + 平台工厂（无 pg 依赖，浏览器/Native 安全）
 *
 * 与 LLM 的区别：Persona 数据源是本地 DB，不是公网 API，
 * 所以当前所有平台都走 Proxy。上云后 Native 端将新增 Direct 模式。
 * 详见 docs/persona-vs-llm-网络架构差异.md
 */

// 服务端 DB 操作函数
export {
  listPersonas,
  createPersona,
  getPersona,
  getPersonaWithProfile,
  listTasks,
  createTask,
  deletePersona,
  deleteTask,
} from "./service";

// 客户端 Proxy 服务 + 平台工厂
export {
  createProxyPersonaService,
  createPersonaServiceForPlatform,
} from "./proxy";

// 类型导出
export type {
  PersonaServiceLike,
  PersonaPlatform,
  PlatformPersonaConfig,
} from "./proxy";
