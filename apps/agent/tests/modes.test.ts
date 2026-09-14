import assert from "node:assert/strict";
import test from "node:test";

import { isPantryStaple } from "../src/domain/validation.ts";
import { validateModeAssignments } from "../src/domain/modes.ts";

test("dinner mode excludes pantry staples but keeps real ingredients", () => {
  for (const name of ["сіль", "Чорний перець", "вода", "olive oil"]) {
    assert.equal(isPantryStaple(name), true, name);
  }
  for (const name of ["спагеті", "бекон", "яйця", "пармезан"]) {
    assert.equal(isPantryStaple(name), false, name);
  }
});

const product = (assignedMemberIds: string[]) => ({
  id: "product-1",
  name: "Product",
  priceUah: 10,
  unit: "pcs",
  available: true,
  category: "food" as const,
  packageSize: { amount: 1, unit: "piece" as const },
  metadata: { ingredients: [], allergens: [], labels: [] },
  quantity: 1,
  assignedMemberIds,
  reason: "requested",
  lineTotalUah: 10,
});

const plan = (assignedMemberIds: string[]) => ({
  summary: "Plan",
  products: [product(assignedMemberIds)],
  recipes: [],
  totalUah: 10,
  coverage: {},
  wishFulfillments: [],
});

test("shopping charges new products only to the requester", () => {
  assert.equal(validateModeAssignments({ mode: "SHOPPING", actorId: "a", memberIds: ["a", "b"], before: null, after: plan(["a"]) }).length, 0);
  assert.equal(validateModeAssignments({ mode: "SHOPPING", actorId: "a", memberIds: ["a", "b"], before: null, after: plan(["a", "b"]) }).length, 1);
});

test("autonomous event items are shared by all members", () => {
  assert.equal(validateModeAssignments({ mode: "EVENT", actorId: "a", memberIds: ["a", "b"], before: null, after: plan(["a", "b"]) }).length, 0);
  assert.equal(validateModeAssignments({ mode: "EVENT", actorId: "a", memberIds: ["a", "b"], before: null, after: plan(["a"]) }).length, 1);
});
