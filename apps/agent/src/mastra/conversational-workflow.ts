import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

import {
  applyConversationDecision,
  mergeWithProtectedPlan,
  planToProposal,
  preferencesFromParty,
  validatePlanOperations,
} from "../domain/conversation.ts";
import { createInitialState, discoverWishCandidates, runPlanningLoop } from "../domain/planning.ts";
import {
  blockerSchema,
  conversationDecisionSchema,
  memberSchema,
  planOperationSchema,
  questionSchema,
  warningSchema,
  wishChangeSchema,
} from "../domain/schemas.ts";
import type { PartyPlanDraft, VerifiedProduct } from "../domain/validation.ts";
import { createSilpoGateway } from "../silpo/gateway.ts";
import { partyPlannerAgent } from "./party-planner-agent.ts";
import { parsePlannerProposal, planSchema } from "./party-planning-workflow.ts";
import { findRecipe } from "./tools/recipe-tool.ts";
import { silpoUserId } from "./tools/silpo-tools.ts";

export const conversationInputSchema = z.object({
  message: z.string().min(1),
  actorId: z.string().min(1),
  hostId: z.string().min(1),
  scope: z.enum(["preferences", "plan", "auto"]).default("auto"),
  currentParty: z.object({ members: z.array(memberSchema).max(10) }),
  currentPlan: planSchema.nullable().default(null),
  budgetUah: z.number().nonnegative().nullable().default(null),
  partyWideRestrictions: z.array(z.string()).default([]),
  blockers: z.array(blockerSchema).default([]),
  warnings: z.array(warningSchema).default([]),
  questions: z.array(questionSchema).default([]),
  readiness: z.enum(["needs_input", "invalid", "ready"]).default("invalid"),
});

const preferenceProjectionSchema = z.object({
  memberId: z.string(),
  wishes: memberSchema.shape.wishes,
  status: memberSchema.shape.status,
});

export const conversationOutputSchema = z.object({
  responseText: z.string(),
  intent: conversationDecisionSchema.shape.intent,
  preferenceOperations: z.array(wishChangeSchema),
  planOperations: z.array(planOperationSchema),
  updatedPreferences: z.array(preferenceProjectionSchema),
  updatedPlan: planSchema.nullable(),
  blockers: z.array(blockerSchema),
  warnings: z.array(warningSchema),
  questions: z.array(questionSchema),
  readiness: z.enum(["needs_input", "invalid", "ready"]),
});

type Input = z.output<typeof conversationInputSchema>;
type Gateway = ReturnType<typeof createSilpoGateway>;

async function recoverLookups(plan: PartyPlanDraft | null, silpo: Gateway) {
  if (!plan) return { plan, unresolvedIds: [] as string[] };
  const recovered = structuredClone(plan);
  const products: VerifiedProduct[] = [
    ...recovered.products,
    ...recovered.recipes.flatMap((recipe) => recipe.ingredients.map((ingredient) => ingredient.selectedProduct)),
  ];
  const unresolvedIds: string[] = [];
  for (const product of products) {
    if (product.lookupProductId) continue;
    const ids = await silpo.searchProductIds(product.name);
    let lookupProductId: string | undefined;
    for (const id of ids) {
      if ((await silpo.hydrate(id))?.id === product.id) { lookupProductId = id; break; }
    }
    if (!lookupProductId) unresolvedIds.push(product.id);
    else for (const matching of products) if (matching.id === product.id) matching.lookupProductId = lookupProductId;
  }
  return { plan: recovered, unresolvedIds: [...new Set(unresolvedIds)] };
}

function errorResult(input: Input, intent: z.infer<typeof conversationDecisionSchema>["intent"], code: "actor_not_found" | "plan_edit_forbidden" | "scope_mismatch" | "preferences_locked") {
  const needsReopen = code === "preferences_locked";
  return {
    responseText: needsReopen ? "Use “Змінити побажання” before editing preferences." : "This message cannot change the requested state.",
    intent,
    preferenceOperations: [],
    planOperations: [],
    updatedPreferences: preferencesFromParty(input.currentParty),
    updatedPlan: input.currentPlan,
    blockers: [{ code, message: needsReopen ? "Participant preferences are finalized." : "The actor or command scope does not authorize this change." }],
    warnings: input.warnings,
    questions: needsReopen
      ? [{ code: "preference_reopen_required" as const, prompt: "Do you want to reopen this participant's preferences?", memberId: input.actorId }]
      : [{ code: "command_scope_required" as const, prompt: "Choose whether this message edits preferences or the shared plan." }],
    readiness: "needs_input" as const,
  };
}

export function readOnlyResult(input: Input, responseText: string) {
  return {
    responseText,
    intent: "read_only" as const,
    preferenceOperations: [],
    planOperations: [],
    updatedPreferences: preferencesFromParty(input.currentParty),
    updatedPlan: input.currentPlan,
    blockers: input.blockers,
    warnings: input.warnings,
    questions: input.questions,
    readiness: input.readiness,
  };
}

async function queryVariants(party: Input["currentParty"]) {
  const wishes = party.members.flatMap((member) => member.wishes
    .filter((wish) => wish.fulfillmentStrategy !== "recipe")
    .map((wish) => ({ memberId: member.id, wishId: wish.id, text: wish.text })));
  if (!wishes.length) return {};
  const schema = z.object({ wishes: z.array(z.object({ memberId: z.string(), wishId: z.string(), queries: z.array(z.string()).max(2) })) });
  const response = await partyPlannerAgent.generate(
    `Return a JSON object with up to two short Silpo search variants for every supplied wish. Preserve IDs exactly.\n${JSON.stringify(wishes)}`,
    { structuredOutput: { schema } },
  );
  const keys = new Set(wishes.map((wish) => `${wish.memberId}:${wish.wishId}`));
  return Object.fromEntries(response.object.wishes
    .filter((wish) => keys.has(`${wish.memberId}:${wish.wishId}`))
    .map((wish) => [`${wish.memberId}:${wish.wishId}`, wish.queries]));
}

