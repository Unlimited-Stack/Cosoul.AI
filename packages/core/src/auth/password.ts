/**
 * password.ts — 密码哈希 + 强度校验
 *
 * bcrypt saltRounds=12，单次哈希约 250ms，暴力破解不划算。
 * 密码强度要求：≥8 位，至少含字母 + 数字。
 */

import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

/** bcrypt 哈希密码 */
export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

/** 比对明文密码与哈希 */
export async function verifyPassword(
  plaintext: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

/**
 * 校验密码强度（≥8 位 + 字母 + 数字）
 * 返回 null 表示通过，否则返回错误提示
 */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) return "密码长度至少 8 位";
  if (!/[a-zA-Z]/.test(password)) return "密码需包含字母";
  if (!/\d/.test(password)) return "密码需包含数字";
  return null;
}
