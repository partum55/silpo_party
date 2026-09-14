const uah = new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Formats a UAH amount for display — pair with `<span className="font-numeral">` and a literal "₴". */
export function formatUahNumber(amount: number): string {
  return uah.format(amount);
}

const UNIT_UK: Record<"g" | "ml" | "piece", (amount: number) => string> = {
  g: () => "г",
  ml: () => "мл",
  piece: (amount) => (amount === 1 ? "шт" : "шт"),
};

export function formatAmountUk(amount: number, unit: "g" | "ml" | "piece") {
  const value = Number.isInteger(amount) ? String(amount) : String(Math.round(amount * 100) / 100);
  return `${value} ${UNIT_UK[unit](amount)}`;
}

export function formatPurchaseUk(packageSize: { amount: number; unit: "g" | "ml" | "piece" } | null, quantity: number) {
  if (!packageSize) return `× ${quantity}`;
  const purchasedAmount = packageSize.amount * quantity;
  if (packageSize.unit === "piece" && packageSize.amount > 1) {
    return `${formatAmountUk(packageSize.amount, "piece")}/уп. × ${quantity} = ${formatAmountUk(purchasedAmount, "piece")}`;
  }
  return `${formatAmountUk(packageSize.amount, packageSize.unit)} × ${quantity} = ${formatAmountUk(purchasedAmount, packageSize.unit)}`;
}
