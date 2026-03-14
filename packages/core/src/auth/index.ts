/**
 * auth/index.ts — 客户端导出（不含 pg 依赖）
 */
export { createProxyAuthService } from "./proxy";
export type {
  AuthServiceLike,
  AuthUser,
  AuthTokenPair,
  AuthResult,
} from "./proxy";
