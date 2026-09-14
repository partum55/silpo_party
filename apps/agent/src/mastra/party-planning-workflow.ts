import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

import {
  applyGatheredContext,
  createInitialState,
  runPlanningLoop,
  type PartyPlanningState,
} from "../domain/planning.ts";
import {
  coverageTargets,
} from "../domain/validation.ts";
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

const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  priceUah: z.number(),
  unit: z.string(),
  available: z.boolean(),
  weighted: z.boolean().optional(),
  category: z.enum(["food", "drink"]),
  packageSize: z.object({ amount: z.number(), unit: z.enum(["g", "ml"]) }),
  metadata: z.object({
    ingredients: z.array(z.string()),
    allergens: z.array(z.string()),
    labels: z.array(z.string()),
    composition: z.array(z.string()).optional(),
  }),
  quantity: z.number().positive(),
  assignedMemberIds: z.array(z.string()),
  reason: z.string(),
  lineTotalUah: z.number(),
});

const coverageSchema = z.record(z.string(), z.object({
  foodGrams: z.number(),
  drinkMilliliters: z.number(),
}));

const planSchema = z.object({
  summary: z.string(),
  products: z.array(productSchema),
  totalUah: z.number(),
  coverage: coverageSchema,
});

const stateSchema = z.object({
  request: z.string(),
  currentParty: z.object({ members: z.array(memberSchema).max(10) }),
  participantCount: z.number().int().min(0).max(10),
  budgetUah: z.number().nonnegative().nullable(),
  restrictions: z.array(z.string()),
  currentPlan: planSchema.nullable(),
  selectedProducts: z.array(productSchema),
  blockers: z.array(blockerSchema),
  warnings: z.array(warningSchema),
  questions: z.array(questionSchema),
  readiness: z.enum(["needs_input", "invalid", "ready"]),
  repairAttempts: z.number().int().min(0).max(2),
  publishedPlan: planSchema.nullable(),
});

const gatheredContextSchema = z.object({
  budgetUah: z.number().nonnegative().nullable(),
  partyWideRestrictions: z.array(z.string()),
  participantCountMentioned: z.number().int().positive().nullable(),
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
  execute: async ({ inputData }) => {
    let next = createInitialState(inputData);
    if (next.participantCount) {
      const response = await partyPlannerAgent.generate(
        `Return JSON with exactly these keys: {"budgetUah": number|null, "partyWideRestrictions": string[], "participantCountMentioned": number|null}. Do not plan products or add other keys.\n\nParty request:\n${inputData.request}`,
        { structuredOutput: { schema: gatheredContextSchema } },
      );
      next = applyGatheredContext(next, response.object);
    }
    return next;
  },
});

const planAndValidate = createStep({
  id: "plan-and-validate",
  description: "Plans with live Silpo tools, validates deterministically, and repairs at most twice.",
  inputSchema: stateSchema,
  outputSchema: stateSchema,
  execute: async ({ inputData }) => {
    const userId = process.env.SILPO_USER_ID;
    if (!userId && inputData.participantCount) throw new Error("Missing environment variable: SILPO_USER_ID");
    const silpo = userId ? createSilpoGateway(userId) : null;
    const result = await runPlanningLoop(inputData as PartyPlanningState, {
      plan: async ({ state, previousBlockers }) => {
        const response = await partyPlannerAgent.generate(
          `Return JSON with exactly these top-level keys: {"summary": string, "selections": [{"productId": string, "quantity": number, "assignedMemberIds": string[], "reason": string}]}. Do not rename selections or assignedMemberIds, and do not add other keys. Search products and inspect details before choosing IDs. Keep the plan small, normally 4-8 selections; increase quantities instead of adding near-duplicates.

Current party and request:
${JSON.stringify({ request: state.request, members: state.currentParty.members, participantCount: state.currentParty.members.length, budgetUah: state.budgetUah, partyWideRestrictions: state.restrictions, coverageTargets })}

Coverage uses hydrated package amount × quantity, divided among every assigned member. Meet both targets for each member; on repair, replace unverified products and increase quantities where coverage is short.

Deterministic validation failures from the previous attempt:
${JSON.stringify(previousBlockers)}`,
          { maxSteps: 20 },
        );
        return parsePlannerProposal(response.text);
      },
      hydrate: (productId) => silpo!.hydrate(productId),
    });
    return result;
  },
});

const finalize = createStep({
  id: "finalize",
  description: "Publishes a draft only when deterministic validation marked it ready.",
  inputSchema: stateSchema,
  outputSchema: stateSchema,
  execute: async ({ inputData }) => {
    const result = {
      ...inputData,
      participantCount: inputData.currentParty.members.length,
      publishedPlan: inputData.readiness === "ready" ? inputData.currentPlan : null,
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
  .then(planAndValidate)
  .then(finalize)
  .commit();
