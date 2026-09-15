import { applyParticipantWishChanges } from "./preferences.ts";
import type {
  ConversationDecision,
  NormalizedPartyPlanningInput,
  PlanOperation,
  PlannerProposal,
} from "./schemas.ts";
import type { PartyPlanDraft, VerifiedProduct } from "./validation.ts";

type Party = NormalizedPartyPlanningInput["currentParty"];

export function applyConversationDecision({
  party,
  actorId,
  hostId,
  scope,
  decision,
  createId,
}: {
  party: Party;
  actorId: string;
  hostId: string;
  scope: "preferences" | "plan" | "auto";
  decision: ConversationDecision;
  createId?: () => string;
}) {
  if (decision.intent === "read_only") return { party, affectedWishKeys: [], error: null };
  if (decision.intent === "plan_mutation") {
    if (scope === "preferences") return { party, affectedWishKeys: [], error: "scope_mismatch" as const };
    if (actorId !== hostId) return { party, affectedWishKeys: [], error: "plan_edit_forbidden" as const };
    return { party, affectedWishKeys: [], error: null };
  }
  if (!party.members.some((member) => member.id === actorId)) return { party, affectedWishKeys: [], error: "actor_not_found" as const };
  if (scope === "plan") return { party, affectedWishKeys: [], error: "scope_mismatch" as const };

  const before = new Set(party.members.find((member) => member.id === actorId)!.wishes.map((wish) => wish.id));
  try {
    const updated = applyParticipantWishChanges(party, actorId, decision.preferenceOperations, createId);
    const after = new Set(updated.members.find((member) => member.id === actorId)!.wishes.map((wish) => wish.id));
    const explicit = decision.preferenceOperations.flatMap((operation) => "wishId" in operation ? [operation.wishId] : []);
    const changed = [...new Set([...explicit, ...[...after].filter((id) => !before.has(id))])];
    return { party: updated, affectedWishKeys: changed.map((id) => `${actorId}:${id}`), error: null };
  } catch {
    return { party, affectedWishKeys: [], error: "preferences_locked" as const };
  }
}

export function preferencesFromParty(party: Party) {
  return party.members.map(({ id: memberId, wishes, status }) => ({ memberId, wishes, status }));
}

function selection(product: VerifiedProduct) {
  if (!product.lookupProductId) return null;
  return {
    productId: product.lookupProductId,
    productType: product.category,
    quantity: product.quantity,
    assignedMemberIds: product.assignedMemberIds,
    reason: product.reason,
  };
}

export function planToProposal(plan: PartyPlanDraft | null): PlannerProposal {
  if (!plan) return { summary: "Party plan", selections: [], recipes: [], wishFulfillments: [] };
  const lookupById = new Map(plan.products.flatMap((product) => product.lookupProductId ? [[product.id, product.lookupProductId] as const] : []));
  const ingredientProductIds = new Set(plan.recipes.flatMap((recipe) => recipe.ingredients.map((ingredient) => ingredient.selectedProduct.id)));
  return {
    summary: plan.summary,
    selections: plan.products.filter((product) => !ingredientProductIds.has(product.id)).flatMap((product) => selection(product) ?? []),
    recipes: plan.recipes.flatMap((recipe) => {
      const ingredients = recipe.ingredients.flatMap((ingredient) => ingredient.selectedProduct.lookupProductId
        ? [{ name: ingredient.name, amount: ingredient.baseAmount, unit: ingredient.unit, productId: ingredient.selectedProduct.lookupProductId }]
        : []);
      if (ingredients.length !== recipe.ingredients.length) return [];
      return [{
        title: recipe.title,
        source: recipe.source,
        sourceUrl: recipe.sourceUrl,
        servings: recipe.baseServings,
        ingredients,
        steps: recipe.steps,
        assignedMemberIds: recipe.assignedMemberIds,
      }];
    }),
    wishFulfillments: plan.wishFulfillments.map((fulfillment) => ({
      memberId: fulfillment.memberId,
      wishId: fulfillment.wishId,
      resolvedStrategy: fulfillment.resolvedStrategy,
      selectedProductIds: fulfillment.selectedProductIds.flatMap((id) => lookupById.get(id) ?? []),
      recipeTitle: fulfillment.recipeTitle,
      fallbackReason: fulfillment.fallbackReason,
    })),
  };
}

