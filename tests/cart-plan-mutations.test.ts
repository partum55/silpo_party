import assert from "node:assert/strict";
import test from "node:test";

import { mutatePlanItem, orderCartItemsByPlan } from "../src/lib/cart/plan-mutations.ts";

function product(id: string, quantity: number, assignedMemberIds: string[]) {
  return {
    id: `internal-${id}-${assignedMemberIds[0]}`,
    lookupProductId: id,
    name: `Товар ${id}`,
    priceUah: 25,
    quantity,
    assignedMemberIds,
    lineTotalUah: 25 * quantity,
  };
}

test("quantity edits preserve per-member shares of the same Silpo SKU and recalculate the total", () => {
  const plan = {
    products: [product("101", 1, ["one"]), product("101", 2, ["two"]), product("202", 1, ["one"])],
    totalUah: 100,
  };

  const next = mutatePlanItem(plan, "101", 4)!;

  assert.equal(next.products.length, 3);
  assert.deepEqual(next.products.slice(0, 2).map((entry) => entry.quantity), [1, 3]);
  assert.deepEqual(next.products.slice(0, 2).map((entry) => entry.assignedMemberIds), [["one"], ["two"]]);
  assert.deepEqual(next.products.slice(0, 2).map((entry) => entry.lineTotalUah), [25, 75]);
  assert.equal(next.totalUah, 125);
});

test("deleting a cart item removes every matching projection and fulfillment reference", () => {
  const plan = {
    products: [product("101", 1, ["one"]), product("101", 2, ["two"]), product("202", 1, ["one"])],
    totalUah: 100,
    wishFulfillments: [{ selectedProductIds: ["internal-101-one", "internal-202-one"] }],
  };

  const next = mutatePlanItem(plan, "101", null)!;

  assert.deepEqual(next.products.map((entry) => entry.lookupProductId), ["202"]);
  assert.deepEqual(next.wishFulfillments?.[0].selectedProductIds, ["internal-202-one"]);
  assert.equal(next.totalUah, 25);
});

test("cart rows keep plan order after quantity updates return them in another database order", () => {
  const products = [product("101", 1, ["one"]), product("202", 1, ["one"]), product("303", 1, ["one"])];
  const rows = [
    { id: "c", product_id: "303" },
    { id: "a", product_id: "101" },
    { id: "b", product_id: "202" },
  ];

  assert.deepEqual(orderCartItemsByPlan(rows, products).map((row) => row.product_id), ["101", "202", "303"]);
});
