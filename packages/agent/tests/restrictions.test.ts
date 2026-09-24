import assert from "node:assert/strict";
import test from "node:test";

import type { HydratedProduct } from "../src/domain/plan.ts";
import { productRestrictionSafety, unverifiedRestrictions } from "../src/domain/restrictions.ts";

function product(name: string, metadata: Partial<HydratedProduct["metadata"]> = {}, category: HydratedProduct["category"] = "food"): HydratedProduct {
  return {
    id: name,
    name,
    priceUah: 50,
    unit: "шт",
    available: true,
    category,
    packageSize: { amount: 1, unit: "piece" },
    metadata: { ingredients: [], allergens: [], labels: [], ...metadata },
  };
}

test("a listed allergen or ingredient makes a product unsafe", () => {
  assert.equal(productRestrictionSafety(product("Печиво", { ingredients: ["борошно, горіхи фундук"] }), ["горіхи"]), "unsafe");
  assert.equal(productRestrictionSafety(product("Шоколад", { allergens: ["молоко"] }), ["dairy"]), "unsafe");
  assert.equal(productRestrictionSafety(product("Ковбаса", { ingredients: ["свинина"] }), ["vegetarian"]), "unsafe");
});

test("readable composition without a conflict, an explicit label, or whole produce is safe", () => {
  assert.equal(productRestrictionSafety(product("Печиво", { ingredients: ["борошно, цукор"] }), ["горіхи"]), "safe");
  assert.equal(productRestrictionSafety(product("Молоко безлактозне"), ["lactose"]), "safe");
  assert.equal(productRestrictionSafety(product("Помідори"), ["vegan"]), "safe");
  assert.equal(productRestrictionSafety(product("Серветки", {}, "non_food"), ["горіхи", "vegan"]), "safe");
});

test("no composition data is unknown, and the unverified restrictions are named", () => {
  const cracker = product("Крекер солоний");
  assert.equal(productRestrictionSafety(cracker, ["горіхи"]), "unknown");
  assert.deepEqual(unverifiedRestrictions(cracker, ["горіхи", "vegetarian"]), ["горіхи", "vegetarian"]);
});

test("any conflict wins over missing data for another restriction", () => {
  assert.equal(productRestrictionSafety(product("Паста горіхова", { ingredients: ["горіхи"] }), ["горіхи", "halal"]), "unsafe");
});