export function mergeWithProtectedPlan({
  baseline,
  proposed,
  currentPlan,
  affectedWishKeys,
  planOperations,
  invalidProductIds = [],
  keepDistinctAdditions = false,
}: {
  baseline: PlannerProposal;
  proposed: PlannerProposal;
  currentPlan: PartyPlanDraft | null;
  affectedWishKeys: string[];
  planOperations: PlanOperation[];
  invalidProductIds?: string[];
  keepDistinctAdditions?: boolean;
}): PlannerProposal {
  const affected = new Set(affectedWishKeys);
  const targetedProducts = new Set(planOperations.flatMap((operation) => "targetType" in operation && operation.targetType === "product" ? [operation.targetId] : []));
  const targetedRecipes = new Set(planOperations.flatMap((operation) => "targetType" in operation && operation.targetType === "recipe" ? [operation.targetId] : []));
  const invalid = new Set(invalidProductIds);
  const lookupById = new Map(currentPlan?.products.flatMap((product) => product.lookupProductId ? [[product.id, product.lookupProductId] as const] : []) ?? []);
  const affectedFulfillments = currentPlan?.wishFulfillments.filter((fulfillment) => affected.has(`${fulfillment.memberId}:${fulfillment.wishId}`)) ?? [];
  const unaffectedFulfillments = currentPlan?.wishFulfillments.filter((fulfillment) => !affected.has(`${fulfillment.memberId}:${fulfillment.wishId}`)) ?? [];
  const unaffectedProductIds = new Set(unaffectedFulfillments.flatMap((fulfillment) => fulfillment.selectedProductIds));
  const affectedProductLookups = new Set(affectedFulfillments
    .flatMap((fulfillment) => fulfillment.selectedProductIds.filter((id) => !unaffectedProductIds.has(id)).flatMap((id) => lookupById.get(id) ?? [])));
  const unaffectedRecipeTitles = new Set(unaffectedFulfillments.flatMap((fulfillment) => fulfillment.recipeTitle ?? []));
  const affectedRecipeTitles = new Set(affectedFulfillments.flatMap((fulfillment) => fulfillment.recipeTitle && !unaffectedRecipeTitles.has(fulfillment.recipeTitle) ? [fulfillment.recipeTitle] : []));
  const invalidRecipeTitles = new Set(currentPlan?.recipes.flatMap((recipe) => recipe.ingredients.some((ingredient) => invalid.has(ingredient.selectedProduct.id)) ? [recipe.title] : []) ?? []);
  const bannedLookups = new Set([...affectedProductLookups, ...[...targetedProducts].flatMap((id) => lookupById.get(id) ?? []), ...[...invalid].flatMap((id) => lookupById.get(id) ?? [])]);

  const protectedSelections = (baseline.selections ?? []).filter((item) => !bannedLookups.has(item.productId));
  const proposedSelections = (proposed.selections ?? []).filter((item) => !bannedLookups.has(item.productId));
  const selections = [...protectedSelections, ...proposedSelections.filter((item) => {
    const matching = protectedSelections.filter((kept) => kept.productId === item.productId);
    if (!matching.length) return true;
    if (!keepDistinctAdditions || !planOperations.some((operation) => operation.action === "add")) return false;
    return !matching.some((kept) => kept.quantity === item.quantity
      && kept.assignedMemberIds.length === item.assignedMemberIds.length
      && kept.assignedMemberIds.every((id) => item.assignedMemberIds.includes(id)));
  })];
  const protectedRecipes = (baseline.recipes ?? []).filter((recipe) => !targetedRecipes.has(recipe.title) && !affectedRecipeTitles.has(recipe.title) && !invalidRecipeTitles.has(recipe.title));
  const recipes = [...protectedRecipes, ...(proposed.recipes ?? []).filter((recipe) => !targetedRecipes.has(recipe.title) && !affectedRecipeTitles.has(recipe.title) && !protectedRecipes.some((kept) => kept.title === recipe.title))];
  const protectedFulfillments = (baseline.wishFulfillments ?? []).filter((item) => {
    const key = `${item.memberId}:${item.wishId}`;
    return !affected.has(key) && !(item.selectedProductIds ?? []).some((id) => bannedLookups.has(id)) && !targetedRecipes.has(item.recipeTitle ?? "");
  });
  const wishFulfillments = [...protectedFulfillments, ...(proposed.wishFulfillments ?? []).filter((item) => !protectedFulfillments.some((kept) => kept.memberId === item.memberId && kept.wishId === item.wishId))];
  return { summary: proposed.summary || baseline.summary, selections, recipes, wishFulfillments };
}

export function validatePlanOperations(before: PartyPlanDraft | null, after: PartyPlanDraft | null, operations: PlanOperation[]) {
  if (!operations.length) return [];
  const beforeProducts = new Set(before?.products.map((product) => product.id) ?? []);
  const afterProducts = new Set(after?.products.map((product) => product.id) ?? []);
  const beforeRecipes = new Set(before?.recipes.map((recipe) => recipe.title) ?? []);
  const afterRecipes = new Set(after?.recipes.map((recipe) => recipe.title) ?? []);
  const addedProducts = after?.products.filter((product) => !(before?.products ?? []).some((previous) =>
    previous.id === product.id
    && previous.quantity === product.quantity
    && previous.assignedMemberIds.length === product.assignedMemberIds.length
    && previous.assignedMemberIds.every((id) => product.assignedMemberIds.includes(id)))) ?? [];
  const addedRecipes = after?.recipes.filter((recipe) => !beforeRecipes.has(recipe.title)) ?? [];

  return operations.flatMap((operation) => {
    if (operation.action === "add") {
      const fulfilled = addedProducts.some((product) => operation.assignedMemberIds.every((id) => product.assignedMemberIds.includes(id)))
        || addedRecipes.some((recipe) => operation.assignedMemberIds.every((id) => recipe.assignedMemberIds.includes(id)));
      return fulfilled ? [] : [{ code: "plan_operation_unfulfilled" as const, message: `Новий елемент плану не виконує запит: ${operation.request}.` }];
    }
    const targetExists = operation.targetType === "product" ? beforeProducts.has(operation.targetId) : beforeRecipes.has(operation.targetId);
    if (!targetExists) return [{ code: "plan_operation_unfulfilled" as const, message: `${operation.targetId} відсутній у поточному плані.` }];
    const targetStillExists = operation.targetType === "product" ? afterProducts.has(operation.targetId) : afterRecipes.has(operation.targetId);
    if (operation.action === "remove") {
      return targetStillExists ? [{ code: "plan_operation_unfulfilled" as const, message: `${operation.targetId} не видалено.` }] : [];
    }
    const replacementAdded = addedProducts.length > 0 || addedRecipes.length > 0;
    return !targetStillExists && replacementAdded
      ? []
      : [{ code: "plan_operation_unfulfilled" as const, message: `${operation.targetId} не замінено.` }];
  });
}
