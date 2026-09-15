import "server-only";

import { after } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runConversationalTurn } from "@/lib/agent/runner";
import { syncCartFromPlan } from "@/lib/cart/service";
import { formatUnknownError } from "@/lib/errors";
import { assertOk, checkRead, checkSendMessage } from "@/lib/party/rules";
import { getMemberReady, getMembership, getPartyRow, type Db } from "@/lib/party/access";

export async function listMessages(partyId: string, userId: string) {
  const db = createSupabaseAdminClient();
  const role = await getMembership(db, partyId, userId);
  const party = await getPartyRow(db, partyId);
  assertOk(checkRead({ isMember: Boolean(role), partyStatus: (party?.status as "ACTIVE" | "COMPLETED" | undefined) ?? null }));
  const { data, error } = await db
    .from("chat_messages")
    .select("id, sender_type, sender_user_id, content, reply_to_message_id, created_at")
    .eq("party_id", partyId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function sendMessage(partyId: string, userId: string, content: string) {
  const db = createSupabaseAdminClient();
  const [role, isReady] = await Promise.all([getMembership(db, partyId, userId), getMemberReady(db, partyId, userId)]);
  const party = await getPartyRow(db, partyId);
  assertOk(checkSendMessage({ isMember: Boolean(role), partyStatus: (party?.status as "ACTIVE" | "COMPLETED" | undefined) ?? null, isReady }));

  const { data: message, error } = await db
    .from("chat_messages")
    .insert({ party_id: partyId, sender_type: "USER", sender_user_id: userId, content })
    .select()
    .single();
  if (error) throw error;

  // Runs after this response is sent (Next.js after()) instead of being awaited inline: a full agent turn
  // can take well over a minute, and the client shouldn't have to hold a request open that long to find out
  // it worked — it learns about progress and the result purely through Realtime (chat_messages inserts,
  // parties.agent_status updates), which is what the page subscribes to. after() keeps the request context alive
  // until this settles, unlike a bare unawaited call, which is not safe when the process can
  // freeze right after the response goes out). A message sent while another request already owns processing
  // returns immediately without draining (see tryAcquireAgentLock) — that owner's own drain loop re-checks
  // for unprocessed messages before releasing the lock, so this message is still picked up.
  after(() => processPendingMessages(db, partyId, party!.creator_id));
  return message;
}

// runConversationalTurn has a 90-second hard deadline. Anything still locked beyond two minutes was killed
// between acquiring the lock and recording its error, so a later status poll may safely resume the queue.
const STALE_LOCK_MINUTES = 2;

async function tryAcquireAgentLock(db: Db, partyId: string) {
  const staleBefore = new Date(Date.now() - STALE_LOCK_MINUTES * 60_000).toISOString();
  const { data, error } = await db
    .from("parties")
    .update({ agent_status: "THINKING", agent_error: null, active_agent_message_id: null })
    .eq("id", partyId)
    .or(`agent_status.in.(IDLE,DONE,ERROR),and(agent_status.in.(THINKING,UPDATING_CART),updated_at.lt.${staleBefore})`)
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

    const { error: activeMessageError } = await db
      .from("parties")
      .update({ agent_status: "THINKING", agent_error: null, active_agent_message_id: next.id })
      .eq("id", partyId);
    if (activeMessageError) throw activeMessageError;

    try {
      const result = await runConversationalTurn(db, {
        partyId,
        creatorId,
        actorId: next.sender_user_id as string,
        message: next.content as string,
      });
      for (const preference of result.updatedPreferences as Array<{ memberId: string; wishes: unknown[] }>) {
        const { error: preferenceError } = await db
          .from("party_members")
          .update({ wishes: preference.wishes })
          .eq("party_id", partyId)
          .eq("user_id", preference.memberId);
        if (preferenceError) throw preferenceError;
      }
      await syncCartFromPlan(db, partyId, result.updatedPlan as never);
      await db.from("chat_messages").update({ processed_at: new Date().toISOString() }).eq("id", next.id);
      if (result.responseText) {
        await db.from("chat_messages").insert({
          party_id: partyId,
          sender_type: "AGENT",
          content: result.responseText,
          reply_to_message_id: next.id,
        });
      }
    } catch (turnError) {
      // Mark processed even on failure: a permanently-failing message would otherwise wedge the queue forever.
      await db.from("chat_messages").update({ processed_at: new Date().toISOString() }).eq("id", next.id);
      const message = formatUnknownError(turnError);
      await db.from("parties").update({ agent_status: "ERROR", agent_error: message, active_agent_message_id: null }).eq("id", partyId);
      return;
    }
  }

  await db.from("parties").update({ agent_status: "DONE", active_agent_message_id: null }).eq("id", partyId);

  // Close the gap between the final empty read and releasing the lock. If a message arrived while the
  // status was still THINKING, its request could not acquire the lock; after DONE is visible, either this
  // call or that request will acquire it and drain the message.
  const { data: racedMessages, error: racedMessagesError } = await db
    .from("chat_messages")
    .select("id")
    .eq("party_id", partyId)
    .eq("sender_type", "USER")
    .is("processed_at", null)
    .limit(1);
  if (racedMessagesError) throw racedMessagesError;
  if (racedMessages?.length) await processPendingMessages(db, partyId, creatorId);
}

/**
 * Re-enters a queue whose original post-response callback was killed by a deploy, process restart, or host
 * timeout. The party page polls agent status, so an open page is also a lightweight queue watchdog.
 */
export async function resumePendingMessages(partyId: string, creatorId: string) {
  const db = createSupabaseAdminClient();
  const { data: pending, error } = await db
    .from("chat_messages")
    .select("id")
    .eq("party_id", partyId)
    .eq("sender_type", "USER")
    .is("processed_at", null)
    .limit(1);
  if (error) throw error;
  if (pending?.length) await processPendingMessages(db, partyId, creatorId);
}
