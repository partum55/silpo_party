import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

import {
  applyGatheredContext,
  createInitialState,
  discoverWishCandidates,
  runPlanningLoop,
  type PartyPlanningState,
} from "../domain/planning.ts";
import { coverageTargets } from "../domain/validation.ts";
import { getPreferencePhase } from "../domain/preferences.ts";
import {
  blockerSchema,
  memberSchema,
  partyPlanningInputSchema,
  plannerProposalSchema,
  questionSchema,
  warningSchema,
} from "../domain/schemas.ts";
import { createSilpoGateway } from "../silpo/gateway.ts";
import { partyPlannerAgent } from "./party-planner-agent.ts";
import { silpoUserId } from "./tools/silpo-tools.ts";
import { findRecipe } from "./tools/recipe-tool.ts";

export const productSchema = z.object({
  id: z.string(),
  lookupProductId: z.string().optional(),
  companyId: z.string().optional(),
  name: z.string(),
  priceUah: z.number(),
  unit: z.string(),
  available: z.boolean(),
  weighted: z.boolean().optional(),
  category: z.enum(["food", "drink"]),
  packageSize: z.object({ amount: z.number(), unit: z.enum(["g", "ml", "piece"]) }),
  metadata: z.object({
    ingredients: z.array(z.string()),
    allergens: z.array(z.string()),
    labels: z.array(z.string()),
    composition: z.array(z.string()).optional(),
  }),
  // Kept permissive for legacy persisted plans; every newly generated planner selection is integer-validated.
  quantity: z.number().positive(),
  assignedMemberIds: z.array(z.string()),
  reason: z.string(),
  lineTotalUah: z.number(),
});

const coverageSchema = z.record(z.string(), z.object({
  foodGrams: z.number(),
  drinkMilliliters: z.number(),
}));

const recipeSchema = z.object({
  title: z.string(),
  source: z.enum(["web", "generated"]),
  sourceUrl: z.string().nullable(),
  baseServings: z.number().positive(),
  servings: z.number().int().positive(),
  assignedMemberIds: z.array(z.string()),
  ingredients: z.array(z.object({
    name: z.string(),
    baseAmount: z.number().positive(),
    requiredAmount: z.number().positive(),
    unit: z.enum(["g", "ml", "piece"]),
    purchaseQuantity: z.number().int().positive(),
    purchasedAmount: z.number().positive(),
    selectedProduct: productSchema,
  })),
  steps: z.array(z.string()),
});

const wishFulfillmentSchema = z.object({
  memberId: z.string(),
  wishId: z.string(),
  requestedStrategy: z.enum(["ready_made", "recipe", "either"]),
  resolvedStrategy: z.enum(["ready_made", "recipe"]),
  candidateProductIds: z.array(z.string()),
  selectedProductIds: z.array(z.string()),
  recipeTitle: z.string().nullable(),
  fallbackReason: z.enum(["explicit_cooking", "no_candidates", "no_safe_candidate", "poor_match"]).nullable(),
});

export const planSchema = z.object({
  summary: z.string(),
  products: z.array(productSchema),
  recipes: z.array(recipeSchema),
  totalUah: z.number(),
  coverage: coverageSchema,
  wishFulfillments: z.array(wishFulfillmentSchema),
});

const wishCandidateSetSchema = z.object({
  memberId: z.string(),
  wishId: z.string(),
  requestedStrategy: z.enum(["ready_made", "recipe", "either"]),
  searchQueries: z.array(z.string()),
  candidates: z.array(z.object({ lookupProductId: z.string(), product: productSchema.omit({
    quantity: true,
    assignedMemberIds: true,
    reason: true,
    lineTotalUah: true,
  }) })),
});

const stateSchema = z.object({
  request: z.string(),
  mode: z.enum(["SHOPPING", "DINNER", "EVENT"]),
  currentParty: z.object({ members: z.array(memberSchema).max(10) }),
  participantCount: z.number().int().min(0).max(10),
  budgetUah: z.number().nonnegative().nullable(),
  restrictions: z.array(z.string()),
  currentPlan: planSchema.nullable(),
  wishCandidates: z.array(wishCandidateSetSchema),
  selectedProducts: z.array(productSchema),
  blockers: z.array(blockerSchema),
  warnings: z.array(warningSchema),
  questions: z.array(questionSchema),
  readiness: z.enum(["needs_input", "invalid", "ready"]),
  preferencePhase: z.enum(["provisional", "finalized"]),
  repairAttempts: z.number().int().min(0).max(2),
  publishedPlan: planSchema.nullable(),
});

