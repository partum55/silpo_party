import assert from "node:assert/strict";
import test from "node:test";

import { formatPurchaseUk } from "../src/lib/format.ts";

test("formats weighted increments as exact purchased amounts", () => {
  assert.equal(formatPurchaseUk({ amount: 100, unit: "g" }, 3), "100 г × 3 = 300 г");
});

test("formats multi-piece packages explicitly", () => {
  assert.equal(formatPurchaseUk({ amount: 10, unit: "piece" }, 2), "10 шт/уп. × 2 = 20 шт");
});

test("formats individual pieces explicitly", () => {
  assert.equal(formatPurchaseUk({ amount: 1, unit: "piece" }, 3), "1 шт × 3 = 3 шт");
});
