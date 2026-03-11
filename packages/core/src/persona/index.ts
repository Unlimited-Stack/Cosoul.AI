/**
 * PersonaAgent — 统一导出
 *
 * - service.ts：服务端 DB 操作（含 pg 依赖，仅 BFF/服务端使用）
 * - proxy.ts：客户端 Proxy（无 pg 依赖，浏览器/Native 安全）
 */

// 服务端 DB 操作函数
export {
  listPersonas,
  createPersona,
  getPersona,
  getPersonaWithProfile,
  listTasks,
  createTask,
} from "./service";

// 客户端 Proxy 服务
export { createProxyPersonaService } from "./proxy";

// 类型导出
export type { PersonaServiceLike } from "./proxy";
