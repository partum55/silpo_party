import { z } from "zod";

export const planningModeSchema = z.enum(["SHOPPING", "DINNER", "EVENT"]);

export const wishSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  fulfillmentStrategy: z.enum(["ready_made", "recipe", "either"]).default("either"),
});

export const wishChangeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), text: z.string().min(1), fulfillmentStrategy: z.enum(["ready_made", "recipe", "either"]).optional() }).strict(),
  z.object({ action: z.literal("replace"), wishId: z.string().min(1), text: z.string().min(1), fulfillmentStrategy: z.enum(["ready_made", "recipe", "either"]).optional() }).strict(),
  z.object({ action: z.literal("remove"), wishId: z.string().min(1) }).strict(),
  z.object({ action: z.literal("reset") }).strict(),
]);

export const wishChangesSchema = z.object({ changes: z.array(wishChangeSchema) }).strict();

export const planOperationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), request: z.string().min(1), assignedMemberIds: z.array(z.string().min(1)).min(1) }).strict(),
  z.object({ action: z.literal("remove"), targetType: z.enum(["product", "recipe"]), targetId: z.string().min(1) }).strict(),
  z.object({ action: z.literal("replace"), targetType: z.enum(["product", "recipe"]), targetId: z.string().min(1), request: z.string().min(1) }).strict(),
]);

export const conversationDecisionSchema = z.object({
  intent: z.enum(["read_only", "preference_mutation", "plan_mutation"]),
  preferenceOperations: z.array(wishChangeSchema),
  planOperations: z.array(planOperationSchema),
  readQuestion: z.enum(["cost", "summary", "member", "recipes", "other"]).nullable(),
}).strict().superRefine((decision, context) => {
  if (decision.intent === "read_only" && (decision.preferenceOperations.length || decision.planOperations.length || decision.readQuestion === null)) {
    context.addIssue({ code: "custom", message: "Read-only decisions cannot contain mutations and require a question type." });
  }
  if (decision.intent === "preference_mutation" && (decision.planOperations.length || decision.readQuestion !== null)) {
    context.addIssue({ code: "custom", message: "Preference decisions cannot contain plan operations or read questions." });
  }
  if (decision.intent === "plan_mutation" && (decision.preferenceOperations.length || !decision.planOperations.length || decision.readQuestion !== null)) {
    context.addIssue({ code: "custom", message: "Plan decisions require plan operations only." });
  }
});

export const memberSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  restrictions: z.array(z.string().min(1)).default([]),
  wishes: z.array(wishSchema).default([]),
  status: z.enum(["collecting", "ready"]).default("collecting"),
});

export const partyPlanningInputSchema = z.object({
  request: z.string().min(1),
  mode: planningModeSchema.default("EVENT"),
  budgetUah: z.number().nonnegative().nullable().default(null),
  currentParty: z.object({
    members: z.array(memberSchema).max(10),
  }),
});

export const plannerSelectionSchema = z.object({
  productId: z.string().min(1),
  // Count of catalog purchase increments/packages, never kilograms or a free-form recipe amount.
  quantity: z.number().int().positive(),
  assignedMemberIds: z.array(z.string().min(1)).min(1),
  reason: z.string().min(1),
});

export const plannerWishFulfillmentSchema = z.object({
  memberId: z.string().min(1),
  wishId: z.string().min(1),
  resolvedStrategy: z.enum(["ready_made", "recipe"]),
  selectedProductIds: z.array(z.string().min(1)).default([]),
  recipeTitle: z.string().min(1).nullable().default(null),
  fallbackReason: z.enum(["explicit_cooking", "no_candidates", "no_safe_candidate", "poor_match"]).nullable().default(null),
});

export const recipeUnitSchema = z.enum(["g", "ml", "piece"]);

export const recipeIngredientSchema = z.object({
  name: z.string().min(1),
  amount: z.number().positive(),
  unit: recipeUnitSchema,
});

export const foundRecipeSchema = z.object({
  title: z.string().min(1),
  source: z.literal("web"),
  sourceUrl: z.string().url(),
  servings: z.number().int().positive(),
  ingredients: z.array(recipeIngredientSchema).min(1),
  steps: z.array(z.string().min(1)).min(1),
});

export const plannerRecipeSchema = z.object({
  title: z.string().min(1),
  source: z.enum(["web", "generated"]),
  sourceUrl: z.string().url().nullable(),
  servings: z.number().int().positive(),
  ingredients: z.array(recipeIngredientSchema.extend({ productId: z.string().min(1) })).min(1),
  steps: z.array(z.string().min(1)).min(1),
  assignedMemberIds: z.array(z.string().min(1)).min(1),
});

export const plannerProposalSchema = z.object({
  summary: z.string().min(1),
  selections: z.array(plannerSelectionSchema),
  recipes: z.array(plannerRecipeSchema).default([]),
  wishFulfillments: z.array(plannerWishFulfillmentSchema).default([]),
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
    "recipe_unresolved",
    "recipe_ingredient_mapping_missing",
    "recipe_unit_mismatch",
    "wish_unfulfilled",
    "invalid_fulfillment",
    "no_suitable_ready_made",
    "actor_not_found",
    "plan_edit_forbidden",
    "scope_mismatch",
    "preferences_locked",
    "plan_operation_unfulfilled",
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
  code: z.enum(["party_members_required", "restriction_details_required", "preference_reopen_required", "command_scope_required"]),
  prompt: z.string(),
  memberId: z.string().optional(),
});

export type Wish = z.infer<typeof wishSchema>;
export type WishChange = z.input<typeof wishChangeSchema>;
export type PlanOperation = z.infer<typeof planOperationSchema>;
export type ConversationDecision = z.infer<typeof conversationDecisionSchema>;
export type PartyMember = z.infer<typeof memberSchema>;
export type PartyPlanningInput = z.input<typeof partyPlanningInputSchema>;
export type NormalizedPartyPlanningInput = z.output<typeof partyPlanningInputSchema>;
export type PlannerProposal = z.input<typeof plannerProposalSchema>;
export type FoundRecipe = z.infer<typeof foundRecipeSchema>;
export type Blocker = z.infer<typeof blockerSchema>;
export type Warning = z.infer<typeof warningSchema>;
export type Question = z.infer<typeof questionSchema>;
