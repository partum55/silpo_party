import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

import {
  applyConversationDecision,
  mergeWithProtectedPlan,
  planToProposal,
  preferencesFromParty,
  validatePlanOperations,
} from "../domain/conversation.ts";
import { eventPlanningGuidance } from "../domain/event-guidance.ts";
import {
  applyGatheredContext,
  createInitialState,
  discoverWishCandidates,
  mentionedParticipantCount,
  runPlanningLoop,
} from "../domain/planning.ts";
import {
  blockerSchema,
  conversationDecisionSchema,
  memberSchema,
  planningModeSchema,
  planOperationSchema,
  questionSchema,
  warningSchema,
  wishChangeSchema,
} from "../domain/schemas.ts";
import type { PartyPlanDraft, VerifiedProduct } from "../domain/validation.ts";
import { validateModeAssignments } from "../domain/modes.ts";
import { createSilpoGateway } from "../silpo/gateway.ts";
import { partyPlannerAgent } from "./party-planner-agent.ts";
import { reportAgentStatus } from "./party-status.ts";
import { parsePlannerProposal, planSchema } from "./party-planning-workflow.ts";
import { findRecipe } from "./tools/recipe-tool.ts";
import { silpoUserId } from "./tools/silpo-tools.ts";

export const conversationInputSchema = z.object({
  message: z.string().min(1),
  mode: planningModeSchema.default("EVENT"),
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

function modeInstructions(
  mode: Input["mode"],
  actorId: string,
  memberIds: string[],
  budgetUah: number | null,
  message: string,
  hasCurrentPlan: boolean,
) {
  const budgetInstruction = budgetUah === null
    ? "Prefer lower-priced suitable verified products and avoid unnecessary extras."
    : `The total budget is ${budgetUah} UAH. Treat it as a strong constraint: choose lower-priced suitable verified products, minimize package waste, add essentials first, and omit optional extras before exceeding it.`;
  if (mode === "SHOPPING") {
    return `SHOPPING mode: interpret purchase requests as direct product additions, never as recipes. Assign every newly requested product only to actor ${actorId}, and preserve other participants' products. ${budgetInstruction}`;
  }
  if (mode === "DINNER") {
    return `DINNER mode: participants request dishes. Use recipes, combine the purchasable ingredients, assign each recipe to its requesters, and never buy pantry staples such as salt, pepper, water, or cooking oil. ${budgetInstruction}`;
  }
  return `EVENT mode: autonomously plan the event for all participants (${memberIds.join(", ")}). Cover essentials first: main food, a side, drinks, and a suitable sauce. Add snacks or other optional extras only when the remaining budget comfortably allows them. Assign shared purchases to everyone. ${budgetInstruction} ${eventPlanningGuidance({ message, participantCount: memberIds.length, hasCurrentPlan })}`;
}

function normalizeDecisionForMode(input: Input, value: z.infer<typeof conversationDecisionSchema>) {
  const memberIds = input.currentParty.members.map((member) => member.id);
  if (input.mode === "DINNER" && value.intent === "preference_mutation") {
    return {
      ...value,
      preferenceOperations: value.preferenceOperations.map((operation) =>
        operation.action === "add" || operation.action === "replace"
          ? { ...operation, fulfillmentStrategy: "recipe" as const }
          : operation),
    };
  }
  if ((input.mode === "SHOPPING" || input.mode === "EVENT") && value.intent === "plan_mutation") {
    const assignedMemberIds = input.mode === "SHOPPING" ? [input.actorId] : memberIds;
    return {
      ...value,
      planOperations: value.planOperations.map((operation) =>
        operation.action === "add" ? { ...operation, assignedMemberIds } : operation),
    };
  }
  if ((input.mode === "SHOPPING" || input.mode === "EVENT")
    && value.intent === "preference_mutation"
    && value.preferenceOperations.every((operation) => operation.action === "add")) {
    const assignedMemberIds = input.mode === "SHOPPING" ? [input.actorId] : memberIds;
    return {
      intent: "plan_mutation" as const,
      preferenceOperations: [],
      planOperations: value.preferenceOperations.map((operation) => ({
        action: "add" as const,
        request: operation.action === "add" ? operation.text : input.message,
        assignedMemberIds,
      })),
      readQuestion: null,
    };
  }
  return value;
}

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
    responseText: needsReopen ? "Спочатку натисніть «Змінити побажання»." : "Це повідомлення не може змінити вибраний стан.",
    intent,
    preferenceOperations: [],
    planOperations: [],
    updatedPreferences: preferencesFromParty(input.currentParty),
    updatedPlan: input.currentPlan,
    blockers: [{ code, message: needsReopen ? "Побажання учасника вже зафіксовані." : "Учасник або область команди не дозволяє цю зміну." }],
    warnings: input.warnings,
    questions: needsReopen
      ? [{ code: "preference_reopen_required" as const, prompt: "Відкрити побажання цього учасника для редагування?", memberId: input.actorId }]
      : [{ code: "command_scope_required" as const, prompt: "Уточніть, це повідомлення змінює побажання чи спільний план." }],
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
  try {
    const response = await partyPlannerAgent.generate(
      `Return a JSON object with exactly one key "wishes": an array with, for every supplied wish, exactly {"memberId": string, "wishId": string, "queries": string[]} (up to two short Silpo search variants). Preserve memberId and wishId exactly.\n${JSON.stringify(wishes)}`,
      { structuredOutput: { schema }, abortSignal: AbortSignal.timeout(20_000) },
    );
    const keys = new Set(wishes.map((wish) => `${wish.memberId}:${wish.wishId}`));
    return Object.fromEntries((response.object?.wishes ?? [])
      .filter((wish) => keys.has(`${wish.memberId}:${wish.wishId}`))
      .map((wish) => [`${wish.memberId}:${wish.wishId}`, wish.queries]));
  } catch (error) {
    // discoverWishCandidates falls back to each wish's own text when no variant is supplied, so degrading to
    // {} here is safe — better than crashing the whole turn over an optional search-quality improvement.
    console.error("queryVariants: failed, falling back to each wish's own text", error);
    return {};
  }
}

const conversationalTurn = createStep({
  id: "conversational-turn",
  description: "Interprets one message and returns a validated, persistence-free state transition.",
  inputSchema: conversationInputSchema,
  outputSchema: conversationOutputSchema,
  execute: async ({ inputData, requestContext }) => {
    // Reverts a prior turn in the same drain-loop batch (src/lib/chat/service.ts) back from SEARCHING —
    // this turn hasn't started searching anything yet.
    await reportAgentStatus(requestContext, "THINKING");
    let decision: z.infer<typeof conversationDecisionSchema> | undefined;
    try {
      const decisionResponse = await partyPlannerAgent.generate(
        `Classify one party conversation message. Return a JSON object with exactly these keys and no others: {"intent": "read_only"|"preference_mutation"|"plan_mutation", "preferenceOperations": array, "planOperations": array, "readQuestion": "cost"|"summary"|"member"|"recipes"|"other"|null}.

If intent is "read_only": preferenceOperations and planOperations must both be [], and readQuestion must be set (not null). Questions are read_only and must have no operations.

If intent is "preference_mutation": planOperations must be [], readQuestion must be null. Each preferenceOperations item is exactly one of {"action":"add","text":string,"fulfillmentStrategy"?:"ready_made"|"recipe"|"either"}, {"action":"replace","wishId":string,"text":string,"fulfillmentStrategy"?:"ready_made"|"recipe"|"either"}, {"action":"remove","wishId":string}, or {"action":"reset"}. Produce incremental add/remove/replace/reset operations only for the actor; never return a complete wish list and never change participant status.

If intent is "plan_mutation": preferenceOperations must be [], readQuestion must be null, planOperations must be non-empty. Each planOperations item is exactly one of {"action":"add","request":string,"assignedMemberIds":string[]}, {"action":"remove","targetType":"product"|"recipe","targetId":string}, or {"action":"replace","targetType":"product"|"recipe","targetId":string,"request":string}. targetId values must come from currentPlan.

Respect the supplied scope. ${modeInstructions(inputData.mode, inputData.actorId, inputData.currentParty.members.map((member) => member.id), inputData.budgetUah, inputData.message, Boolean(inputData.currentPlan))}\n${JSON.stringify({ message: inputData.message, mode: inputData.mode, actorId: inputData.actorId, hostId: inputData.hostId, scope: inputData.scope, currentParty: inputData.currentParty, currentPlan: inputData.currentPlan })}`,
        { structuredOutput: { schema: conversationDecisionSchema }, requestContext, abortSignal: AbortSignal.timeout(20_000) },
      );
      decision = decisionResponse.object
        ? normalizeDecisionForMode(inputData, decisionResponse.object)
        : undefined;
    } catch (error) {
      console.error("conversationalTurn: decision classification failed", error);
      decision = undefined;
    }
    if (!decision) {
      // Provider timeouts and invalid structured output both leave this turn without a usable decision.
      // Keep the existing state and report an availability problem instead of blaming the user's wording.
      return readOnlyResult(inputData, "Сервіс агента тимчасово не відповідає. Спробуйте ще раз за хвилину.");
    }
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
        `Відповідай українською мовою на запитання користувача, використовуючи лише цей зафіксований стан. Не викликай інструменти, не пропонуй змін і не вигадуй фактів.\n${JSON.stringify({ message: inputData.message, currentParty: inputData.currentParty, currentPlan: inputData.currentPlan })}`,
        { requestContext, abortSignal: AbortSignal.timeout(20_000) },
      );
      return readOnlyResult(inputData, answer.text);
    }

    // Everything below drives multiple free-text LLM calls (recipe/plan JSON isn't schema-constrained by the
    // provider, only Zod-validated after the fact — see parsePlannerProposal). A malformed response anywhere
    // in here must not crash the whole turn; fail soft with the original, unmodified state instead.
    await reportAgentStatus(requestContext, "SEARCHING");
    try {
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
      let state = createInitialState({
        request: inputData.message,
        mode: inputData.mode,
        budgetUah: inputData.budgetUah,
        currentParty: applied.party,
      });
      state = applyGatheredContext(state, {
        budgetUah: inputData.budgetUah,
        partyWideRestrictions: inputData.partyWideRestrictions,
        participantCountMentioned: inputData.mode === "EVENT" ? mentionedParticipantCount(inputData.message) : null,
      });
      state.currentPlan = recovered.plan;
      state.wishCandidates = wishCandidates;
      state.blockers = recovered.unresolvedIds.map((productId) => ({ code: "product_not_found", message: `Не вдалося знайти наявний товар ${productId} у Silpo.`, productId }));

      const result = await runPlanningLoop(state, {
        plan: async ({ previousBlockers }) => {
          const response = await partyPlannerAgent.generate(
            `Return JSON with exactly these top-level keys: {"summary": string, "selections": [{"productId": string, "quantity": number, "assignedMemberIds": string[], "reason": string}], "recipes": [{"title": string, "source": "web"|"generated", "sourceUrl": string|null, "servings": number, "assignedMemberIds": string[], "ingredients": [{"name": string, "amount": number, "unit": "g"|"ml"|"piece", "productId": string}], "steps": string[]}], "wishFulfillments": [{"memberId": string, "wishId": string, "resolvedStrategy": "ready_made"|"recipe", "selectedProductIds": string[], "recipeTitle": string|null, "fallbackReason": "explicit_cooking"|"no_candidates"|"no_safe_candidate"|"poor_match"|null}]}. Always include all three arrays, even if empty. Do not rename fields, omit fields, or add other keys — every selections/recipes item needs every listed field. Modify only components required by the explicit operations or deterministic blockers below; preserve every unaffected product, recipe, assignment, quantity, and wish fulfillment shown in currentProposal exactly. Never change member status. Use the supplied hydrated wish candidates for wish products. For direct additions or replacements, call silpoSearchVerifiedProducts once with one short catalog term per concrete product/category need (never pass quantities, event context, or a whole request as a query), select using its hydrated results and lookupProductId values, and avoid extra comparison calls unless that batch has no suitable candidate. Satisfy a requested total amount using the available package size and quantity when the exact package size is unavailable. Quantity is always a positive integer count of the product's displayed purchasable increment/package, never kilograms or a raw recipe amount. Example: if the catalog increment is 100 g and 250 g is needed, use quantity 3.\n${modeInstructions(inputData.mode, inputData.actorId, applied.party.members.map((member) => member.id), inputData.budgetUah, inputData.message, Boolean(recovered.plan))}\n${JSON.stringify({ message: inputData.message, mode: inputData.mode, budgetUah: inputData.budgetUah, decision, currentParty: applied.party, currentProposal: working, wishCandidates, blockers: previousBlockers })}`,
            {
              maxSteps: inputData.currentPlan ? 4 : inputData.mode === "SHOPPING" ? 6 : 12,
              requestContext,
              abortSignal: AbortSignal.timeout(60_000),
            },
          );
          let proposed;
          try {
            proposed = parsePlannerProposal(response.text);
          } catch (error) {
            // An empty proposal fails deterministic validation just like a genuinely bad plan would, so it
            // naturally feeds runPlanningLoop's existing repair-retry loop instead of throwing out to the
            // outer catch (which gives up on the whole turn) on one malformed response.
            console.error("conversationalTurn: failed to parse planner proposal", error);
            proposed = { summary: "", selections: [], recipes: [], wishFulfillments: [] };
          }
          working = mergeWithProtectedPlan({
            baseline,
            proposed,
            currentPlan: recovered.plan,
            affectedWishKeys: applied.affectedWishKeys,
            planOperations: decision.planOperations,
            invalidProductIds: previousBlockers.flatMap((blocker) => blocker.productId ?? []),
            keepDistinctAdditions: inputData.mode === "SHOPPING",
          });
          return working;
        },
        hydrate: silpo.hydrate,
        resolveRecipe: findRecipe,
        // A conversational edit is incremental and mergeWithProtectedPlan already preserves the valid
        // baseline. Re-running a full tool-using plan for one failed addition can turn one edit into minutes;
        // publish the valid partial draft and report its blockers instead.
        maxRepairAttempts: 0,
        postValidate: (draft) => [
          ...validatePlanOperations(recovered.plan, draft, decision.planOperations),
          ...validateModeAssignments({
            mode: inputData.mode,
            actorId: inputData.actorId,
            memberIds: applied.party.members.map((member) => member.id),
            before: recovered.plan,
            after: draft,
          }),
        ],
      });

      const warningText = result.warnings.map((warning) => warning.code === "budget_exceeded"
        ? `План перевищує бюджет на ${warning.amountUah ?? 0} грн.`
        : "Кількість людей у запиті не збігається зі складом вечірки; використано поточний список учасників.").join(" ");
      return {
        responseText: [
          result.readiness === "ready" ? "План вечірки оновлено." : "Чернетку оновлено, але деякі товари потребують уваги.",
          warningText,
        ].filter(Boolean).join(" "),
        intent: decision.intent,
        preferenceOperations: decision.intent === "preference_mutation" ? decision.preferenceOperations : [],
        planOperations: decision.intent === "plan_mutation" ? decision.planOperations : [],
        updatedPreferences: preferencesFromParty(applied.party),
        // Never replace an existing basket with an invalid partial draft. A transient catalog miss while
        // validating an incremental addition must not silently delete products that were already visible.
        updatedPlan: result.readiness === "ready" ? result.currentPlan : (inputData.currentPlan ?? result.currentPlan),
        blockers: result.blockers,
        warnings: result.warnings,
        questions: result.questions,
        readiness: result.readiness,
      };
    } catch (error) {
      console.error("conversationalTurn: plan mutation failed", error);
      return readOnlyResult(inputData, "Не вдалося оновити кошик. Спробуйте ще раз.");
    }
  },
});

export const conversationalPartyWorkflow = createWorkflow({
  id: "conversational-party-workflow",
  description: "Applies one conversational turn to authoritative party state without persistence.",
  inputSchema: conversationInputSchema,
  outputSchema: conversationOutputSchema,
}).then(conversationalTurn).commit();
