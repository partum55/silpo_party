import assert from "node:assert/strict";
import test from "node:test";

import { applyGatheredContext, createInitialState, runPlanningLoop } from "../src/domain/planning.ts";
import { partyPlanningInputSchema } from "../src/domain/schemas.ts";
import type { HydratedProduct } from "../src/domain/validation.ts";

const product = (id: string, category: "food" | "drink"): HydratedProduct => ({
  id,
  name: id,
  priceUah: 50,
  unit: "pack",
  available: true,
  category,
  packageSize: { amount: category === "food" ? 400 : 750, unit: category === "food" ? "g" : "ml" },
  metadata: { ingredients: ["vegetables"], allergens: [], labels: ["vegetarian"] },
});

test("empty party asks a structured question without planning", async () => {
  let calls = 0;
  const state = createInitialState({ request: "Plan a party", currentParty: { members: [] } });
  const result = await runPlanningLoop(state, {
    plan: async () => { calls += 1; throw new Error("must not run"); },
    hydrate: async () => null,
  });

  assert.equal(calls, 0);
  assert.equal(result.readiness, "needs_input");
  assert.equal(result.questions[0]?.code, "party_members_required");
});

test("repairs a fabricated id and publishes only hydrated products", async () => {
  let calls = 0;
  const state = createInitialState({
    request: "Party",
    currentParty: { members: [{ id: "a", restrictions: [] }] },
  });
  const result = await runPlanningLoop(state, {
    plan: async () => {
      calls += 1;
      return {
        summary: "Draft",
        selections: calls === 1
          ? [{ productId: "fake-123", quantity: 1, assignedMemberIds: ["a"], reason: "Food" }]
          : [
              { productId: "food", quantity: 1, assignedMemberIds: ["a"], reason: "Food" },
              { productId: "drink", quantity: 1, assignedMemberIds: ["a"], reason: "Drink" },
            ],
      };
    },
    hydrate: async (id) => id === "food" || id === "drink" ? product(id, id) : null,
  });

  assert.equal(calls, 2);
  assert.equal(result.repairAttempts, 1);
  assert.equal(result.readiness, "ready");
  assert.equal(result.publishedPlan?.products.some((item) => item.id === "fake-123"), false);
});

test("never attempts a third repair", async () => {
  let calls = 0;
  const state = createInitialState({
    request: "Party",
    currentParty: { members: [{ id: "a", restrictions: [] }] },
  });
  const result = await runPlanningLoop(state, {
    plan: async () => {
      calls += 1;
      return { summary: "Bad", selections: [{ productId: `fake-${calls}`, quantity: 1, assignedMemberIds: ["a"], reason: "No" }] };
    },
    hydrate: async () => null,
  });

  assert.equal(calls, 3);
  assert.equal(result.repairAttempts, 2);
  assert.equal(result.readiness, "invalid");
  assert.equal(result.publishedPlan, null);
});

test("member state overrides a conflicting prompt count", () => {
  const state = createInitialState({
    request: "Party for 8",
    currentParty: { members: [{ id: "a", restrictions: [] }, { id: "b", restrictions: [] }] },
  });
  const result = applyGatheredContext(state, {
    budgetUah: null,
    partyWideRestrictions: [],
    participantCountMentioned: 8,
  });

  assert.equal(result.participantCount, 2);
  assert.equal(result.warnings[0]?.code, "participant_count_conflict");
});

test("party input rejects more than ten current members", () => {
  assert.throws(() => partyPlanningInputSchema.parse({
    request: "Large party",
    currentParty: { members: Array.from({ length: 11 }, (_, index) => ({ id: String(index), restrictions: [] })) },
  }));
});
