import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type Db = ReturnType<typeof createSupabaseAdminClient>;

export async function getMembership(db: Db, partyId: string, userId: string) {
  const { data, error } = await db
    .from("party_members")
    .select("role")
    .eq("party_id", partyId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data?.role as "CREATOR" | "MEMBER" | undefined) ?? null;
}

export async function getPartyRow(db: Db, partyId: string) {
  const { data, error } = await db.from("parties").select("*").eq("id", partyId).maybeSingle();
  if (error) throw error;
  return data;
}
