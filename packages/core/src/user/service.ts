/**
 * UserService — 服务端 DB CRUD（用户信息管理）
 *
 * 服务端专用，依赖 drizzle db + pg，供 BFF 路由调用。
 * 客户端请使用 proxy.ts 中的 createProxyUserService。
 */

import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword, validatePasswordStrength } from "../auth/password";

// ─── 用户公开信息类型（不含 password_hash 等内部字段）─────────────
export interface UserProfile {
  userId: string;
  email: string;
  phone: string | null;
  name: string | null;
  avatarUrl: string | null;
  gender: string | null;
  birthday: string | null;
  bio: string | null;
  interests: string[];
  school: string | null;
  location: string | null;
  subscriptionTier: string;
  subscriptionExpiresAt: Date | null;
  createdAt: Date;
}

// ─── 可修改的用户字段 ────────────────────────────────────────────
export interface UpdateProfileInput {
  name?: string;
  avatarUrl?: string;
  gender?: string;
  birthday?: string;
  bio?: string;
  interests?: string[];
  school?: string;
  location?: string;
}

// ─── 查询用户公开信息 ────────────────────────────────────────────
/** 按 userId 获取用户公开信息（不返回 password_hash, status 等内部字段） */
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const [row] = await db
    .select({
      userId: schema.users.userId,
      email: schema.users.email,
      phone: schema.users.phone,
      name: schema.users.name,
      avatarUrl: schema.users.avatarUrl,
      gender: schema.users.gender,
      birthday: schema.users.birthday,
      bio: schema.users.bio,
      interests: schema.users.interests,
      school: schema.users.school,
      location: schema.users.location,
      subscriptionTier: schema.users.subscriptionTier,
      subscriptionExpiresAt: schema.users.subscriptionExpiresAt,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(eq(schema.users.userId, userId))
    .limit(1);

  if (!row) return null;

  return {
    ...row,
    interests: (row.interests as string[] | null) ?? [],
  };
}

// ─── 修改用户信息 ────────────────────────────────────────────────
/** 部分更新用户信息，返回更新后的完整 profile */
export async function updateUserProfile(
  userId: string,
  input: UpdateProfileInput,
): Promise<UserProfile | null> {
  // 构建 SET 对象（只包含传入的字段）
  const setObj: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) setObj.name = input.name;
  if (input.avatarUrl !== undefined) setObj.avatarUrl = input.avatarUrl;
  if (input.gender !== undefined) setObj.gender = input.gender;
  if (input.birthday !== undefined) setObj.birthday = input.birthday;
  if (input.bio !== undefined) setObj.bio = input.bio;
  if (input.interests !== undefined) setObj.interests = input.interests;
  if (input.school !== undefined) setObj.school = input.school;
  if (input.location !== undefined) setObj.location = input.location;

  await db
    .update(schema.users)
    .set(setObj)
    .where(eq(schema.users.userId, userId));

  // 返回更新后的完整 profile
  return getUserProfile(userId);
}

// ─── 修改密码（已登录状态）─────────────────────────────────────────

export async function changePassword(
  userId: string,
  input: { currentPassword: string; newPassword: string },
): Promise<void> {
  // 校验新密码强度
  const strengthErr = validatePasswordStrength(input.newPassword);
  if (strengthErr) throw new Error(strengthErr);

  // 查当前密码哈希
  const [row] = await db
    .select({ passwordHash: schema.users.passwordHash })
    .from(schema.users)
    .where(eq(schema.users.userId, userId))
    .limit(1);
  if (!row) throw new Error("用户不存在");

  // 验证旧密码
  const valid = await verifyPassword(input.currentPassword, row.passwordHash);
  if (!valid) throw new Error("当前密码错误");

  // 更新密码
  const newHash = await hashPassword(input.newPassword);
  await db
    .update(schema.users)
    .set({ passwordHash: newHash, updatedAt: new Date() })
    .where(eq(schema.users.userId, userId));
}

// ─── 注销账号（软删除）──────────────────────────────────────────────

export async function deactivateAccount(
  userId: string,
  password: string,
): Promise<void> {
  // 验证密码（二次确认）
  const [row] = await db
    .select({ passwordHash: schema.users.passwordHash })
    .from(schema.users)
    .where(eq(schema.users.userId, userId))
    .limit(1);
  if (!row) throw new Error("用户不存在");

  const valid = await verifyPassword(password, row.passwordHash);
  if (!valid) throw new Error("密码错误");

  // 软删除：status → deleted
  await db
    .update(schema.users)
    .set({ status: "deleted", updatedAt: new Date() })
    .where(eq(schema.users.userId, userId));

  // 吊销所有 refresh token
  await db
    .update(schema.refreshTokens)
    .set({ revoked: true })
    .where(eq(schema.refreshTokens.userId, userId));
}