const gatheredContextSchema = z.object({
  budgetUah: z.number().nonnegative().nullable(),
  partyWideRestrictions: z.array(z.string()),
  participantCountMentioned: z.number().int().positive().nullable(),
});

const wishQueryVariantsSchema = z.object({
  wishes: z.array(z.object({
    memberId: z.string(),
    wishId: z.string(),
    queries: z.array(z.string().min(1)).max(2),
  })),
});

export function parsePlannerProposal(value: string) {
  const cleaned = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const json = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  return plannerProposalSchema.parse(JSON.parse(json));
}

const gatherContext = createStep({
  id: "gather-context",
  description: "Extracts soft budget and party-wide restrictions; current members remain authoritative.",
  inputSchema: partyPlanningInputSchema,
  outputSchema: stateSchema,
  execute: async ({ inputData, requestContext }) => {
    let next = createInitialState(inputData);
    if (next.participantCount) {
      try {
        const response = await partyPlannerAgent.generate(
          `Return JSON with exactly these keys: {"budgetUah": number|null, "partyWideRestrictions": string[], "participantCountMentioned": number|null}. Do not plan products or add other keys.\n\nParty request:\n${inputData.request}`,
          { structuredOutput: { schema: gatheredContextSchema }, requestContext },
        );
        if (response.object) next = applyGatheredContext(next, response.object);
      } catch (error) {
        // Soft budget/restriction extraction is optional context, not a hard requirement — degrade to the
        // party's own explicit member data (no gathered budget/restrictions) rather than crash the run.
        console.error("gatherContext: failed, proceeding without gathered budget/restrictions", error);
      }
    }
    return next;
  },
});

const discoverCandidates = createStep({
  id: "discover-wish-candidates",
  description: "Searches and hydrates a bounded Silpo candidate set for each non-recipe wish.",
  inputSchema: stateSchema,
  outputSchema: stateSchema,
  execute: async ({ inputData, requestContext }) => {
    const searchableWishes = inputData.currentParty.members.flatMap((member) => member.wishes
      .filter((wish) => wish.fulfillmentStrategy !== "recipe")
      .map((wish) => ({ memberId: member.id, wishId: wish.id, text: wish.text })));
    if (!searchableWishes.length) return inputData;

    let queryVariants: Record<string, string[]> = {};
    try {
      const response = await partyPlannerAgent.generate(
        `Return a JSON object with, for each wish, up to two short Silpo catalog search query variants. Use general food/product wording and never name or invent SKUs. Return every supplied memberId and wishId unchanged.\n\n${JSON.stringify(searchableWishes)}`,
        { structuredOutput: { schema: wishQueryVariantsSchema }, requestContext },
      );
      const validKeys = new Set(searchableWishes.map((wish) => `${wish.memberId}:${wish.wishId}`));
      queryVariants = Object.fromEntries((response.object?.wishes ?? [])
        .filter((wish) => validKeys.has(`${wish.memberId}:${wish.wishId}`))
        .map((wish) => [`${wish.memberId}:${wish.wishId}`, wish.queries]));
    } catch (error) {
      // discoverWishCandidates falls back to each wish's own text when no variant is supplied — degrading to
      // {} is safe, better than crashing the whole run over an optional search-quality improvement.
      console.error("discoverCandidates: failed, falling back to each wish's own text", error);
    }
    const silpo = createSilpoGateway(silpoUserId(requestContext));
    return {
      ...inputData,
      wishCandidates: await discoverWishCandidates({
        party: inputData.currentParty,
        queryVariants,
        search: silpo.searchProductIds,
        hydrate: silpo.hydrate,
      }),
    };
  },
});

