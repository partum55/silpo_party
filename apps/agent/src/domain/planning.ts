import type {
  Blocker,
  FoundRecipe,
  NormalizedPartyPlanningInput,
  PartyPlanningInput,
  PlannerProposal,
  Question,
  Warning,
} from "./schemas.ts";
import { partyPlanningInputSchema } from "./schemas.ts";
import { getPreferencePhase } from "./preferences.ts";
import {
  validateProposal,
  type HydratedProduct,
  type PartyPlanDraft,
  type VerifiedProduct,
} from "./validation.ts";

export type PartyPlanningState = {
  request: string;
  currentParty: NormalizedPartyPlanningInput["currentParty"];
  participantCount: number;
  budgetUah: number | null;
  restrictions: string[];
  currentPlan: PartyPlanDraft | null;
  wishCandidates: WishCandidateSet[];
  selectedProducts: VerifiedProduct[];
  blockers: Blocker[];
  warnings: Warning[];
  questions: Question[];
  readiness: "needs_input" | "invalid" | "ready";
  preferencePhase: "provisional" | "finalized";
  repairAttempts: number;
  publishedPlan: PartyPlanDraft | null;
};

export type WishCandidateSet = {
  memberId: string;
  wishId: string;
  requestedStrategy: "ready_made" | "recipe" | "either";
  searchQueries: string[];
  candidates: Array<{ lookupProductId: string; product: HydratedProduct }>;
};

export async function discoverWishCandidates({
  party,
  queryVariants,
  search,
  hydrate,
}: {
  party: NormalizedPartyPlanningInput["currentParty"];
  queryVariants: Record<string, string[]>;
  search: (query: string) => Promise<string[]>;
  hydrate: (productId: string) => Promise<HydratedProduct | null>;
}): Promise<WishCandidateSet[]> {
  const sets: WishCandidateSet[] = [];
  for (const member of party.members) {
    for (const wish of member.wishes) {
      if (wish.fulfillmentStrategy === "recipe") {
        sets.push({ memberId: member.id, wishId: wish.id, requestedStrategy: "recipe", searchQueries: [], candidates: [] });
        continue;
      }
      const key = `${member.id}:${wish.id}`;
      const queries = [...new Set([wish.text, ...(queryVariants[key] ?? []).slice(0, 2)])];
      const ids: string[] = [];
      const searchResults = await Promise.all(queries.map(search));
      for (let index = 0; ids.length < 6 && searchResults.some((results) => index < results.length); index += 1) {
        for (const results of searchResults) {
          const id = results[index];
          if (id && !ids.includes(id)) ids.push(id);
          if (ids.length === 6) break;
        }
      }
      const candidates = (await Promise.all(ids.map(async (lookupProductId) => ({
        lookupProductId,
        product: await hydrate(lookupProductId),
      })))).flatMap((candidate) => candidate.product ? [{ ...candidate, product: candidate.product }] : []);
      sets.push({ memberId: member.id, wishId: wish.id, requestedStrategy: wish.fulfillmentStrategy, searchQueries: queries, candidates });
    }
  }
  return sets;
}

export function createInitialState(value: PartyPlanningInput): PartyPlanningState {
  const input = partyPlanningInputSchema.parse(value);
  return {
    request: input.request,
    currentParty: input.currentParty,
    participantCount: input.currentParty.members.length,
    budgetUah: null,
    restrictions: [],
    currentPlan: null,
    wishCandidates: [],
    selectedProducts: [],
    blockers: [],
    warnings: [],
    questions: [],
    readiness: "invalid",
    preferencePhase: getPreferencePhase(input.currentParty),
    repairAttempts: 0,
    publishedPlan: null,
  };
}

export function applyGatheredContext(
  state: PartyPlanningState,
  context: {
    budgetUah: number | null;
    partyWideRestrictions: string[];
    participantCountMentioned: number | null;
  },
): PartyPlanningState {
  const participantCount = state.currentParty.members.length;
  const warnings = state.warnings.filter((warning) => warning.code !== "participant_count_conflict");
  if (context.participantCountMentioned !== null && context.participantCountMentioned !== participantCount) {
    warnings.push({
      code: "participant_count_conflict",
      message: `The request mentions ${context.participantCountMentioned} people, but the current party has ${participantCount}; current members were used.`,
    });
  }
  return {
    ...state,
    participantCount,
    budgetUah: context.budgetUah,
    restrictions: [...new Set(context.partyWideRestrictions)],
    warnings,
  };
}

export async function runPlanningLoop(
  initialState: PartyPlanningState,
  dependencies: {
    plan: (context: { state: PartyPlanningState; previousBlockers: Blocker[] }) => Promise<PlannerProposal>;
    hydrate: (productId: string) => Promise<HydratedProduct | null>;
    resolveRecipe?: (query: string) => Promise<FoundRecipe | null>;
    postValidate?: (draft: PartyPlanDraft | null) => Blocker[];
  },
): Promise<PartyPlanningState> {
  let state: PartyPlanningState = {
    ...initialState,
    participantCount: initialState.currentParty.members.length,
    preferencePhase: getPreferencePhase(initialState.currentParty),
    publishedPlan: null,
  };
  if (!state.participantCount) {
    return {
      ...state,
      blockers: [{ code: "party_members_required", message: "Add at least one current party member." }],
      questions: [{ code: "party_members_required", prompt: "Who is currently attending the party?" }],
      readiness: "needs_input",
    };
  }

  for (let attempt = 0; attempt <= 2; attempt += 1) {
    state.participantCount = state.currentParty.members.length;
    const proposal = await dependencies.plan({ state, previousBlockers: state.blockers });
    const result = await validateProposal({
      input: { request: state.request, currentParty: state.currentParty },
      budgetUah: state.budgetUah,
      partyWideRestrictions: state.restrictions,
      proposal,
      hydrate: dependencies.hydrate,
      resolveRecipe: dependencies.resolveRecipe,
      wishCandidates: state.wishCandidates,
    });
    const blockers = [...result.blockers, ...(dependencies.postValidate?.(result.draft) ?? [])];
    state = {
      ...state,
      participantCount: state.currentParty.members.length,
      currentPlan: result.draft,
      selectedProducts: result.selectedProducts,
      blockers,
      warnings: result.warnings,
      questions: [],
      readiness: blockers.length ? "invalid" : "ready",
      preferencePhase: getPreferencePhase(state.currentParty),
      repairAttempts: attempt,
      publishedPlan: !blockers.length && getPreferencePhase(state.currentParty) === "finalized"
        ? result.draft
        : null,
    };
    if (state.readiness === "ready") return state;
  }
  return state;
}
