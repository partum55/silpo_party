import assert from "node:assert/strict";
import test from "node:test";

import {
  applyConversationDecision,
  mergeWithProtectedPlan,
  planToProposal,
  validatePlanOperations,
} from "../src/domain/conversation.ts";
import { memberSchema } from "../src/domain/schemas.ts";
import type { PartyPlanDraft, VerifiedProduct } from "../src/domain/validation.ts";
import { conversationInputSchema, planAfterValidation, readOnlyResult } from "../src/mastra/conversational-workflow.ts";

const product = (id: string): VerifiedProduct => ({
  id: `sku-${id}`,
  lookupProductId: id,
  name: id,
  priceUah: 50,
  unit: "шт",
  available: true,
  category: id === "cola" ? "drink" : "food",
  packageSize: { amount: 400, unit: id === "cola" ? "ml" : "g" },
  metadata: { ingredients: [], allergens: [], labels: [] },
  quantity: 1,
  assignedMemberIds: ["a"],
  reason: id,
  lineTotalUah: 50,
});

const party = { members: [memberSchema.parse({ id: "a" })] };

function existingPlan(): PartyPlanDraft {
  return {
    summary: "Existing",
    products: [product("chips"), product("cola")],
    recipes: [],
    totalUah: 100,
    coverage: { a: { foodGrams: 400, drinkMilliliters: 400 } },
    wishFulfillments: [],
  };
}

test("conversational preference additions accumulate across turns", () => {
  const first = applyConversationDecision({
    party,
    actorId: "a",
    hostId: "a",
    scope: "preferences",
    decision: {
      intent: "preference_mutation",
      preferenceOperations: [{ action: "add", text: "чіпси" }, { action: "add", text: "кола" }],
      planOperations: [],
      readQuestion: null,
    },
    createId: (() => { const ids = ["chips", "cola"]; return () => ids.shift()!; })(),
  });
  const second = applyConversationDecision({
    party: first.party,
    actorId: "a",
    hostId: "a",
    scope: "preferences",
    decision: {
      intent: "preference_mutation",
      preferenceOperations: [{ action: "add", text: "нутелла" }],
      planOperations: [],
      readQuestion: null,
    },
    createId: () => "nutella",
  });

  assert.deepEqual(second.party.members[0]?.wishes.map((wish) => wish.text), ["чіпси", "кола", "нутелла"]);
});

test("explicit conversational removal and replacement touch only their wish", () => {
  const current = {
    members: [memberSchema.parse({ id: "a", wishes: [
      { id: "chips", text: "чіпси" }, { id: "water", text: "вода" }, { id: "cola", text: "кола" },
    ] })],
  };
  const removed = applyConversationDecision({
    party: current,
    actorId: "a",
    hostId: "a",
    scope: "preferences",
    decision: { intent: "preference_mutation", preferenceOperations: [{ action: "remove", wishId: "chips" }], planOperations: [], readQuestion: null },
  });
  const replaced = applyConversationDecision({
    party: removed.party,
    actorId: "a",
    hostId: "a",
    scope: "preferences",
    decision: { intent: "preference_mutation", preferenceOperations: [{ action: "replace", wishId: "water", text: "негазована вода" }], planOperations: [], readQuestion: null },
  });

  assert.deepEqual(replaced.party.members[0]?.wishes.map(({ id, text }) => ({ id, text })), [
    { id: "water", text: "негазована вода" }, { id: "cola", text: "кола" },
  ]);
});

test("adding to an existing plan preserves every unaffected selection", () => {
  const currentPlan = existingPlan();
  const merged = mergeWithProtectedPlan({
    baseline: planToProposal(currentPlan),
    proposed: {
      summary: "Add Nutella",
      selections: [{ productId: "nutella", quantity: 1, assignedMemberIds: ["a"], reason: "Requested" }],
      recipes: [],
      wishFulfillments: [],
    },
    currentPlan,
    affectedWishKeys: [],
    planOperations: [{ action: "add", request: "нутелла", assignedMemberIds: ["a"] }],
  });

  assert.deepEqual(merged.selections.map((item) => item.productId), ["chips", "cola", "nutella"]);
  assert.deepEqual(merged.selections.slice(0, 2), planToProposal(currentPlan).selections);
});

