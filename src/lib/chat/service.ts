import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runConversationalTurn } from "@/lib/agent/runner";
import { syncCartFromPlan } from "@/lib/cart/service";
import { assertOk, checkActiveMemberAction, checkRead } from "@/lib/party/rules";
import { getMembership, getPartyRow, type Db } from "@/lib/party/access";

export async function listMessages(partyId: string, userId: string) {
  const db = createSupabaseAdminClient();
  const role = await getMembership(db, partyId, userId);
  const party = await getPartyRow(db, partyId);
  assertOk(checkRead({ isMember: Boolean(role), partyStatus: (party?.status as "ACTIVE" | "COMPLETED" | undefined) ?? null }));
  const { data, error } = await db
    .from("chat_messages")
    .select("id, sender_type, sender_user_id, content, created_at")
    .eq("party_id", partyId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function sendMessage(partyId: string, userId: string, content: string) {
  const db = createSupabaseAdminClient();
  const role = await getMembership(db, partyId, userId);
  const party = await getPartyRow(db, partyId);
  assertOk(checkActiveMemberAction({ isMember: Boolean(role), partyStatus: (party?.status as "ACTIVE" | "COMPLETED" | undefined) ?? null }));

  const { data: message, error } = await db
    .from("chat_messages")
    .insert({ party_id: partyId, sender_type: "USER", sender_user_id: userId, content })
    .select()
    .single();
  if (error) throw error;

  // Fire-and-forget from the caller's perspective is not safe on serverless (the process may be frozen after
  // the response is sent), so this awaits inline. A message sent while another request already owns
  // processing returns immediately without draining (see tryAcquireAgentLock) — that owner's own drain loop
  // re-checks for unprocessed messages before releasing the lock, so this message is still picked up.
  await processPendingMessages(db, partyId, party!.creator_id);
  return message;
}

async function tryAcquireAgentLock(db: Db, partyId: string) {
  const { data, error } = await db
    .from("parties")
    .update({ agent_status: "THINKING", agent_error: null })
    .eq("id", partyId)
    .in("agent_status", ["IDLE", "DONE", "ERROR"])
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

/**
 * Drains every unprocessed USER message for a party, one conversational-turn call at a time, so the agent
 * stays "busy" across a burst of messages instead of resetting to idle between each one (spec section 8's
 * batching requirement). See runConversationalTurn for why turns run sequentially rather than as one merged
 * prompt. Uses parties.agent_status as a process-local compare-and-swap lock (ponytail: no distributed lock;
 * fine for a single-instance MVP).
 */
async function processPendingMessages(db: Db, partyId: string, creatorId: string) {
  if (!(await tryAcquireAgentLock(db, partyId))) return;

  for (;;) {
    const { data: pending, error } = await db
      .from("chat_messages")
      .select("id, sender_user_id, content")
      .eq("party_id", partyId)
      .eq("sender_type", "USER")
      .is("processed_at", null)
      .order("created_at", { ascending: true })
      .limit(1);
    if (error) throw error;
    const next = pending?.[0];
    if (!next) break;

    try {
      const result = await runConversationalTurn(db, {
        partyId,
        creatorId,
        actorId: next.sender_user_id as string,
        message: next.content as string,
      });
      await syncCartFromPlan(db, partyId, result.updatedPlan as never);
      await db.from("chat_messages").update({ processed_at: new Date().toISOString() }).eq("id", next.id);
      if (result.responseText) {
        await db.from("chat_messages").insert({ party_id: partyId, sender_type: "AGENT", content: result.responseText });
      }
    } catch (turnError) {
      // Mark processed even on failure: a permanently-failing message would otherwise wedge the queue forever.
      await db.from("chat_messages").update({ processed_at: new Date().toISOString() }).eq("id", next.id);
      const message = turnError instanceof Error ? turnError.message : String(turnError);
      await db.from("parties").update({ agent_status: "ERROR", agent_error: message }).eq("id", partyId);
      return;
    }
  }

  await db.from("parties").update({ agent_status: "DONE" }).eq("id", partyId);
}
