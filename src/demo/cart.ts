import { calculateMemberTotals } from "@/lib/cart/costs";
import type { Cart, Member, PartyStatus, Recipe } from "@/components/party/types";

import type { Seed } from "./scenarios";

export function buildCart(mode: PartyStatus["mode"], seeds: Seed[], recipes: Recipe[], members: Member[], finalized: boolean): Cart {
  const items = seeds.map((seed) => ({
    id: seed.id,
    name: seed.name,
    image_url: null,
    quantity: seed.qty,
    price_uah: seed.price,
    package_size: seed.pack,
    line_total_uah: Math.round(seed.price * seed.qty * 100) / 100,
    base_assigned_member_ids: seed.payers,
    assigned_member_ids: seed.payers,
    subscriber_member_ids: [],
  }));
  const total = Math.round(items.reduce((sum, item) => sum + item.line_total_uah, 0) * 100) / 100;
  const memberTotals = calculateMemberTotals(
    mode,
    total,
    members.map((member) => member.user_id),
    items.map((item) => ({ priceUah: item.price_uah, quantity: item.quantity, lineTotalUah: item.line_total_uah, assignedMemberIds: item.assigned_member_ids })),
  );
  return {
    status: finalized ? "FINALIZED" : "DRAFT",
    total_uah: total,
    checkout_url: finalized ? "https://silpo.ua" : null,
    items,
    recipes,
    memberTotals,
  };
}
