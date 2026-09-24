import "server-only";

import { after } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runConversationalTurn } from "@/lib/agent/runner";
import { syncCartFromPlan } from "@/lib/cart/service";
import { rebasePlan, type MutablePlan } from "@/lib/cart/plan-mutations";
import { formatUahNumber } from "@/lib/format";
import { formatUnknownError } from "@/lib/errors";
import { assertOk, checkRead, checkSendMessage } from "@/lib/party/rules";
import { getMemberReady, getMembership, getPartyRow, type Db } from "@/lib/party/access";

function isMissingReplyTrackingColumn(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; message?: unknown };
  return (value.code === "42703" || value.code === "PGRST204") && typeof value.message === "string"
    && (value.message.includes("reply_to_message_id") || value.message.includes("active_agent_message_id"));
}

export async function listMessages(partyId: string, userId: string) {
  const db = createSupabaseAdminClient();
  const role = await getMembership(db, partyId, userId);
  const party = await getPartyRow(db, partyId);
  assertOk(checkRead({ isMember: Boolean(role), partyStatus: (party?.status as "ACTIVE" | "COMPLETED" | undefined) ?? null }));
  const result = await db
    .from("chat_messages")
    .select("id, sender_type, sender_user_id, content, reply_to_message_id, created_at")
    .eq("party_id", partyId)
    .order("created_at", { ascending: true });
  if (!result.error) return result.data ?? [];
  if (!isMissingReplyTrackingColumn(result.error)) throw result.error;

  // Allows an application deployment to precede the additive migration without taking the entire party
  // page down. Reply previews activate automatically as soon as the migration is applied.
  const legacy = await db
    .from("chat_messages")
    .select("id, sender_type, sender_user_id, content, created_at")
    .eq("party_id", partyId)
    .order("created_at", { ascending: true });
  if (legacy.error) throw legacy.error;
  return (legacy.data ?? []).map((message) => ({ ...message, reply_to_message_id: null }));
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
  after(() => processPendingMessagesSafely(db, partyId, party!.creator_id));
  return message;
}

// runConversationalTurn has a 90-second hard deadline. Anything still locked beyond two minutes was killed
// between acquiring the lock and recording its error, so a later status poll may safely resume the queue.
const STALE_LOCK_MINUTES = 2;

async function tryAcquireAgentLock(db: Db, partyId: string) {
  const staleBefore = new Date(Date.now() - STALE_LOCK_MINUTES * 60_000).toISOString();
  let result = await db
    .from("parties")
    .update({ agent_status: "THINKING", agent_error: null, active_agent_message_id: null })
    .eq("id", partyId)
    .or(`agent_status.in.(IDLE,DONE,ERROR),and(agent_status.in.(THINKING,UPDATING_CART),updated_at.lt.${staleBefore})`)
    .select("id")
    .maybeSingle();
  if (isMissingReplyTrackingColumn(result.error)) {
    result = await db
      .from("parties")
      .update({ agent_status: "THINKING", agent_error: null })
      .eq("id", partyId)
      .or(`agent_status.in.(IDLE,DONE,ERROR),and(agent_status.in.(THINKING,UPDATING_CART),updated_at.lt.${staleBefore})`)
      .select("id")
      .maybeSingle();
  }
  if (result.error) throw result.error;
  return Boolean(result.data);
}

async function updateAgentState(
  db: Db,
  partyId: string,
  values: { agent_status: string; agent_error?: string | null; active_agent_message_id: string | null },
) {
  let result = await db.from("parties").update(values).eq("id", partyId);
  if (isMissingReplyTrackingColumn(result.error)) {
    const legacyValues = {
      agent_status: values.agent_status,
      ...("agent_error" in values ? { agent_error: values.agent_error } : {}),
    };
    result = await db.from("parties").update(legacyValues).eq("id", partyId);
  }
  if (result.error) throw result.error;
}

type PendingMessage = { id: string; sender_user_id: string; content: string; created_at: string };

// Shopping requests belong to one member each, so their turns can run side by side and be merged (rebasePlan).
// Dinner recipes and event checklists are planned for the whole party, so those turns stay strictly sequential.
const MAX_PARALLEL_SHOPPING_TURNS = 4;
// How often a worker with free slots looks for messages that arrived while other turns are still running.
const PENDING_POLL_MS = 1_500;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Drains every unprocessed USER message for a party, so the agent stays "busy" across a burst of messages
 * instead of resetting to idle between each one (spec section 8's batching requirement). Uses
 * parties.agent_status as a compare-and-swap lock, so one worker owns a party's queue (ponytail: no
 * distributed lock; fine for a single-instance MVP). In SHOPPING mode that worker runs up to
 * MAX_PARALLEL_SHOPPING_TURNS agent turns at once; saving their results is serialized and each one is merged
 * onto the latest plan, so concurrent turns never overwrite each other.
 */