const conversationalTurn = createStep({
  id: "conversational-turn",
  description: "Interprets one message and returns a validated, persistence-free state transition.",
  inputSchema: conversationInputSchema,
  outputSchema: conversationOutputSchema,
  execute: async ({ inputData, requestContext }) => {
    const decisionResponse = await partyPlannerAgent.generate(
      `Classify one party conversation message and return a JSON object matching the decision schema. Questions are read_only and must have no operations. Preference messages produce incremental add/remove/replace/reset operations only for the actor; never return a complete wish list and never change participant status. Plan commands produce only add/remove/replace plan operations. Respect the supplied scope. Product and recipe targetId values must come from currentPlan.\n${JSON.stringify({ message: inputData.message, actorId: inputData.actorId, hostId: inputData.hostId, scope: inputData.scope, currentParty: inputData.currentParty, currentPlan: inputData.currentPlan })}`,
      { structuredOutput: { schema: conversationDecisionSchema }, requestContext },
    );
    const decision = decisionResponse.object;
    const applied = applyConversationDecision({
      party: inputData.currentParty,
      actorId: inputData.actorId,
      hostId: inputData.hostId,
      scope: inputData.scope,
      decision,
    });
    if (applied.error) return errorResult(inputData, decision.intent, applied.error);

    if (decision.intent === "read_only") {
      const answer = await partyPlannerAgent.generate(
        `Answer the user's read-only question using only this frozen state. Do not call tools, propose changes, or invent facts.\n${JSON.stringify({ message: inputData.message, currentParty: inputData.currentParty, currentPlan: inputData.currentPlan })}`,
        { requestContext },
      );
      return readOnlyResult(inputData, answer.text);
    }

    const silpo = createSilpoGateway(silpoUserId(requestContext));
    const recovered = await recoverLookups(inputData.currentPlan as PartyPlanDraft | null, silpo);
    const baseline = planToProposal(recovered.plan);
    const wishCandidates = await discoverWishCandidates({
      party: applied.party,
      queryVariants: await queryVariants(applied.party),
      search: silpo.searchProductIds,
      hydrate: silpo.hydrate,
    });

    for (const set of wishCandidates) {
      const prior = recovered.plan?.wishFulfillments.find((item) => item.memberId === set.memberId && item.wishId === set.wishId);
      for (const id of prior?.selectedProductIds ?? []) {
        const product = recovered.plan?.products.find((item) => item.id === id);
        if (product?.lookupProductId && !set.candidates.some((candidate) => candidate.lookupProductId === product.lookupProductId)) {
          set.candidates.push({ lookupProductId: product.lookupProductId, product });
        }
      }
    }

    let working = baseline;
    const state = createInitialState({ request: inputData.message, currentParty: applied.party });
    state.currentPlan = recovered.plan;
    state.budgetUah = inputData.budgetUah;
    state.restrictions = inputData.partyWideRestrictions;
    state.wishCandidates = wishCandidates;
    state.blockers = recovered.unresolvedIds.map((productId) => ({ code: "product_not_found", message: `Existing product ${productId} could not be resolved in Silpo.`, productId }));

    const result = await runPlanningLoop(state, {
      plan: async ({ previousBlockers }) => {
        const response = await partyPlannerAgent.generate(
          `Return a complete planner proposal JSON using the existing planner schema. Modify only components required by the explicit operations or deterministic blockers. Preserve every unaffected product, recipe, assignment, quantity, and wish fulfillment shown in currentProposal. Never change member status. Use the supplied hydrated wish candidates for wish products; use Silpo tools for direct host additions/replacements and recipe ingredients.\n${JSON.stringify({ message: inputData.message, decision, currentParty: applied.party, currentProposal: working, wishCandidates, blockers: previousBlockers })}`,
          { maxSteps: 20, requestContext },
        );
        working = mergeWithProtectedPlan({
          baseline,
          proposed: parsePlannerProposal(response.text),
          currentPlan: recovered.plan,
          affectedWishKeys: applied.affectedWishKeys,
          planOperations: decision.planOperations,
          invalidProductIds: previousBlockers.flatMap((blocker) => blocker.productId ?? []),
        });
        return working;
      },
      hydrate: silpo.hydrate,
      resolveRecipe: findRecipe,
      postValidate: (draft) => validatePlanOperations(recovered.plan, draft, decision.planOperations),
    });

    return {
      responseText: result.readiness === "ready" ? "Party plan updated." : "I updated the draft, but some items still need attention.",
      intent: decision.intent,
      preferenceOperations: decision.intent === "preference_mutation" ? decision.preferenceOperations : [],
      planOperations: decision.intent === "plan_mutation" ? decision.planOperations : [],
      updatedPreferences: preferencesFromParty(applied.party),
      updatedPlan: result.currentPlan,
      blockers: result.blockers,
      warnings: result.warnings,
      questions: result.questions,
      readiness: result.readiness,
    };
  },
});

export const conversationalPartyWorkflow = createWorkflow({
  id: "conversational-party-workflow",
  description: "Applies one conversational turn to authoritative party state without persistence.",
  inputSchema: conversationInputSchema,
  outputSchema: conversationOutputSchema,
}).then(conversationalTurn).commit();
