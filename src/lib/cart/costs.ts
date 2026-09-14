export type CostMode = "SHOPPING" | "DINNER" | "EVENT";

export type CostProduct = {
  priceUah: number;
  quantity: number;
  lineTotalUah?: number;
  assignedMemberIds: string[];
};

export function mergePayerIds(baseIds: string[], subscriberIds: string[]) {
  return [...new Set([...baseIds, ...subscriberIds])];
}

function splitCents(totalCents: number, memberIds: string[]) {
  if (!memberIds.length) return new Map<string, number>();
  const base = Math.floor(totalCents / memberIds.length);
  const remainder = totalCents - base * memberIds.length;
  return new Map(memberIds.map((id, index) => [id, base + (index < remainder ? 1 : 0)]));
}

export function calculateMemberTotals(
  mode: CostMode,
  totalUah: number,
  memberIds: string[],
  products: CostProduct[],
) {
  const totals = new Map(memberIds.map((id) => [id, 0]));
  if (mode === "EVENT") {
    for (const [id, cents] of splitCents(Math.round(totalUah * 100), memberIds)) totals.set(id, cents);
  } else {
    for (const product of products) {
      const assigned = [...new Set(product.assignedMemberIds)].filter((id) => totals.has(id));
      const lineCents = Math.round((product.lineTotalUah ?? product.priceUah * product.quantity) * 100);
      for (const [id, cents] of splitCents(lineCents, assigned)) totals.set(id, (totals.get(id) ?? 0) + cents);
    }
  }
  return memberIds.map((memberId) => ({ memberId, amountUah: (totals.get(memberId) ?? 0) / 100 }));
}

