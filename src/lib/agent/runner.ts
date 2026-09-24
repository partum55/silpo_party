import "server-only";

import { env } from "@/lib/env";
import type { Db } from "@/lib/party/access";

export const AGENT_TURN_TIMEOUT_MS = 90_000;

async function loadPartyMembers(db: Db, partyId: string) {
  const { data, error } = await db.from("party_members").select("user_id, wishes").eq("party_id", partyId);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.user_id as string,
    // Food restrictions are intentionally never read from the participant's Silpo profile. The agent only
    // receives restrictions that are explicitly provided through the party conversation/request context.
    restrictions: [],
    wishes: (Array.isArray(row.wishes) ? row.wishes : []) as never[],
    status: "collecting" as const,
  }));
}

async function loadPartySettings(db: Db, partyId: string) {
  const { data, error } = await db.from("parties").select("mode, budget_uah").eq("id", partyId).single();
  if (error) throw error;
  return {
    mode: data.mode as "SHOPPING" | "DINNER" | "EVENT",
    budgetUah: data.budget_uah === null ? null : Number(data.budget_uah),
  };
}

async function loadPlan(db: Db, partyId: string) {
  const { data, error } = await db.from("carts").select("plan").eq("party_id", partyId).maybeSingle();
  if (error) throw error;
  return (data?.plan as unknown as null) ?? null;
}

// Enough to resolve "поміняй назад" / "ще одну таку"; long event replies are cut so the prompt stays small.
const RECENT_MESSAGES = 8;
const RECENT_MESSAGE_CHARS = 600;

/** The party chat right before one message, oldest first, in the agent's recentMessages shape. */
async function loadRecentMessages(db: Db, partyId: string, before: string) {
  const { data, error } = await db
    .from("chat_messages")
    .select("sender_type, sender_user_id, content")
    .eq("party_id", partyId)
    .lt("created_at", before)
    .order("created_at", { ascending: false })
    .limit(RECENT_MESSAGES);
  if (error) throw error;
  return (data ?? []).reverse().map((row) => ({
    from: row.sender_type === "AGENT" ? "agent" as const : "member" as const,
    memberId: (row.sender_user_id as string | null) ?? null,
    text: (row.content as string).slice(0, RECENT_MESSAGE_CHARS),
  }));
}

/**
 * Runs one chat message through the separately-deployed agent (apps/agent; see
 * AGENT_URL) via its Mastra-generated REST API, instead of importing the workflow in-process. Authenticated
 * with a shared-secret bearer token (AGENT_INTERNAL_TOKEN, set identically on both deployments) since the
 * agent's HTTP API would otherwise let any caller run workflows against an arbitrary Silpo account.
 *
 * hostId is deliberately set to actorId (not party.creator_id): the workflow's own host/actor distinction
 * gates who may edit the shared plan directly vs. only submit preferences, a finer-grained model than this
 * product needs — here, any party member's chat message should be able to update the shared cart (spec:
 * "the agent reads the chat ... and modifies the shared cart" for any participant). Silpo product data is
 * still always fetched/written through the party CREATOR's connection via requestContext, matching the spec's
 * "the creator's Silpo connection is always used" rule regardless of who sent the message.
 */
export async function runConversationalTurn(db: Db, {
  partyId,
  creatorId,
  actorId,
  message,
  sentAt,
}: {
  partyId: string;
  creatorId: string;
  actorId: string;
  message: string;
  /** created_at of the message, so only the chat before it is sent as context. */
  sentAt: string;
}) {
  const [members, currentPlan, settings, recentMessages] = await Promise.all([
    loadPartyMembers(db, partyId),
    loadPlan(db, partyId),
    loadPartySettings(db, partyId),
    loadRecentMessages(db, partyId, sentAt),
  ]);

  const response = await fetch(`${env("AGENT_URL")}/api/workflows/conversationalPartyWorkflow/start-async`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env("AGENT_INTERNAL_TOKEN")}`,
    },
    body: JSON.stringify({
      inputData: {
        message,
        mode: settings.mode,
        actorId,
        hostId: actorId,
        scope: "auto",
        currentParty: { members },
        currentPlan,
        recentMessages,
        budgetUah: settings.budgetUah,
        partyWideRestrictions: [],
        blockers: [],
        warnings: [],
        questions: [],
        readiness: "invalid",
      },
      requestContext: { silpoUserId: creatorId, partyId },
    }),
    signal: AbortSignal.timeout(AGENT_TURN_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Agent request failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  }
  const data = await response.json();
  if (data.status !== "success") {
    throw new Error(`Agent turn did not complete (status: ${data.status}): ${JSON.stringify(data.error ?? "").slice(0, 500)}`);
  }
  // basePlan is the snapshot this turn started from, so concurrent turns can be merged (see rebasePlan).
  return { result: data.result, basePlan: currentPlan };
}
