import assert from "node:assert/strict";
import test from "node:test";

import { productLineTotalUah, silpoCartQuantity } from "../src/domain/purchasing.ts";
import { plannerSelectionSchema } from "../src/domain/schemas.ts";

test("weighted 100 g increments are counted and converted to kilograms for Silpo", () => {
  const tomatoes = { priceUah: 90, unit: "кг", weighted: true, packageSize: { amount: 100, unit: "g" as const } };
  assert.equal(silpoCartQuantity(tomatoes, 3), 0.3);
  assert.equal(productLineTotalUah(tomatoes, 3), 27);
});

test("packaged goods keep package count for pricing and checkout", () => {
  const eggs = { priceUah: 70, unit: "шт", weighted: false, packageSize: { amount: 10, unit: "piece" as const } };
  assert.equal(silpoCartQuantity(eggs, 2), 2);
  assert.equal(productLineTotalUah(eggs, 2), 140);
});

test("planner quantities must be whole purchasable units", () => {
  const selection = { productId: "tomatoes", quantity: 1.5, assignedMemberIds: ["member"], reason: "Salad" };
  assert.equal(plannerSelectionSchema.safeParse(selection).success, false);
  assert.equal(plannerSelectionSchema.safeParse({ ...selection, quantity: 3 }).success, true);
});