test("shopping keeps the same SKU as a distinct per-member charge", () => {
  const currentPlan = existingPlan();
  const merged = mergeWithProtectedPlan({
    baseline: planToProposal(currentPlan),
    proposed: {
      summary: "Another chips request",
      selections: [{ productId: "chips", quantity: 1, assignedMemberIds: ["b"], reason: "Requested by b" }],
      recipes: [],
      wishFulfillments: [],
    },
    currentPlan,
    affectedWishKeys: [],
    planOperations: [{ action: "add", request: "chips", assignedMemberIds: ["b"] }],
    keepDistinctAdditions: true,
  });

  assert.deepEqual(merged.selections.filter((item) => item.productId === "chips").map((item) => item.assignedMemberIds), [["a"], ["b"]]);
  const after = {
    ...currentPlan,
    products: [...currentPlan.products, { ...product("chips"), assignedMemberIds: ["b"] }],
  };
  assert.deepEqual(validatePlanOperations(currentPlan, after, [{ action: "add", request: "chips", assignedMemberIds: ["b"] }]), []);
});

test("direct plan additions must produce a new assigned component", () => {
  const currentPlan = existingPlan();
  const operation = { action: "add" as const, request: "щось для Анни", assignedMemberIds: ["anna"] };

  assert.equal(validatePlanOperations(currentPlan, currentPlan, [operation])[0]?.code, "plan_operation_unfulfilled");
  assert.deepEqual(validatePlanOperations(currentPlan, {
    ...currentPlan,
    products: [...currentPlan.products, { ...product("dessert"), assignedMemberIds: ["anna"] }],
  }, [operation]), []);
});

test("read-only cost questions return frozen preferences and plan", () => {
  const input = conversationInputSchema.parse({
    message: "скільки зараз коштує?",
    actorId: "a",
    hostId: "a",
    scope: "auto",
    currentParty: party,
    currentPlan: existingPlan(),
    readiness: "ready",
  });
  const result = readOnlyResult(input, "100 UAH");

  assert.deepEqual(result.updatedPreferences, input.currentParty.members.map(({ id: memberId, wishes, status }) => ({ memberId, wishes, status })));
  assert.deepEqual(result.updatedPlan, input.currentPlan);
  assert.deepEqual(result.preferenceOperations, []);
  assert.deepEqual(result.planOperations, []);
  assert.equal(result.readiness, "ready");
});

test("an invalid first draft is never persisted", () => {
  const invalidMilkPlan = existingPlan();

  assert.equal(planAfterValidation(null, invalidMilkPlan, "invalid"), null);
  assert.equal(planAfterValidation(existingPlan(), invalidMilkPlan, "invalid")?.summary, "Existing");
  assert.equal(planAfterValidation(null, invalidMilkPlan, "ready"), invalidMilkPlan);
});

test("participant readiness and host authorization stay outside model control", () => {
  const readyParty = { members: [memberSchema.parse({ id: "a", status: "ready" }), memberSchema.parse({ id: "host" })] };
  const preference = applyConversationDecision({
    party: readyParty,
    actorId: "a",
    hostId: "host",
    scope: "preferences",
    decision: { intent: "preference_mutation", preferenceOperations: [{ action: "add", text: "кола" }], planOperations: [], readQuestion: null },
  });
  const plan = applyConversationDecision({
    party: readyParty,
    actorId: "a",
    hostId: "host",
    scope: "plan",
    decision: { intent: "plan_mutation", preferenceOperations: [], planOperations: [{ action: "add", request: "кола", assignedMemberIds: ["a"] }], readQuestion: null },
  });

  assert.equal(preference.error, "preferences_locked");
  assert.equal(plan.error, "plan_edit_forbidden");
  assert.equal(readyParty.members[0]?.status, "ready");
});

test("a host may edit the plan without being a participant", () => {
  const result = applyConversationDecision({
    party,
    actorId: "host",
    hostId: "host",
    scope: "plan",
    decision: { intent: "plan_mutation", preferenceOperations: [], planOperations: [{ action: "add", request: "десерт", assignedMemberIds: ["a"] }], readQuestion: null },
  });

  assert.equal(result.error, null);
});