const planAndValidate = createStep({
  id: "plan-and-validate",
  description: "Plans with live Silpo tools, validates deterministically, and repairs at most twice.",
  inputSchema: stateSchema,
  outputSchema: stateSchema,
  execute: async ({ inputData, requestContext }) => {
    const silpo = inputData.participantCount ? createSilpoGateway(silpoUserId(requestContext)) : null;
    const result = await runPlanningLoop(inputData as PartyPlanningState, {
      plan: async ({ state, previousBlockers }) => {
        const response = await partyPlannerAgent.generate(
          `Return JSON with exactly these top-level keys: {"summary": string, "selections": [{"productId": string, "quantity": number, "assignedMemberIds": string[], "reason": string}], "recipes": [{"title": string, "source": "web"|"generated", "sourceUrl": string|null, "servings": number, "assignedMemberIds": string[], "ingredients": [{"name": string, "amount": number, "unit": "g"|"ml"|"piece", "productId": string}], "steps": string[]}], "wishFulfillments": [{"memberId": string, "wishId": string, "resolvedStrategy": "ready_made"|"recipe", "selectedProductIds": string[], "recipeTitle": string|null, "fallbackReason": "explicit_cooking"|"no_candidates"|"no_safe_candidate"|"poor_match"|null}]}. Always include all three arrays. Do not rename fields or add other keys. Candidate lookupProductIds are the only IDs allowed for ready-made wish fulfillment. Rank the full hydrated candidate set rather than automatically choosing its first item. A wish may use several candidates for variety. Consider participant preferences, participant-specific restrictions, price, quantity, variety, and closeness to the wish.

Current party and request:
${JSON.stringify({ mode: state.mode, request: state.request, members: state.currentParty.members, participantCount: state.currentParty.members.length, budgetUah: state.budgetUah, partyWideRestrictions: state.restrictions, coverageTargets, wishCandidates: state.wishCandidates })}

Mode rules: SHOPPING means direct requested products assigned only to their requester and no recipes. DINNER means requested dishes become recipes and pantry staples (salt, pepper, water, cooking oil) are omitted. EVENT means autonomously cover essentials first (main food, one side, drinks, and a suitable sauce), assign shared purchases to all participants, and add optional snacks or extras only when the remaining budget comfortably allows them. In every mode, prefer lower-priced suitable verified products, minimize package waste, and treat a supplied budget as a strong constraint.

Member wishes are current planning preferences. Member status is UI-owned context only; never infer or change it from message text.

For ready_made, choose suitable candidate products or leave the wish blocked. For either, prefer suitable ready-made candidates; use a recipe only for no_candidates, no_safe_candidate, or a genuine poor_match. For recipe, skip ready-made fulfillment and use explicit_cooking. Recipe resolution is a fallback strategy, not the default for named dishes. These rules apply generally; never special-case a dish.

Quantity is always a positive integer count of the product's displayed purchasable increment/package, never kilograms or a raw recipe amount. For example, if Silpo sells tomatoes in 100 g increments and 250 g is needed, select quantity 3. Coverage uses hydrated package amount × quantity, divided among every assigned member. Meet both targets for each member; on repair, replace unverified products and increase quantities where coverage is short.

Deterministic validation failures from the previous attempt:
${JSON.stringify(previousBlockers)}`,
          { maxSteps: 20, requestContext },
        );
        try {
          return parsePlannerProposal(response.text);
        } catch (error) {
          // An empty proposal fails deterministic validation (e.g. no_suitable_products) exactly like a
          // genuinely bad plan would, so it naturally feeds the existing repair-retry loop instead of
          // crashing the whole run on one malformed response.
          console.error("planAndValidate: failed to parse planner proposal", error);
          return { summary: "", selections: [], recipes: [], wishFulfillments: [] };
        }
      },
      hydrate: (productId) => silpo!.hydrate(productId),
      resolveRecipe: findRecipe,
    });
    return result;
  },
});

const finalize = createStep({
  id: "finalize",
  description: "Publishes a validated draft only after every member explicitly finalized preferences.",
  inputSchema: stateSchema,
  outputSchema: stateSchema,
  execute: async ({ inputData }) => {
    const preferencePhase = getPreferencePhase(inputData.currentParty);
    const result = {
      ...inputData,
      participantCount: inputData.currentParty.members.length,
      preferencePhase,
      publishedPlan: inputData.readiness === "ready" && preferencePhase === "finalized"
        ? inputData.currentPlan
        : null,
    };
    return result;
  },
});

export const partyPlanningWorkflow = createWorkflow({
  id: "party-planning-workflow",
  description: "Builds and deterministically validates a party plan using live Silpo products.",
  inputSchema: partyPlanningInputSchema,
  outputSchema: stateSchema,
})
  .then(gatherContext)
  .then(discoverCandidates)
  .then(planAndValidate)
  .then(finalize)
  .commit();
