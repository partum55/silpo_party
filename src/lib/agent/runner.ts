import "server-only";

import {
  agentCache,
  createDeadline,
  createDeepSeekLlm,
  readFoodRestrictions,
  RECENT_MESSAGE_CHARS,
  RECENT_MESSAGES,
  runTurn,
  TURN_BUDGET_MS,
  withCatalogSession,
  type RecentMessage,
  type TurnResult,
} from "@silpo-party/agent";

import { env } from "@/lib/env";
import type { Db } from "@/lib/party/access";

async function loadMembers(db: Db, partyId: string) {
  const { data, error } = await db.from("party_members").select("user_id, wishes").eq("party_id", partyId);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.user_id as string,
    wishes: Array.isArray(row.wishes) ? row.wishes : [],
  }));
}

async function loadSettings(db: Db, partyId: string) {
  const { data, error } = await db.from("parties").select("mode, budget_uah").eq("id", partyId).single();
  if (error) throw error;
  return {
    mode: data.mode as "SHOPPING" | "DINNER" | "EVENT",
    budgetUah: data.budget_uah === null ? null : Number(data.budget_uah),
  };
}

async function loadPlan(db: Db, partyId: string): Promise<unknown> {
  const { data, error } = await db.from("carts").select("plan").eq("party_id", partyId).maybeSingle();
  if (error) throw error;
  return data?.plan ?? null;
}

/** The party chat right before one message, oldest first, so the agent can resolve "поміняй назад". */
async function loadRecentMessages(db: Db, partyId: string, before: string): Promise<RecentMessage[]> {
  const { data, error } = await db
    .from("chat_messages")
    .select("sender_type, sender_user_id, content")
    .eq("party_id", partyId)
    .lt("created_at", before)
    .order("created_at", { ascending: false })
    .limit(RECENT_MESSAGES);
  if (error) throw error;
  return (data ?? []).reverse().map((row) => ({
    from: row.sender_type === "AGENT" ? "agent" : "member",
    memberId: (row.sender_user_id as string | null) ?? null,
    text: (row.content as string).slice(0, RECENT_MESSAGE_CHARS),
  }));
}

/**
 * Runs one chat message through the agent against the party's current state. Catalog work always uses the
 * party creator's Silpo connection, whoever wrote the message; each member's food restrictions come from their
 * own Silpo profile. Returns the plan the turn started from, so concurrent turns can be merged (see rebasePlan).
 */
export async function runConversationalTurn(db: Db, {
  partyId,
  creatorId,
  actorId,
  message,
  sentAt,
  reportStatus,
}: {
  partyId: string;
  creatorId: string;
  actorId: string;
  message: string;
  /** created_at of the message: only the chat before it is context. */
  sentAt: string;
  reportStatus: (status: "THINKING" | "SEARCHING") => Promise<void>;
}): Promise<{ result: TurnResult; basePlan: unknown }> {
  const [members, plan, settings, recentMessages] = await Promise.all([
    loadMembers(db, partyId),
    loadPlan(db, partyId),
    loadSettings(db, partyId),
    loadRecentMessages(db, partyId, sentAt),
  ]);
  const deadline = createDeadline(TURN_BUDGET_MS);
  const result = await runTurn(
    { message, mode: settings.mode, actorId, members, plan, budgetUah: settings.budgetUah, recentMessages },
    {
      llm: createDeepSeekLlm({ apiKey: env("AI_API_KEY"), deadline }),
      withSession: (operation) => withCatalogSession(creatorId, operation),
      foodRestrictions: readFoodRestrictions,
      cache: agentCache(),
      deadline,
      reportStatus,
    },
  );
  return { result, basePlan: plan };
}
