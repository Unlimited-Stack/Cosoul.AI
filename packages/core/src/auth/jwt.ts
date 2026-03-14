/**
 * jwt.ts — JWT 签发 + 验证 + Refresh Token 生成
 *
 * Access Token: JWT HS256, 15 分钟有效期
 * Refresh Token: 随机 64 字节 hex，DB 存 SHA-256 哈希
 */

import jwt from "jsonwebtoken";
import crypto from "crypto";

// JWT 密钥（生产环境必须通过环境变量注入）
const JWT_SECRET = process.env.JWT_SECRET ?? "cosoul-dev-jwt-secret-change-in-production";

const ACCESS_TOKEN_EXPIRES = "15m";
export const REFRESH_TOKEN_DAYS = 7;

// ─── JWT Payload ─────────────────────────────────────────────────

export interface JwtPayload {
  sub: string;     // user_id
  email: string;
  tier: string;    // subscription_tier
}

// ─── Access Token ────────────────────────────────────────────────

/** 签发 Access Token（JWT, 15 分钟） */
export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRES });
}

/** 验证 Access Token，返回 payload 或抛异常 */
export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

// ─── Refresh Token ───────────────────────────────────────────────

/** 生成随机 refresh token（64 字节 hex） */
export function generateRefreshToken(): string {
  return crypto.randomBytes(64).toString("hex");
}

/** 对 refresh token 做 SHA-256 哈希（DB 只存哈希，不存原文） */
export function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
