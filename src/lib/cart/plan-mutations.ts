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
