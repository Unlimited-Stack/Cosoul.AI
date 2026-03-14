/**
 * AuthService — 认证核心逻辑（服务端）
 *
 * 功能：注册、登录、Token 刷新、登出、找回密码、重置密码
 * 依赖 drizzle db + pg，仅供 BFF 路由调用。
 */

import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, gt } from "drizzle-orm";
import {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
} from "./password";
import {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  REFRESH_TOKEN_DAYS,
  type JwtPayload,
} from "./jwt";
import crypto from "crypto";

// ─── 返回类型 ────────────────────────────────────────────────────

/** 安全的用户信息（不含 passwordHash 等内部字段） */
export interface AuthUser {
  userId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  subscriptionTier: string;
}

export interface AuthTokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult {
  user: AuthUser;
  tokens: AuthTokenPair;
}

// ─── 错误类 ──────────────────────────────────────────────────────

export class AuthError extends Error {
  constructor(
    message: string,
    public statusCode: number = 401,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

// ─── 内部工具 ────────────────────────────────────────────────────

/** 从 DB 行提取安全的用户信息 */
function toAuthUser(row: {
  userId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  subscriptionTier: string;
}): AuthUser {
  return {
    userId: row.userId,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatarUrl,
    subscriptionTier: row.subscriptionTier,
  };
}

/** 签发 token 对 + 写入 refresh_tokens 表 */
async function issueTokenPair(
  user: AuthUser,
  deviceInfo?: string,
): Promise<AuthTokenPair> {
  const payload: JwtPayload = {
    sub: user.userId,
    email: user.email,
    tier: user.subscriptionTier,
  };
  const accessToken = signAccessToken(payload);
  const refreshToken = generateRefreshToken();
  const tokenHash = hashRefreshToken(refreshToken);

  // 写入 DB（refresh token 只存哈希）
  await db.insert(schema.refreshTokens).values({
    userId: user.userId,
    tokenHash,
    deviceInfo: deviceInfo ?? null,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 3600 * 1000),
  });

  return { accessToken, refreshToken };
}

// ─── 注册 ────────────────────────────────────────────────────────

export async function register(input: {
  email: string;
  password: string;
  name?: string;
  deviceInfo?: string;
}): Promise<AuthResult> {
  // 1. 校验
  const strengthErr = validatePasswordStrength(input.password);
  if (strengthErr) throw new AuthError(strengthErr, 400);

  const emailLower = input.email.toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower)) {
    throw new AuthError("邮箱格式不正确", 400);
  }

  // 2. 查重
  const [existing] = await db
    .select({ userId: schema.users.userId })
    .from(schema.users)
    .where(eq(schema.users.email, emailLower))
    .limit(1);
  if (existing) throw new AuthError("该邮箱已注册", 409);

  // 3. 哈希密码 + 入库
  const passwordHash = await hashPassword(input.password);
  const [newUser] = await db
    .insert(schema.users)
    .values({
      email: emailLower,
      passwordHash,
      name: input.name ?? null,
      subscriptionTier: "free",
      status: "active",
      lastLoginAt: new Date(),
    })
    .returning({
      userId: schema.users.userId,
      email: schema.users.email,
      name: schema.users.name,
      avatarUrl: schema.users.avatarUrl,
      subscriptionTier: schema.users.subscriptionTier,
    });

  // 4. 签发 token
  const user = toAuthUser(newUser);
  const tokens = await issueTokenPair(user, input.deviceInfo);

  return { user, tokens };
}

// ─── 登录 ────────────────────────────────────────────────────────

export async function login(input: {
  email: string;
  password: string;
  deviceInfo?: string;
}): Promise<AuthResult> {
  const emailLower = input.email.toLowerCase().trim();

  // 1. 查用户
  const [row] = await db
    .select({
      userId: schema.users.userId,
      email: schema.users.email,
      name: schema.users.name,
      avatarUrl: schema.users.avatarUrl,
      subscriptionTier: schema.users.subscriptionTier,
      passwordHash: schema.users.passwordHash,
      status: schema.users.status,
    })
    .from(schema.users)
    .where(eq(schema.users.email, emailLower))
    .limit(1);

  // 2. 不暴露邮箱是否注册
  if (!row) throw new AuthError("邮箱或密码错误");

  // 3. 账号状态
  if (row.status !== "active") {
    throw new AuthError("账号已被暂停或已注销", 403);
  }

  // 4. 验证密码
  const valid = await verifyPassword(input.password, row.passwordHash);
  if (!valid) throw new AuthError("邮箱或密码错误");

  // 5. 更新 last_login_at
  await db
    .update(schema.users)
    .set({ lastLoginAt: new Date() })
    .where(eq(schema.users.userId, row.userId));

  // 6. 签发 token
  const user = toAuthUser(row);
  const tokens = await issueTokenPair(user, input.deviceInfo);

  return { user, tokens };
}

// ─── Token 刷新 ──────────────────────────────────────────────────

