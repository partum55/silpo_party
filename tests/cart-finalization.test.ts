import assert from "node:assert/strict";
import test from "node:test";

import { buildSilpoLineItems } from "../src/lib/cart/finalization.ts";

test("Silpo checkout uses hydrated internal product ids", () => {
  const [line] = buildSilpoLineItems([{
    silpoProductId: "9fb4d5d4-internal-uuid",
    companyId: "company-1",
    priceUah: 50,
    unit: "шт",
    packageSize: { amount: 1, unit: "piece" },
    quantity: 3,
  }], "branch-1");

  assert.deepEqual(line, {
    productId: "9fb4d5d4-internal-uuid",
    companyId: "company-1",
    branchId: "branch-1",
    quantity: 3,
  });
});
