import { z } from "zod";

import { planSchema, type PartyPlan, type VerifiedProduct, type VerifiedRecipe } from "./plan.ts";

const planningModeSchema = z.enum(["SHOPPING", "DINNER", "EVENT"]);
export type PlanningMode = z.output<typeof planningModeSchema>;

/** A dish a member wants (dinner mode), stored in `party_members.wishes`. */
const wishSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  // Wishes saved by the earlier agent may be "ready_made" or "either"; only "recipe" wishes become recipes.
  fulfillmentStrategy: z.enum(["ready_made", "recipe", "either"]).default("recipe"),
});
export type Wish = z.output<typeof wishSchema>;

const memberSchema = z.object({
  id: z.string().min(1),
  wishes: z.array(wishSchema).default([]),
});
export type Member = z.output<typeof memberSchema>;

const recentMessageSchema = z.object({
  from: z.enum(["member", "agent"]),
  memberId: z.string().nullable().default(null),
  text: z.string(),
});
export type RecentMessage = z.output<typeof recentMessageSchema>;

/** Everything one chat turn needs, loaded by the web app from the party's authoritative state. */
export const turnInputSchema = z.object({
  message: z.string().min(1),
  mode: planningModeSchema,
  actorId: z.string().min(1),
  members: z.array(memberSchema).min(1).max(10),
  plan: planSchema.nullable().default(null),
  budgetUah: z.number().nonnegative().nullable().default(null),
  /** The party chat right before `message`, oldest first. */
  recentMessages: z.array(recentMessageSchema).max(20).default([]),
});
export type TurnInput = z.output<typeof turnInputSchema>;

export type UnresolvedReason = "no_results" | "no_brand" | "restricted" | "no_match" | "unavailable" | "no_details" | "mcp_error" | "timeout";

export type UnresolvedLine = {
  label: string;
  reason: UnresolvedReason;
  suggestions: string[];
  /** The brand the member named ("no_brand"). */
  brand?: string;
  /** The payers' restrictions every candidate conflicted with ("restricted"). */
  restrictions?: string[];
};

/** What a turn changed, item by item, so the reply can be written after concurrent turns are merged. */
export type TurnReport = {
  added: Array<{ product: VerifiedProduct; addedQuantity: number }>;
  removed: VerifiedProduct[];
  quantityChanged: VerifiedProduct[];
  unresolved: UnresolvedLine[];
  notFoundInPlan: string[];
  /** Products added although Silpo lists no composition for a restriction of their payers. */
  unverified: Array<{ product: string; restrictions: string[] }>;
  notes: string[];
  /** Recipes created in this turn, rendered as recipe cards. */
  recipes: VerifiedRecipe[];
};

export type TurnReply =
  /** The plan is unchanged: an answer, a refusal, or a request that could not be understood. */
  | { kind: "message"; text: string }
  | { kind: "changes"; report: TurnReport };

export type TurnResult = {
  reply: TurnReply;
  plan: PartyPlan;
  /** Members whose dinner wishes changed, with their complete new wish list. */
  changedWishes: Array<{ memberId: string; wishes: Wish[] }>;
};
