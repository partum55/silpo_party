import { normalizeKey } from "../cache/index.ts";
import type { CatalogProduct, PartyPlan, VerifiedProduct } from "../domain/plan.ts";
import { productLineTotalUah } from "../domain/purchasing.ts";

const money = (value: number) => Math.round(value * 100) / 100;
const sortedIds = (ids: string[]) => [...new Set(ids)].sort();

/** Identity of a plan row: the same product bought for the same people is one row. */
export function rowKey(product: Pick<VerifiedProduct, "id" | "lookupProductId" | "assignedMemberIds">) {
  return `${product.lookupProductId ?? product.id}|${sortedIds(product.assignedMemberIds).join(",")}`;
}

export function toPlanProduct(product: CatalogProduct, {
  quantity,
  assignedMemberIds,
  reason,
  requestKey,
}: {
  quantity: number;
  assignedMemberIds: string[];
  reason: string;
  requestKey?: string;
}): VerifiedProduct {
  return {
    ...product,
    quantity,
    assignedMemberIds: sortedIds(assignedMemberIds),
    reason,
    lineTotalUah: productLineTotalUah(product, quantity),
    ...(requestKey ? { requestKey } : {}),
  };
}

function withQuantity(product: VerifiedProduct, quantity: number): VerifiedProduct {
  return { ...product, quantity, lineTotalUah: productLineTotalUah(product, quantity) };
}

export type PlanChange = { product: VerifiedProduct; addedQuantity: number };

/** Adds products, merging each into an existing row for the same product and people. */
export function addProducts(plan: PartyPlan, additions: VerifiedProduct[]) {
  const products = [...plan.products];
  const changes: PlanChange[] = [];
  for (const addition of additions) {
    const index = products.findIndex((product) => rowKey(product) === rowKey(addition));
    if (index >= 0) {
      products[index] = withQuantity({ ...products[index], ...refreshedFacts(addition) }, products[index].quantity + addition.quantity);
      changes.push({ product: products[index], addedQuantity: addition.quantity });
    } else {
      products.push(addition);
      changes.push({ product: addition, addedQuantity: addition.quantity });
    }
  }
  return { plan: recalculate({ ...plan, products }), changes };
}

/** Live catalog facts from a fresh lookup win over the stored copy (price, availability, slug, image). */
function refreshedFacts(product: VerifiedProduct): Partial<VerifiedProduct> {
  const facts: Partial<VerifiedProduct> = { ...product };
  for (const key of ["quantity", "assignedMemberIds", "reason", "lineTotalUah", "requestKey"] as const) delete facts[key];
  return facts;
}

const tokenStem = (token: string) => token.slice(0, Math.max(3, Math.min(token.length, 5)));

/** Finds plan rows a user refers to by name ("сік", "апельсиновий сік") or by product id. */
export function findPlanProducts(plan: PartyPlan, target: string) {
  const exact = plan.products.filter((product) => product.id === target || product.lookupProductId === target);
  if (exact.length) return exact;
  const tokens = normalizeKey(target).split(" ").filter((token) => token.length > 1);
  if (!tokens.length) return [];
  return plan.products.filter((product) => {
    const name = normalizeKey(`${product.name} ${product.requestKey?.replace(/^\w+:/, "") ?? ""}`);
    return tokens.every((token) => name.includes(tokenStem(token)));
  });
}

/**
 * Removes plan rows. A removed recipe ingredient is remembered as excluded so later recipe rebuilds do not
 * buy it again; pass `exclude: false` when the row is being replaced by another product for the same need.
 */
export function removeRows(plan: PartyPlan, rows: VerifiedProduct[], { exclude = true }: { exclude?: boolean } = {}) {
  const keys = new Set(rows.map(rowKey));
  const removedIds = new Set(rows.map((row) => row.id));
  const products = plan.products.filter((product) => !keys.has(rowKey(product)));
  const stillPresent = new Set(products.map((product) => product.id));
  const goneIds = new Set([...removedIds].filter((id) => !stillPresent.has(id)));
  return recalculate({
    ...plan,
    products,
    // A removed recipe ingredient stays listed on its recipe as missing, so the recipe still reads correctly.
    recipes: plan.recipes.map((recipe) => {
      const removed = recipe.ingredients.filter((ingredient) => goneIds.has(ingredient.selectedProduct.id));
      if (!removed.length) return recipe;
      return {
        ...recipe,
        ingredients: recipe.ingredients.filter((ingredient) => !goneIds.has(ingredient.selectedProduct.id)),
        missingIngredients: [
          ...(recipe.missingIngredients ?? []),
          ...removed.map(({ name, baseAmount, requiredAmount, unit }) => ({ name, baseAmount, requiredAmount, unit })),
        ],
      };
    }),
    excludedIngredientKeys: [...new Set([
      ...plan.excludedIngredientKeys,
      ...(exclude ? rows.flatMap((row) => row.requestKey?.startsWith("ingredient:") ? [row.requestKey] : []) : []),
    ])],
  });
}

export function setRowQuantity(plan: PartyPlan, row: VerifiedProduct, quantity: number) {
  if (quantity < 1) return removeRows(plan, [row]);
  const key = rowKey(row);
  return recalculate({
    ...plan,
    products: plan.products.map((product) => rowKey(product) === key ? withQuantity(product, Math.round(quantity)) : product),
  });
}

export function recalculate(plan: PartyPlan): PartyPlan {
  const totalUah = money(plan.products.reduce((sum, product) => sum + product.lineTotalUah, 0));
  return { ...plan, totalUah };
}
