import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import { generateJoinCode } from "./join-code";
import { assertOk, checkCreate, checkDelete, checkJoin, checkLeave, checkRead, MAX_ACTIVE_PARTIES_PER_USER } from "./rules";

type Db = ReturnType<typeof createSupabaseAdminClient>;

async function activePartyCount(db: Db, userId: string) {
  const { count, error } = await db
    .from("party_members")
    .select("party_id, parties!inner(status)", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("parties.status", "ACTIVE");
  if (error) throw error;
  return count ?? 0;
}

async function getMembership(db: Db, partyId: string, userId: string) {
  const { data, error } = await db
    .from("party_members")
    .select("role")
    .eq("party_id", partyId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.role as "CREATOR" | "MEMBER" | undefined;
}

async function getPartyStatus(db: Db, partyId: string) {
  const { data, error } = await db.from("parties").select("status").eq("id", partyId).maybeSingle();
  if (error) throw error;
  return (data?.status as "ACTIVE" | "COMPLETED" | undefined) ?? null;
}

export async function createParty(userId: string, name: string) {
  const db = createSupabaseAdminClient();
  assertOk(checkCreate({ activePartyCountForUser: await activePartyCount(db, userId) }));

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const joinCode = generateJoinCode();
    const { data: party, error } = await db
      .from("parties")
      .insert({ creator_id: userId, name, join_code: joinCode })
      .select()
      .single();
    if (error) {
      if (error.code === "23505") continue; // join_code collision, retry with a fresh code
      throw error;
    }
    const { error: memberError } = await db
      .from("party_members")
      .insert({ party_id: party.id, user_id: userId, role: "CREATOR" });
    if (memberError) throw memberError;
    const { error: cartError } = await db.from("carts").insert({ party_id: party.id });
    if (cartError) throw cartError;
    return party;
  }
  throw new Error("Could not generate a unique join code after several attempts.");
}

export async function listMyParties(userId: string) {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("party_members")
    .select("role, joined_at, parties(*)")
    .eq("user_id", userId)
    .order("joined_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => {
    const party = row.parties as unknown as Record<string, unknown>;
    return { ...party, role: row.role, joinedAt: row.joined_at };
  });
}

export async function getParty(partyId: string, userId: string) {
  const db = createSupabaseAdminClient();
  const role = await getMembership(db, partyId, userId);
  const { data: party, error } = await db.from("parties").select("*").eq("id", partyId).maybeSingle();
  if (error) throw error;
  assertOk(checkRead({ isMember: Boolean(role), partyStatus: (party?.status as "ACTIVE" | "COMPLETED" | undefined) ?? null }));
  return { ...party, role };
}

export async function listMembers(partyId: string, userId: string) {
  const db = createSupabaseAdminClient();
  const role = await getMembership(db, partyId, userId);
  const status = await getPartyStatus(db, partyId);
  assertOk(checkRead({ isMember: Boolean(role), partyStatus: status }));
  const { data, error } = await db
    .from("party_members")
    .select("user_id, role, joined_at")
    .eq("party_id", partyId)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function joinPartyByCode(joinCode: string, userId: string) {
  const db = createSupabaseAdminClient();
  const { data: party, error } = await db
    .from("parties")
    .select("id, status")
    .eq("join_code", joinCode.toUpperCase())
    .maybeSingle();
  if (error) throw error;

  const [alreadyMember, memberCount, activeCount] = party
    ? await Promise.all([
        getMembership(db, party.id, userId).then(Boolean),
        db.from("party_members").select("*", { count: "exact", head: true }).eq("party_id", party.id).then(({ count, error: e }) => {
          if (e) throw e;
          return count ?? 0;
        }),
        activePartyCount(db, userId),
      ])
    : [false, 0, 0];

  assertOk(checkJoin({
    partyStatus: (party?.status as "ACTIVE" | "COMPLETED" | undefined) ?? null,
    alreadyMember,
    memberCount,
    activePartyCountForUser: activeCount,
  }));

  const { error: insertError } = await db.from("party_members").insert({ party_id: party!.id, user_id: userId, role: "MEMBER" });
  if (insertError) throw insertError;
  return { id: party!.id };
}

export async function leaveParty(partyId: string, userId: string) {
  const db = createSupabaseAdminClient();
  const role = await getMembership(db, partyId, userId);
  assertOk(checkLeave({ role: role ?? null }));
  const { error } = await db.from("party_members").delete().eq("party_id", partyId).eq("user_id", userId);
  if (error) throw error;
}

export async function deleteParty(partyId: string, userId: string) {
  const db = createSupabaseAdminClient();
  const { data: party, error } = await db.from("parties").select("creator_id").eq("id", partyId).maybeSingle();
  if (error) throw error;
  assertOk(checkDelete({ isCreator: party?.creator_id === userId }));
  const { error: deleteError } = await db.from("parties").delete().eq("id", partyId);
  if (deleteError) throw deleteError;
}

export { MAX_ACTIVE_PARTIES_PER_USER };
