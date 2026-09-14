import "server-only";

import type { Db } from "./access";

export type MemberIdentity = { name: string; avatarUrl: string | null };

/**
 * Reuses Supabase's own auth.users data (already populated from Google sign-in — see ProfileMenu, which reads
 * the same fields for the signed-in user) instead of a new profiles table: the admin client already holds the
 * service role needed to read another user's metadata, so there's nothing to duplicate.
 */
async function resolveOne(db: Db, userId: string): Promise<MemberIdentity> {
  const { data, error } = await db.auth.admin.getUserById(userId);
  if (error || !data.user) return { name: "Учасник", avatarUrl: null };
  const meta = data.user.user_metadata as Record<string, unknown>;
  const name = (meta.full_name ?? meta.name ?? data.user.email ?? "Учасник") as string;
  const avatarUrl = (meta.avatar_url as string | undefined) ?? null;
  return { name, avatarUrl };
}

export async function resolveMemberIdentities(db: Db, userIds: string[]): Promise<Map<string, MemberIdentity>> {
  const unique = [...new Set(userIds)];
  const resolved = await Promise.all(unique.map(async (id) => [id, await resolveOne(db, id)] as const));
  return new Map(resolved);
}
