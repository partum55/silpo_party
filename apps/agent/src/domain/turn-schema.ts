import { z } from "zod";

import { planSchema } from "./plan.ts";
import {
  blockerSchema,
  conversationDecisionSchema,
  memberSchema,
  planningModeSchema,
  planOperationSchema,
  questionSchema,
  warningSchema,
  wishChangeSchema,
} from "./schemas.ts";

// Contract with the web app (src/lib/agent/runner.ts and src/lib/chat/service.ts). Keep it stable.
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

export type TurnInput = z.output<typeof conversationInputSchema>;
export type TurnOutput = z.output<typeof conversationOutputSchema>;
export type Party = TurnInput["currentParty"];
export type Member = Party["members"][number];