export async function refresh(input: {
  refreshToken: string;
  deviceInfo?: string;
}): Promise<AuthTokenPair> {
  const tokenHash = hashRefreshToken(input.refreshToken);

  // 1. 查找有效的 refresh token
  const [tokenRow] = await db
    .select({
      id: schema.refreshTokens.id,
      userId: schema.refreshTokens.userId,
      revoked: schema.refreshTokens.revoked,
      expiresAt: schema.refreshTokens.expiresAt,
    })
    .from(schema.refreshTokens)
    .where(eq(schema.refreshTokens.tokenHash, tokenHash))
    .limit(1);

  if (!tokenRow) throw new AuthError("无效的刷新令牌");

  // 检测 token 重用攻击：已吊销的 token 被使用 → 全量吊销该用户所有 token
  if (tokenRow.revoked) {
    await db
      .update(schema.refreshTokens)
      .set({ revoked: true })
      .where(eq(schema.refreshTokens.userId, tokenRow.userId));
    throw new AuthError("检测到令牌重用，已强制登出所有设备");
  }

  if (tokenRow.expiresAt < new Date()) {
    throw new AuthError("刷新令牌已过期，请重新登录");
  }

  // 2. 吊销旧 token（Rotation）
  await db
    .update(schema.refreshTokens)
    .set({ revoked: true })
    .where(eq(schema.refreshTokens.id, tokenRow.id));

  // 3. 查用户信息 + 签发新 token 对
  const [userRow] = await db
    .select({
      userId: schema.users.userId,
      email: schema.users.email,
      name: schema.users.name,
      avatarUrl: schema.users.avatarUrl,
      subscriptionTier: schema.users.subscriptionTier,
      status: schema.users.status,
    })
    .from(schema.users)
    .where(eq(schema.users.userId, tokenRow.userId))
    .limit(1);

  if (!userRow || userRow.status !== "active") {
    throw new AuthError("账号已被暂停或已注销", 403);
  }

  const user = toAuthUser(userRow);
  return issueTokenPair(user, input.deviceInfo);
}

// ─── 登出 ────────────────────────────────────────────────────────

export async function logout(refreshToken: string): Promise<void> {
  const tokenHash = hashRefreshToken(refreshToken);
  await db
    .update(schema.refreshTokens)
    .set({ revoked: true })
    .where(eq(schema.refreshTokens.tokenHash, tokenHash));
}

/** 登出所有设备（吊销用户的全部 refresh token） */
export async function logoutAll(userId: string): Promise<void> {
  await db
    .update(schema.refreshTokens)
    .set({ revoked: true })
    .where(eq(schema.refreshTokens.userId, userId));
}

// ─── 找回密码（发送验证码）────────────────────────────────────────

export async function forgotPassword(email: string): Promise<{ sent: boolean }> {
  const emailLower = email.toLowerCase().trim();

  // 查用户（不存在也返回成功，不暴露邮箱是否注册）
  const [userRow] = await db
    .select({ userId: schema.users.userId })
    .from(schema.users)
    .where(eq(schema.users.email, emailLower))
    .limit(1);

  if (!userRow) return { sent: true };

  // 限频检查：60 秒内不能重复发送
  const [recent] = await db
    .select({ id: schema.passwordResetCodes.id })
    .from(schema.passwordResetCodes)
    .where(
      and(
        eq(schema.passwordResetCodes.userId, userRow.userId),
        gt(schema.passwordResetCodes.createdAt, new Date(Date.now() - 60_000)),
      ),
    )
    .limit(1);

  if (recent) throw new AuthError("验证码发送过于频繁，请 60 秒后重试", 429);

  // 生成 6 位验证码 + 15 分钟过期
  const code = crypto.randomInt(100000, 999999).toString();
  await db.insert(schema.passwordResetCodes).values({
    userId: userRow.userId,
    code,
    expiresAt: new Date(Date.now() + 15 * 60_000),
  });

  // TODO: 接入邮件服务发送验证码（开发阶段打印到控制台）
  console.log(`[auth] 找回密码验证码: ${code}（发送至 ${emailLower}）`);

  return { sent: true };
}

// ─── 重置密码 ────────────────────────────────────────────────────

export async function resetPassword(input: {
  email: string;
  code: string;
  newPassword: string;
}): Promise<void> {
  const emailLower = input.email.toLowerCase().trim();

  // 校验新密码强度
  const strengthErr = validatePasswordStrength(input.newPassword);
  if (strengthErr) throw new AuthError(strengthErr, 400);

  // 查用户
  const [userRow] = await db
    .select({ userId: schema.users.userId })
    .from(schema.users)
    .where(eq(schema.users.email, emailLower))
    .limit(1);

  if (!userRow) throw new AuthError("验证码无效或已过期", 400);

  // 查验证码
  const [codeRow] = await db
    .select({
      id: schema.passwordResetCodes.id,
      expiresAt: schema.passwordResetCodes.expiresAt,
    })
    .from(schema.passwordResetCodes)
    .where(
      and(
        eq(schema.passwordResetCodes.userId, userRow.userId),
        eq(schema.passwordResetCodes.code, input.code),
        eq(schema.passwordResetCodes.used, false),
      ),
    )
    .limit(1);

  if (!codeRow || codeRow.expiresAt < new Date()) {
    throw new AuthError("验证码无效或已过期", 400);
  }

  // 更新密码 + 标记验证码已用 + 吊销全部 refresh token
  const newHash = await hashPassword(input.newPassword);
  await db
    .update(schema.users)
    .set({ passwordHash: newHash, updatedAt: new Date() })
    .where(eq(schema.users.userId, userRow.userId));

  await db
    .update(schema.passwordResetCodes)
    .set({ used: true })
    .where(eq(schema.passwordResetCodes.id, codeRow.id));

  await logoutAll(userRow.userId);
}
