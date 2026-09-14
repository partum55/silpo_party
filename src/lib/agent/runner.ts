import "server-only";

import { env } from "@/lib/env";
import type { Db } from "@/lib/party/access";

async function loadPartyMembers(db: Db, partyId: string) {
  const { data, error } = await db.from("party_members").select("user_id, wishes").eq("party_id", partyId);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.user_id as string,
    restrictions: [] as string[],
    // ponytail: per-member wish lists are not persisted across chat turns (no dedicated table) — only the
    // resulting cart plan is. This loses cross-turn wish-based re-planning nuance; add a wishes table and
    // hydrate it here if that nuance is ever needed.
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
}: {
  partyId: string;
  creatorId: string;
  actorId: string;
  message: string;
}) {
  const [members, currentPlan, settings] = await Promise.all([
    loadPartyMembers(db, partyId),
    loadPlan(db, partyId),
    loadPartySettings(db, partyId),
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
        budgetUah: settings.budgetUah,
        partyWideRestrictions: [],
        blockers: [],
        warnings: [],
        questions: [],
        readiness: "invalid",
      },
      requestContext: { silpoUserId: creatorId },
    }),
  });

  if (!response.ok) {
    throw new Error(`Agent request failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  }
  const data = await response.json();
  if (data.status !== "success") {
    throw new Error(`Agent turn did not complete (status: ${data.status}): ${JSON.stringify(data.error ?? "").slice(0, 500)}`);
  }
  return data.result;
}
