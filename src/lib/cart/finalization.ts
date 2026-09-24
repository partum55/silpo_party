import { silpoCartQuantity, type CartLineItem } from "@silpo-party/agent";

export type RefreshedCheckoutProduct = {
  silpoProductId: string;
  companyId: string;
  priceUah: number;
  unit: string;
  weighted?: boolean;
  packageSize: { amount: number; unit: "g" | "ml" | "piece" };
  quantity: number;
};

/** Maps the hydrated internal Silpo product ID—not the external lookup ID—into the real cart request. */
export function buildSilpoLineItems(products: RefreshedCheckoutProduct[], branchId: string): CartLineItem[] {
  return products.map((product) => ({
    productId: product.silpoProductId,
    companyId: product.companyId,
    branchId,
    quantity: silpoCartQuantity(product, product.quantity),
  }));
}
