import "server-only";

import { formatReply, type PartyPlan, type TurnResult } from "@silpo-party/agent";
import { after } from "next/server";

import { runConversationalTurn } from "@/lib/agent/runner";
import { rebasePlan } from "@/lib/cart/plan-mutations";
import { CartChangedError, syncCartFromPlan } from "@/lib/cart/service";
import { drainQueue, type SerialQueue } from "@/lib/chat/drain-queue";
import { formatUnknownError } from "@/lib/errors";
import { getMemberReady, getMembership, getPartyRow, type Db } from "@/lib/party/access";
import { assertOk, checkRead, checkSendMessage } from "@/lib/party/rules";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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

  // The agent runs after this response is sent: a turn takes up to a minute, and the client follows progress
  // and the reply through Realtime (chat_messages inserts, parties.agent_status). A message sent while another
  // request already drains the queue returns at once; that drain re-checks for new messages before it ends.
  after(() => processPendingMessagesSafely(db, partyId, party!.creator_id));
  return message;
}

// A turn has a 75-second budget. A lock older than two minutes was left by a process killed mid-turn, so a
// later status poll may take the queue over.
const STALE_LOCK_MINUTES = 2;

// Shopping requests belong to one member each, so their turns run side by side and are merged (rebasePlan).
// Dinner recipes and event checklists plan for the whole party, so those turns stay strictly sequential.
const MAX_PARALLEL_SHOPPING_TURNS = 4;
// How often a queue with a free slot looks for messages that arrived while other turns are running.
const PENDING_POLL_MS = 1_500;

type PendingMessage = { id: string; sender_user_id: string; content: string; created_at: string };

