export type MutablePlanProduct = {
  id: string;
  lookupProductId?: string;
  name: string;
  priceUah: number;
  quantity: number;
  assignedMemberIds: string[];
  lineTotalUah?: number;
};

export type MutablePlan = {
  products: MutablePlanProduct[];
  totalUah: number;
  wishFulfillments?: Array<{
    selectedProductIds: string[];
  }>;
} | null;

const money = (value: number) => Math.round(value * 100) / 100;
const productKey = (product: MutablePlanProduct) => product.lookupProductId ?? product.id;

export function orderCartItemsByPlan<T extends { id: string; product_id: string }>(
  items: T[],
  products: MutablePlanProduct[],
) {
  const positions = new Map<string, number>();
  for (const product of products) {
    const key = productKey(product);
    if (!positions.has(key)) positions.set(key, positions.size);
  }
  return [...items].sort((left, right) => {
    const leftPosition = positions.get(left.product_id) ?? Number.MAX_SAFE_INTEGER;
    const rightPosition = positions.get(right.product_id) ?? Number.MAX_SAFE_INTEGER;
    return leftPosition - rightPosition || left.id.localeCompare(right.id);
  });
}

/** Keeps the agent's persisted plan aligned with a direct edit to its flattened cart projection. */
export function mutatePlanItem(plan: MutablePlan, productId: string, quantity: number | null): MutablePlan {
  if (!plan) return null;
  const matching = plan.products.filter((product) => productKey(product) === productId);
  if (!matching.length) return plan;

  const previousQuantity = matching.reduce((sum, product) => sum + product.quantity, 0);
  const allocations = quantity === null
    ? matching.map((_, index) => ({ index, quantity: 0, fraction: 0 }))
    : matching.map((product, index) => {
      const exact = previousQuantity > 0 ? quantity * product.quantity / previousQuantity : quantity / matching.length;
      return { index, quantity: Math.floor(exact), fraction: exact - Math.floor(exact) };
    });
  if (quantity !== null) {
    let remainder = quantity - allocations.reduce((sum, entry) => sum + entry.quantity, 0);
    for (const entry of [...allocations].sort((a, b) => b.fraction - a.fraction || a.index - b.index)) {
      if (remainder-- <= 0) break;
      entry.quantity += 1;
    }
  }
  const allocationByProduct = new Map(matching.map((product, index) => [product, allocations[index].quantity]));

  const nextProducts = plan.products.flatMap((product) => {
    if (productKey(product) !== productId) return [product];
    const nextQuantity = allocationByProduct.get(product) ?? 0;
    if (nextQuantity < 1) return [];
    const unitTotal = product.quantity > 0
      ? (product.lineTotalUah ?? product.priceUah * product.quantity) / product.quantity
      : product.priceUah;
    return [{ ...product, quantity: nextQuantity, lineTotalUah: money(unitTotal * nextQuantity) }];
  });
  const remainingIds = new Set(nextProducts.map((product) => product.id));
  const removedIds = new Set(matching.map((product) => product.id).filter((id) => !remainingIds.has(id)));
  const totalUah = money(nextProducts.reduce(
    (sum, product) => sum + (product.lineTotalUah ?? product.priceUah * product.quantity),
    0,
  ));

  return {
    ...plan,
    products: nextProducts,
    totalUah,
    wishFulfillments: plan.wishFulfillments?.map((fulfillment) => ({
      ...fulfillment,
      selectedProductIds: fulfillment.selectedProductIds.filter((id) => !removedIds.has(id)),
    })),
  };
}

/** Same identity as the agent's plan rows (apps/agent/src/pipeline/plan-builder.ts rowKey). */
const rowKey = (product: MutablePlanProduct) => `${productKey(product)}|${[...new Set(product.assignedMemberIds)].sort().join(",")}`;
const lineTotal = (product: MutablePlanProduct) => product.lineTotalUah ?? product.priceUah * product.quantity;

/**
 * Three-way merge for turns that ran concurrently: applies what one agent turn changed (base -> result) on top
 * of the plan as it is now (latest), which may already hold other members' turns or manual cart edits. Rows
 * the turn added gain quantity, rows it removed are dropped, rows it did not touch keep their latest state.
 */
export function rebasePlan<P extends NonNullable<MutablePlan>>(base: P | null, result: P, latest: P | null): P {
  if (!latest) return result;
  const before = new Map((base?.products ?? []).map((product) => [rowKey(product), product]));
  const after = new Map(result.products.map((product) => [rowKey(product), product]));
  const products = [...latest.products];

  for (const key of before.keys()) {
    if (after.has(key)) continue;
    const index = products.findIndex((product) => rowKey(product) === key);
    if (index >= 0) products.splice(index, 1);
  }
  for (const [key, next] of after) {
    const delta = next.quantity - (before.get(key)?.quantity ?? 0);
    if (delta === 0) continue;
    const unitTotal = next.quantity > 0 ? lineTotal(next) / next.quantity : next.priceUah;
    const index = products.findIndex((product) => rowKey(product) === key);
    const quantity = (index >= 0 ? products[index].quantity : 0) + delta;
    const merged = { ...(index >= 0 ? products[index] : {}), ...next, quantity, lineTotalUah: money(unitTotal * quantity) };
    if (index >= 0 && quantity < 1) products.splice(index, 1);
    else if (index >= 0) products[index] = merged;
    else if (quantity >= 1) products.push(merged);
  }

  return { ...latest, products, totalUah: money(products.reduce((sum, product) => sum + lineTotal(product), 0)) };
}
