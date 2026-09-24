export type PurchasableProduct = {
  priceUah: number;
  unit: string;
  weighted?: boolean;
  packageSize: { amount: number; unit: "g" | "ml" | "piece" };
};

const roundMoney = (value: number) => Math.round(value * 100) / 100;

/** Converts purchasable-unit count into the quantity expected by Silpo's cart API. */
export function silpoCartQuantity(product: PurchasableProduct, purchaseUnits: number) {
  if (!product.weighted) return purchaseUnits;
  const unit = product.unit.trim().toLocaleLowerCase("uk");
  if ((unit === "кг" || unit === "kg") && product.packageSize.unit === "g") {
    return product.packageSize.amount * purchaseUnits / 1000;
  }
  if ((unit === "л" || unit === "l") && product.packageSize.unit === "ml") {
    return product.packageSize.amount * purchaseUnits / 1000;
  }
  return product.packageSize.amount * purchaseUnits;
}

/** Prices a number of purchasable units using Silpo's sell-unit price. */
export function productLineTotalUah(product: PurchasableProduct, purchaseUnits: number) {
  return roundMoney(product.priceUah * silpoCartQuantity(product, purchaseUnits));
}
