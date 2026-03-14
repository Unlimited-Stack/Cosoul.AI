/**
 * middleware.ts — Auth 中间件（服务端）
 *
 * requireAuth: 从 Authorization header 提取 JWT → 返回 userId
 * requireTier: 检查用户订阅等级是否满足最低要求
 */

import { verifyAccessToken, type JwtPayload } from "./jwt";
import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq } from "drizzle-orm";

// ─── 类型 ────────────────────────────────────────────────────────

export interface AuthContext {
  userId: string;
  email: string;
  tier: string;
}

// ─── requireAuth ─────────────────────────────────────────────────

/**
 * 从 Request 的 Authorization: Bearer <token> 中提取并验证 JWT
 * 返回 AuthContext，失败则抛异常
 */
export function requireAuth(request: Request): AuthContext {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new AuthHttpError(401, "缺少认证令牌");
  }

  const token = authHeader.slice(7);
  try {
    const payload: JwtPayload = verifyAccessToken(token);
    return {
      userId: payload.sub,
      email: payload.email,
      tier: payload.tier,
    };
  } catch {
    throw new AuthHttpError(401, "令牌无效或已过期");
  }
}

// ─── requireTier ─────────────────────────────────────────────────

const TIER_RANK: Record<string, number> = { free: 0, pro: 1, premium: 2 };

/**
 * 校验用户订阅等级 ≥ minTier
 * 同时检查订阅是否过期（过期自动降级为 free）
 */
export async function requireTier(
  userId: string,
  minTier: "free" | "pro" | "premium",
): Promise<void> {
  const [user] = await db
    .select({
      subscriptionTier: schema.users.subscriptionTier,
      subscriptionExpiresAt: schema.users.subscriptionExpiresAt,
    })
    .from(schema.users)
    .where(eq(schema.users.userId, userId))
    .limit(1);

  if (!user) throw new AuthHttpError(404, "用户不存在");

  let tier = user.subscriptionTier;

  // 订阅过期 → 自动降级为 free
  if (user.subscriptionExpiresAt && user.subscriptionExpiresAt < new Date()) {
    await db
      .update(schema.users)
      .set({ subscriptionTier: "free", updatedAt: new Date() })
      .where(eq(schema.users.userId, userId));
    tier = "free";
  }

  if ((TIER_RANK[tier] ?? 0) < (TIER_RANK[minTier] ?? 0)) {
    throw new AuthHttpError(403, "需要升级订阅等级");
  }
}

// ─── 错误类 ──────────────────────────────────────────────────────

export class AuthHttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "AuthHttpError";
  }
}
