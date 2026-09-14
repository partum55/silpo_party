import assert from "node:assert/strict";
import test from "node:test";

import { formatPurchase } from "../src/lib/cart/display.ts";

test("formats weighted increments as exact purchased amounts", () => {
  assert.equal(formatPurchase({ amount: 100, unit: "g" }, 3), "100 g × 3 = 300 g");
});

test("formats multi-piece packages explicitly", () => {
  assert.equal(formatPurchase({ amount: 10, unit: "piece" }, 2), "10 pieces/package × 2 packages = 20 pieces");
});

test("formats individual pieces explicitly", () => {
  assert.equal(formatPurchase({ amount: 1, unit: "piece" }, 3), "1 piece × 3 = 3 pieces");
});
