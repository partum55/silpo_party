import assert from "node:assert/strict";
import test from "node:test";

import { partyPlanningInputSchema, type PlannerProposal } from "../src/domain/schemas.ts";
import { validateProposal, type HydratedProduct } from "../src/domain/validation.ts";

const product = (id: string, name = id): HydratedProduct => ({
  id: `sku-${id}`,
  name,
  priceUah: 50,
  unit: "шт",
  available: true,
  category: "food",
  packageSize: { amount: 400, unit: "g" },
  metadata: { ingredients: ["vegetables"], allergens: [], labels: [] },
});

const input = (strategy: "ready_made" | "recipe" | "either" = "either") => partyPlanningInputSchema.parse({
  request: "Party",
  currentParty: { members: [{ id: "a", wishes: [{ id: "dish", text: "щось гаряче", fulfillmentStrategy: strategy }] }] },
});

test("ready-made fulfillment can select a non-first candidate or a mix", async () => {
  const products = { first: product("first"), second: product("second"), third: product("third") };
  const result = await validateProposal({
    input: input(),
    budgetUah: null,
    partyWideRestrictions: [],
    proposal: {
      summary: "Mix",
      selections: ["second", "third"].map((productId) => ({ productId, quantity: 1, assignedMemberIds: ["a"], reason: "Variety" })),
      wishFulfillments: [{ memberId: "a", wishId: "dish", resolvedStrategy: "ready_made", selectedProductIds: ["second", "third"], recipeTitle: null, fallbackReason: null }],
    },
    wishCandidates: [{
      memberId: "a",
      wishId: "dish",
      requestedStrategy: "either",
      candidates: Object.entries(products).map(([lookupProductId, value]) => ({ lookupProductId, product: value })),
    }],
    hydrate: async (id) => products[id as keyof typeof products] ?? null,
    targets: { foodGramsPerPerson: 0, drinkMillilitersPerPerson: 0 },
  });

  assert.equal(result.readiness, "ready");
  assert.deepEqual(result.draft.wishFulfillments[0]?.selectedProductIds, ["sku-second", "sku-third"]);
});

test("ready-made is a hard constraint when no suitable candidate exists", async () => {
  const result = await validateProposal({
    input: input("ready_made"),
    budgetUah: null,
    partyWideRestrictions: [],
    proposal: { summary: "None", selections: [], wishFulfillments: [] },
    wishCandidates: [{ memberId: "a", wishId: "dish", requestedStrategy: "ready_made", candidates: [] }],
    hydrate: async () => null,
    targets: { foodGramsPerPerson: 0, drinkMillilitersPerPerson: 0 },
  });

  assert.equal(result.readiness, "invalid");
  assert.ok(result.blockers.some((blocker) => blocker.code === "no_suitable_ready_made"));
});

test("either may fall back to a recipe only with a valid fallback reason", async () => {
  const ingredient = product("ingredient");
  const proposal = (fallbackReason: "no_candidates" | "poor_match"): PlannerProposal => ({
    summary: "Recipe",
    selections: [],
    recipes: [{
      title: "Hot dish",
      source: "generated",
      sourceUrl: null,
      servings: 1,
      assignedMemberIds: ["a"],
      ingredients: [{ name: "vegetables", amount: 100, unit: "g", productId: "ingredient" }],
      steps: ["Cook."],
    }],
    wishFulfillments: [{ memberId: "a", wishId: "dish", resolvedStrategy: "recipe", selectedProductIds: [], recipeTitle: "Hot dish", fallbackReason }],
  });
  const options = {
    input: input(),
    budgetUah: null,
    partyWideRestrictions: [],
    wishCandidates: [{ memberId: "a", wishId: "dish", requestedStrategy: "either" as const, candidates: [] }],
    hydrate: async (id: string) => id === "ingredient" ? ingredient : null,
    targets: { foodGramsPerPerson: 0, drinkMillilitersPerPerson: 0 },
  };

  assert.equal((await validateProposal({ ...options, proposal: proposal("no_candidates") })).readiness, "ready");
  assert.equal((await validateProposal({
    ...options,
    proposal: proposal("poor_match"),
    wishCandidates: [{ memberId: "a", wishId: "dish", requestedStrategy: "either", candidates: [{ lookupProductId: "candidate", product: product("candidate") }] }],
  })).readiness, "ready");
});

test("explicit cooking uses recipe mode without ready-made candidates", async () => {
  const ingredient = product("ingredient");
  const result = await validateProposal({
    input: input("recipe"),
    budgetUah: null,
    partyWideRestrictions: [],
    proposal: {
      summary: "Cook",
      selections: [],
      recipes: [{
        title: "Hot dish",
        source: "generated",
        sourceUrl: null,
        servings: 1,
        assignedMemberIds: ["a"],
        ingredients: [{ name: "vegetables", amount: 100, unit: "g", productId: "ingredient" }],
        steps: ["Cook."],
      }],
      wishFulfillments: [{ memberId: "a", wishId: "dish", resolvedStrategy: "recipe", selectedProductIds: [], recipeTitle: "Hot dish", fallbackReason: "explicit_cooking" }],
    },
    wishCandidates: [{ memberId: "a", wishId: "dish", requestedStrategy: "recipe", candidates: [] }],
    hydrate: async (id) => id === "ingredient" ? ingredient : null,
    targets: { foodGramsPerPerson: 0, drinkMillilitersPerPerson: 0 },
  });

  assert.equal(result.readiness, "ready");
  assert.equal(result.draft.wishFulfillments[0]?.resolvedStrategy, "recipe");
});

test("fabricated selected ids cannot satisfy a wish", async () => {
  const candidate = product("candidate");
  const fabricated = product("fabricated");
  const result = await validateProposal({
    input: input(),
    budgetUah: null,
    partyWideRestrictions: [],
    proposal: {
      summary: "Bad",
      selections: [{ productId: "fabricated", quantity: 1, assignedMemberIds: ["a"], reason: "Bad" }],
      wishFulfillments: [{ memberId: "a", wishId: "dish", resolvedStrategy: "ready_made", selectedProductIds: ["fabricated"], recipeTitle: null, fallbackReason: null }],
    },
    wishCandidates: [{ memberId: "a", wishId: "dish", requestedStrategy: "either", candidates: [{ lookupProductId: "candidate", product: candidate }] }],
    hydrate: async (id) => id === "fabricated" ? fabricated : null,
    targets: { foodGramsPerPerson: 0, drinkMillilitersPerPerson: 0 },
  });

  assert.equal(result.readiness, "invalid");
  assert.ok(result.blockers.some((blocker) => blocker.code === "invalid_fulfillment"));
});
