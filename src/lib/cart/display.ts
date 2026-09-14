export type PackageSize = { amount: number; unit: "g" | "ml" | "piece" };

export function formatAmount(amount: number, unit: PackageSize["unit"]) {
  const value = Number.isInteger(amount) ? String(amount) : String(Math.round(amount * 100) / 100);
  return `${value} ${unit === "piece" ? (amount === 1 ? "piece" : "pieces") : unit}`;
}

export function formatPurchase(packageSize: PackageSize | null, quantity: number) {
  if (!packageSize) return `× ${quantity}`;
  const purchasedAmount = packageSize.amount * quantity;
  if (packageSize.unit === "piece" && packageSize.amount > 1) {
    return `${formatAmount(packageSize.amount, "piece")}/package × ${quantity} ${quantity === 1 ? "package" : "packages"} = ${formatAmount(purchasedAmount, "piece")}`;
  }
  return `${formatAmount(packageSize.amount, packageSize.unit)} × ${quantity} = ${formatAmount(purchasedAmount, packageSize.unit)}`;
}