async function processPendingMessages(db: Db, partyId: string, creatorId: string) {
  if (!(await tryAcquireAgentLock(db, partyId))) return;

  const { data: settings, error: settingsError } = await db.from("parties").select("mode").eq("id", partyId).single();
  if (settingsError) throw settingsError;
  const parallel = settings.mode === "SHOPPING";
  const limit = parallel ? MAX_PARALLEL_SHOPPING_TURNS : 1;

  const inFlight = new Map<string, Promise<void>>();
  let saveQueue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(work: () => Promise<T>) => {
    const run = saveQueue.then(work);
    saveQueue = run.catch(() => undefined);
    return run;
  };
  let lastError: string | null = null;

  for (;;) {
    if (inFlight.size < limit) {
      let query = db
        .from("chat_messages")
        .select("id, sender_user_id, content, created_at")
        .eq("party_id", partyId)
        .eq("sender_type", "USER")
        .is("processed_at", null)
        .order("created_at", { ascending: true })
        .limit(limit - inFlight.size);
      if (inFlight.size) query = query.not("id", "in", `(${[...inFlight.keys()].join(",")})`);
      const { data: pending, error } = await query;
      if (error) throw error;
      for (const next of (pending ?? []) as PendingMessage[]) {
        const run = processMessage(db, partyId, creatorId, next, { parallel, serialized })
          .catch((turnError) => { lastError = formatUnknownError(turnError); })
          .finally(() => { inFlight.delete(next.id); });
        inFlight.set(next.id, run);
      }
    }
    if (!inFlight.size) break;
    // Wake when a turn finishes, or, while slots are free, to start messages that arrived in the meantime.
    await Promise.race([...inFlight.values(), ...(inFlight.size < limit ? [delay(PENDING_POLL_MS)] : [])]);
  }

  await updateAgentState(db, partyId, lastError
    ? { agent_status: "ERROR", agent_error: lastError, active_agent_message_id: null }
    : { agent_status: "DONE", active_agent_message_id: null });

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

/** Runs one message through the agent and saves the result. Throws after marking the message processed. */
async function processMessage(
  db: Db,
  partyId: string,
  creatorId: string,
  next: PendingMessage,
  { parallel, serialized }: { parallel: boolean; serialized: <T>(work: () => Promise<T>) => Promise<T> },
) {
  // A message queued before the host finalized must not change a cart that is already in Silpo.
  const current = await getPartyRow(db, partyId);
  if (current?.status === "COMPLETED") {
    await db.from("chat_messages").update({ processed_at: new Date().toISOString() }).eq("id", next.id);
    await db.from("chat_messages").insert({
      party_id: partyId,
      sender_type: "AGENT",
      content: "Вечірку вже завершено — кошик оформлено, тому зміни не вносяться.",
      reply_to_message_id: next.id,
    });
    return;
  }

  await updateAgentState(db, partyId, {
    agent_status: "THINKING",
    agent_error: null,
    active_agent_message_id: next.id,
  });

  try {
    const { result, basePlan } = await runConversationalTurn(db, {
      partyId,
      creatorId,
      actorId: next.sender_user_id,
      message: next.content,
      sentAt: next.created_at,
    });
    await serialized(() => saveTurn(db, partyId, next.id, result, parallel ? basePlan : undefined));
  } catch (turnError) {
    // Mark processed even on failure: a permanently-failing message would otherwise wedge the queue forever.
    await db.from("chat_messages").update({ processed_at: new Date().toISOString() }).eq("id", next.id);
    throw turnError;
  }
}

type TurnResult = {
  responseText?: string;
  updatedPreferences: Array<{ memberId: string; wishes: unknown[] }>;
  updatedPlan: NonNullable<MutablePlan> | null;
};

/**
 * Persists one turn. With basePlan (parallel shopping turns) only this turn's own changes are applied to the
 * plan as it is now, and the reply's cart total is updated to the merged plan.
 */
async function saveTurn(db: Db, partyId: string, messageId: string, result: TurnResult, basePlan?: MutablePlan) {
  for (const preference of result.updatedPreferences) {
    const { error: preferenceError } = await db
      .from("party_members")
      .update({ wishes: preference.wishes })
      .eq("party_id", partyId)
      .eq("user_id", preference.memberId);
    if (preferenceError) throw preferenceError;
  }

  let responseText = result.responseText;
  if (basePlan === undefined) {
    await syncCartFromPlan(db, partyId, result.updatedPlan as never);
  } else if (result.updatedPlan) {
    const { data: cart, error: cartError } = await db.from("carts").select("plan").eq("party_id", partyId).maybeSingle();
    if (cartError) throw cartError;
    const merged = rebasePlan(basePlan, result.updatedPlan, (cart?.plan as MutablePlan) ?? null);
    await syncCartFromPlan(db, partyId, merged as never);
    if (responseText && merged.totalUah !== result.updatedPlan.totalUah) {
      responseText = responseText.replace(/Разом у кошику: [^\n]+ грн\./, `Разом у кошику: ${formatUahNumber(merged.totalUah)} грн.`);
    }
  }

  await db.from("chat_messages").update({ processed_at: new Date().toISOString() }).eq("id", messageId);
  if (!responseText) return;
  let replyInsert = await db.from("chat_messages").insert({
    party_id: partyId,
    sender_type: "AGENT",
    content: responseText,
    reply_to_message_id: messageId,
  });
  if (isMissingReplyTrackingColumn(replyInsert.error)) {
    replyInsert = await db.from("chat_messages").insert({ party_id: partyId, sender_type: "AGENT", content: responseText });
  }
  if (replyInsert.error) throw replyInsert.error;
}

async function processPendingMessagesSafely(db: Db, partyId: string, creatorId: string) {
  try {
    await processPendingMessages(db, partyId, creatorId);
  } catch (error) {
    const message = formatUnknownError(error);
    console.error("Failed to drain party message queue", { partyId, error });
    try {
      await updateAgentState(db, partyId, {
        agent_status: "ERROR",
        agent_error: message,
        active_agent_message_id: null,
      });
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
