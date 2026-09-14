import assert from "node:assert/strict";
import test from "node:test";

import { calculateMemberTotals } from "../src/lib/cart/costs.ts";

const products = [
  { priceUah: 90, quantity: 1, assignedMemberIds: ["a"] },
  { priceUah: 60, quantity: 1, assignedMemberIds: ["a", "b"] },
];

test("shopping and dinner costs follow product assignments", () => {
  assert.deepEqual(calculateMemberTotals("SHOPPING", 150, ["a", "b"], products), [
    { memberId: "a", amountUah: 120 },
    { memberId: "b", amountUah: 30 },
  ]);
  assert.deepEqual(calculateMemberTotals("DINNER", 150, ["a", "b"], products), [
    { memberId: "a", amountUah: 120 },
    { memberId: "b", amountUah: 30 },
  ]);
});

test("event cost is split equally down to the cent", () => {
  assert.deepEqual(calculateMemberTotals("EVENT", 100, ["a", "b", "c"], products), [
    { memberId: "a", amountUah: 33.34 },
    { memberId: "b", amountUah: 33.33 },
    { memberId: "c", amountUah: 33.33 },
  ]);
});

