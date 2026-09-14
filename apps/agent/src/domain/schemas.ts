import { z } from "zod";

export const memberSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  restrictions: z.array(z.string().min(1)).default([]),
});

export const partyPlanningInputSchema = z.object({
  request: z.string().min(1),
  currentParty: z.object({
    members: z.array(memberSchema).max(10),
  }),
});

export const plannerSelectionSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().positive(),
  assignedMemberIds: z.array(z.string().min(1)).min(1),
  reason: z.string().min(1),
});

export const plannerProposalSchema = z.object({
  summary: z.string().min(1),
  selections: z.array(plannerSelectionSchema),
});

export const blockerSchema = z.object({
  code: z.enum([
    "party_members_required",
    "product_not_found",
    "product_unavailable",
    "invalid_assignment",
    "restriction_unverified",
    "restriction_violation",
    "insufficient_food",
    "insufficient_drink",
    "no_suitable_products",
  ]),
  message: z.string(),
  productId: z.string().optional(),
  memberId: z.string().optional(),
});

export const warningSchema = z.object({
  code: z.enum(["budget_exceeded", "participant_count_conflict"]),
  message: z.string(),
  amountUah: z.number().optional(),
});

export const questionSchema = z.object({
  code: z.enum(["party_members_required", "restriction_details_required"]),
  prompt: z.string(),
  memberId: z.string().optional(),
});

export type PartyPlanningInput = z.infer<typeof partyPlanningInputSchema>;
export type PlannerProposal = z.infer<typeof plannerProposalSchema>;
export type Blocker = z.infer<typeof blockerSchema>;
export type Warning = z.infer<typeof warningSchema>;
export type Question = z.infer<typeof questionSchema>;
