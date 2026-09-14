import assert from "node:assert/strict";
import test from "node:test";

import { applyGatheredContext, createInitialState, discoverWishCandidates, mentionedParticipantCount, runPlanningLoop } from "../src/domain/planning.ts";
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
    currentParty: { members: [{ id: "a", restrictions: [], status: "ready" }] },
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

test("a validated plan stays provisional while a participant is collecting", async () => {
  const state = createInitialState({
    request: "Party",
    currentParty: { members: [{ id: "a", restrictions: [], wishes: [{ id: "pizza", text: "pizza" }] }] },
  });
  state.wishCandidates = [{
    memberId: "a",
    wishId: "pizza",
    requestedStrategy: "either",
    searchQueries: ["pizza"],
    candidates: [{ lookupProductId: "food", product: product("food", "food") }],
  }];
  const result = await runPlanningLoop(state, {
    plan: async () => ({
      summary: "Draft",
      selections: [
        { productId: "food", quantity: 1, assignedMemberIds: ["a"], reason: "Food" },
        { productId: "drink", quantity: 1, assignedMemberIds: ["a"], reason: "Drink" },
      ],
      wishFulfillments: [{
        memberId: "a",
        wishId: "pizza",
        resolvedStrategy: "ready_made",
        selectedProductIds: ["food"],
        recipeTitle: null,
        fallbackReason: null,
      }],
    }),
    hydrate: async (id) => id === "food" || id === "drink" ? product(id, id) : null,
  });

  assert.equal(result.readiness, "ready");
  assert.equal(result.preferencePhase, "provisional");
  assert.ok(result.currentPlan);
  assert.equal(result.publishedPlan, null);
});

test("candidate discovery searches incrementally, hydrates a bounded set, and skips recipe wishes", async () => {
  const party = partyPlanningInputSchema.parse({
    request: "Party",
    currentParty: { members: [{
      id: "a",
      wishes: [
        { id: "hot", text: "щось гаряче" },
        { id: "salad", text: "готуємо салат", fulfillmentStrategy: "recipe" },
      ],
    }] },
  }).currentParty;
  const searched: string[] = [];
  const result = await discoverWishCandidates({
    party,
    queryVariants: { "a:hot": ["гарячі страви", "кулінарія", "ignored"] },
    search: async (query) => {
      searched.push(query);
      return Array.from({ length: 10 }, (_, index) => `${query}-${index}`);
    },
    hydrate: async (id) => product(id, "food"),
  });

  assert.deepEqual(searched, ["щось гаряче", "гарячі страви", "кулінарія"]);
  assert.equal(result[0]?.candidates.length, 6);
  assert.deepEqual(result[0]?.candidates.slice(0, 3).map((candidate) => candidate.lookupProductId), [
    "щось гаряче-0", "гарячі страви-0", "кулінарія-0",
  ]);
  assert.deepEqual(result[1]?.candidates, []);
  assert.deepEqual(result[1]?.searchQueries, []);
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

test("extracts event headcounts without treating ordinary quantities as participants", () => {
  assert.equal(mentionedParticipantCount("Хочу шашлики на трьох та печену картоплю"), 3);
  assert.equal(mentionedParticipantCount("Plan a barbecue for 6 people"), 6);
  assert.equal(mentionedParticipantCount("Купи 3 пляшки води"), null);
});

test("participant-count conflicts survive proposal validation", async () => {
  const state = applyGatheredContext(createInitialState({
    request: "Barbecue for three",
    currentParty: { members: [{ id: "a", restrictions: [] }] },
  }), {
    budgetUah: null,
    partyWideRestrictions: [],
    participantCountMentioned: 3,
  });
  const result = await runPlanningLoop(state, {
    plan: async () => ({
      summary: "Complete event",
      selections: [
        { productId: "food", quantity: 1, assignedMemberIds: ["a"], reason: "Main" },
        { productId: "drink", quantity: 1, assignedMemberIds: ["a"], reason: "Drink" },
      ],
    }),
    hydrate: async (id) => product(id, id === "drink" ? "drink" : "food"),
  });

  assert.equal(result.readiness, "ready");
  assert.equal(result.warnings[0]?.code, "participant_count_conflict");
});

test("party input rejects more than ten current members", () => {
  assert.throws(() => partyPlanningInputSchema.parse({
    request: "Large party",
    currentParty: { members: Array.from({ length: 11 }, (_, index) => ({ id: String(index), restrictions: [] })) },
  }));
});
