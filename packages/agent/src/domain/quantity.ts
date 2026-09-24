import type { HydratedProduct, MeasureUnit } from "./plan.ts";

/** What a request asks for: an explicit package count, a measured amount, or (neither) one package. */
export type RequestedAmount = {
  count?: number | null;
  amount?: number | null;
  unit?: MeasureUnit | null;
};

// Rough weight of one countable produce item, used only when a recipe counts pieces (3 onions) and Silpo sells
// that product by weight. Package rounding absorbs the imprecision.
const APPROXIMATE_PIECE_GRAMS = 150;

/** Number of purchasable increments (packages, or weighed steps for loose goods) needed for a request. */
export function purchaseQuantity(request: RequestedAmount, product: Pick<HydratedProduct, "packageSize">) {
  if (request.count && request.count > 0) return Math.max(1, Math.round(request.count));
  const { amount, unit } = request;
  if (!amount || amount <= 0 || !unit) return 1;
  const size = product.packageSize;
  let needed = amount;
  if (unit !== size.unit) {
    if (unit === "piece" && size.unit === "g") needed = amount * APPROXIMATE_PIECE_GRAMS;
    else return 1;
  }
  if (size.amount <= 0) return 1;
  // Tolerate float noise (e.g. 0.30000000000000004 of a package) before rounding up to whole increments.
  return Math.max(1, Math.ceil(needed / size.amount - 1e-9));
}

const numberFormat = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 });

export function formatMeasure(amount: number, unit: MeasureUnit) {
  if (unit === "g") return amount >= 1000 ? `${numberFormat.format(amount / 1000)} кг` : `${numberFormat.format(amount)} г`;
  if (unit === "ml") return amount >= 1000 ? `${numberFormat.format(amount / 1000)} л` : `${numberFormat.format(amount)} мл`;
  return `${numberFormat.format(amount)} шт.`;
}

/** Human-readable purchased amount, e.g. "2 кг" for loose potatoes or "×3" for packaged juice. */
export function formatPurchase(product: Pick<HydratedProduct, "packageSize" | "weighted">, quantity: number) {
  if (product.weighted && product.packageSize.unit !== "piece") {
    return formatMeasure(product.packageSize.amount * quantity, product.packageSize.unit);
  }
  return `×${numberFormat.format(quantity)}`;
}
