import "server-only";

import { RequestContext } from "@mastra/core/request-context";
import { mastra } from "@silpo-party/agent";

import type { Db } from "@/lib/party/access";

async function loadPartyMembers(db: Db, partyId: string) {
  const { data, error } = await db.from("party_members").select("user_id").eq("party_id", partyId);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.user_id as string,
    restrictions: [] as string[],
    // ponytail: per-member wish lists are not persisted across chat turns (no dedicated table) — only the
    // resulting cart plan is. This loses cross-turn wish-based re-planning nuance; add a wishes table and
    // hydrate it here if that nuance is ever needed.
    wishes: [] as never[],
    status: "collecting" as const,
  }));
}

async function loadPlan(db: Db, partyId: string) {
  const { data, error } = await db.from("carts").select("plan").eq("party_id", partyId).maybeSingle();
  if (error) throw error;
  return (data?.plan as unknown as null) ?? null;
}

/**
 * Runs one chat message through @silpo-party/agent's conversational workflow.
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
  const [members, currentPlan] = await Promise.all([loadPartyMembers(db, partyId), loadPlan(db, partyId)]);

  const requestContext = new RequestContext();
  requestContext.set("silpoUserId", creatorId);

  const run = await mastra.getWorkflow("conversationalPartyWorkflow").createRun();
  const result = await run.start({
    inputData: {
      message,
      actorId,
      hostId: actorId,
      scope: "auto",
      currentParty: { members },
      currentPlan,
      budgetUah: null,
      partyWideRestrictions: [],
      blockers: [],
      warnings: [],
      questions: [],
      readiness: "invalid",
    },
    requestContext,
  });

  if (result.status !== "success") {
    throw new Error(`Agent turn did not complete (status: ${result.status}).`);
  }
  return result.result;
}
