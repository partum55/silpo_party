import type {
  Blocker,
  PartyPlanningInput,
  PlannerProposal,
  Question,
  Warning,
} from "./schemas.ts";
import { partyPlanningInputSchema } from "./schemas.ts";
import {
  validateProposal,
  type HydratedProduct,
  type PartyPlanDraft,
  type VerifiedProduct,
} from "./validation.ts";

export type PartyPlanningState = {
  request: string;
  currentParty: PartyPlanningInput["currentParty"];
  participantCount: number;
  budgetUah: number | null;
  restrictions: string[];
  currentPlan: PartyPlanDraft | null;
  selectedProducts: VerifiedProduct[];
  blockers: Blocker[];
  warnings: Warning[];
  questions: Question[];
  readiness: "needs_input" | "invalid" | "ready";
  repairAttempts: number;
  publishedPlan: PartyPlanDraft | null;
};

export function createInitialState(value: PartyPlanningInput): PartyPlanningState {
  const input = partyPlanningInputSchema.parse(value);
  return {
    request: input.request,
    currentParty: input.currentParty,
    participantCount: input.currentParty.members.length,
    budgetUah: null,
    restrictions: [],
    currentPlan: null,
    selectedProducts: [],
    blockers: [],
    warnings: [],
    questions: [],
    readiness: "invalid",
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
  },
): Promise<PartyPlanningState> {
  let state: PartyPlanningState = {
    ...initialState,
    participantCount: initialState.currentParty.members.length,
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
    });
    state = {
      ...state,
      participantCount: state.currentParty.members.length,
      currentPlan: result.draft,
      selectedProducts: result.selectedProducts,
      blockers: result.blockers,
      warnings: result.warnings,
      questions: [],
      readiness: result.readiness,
      repairAttempts: attempt,
      publishedPlan: result.readiness === "ready" ? result.draft : null,
    };
    if (state.readiness === "ready") return state;
  }
  return state;
}