/** parties.agent_status is a compare-and-swap lock: one request drains a party's queue at a time. */
async function tryAcquireAgentLock(db: Db, partyId: string) {
  const staleBefore = new Date(Date.now() - STALE_LOCK_MINUTES * 60_000).toISOString();
  const { data, error } = await db
    .from("parties")
    .update({ agent_status: "THINKING", agent_error: null, active_agent_message_id: null })
    .eq("id", partyId)
    .or(`agent_status.in.(IDLE,DONE,ERROR),and(agent_status.in.(THINKING,SEARCHING,UPDATING_CART),updated_at.lt.${staleBefore})`)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function updateAgentState(
  db: Db,
  partyId: string,
  values: { agent_status: string; agent_error?: string | null; active_agent_message_id?: string | null },
) {
  const { error } = await db.from("parties").update(values).eq("id", partyId);
  if (error) throw error;
}

async function markProcessed(db: Db, messageId: string) {
  const { error } = await db.from("chat_messages").update({ processed_at: new Date().toISOString() }).eq("id", messageId);
  if (error) throw error;
}

async function insertReply(db: Db, partyId: string, messageId: string, content: string) {
  const { error } = await db.from("chat_messages").insert({
    party_id: partyId,
    sender_type: "AGENT",
    content,
    reply_to_message_id: messageId,
  });
  if (error) throw error;
}

async function processPendingMessages(db: Db, partyId: string, creatorId: string) {
  if (!(await tryAcquireAgentLock(db, partyId))) return;

  const { data: settings, error: settingsError } = await db.from("parties").select("mode").eq("id", partyId).single();
  if (settingsError) throw settingsError;
  const parallel = settings.mode === "SHOPPING";

  const { lastError } = await drainQueue<PendingMessage>({
    limit: parallel ? MAX_PARALLEL_SHOPPING_TURNS : 1,
    pollMs: PENDING_POLL_MS,
    fetchPending: async (count, running) => {
      let query = db
        .from("chat_messages")
        .select("id, sender_user_id, content, created_at")
        .eq("party_id", partyId)
        .eq("sender_type", "USER")
        .is("processed_at", null)
        .order("created_at", { ascending: true })
        .limit(count);
      if (running.length) query = query.not("id", "in", `(${running.join(",")})`);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as PendingMessage[];
    },
    process: (message, serial) => processMessage(db, { partyId, creatorId, message, parallel, serial }),
  });

  await updateAgentState(db, partyId, lastError
    ? { agent_status: "ERROR", agent_error: formatUnknownError(lastError), active_agent_message_id: null }
    : { agent_status: "DONE", active_agent_message_id: null });

  // Close the gap between the last empty read and releasing the lock: a message sent meanwhile could not take
  // the lock, so drain again if one is waiting.
  const { data: raced, error: racedError } = await db
    .from("chat_messages")
    .select("id")
    .eq("party_id", partyId)
    .eq("sender_type", "USER")
    .is("processed_at", null)
    .limit(1);
  if (racedError) throw racedError;
  if (raced?.length) await processPendingMessages(db, partyId, creatorId);
}

/** Runs one message through the agent and saves the result. Throws after marking the message processed. */
async function processMessage(db: Db, { partyId, creatorId, message, parallel, serial }: {
  partyId: string;
  creatorId: string;
  message: PendingMessage;
  parallel: boolean;
  serial: SerialQueue;
}) {
  // A message queued before the host finalized must not change a cart that is already in Silpo.
  const party = await getPartyRow(db, partyId);
  if (party?.status === "COMPLETED") {
    await markProcessed(db, message.id);
    await insertReply(db, partyId, message.id, "Вечірку вже завершено — кошик оформлено, тому зміни не вносяться.");
    return;
  }

  await updateAgentState(db, partyId, { agent_status: "THINKING", agent_error: null, active_agent_message_id: message.id });
  try {
    const { result, basePlan } = await runConversationalTurn(db, {
      partyId,
      creatorId,
      actorId: message.sender_user_id,
      message: message.content,
      sentAt: message.created_at,
      reportStatus: (status) => updateAgentState(db, partyId, { agent_status: status, active_agent_message_id: message.id }),
    });
    await serial(() => saveTurn(db, partyId, message.id, result, parallel ? basePlan as PartyPlan | null : undefined));
  } catch (error) {
    // Mark processed even on failure: a permanently failing message would otherwise wedge the queue.
    await markProcessed(db, message.id);
    throw error;
  }
}

/**
 * Persists one turn and writes its reply. With a base plan (parallel shopping turns), only this turn's own
 * changes are applied to the plan as it is now, and the reply states the merged total.
 */
async function saveTurn(db: Db, partyId: string, messageId: string, result: TurnResult, basePlan?: PartyPlan | null) {
  for (const { memberId, wishes } of result.changedWishes) {
    const { error } = await db.from("party_members").update({ wishes }).eq("party_id", partyId).eq("user_id", memberId);
    if (error) throw error;
  }

  let totalUah = result.plan.totalUah;
  if (result.reply.kind === "changes") {
    if (basePlan === undefined) await syncCartFromPlan(db, partyId, result.plan as never);
    else totalUah = await mergeIntoCart(db, partyId, basePlan, result.plan);
  }

  await markProcessed(db, messageId);
  await insertReply(db, partyId, messageId, formatReply(result.reply, totalUah));
}

// A manual cart edit can land between reading the cart and saving the merge; each retry merges on top of it.
const MERGE_ATTEMPTS = 3;

/** Applies a turn's own changes (basePlan -> plan) on top of the cart as it is now; returns the merged total. */
async function mergeIntoCart(db: Db, partyId: string, basePlan: PartyPlan | null, plan: PartyPlan) {
  for (let attempt = 1; ; attempt += 1) {
    const { data: cart, error } = await db.from("carts").select("plan, updated_at").eq("party_id", partyId).single();
    if (error) throw error;
    const merged = rebasePlan(basePlan, plan, cart.plan as PartyPlan | null);
    try {
      await syncCartFromPlan(db, partyId, merged as never, cart.updated_at as string);
      return merged.totalUah;
    } catch (saveError) {
      if (!(saveError instanceof CartChangedError) || attempt === MERGE_ATTEMPTS) throw saveError;
    }
  }
}

async function processPendingMessagesSafely(db: Db, partyId: string, creatorId: string) {
  try {
    await processPendingMessages(db, partyId, creatorId);
  } catch (error) {
    console.error("Failed to drain party message queue", { partyId, error });
    try {
      await updateAgentState(db, partyId, { agent_status: "ERROR", agent_error: formatUnknownError(error), active_agent_message_id: null });
    } catch (statusError) {
      console.error("Failed to publish party queue error", { partyId, statusError });
    }
  }
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
  if (pending?.length) await processPendingMessagesSafely(db, partyId, creatorId);
}
