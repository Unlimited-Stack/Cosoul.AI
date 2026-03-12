/**
 * PersonaAgent — 服务端 DB CRUD 服务层
 *
 * 服务端专用，依赖 drizzle db + pg，供 BFF 路由调用。
 * 客户端（浏览器/Native）请使用 proxy.ts 中的 createProxyPersonaService。
 */

import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, desc } from "drizzle-orm";

// ─── Soul.md 模板组装 ─────────────────────────────────────────────
/** 根据用户输入组装 Soul.md 格式的 profile markdown */
function buildSoulMd(params: {
  name: string;
  coreIdentity: string;
  preferences: string;
}): string {
  return `# Soul — ${params.name}

## Core Identity
${params.coreIdentity}

## Preferences
${params.preferences}

## Values & Vibe
（待用户补充）

## History Annotations
（Agent 自动追加区域，请勿手动编辑）
`;
}

// ─── Persona CRUD ─────────────────────────────────────────────────

/** 查询用户名下所有分身列表 */
export async function listPersonas(userId: string) {
  const rows = await db
    .select({
      personaId: schema.personas.personaId,
      name: schema.personas.name,
      bio: schema.personas.bio,
    })
    .from(schema.personas)
    .where(eq(schema.personas.userId, userId))
    .orderBy(desc(schema.personas.createdAt));

  return rows;
}

/** 创建新分身，profile_text 和 preferences 直接写入 personas 表 */
export async function createPersona(
  userId: string,
  input: {
    name: string;
    bio: string;
    coreIdentity: string;
    preferences: string;
  }
) {
  const profileText = buildSoulMd({
    name: input.name,
    coreIdentity: input.coreIdentity,
    preferences: input.preferences,
  });

  const [persona] = await db
    .insert(schema.personas)
    .values({
      userId,
      name: input.name,
      bio: input.bio,
      profileText,
      preferences: {
        coreIdentity: input.coreIdentity,
        preferences: input.preferences,
      },
    })
    .returning({
      personaId: schema.personas.personaId,
      name: schema.personas.name,
      bio: schema.personas.bio,
    });

  return persona;
}

/** 查询单个分身基本信息 */
export async function getPersona(personaId: string) {
  const [row] = await db
    .select({
      personaId: schema.personas.personaId,
      userId: schema.personas.userId,
      name: schema.personas.name,
      bio: schema.personas.bio,
      avatar: schema.personas.avatar,
      createdAt: schema.personas.createdAt,
    })
    .from(schema.personas)
    .where(eq(schema.personas.personaId, personaId))
    .limit(1);

  return row ?? null;
}

/** 查询分身 + profile（Soul.md）数据 */
export async function getPersonaWithProfile(personaId: string) {
  const [row] = await db
    .select({
      personaId: schema.personas.personaId,
      userId: schema.personas.userId,
      name: schema.personas.name,
      bio: schema.personas.bio,
      avatar: schema.personas.avatar,
      createdAt: schema.personas.createdAt,
      profileText: schema.personas.profileText,
      preferences: schema.personas.preferences,
    })
    .from(schema.personas)
    .where(eq(schema.personas.personaId, personaId))
    .limit(1);

  return row ?? null;
}

// ─── Task CRUD ────────────────────────────────────────────────────

/** 查询分身名下所有任务列表 */
export async function listTasks(personaId: string) {
  const rows = await db
    .select({
      taskId: schema.tasks.taskId,
      rawDescription: schema.tasks.rawDescription,
      status: schema.tasks.status,
      targetActivity: schema.tasks.targetActivity,
      interactionType: schema.tasks.interactionType,
    })
    .from(schema.tasks)
    .where(eq(schema.tasks.personaId, personaId))
    .orderBy(desc(schema.tasks.createdAt));

  return rows;
}

/** 调试用：获取用户所有分身（含 profile + tasks 完整数据） */
export async function listPersonasDebug(userId: string) {
  const personas = await db
    .select({
      personaId: schema.personas.personaId,
      name: schema.personas.name,
      bio: schema.personas.bio,
      createdAt: schema.personas.createdAt,
      profileText: schema.personas.profileText,
      preferences: schema.personas.preferences,
    })
    .from(schema.personas)
    .where(eq(schema.personas.userId, userId))
    .orderBy(desc(schema.personas.createdAt));

  // 逐个分身查询其任务列表
  const result = await Promise.all(
    personas.map(async (p) => ({
      ...p,
      tasks: await listTasks(p.personaId),
    }))
  );

  return result;
}

/** 删除分身（级联删除关联的 tasks） */
export async function deletePersona(personaId: string) {
  // 先删关联任务，再删分身
  await db.delete(schema.tasks).where(eq(schema.tasks.personaId, personaId));
  const [deleted] = await db
    .delete(schema.personas)
    .where(eq(schema.personas.personaId, personaId))
    .returning({ personaId: schema.personas.personaId });
  return deleted ?? null;
}

/** 删除单个任务 */
export async function deleteTask(taskId: string) {
  const [deleted] = await db
    .delete(schema.tasks)
    .where(eq(schema.tasks.taskId, taskId))
    .returning({ taskId: schema.tasks.taskId });
  return deleted ?? null;
}

/** 创建新任务，初始状态为 Drafting */
export async function createTask(
  personaId: string,
  input: {
    rawDescription: string;
    interactionType: string;
  }
) {
  const [task] = await db
    .insert(schema.tasks)
    .values({
      personaId,
      rawDescription: input.rawDescription,
      interactionType: input.interactionType,
      status: "Drafting",
    })
    .returning({
      taskId: schema.tasks.taskId,
      rawDescription: schema.tasks.rawDescription,
      status: schema.tasks.status,
      interactionType: schema.tasks.interactionType,
    });

  return task;
}
