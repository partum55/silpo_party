import assert from "node:assert/strict";
import test from "node:test";

import { productLineTotalUah, silpoCartQuantity } from "../src/domain/purchasing.ts";
import { formatPurchase, purchaseQuantity } from "../src/domain/quantity.ts";

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

test("purchase quantities are whole purchasable increments", () => {
  const tomatoes = { packageSize: { amount: 100, unit: "g" as const } };
  assert.equal(purchaseQuantity({ amount: 250, unit: "g" }, tomatoes), 3);
  assert.equal(purchaseQuantity({ amount: 300, unit: "g" }, tomatoes), 3);
  assert.equal(purchaseQuantity({ count: 2 }, tomatoes), 2);
  assert.equal(purchaseQuantity({}, tomatoes), 1);
});

test("counted recipe produce converts to grams when Silpo sells it by weight", () => {
  const onions = { packageSize: { amount: 1000, unit: "g" as const } };
  assert.equal(purchaseQuantity({ amount: 3, unit: "piece" }, onions), 1);
  const juice = { packageSize: { amount: 1000, unit: "ml" as const } };
  assert.equal(purchaseQuantity({ amount: 200, unit: "g" }, juice), 1);
});

test("weighted goods are described by weight, packaged goods by count", () => {
  assert.equal(formatPurchase({ weighted: true, packageSize: { amount: 1000, unit: "g" } }, 2), "2 кг");
  assert.equal(formatPurchase({ weighted: false, packageSize: { amount: 950, unit: "ml" } }, 3), "×3");
});
