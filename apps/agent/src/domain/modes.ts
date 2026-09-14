import type { Blocker } from "./schemas.ts";
import type { PartyPlanDraft } from "./validation.ts";

const sameIds = (left: string[], right: string[]) => {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((id, index) => id === b[index]);
};

export function validateModeAssignments({
  mode,
  actorId,
  memberIds,
  before,
  after,
}: {
  mode: "SHOPPING" | "DINNER" | "EVENT";
  actorId: string;
  memberIds: string[];
  before: PartyPlanDraft | null;
  after: PartyPlanDraft | null;
}): Blocker[] {
  if (!after || mode === "DINNER") return [];
  const beforeProducts = new Map((before?.products ?? []).map((product) => [product.id, product]));
  const beforeRecipes = new Set((before?.recipes ?? []).map((recipe) => recipe.title));
  const changedProducts = after.products.filter((product) => {
    const previous = beforeProducts.get(product.id);
    return !previous || previous.quantity !== product.quantity || !sameIds(previous.assignedMemberIds, product.assignedMemberIds);
  });
  const newRecipes = after.recipes.filter((recipe) => !beforeRecipes.has(recipe.title));

  if (mode === "SHOPPING") {
    if (newRecipes.length || changedProducts.some((product) => !sameIds(product.assignedMemberIds, [actorId]))) {
      return [{ code: "plan_operation_unfulfilled", message: "Shopping purchases must be direct products charged only to the requesting participant." }];
    }
    return [];
  }

  const invalidSharedItem = changedProducts.some((product) => !sameIds(product.assignedMemberIds, memberIds))
    || newRecipes.some((recipe) => !sameIds(recipe.assignedMemberIds, memberIds));
  return invalidSharedItem
    ? [{ code: "plan_operation_unfulfilled", message: "Autonomous event purchases must be shared by every current participant." }]
    : [];
}

