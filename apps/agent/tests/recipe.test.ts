import assert from "node:assert/strict";
import test from "node:test";

import type { PlannerProposal } from "../src/domain/schemas.ts";
import { validateProposal, type HydratedProduct } from "../src/domain/validation.ts";
import { normalizeWebRecipe } from "../src/mastra/tools/recipe-tool.ts";

const product = (id: string, name: string, amount: number, ingredients: string[]): HydratedProduct => ({
  id,
  name,
  priceUah: 50,
  unit: "шт",
  available: true,
  category: "food",
  packageSize: { amount, unit: "g" },
  metadata: { ingredients, allergens: [], labels: [] },
});

const products: Record<string, HydratedProduct> = {
  cheese: product("cheese", "Cheese 200 g", 200, ["milk", "salt"]),
  chicken: product("chicken", "Chicken fillet 400 g", 400, ["chicken"]),
};

const members = Array.from({ length: 6 }, (_, index) => ({ id: `m${index + 1}`, restrictions: [] }));

function recipeProposal(overrides: Record<string, unknown> = {}) {
  return {
    summary: "Recipe plan",
    selections: [],
    recipes: [{
      title: "Cheese plate",
      source: "generated",
      sourceUrl: null,
      servings: 6,
      assignedMemberIds: members.map((member) => member.id),
      ingredients: [{ name: "cheese", amount: 350, unit: "g", productId: "cheese" }],
      steps: ["Arrange cheese."],
      ...overrides,
    }],
  } as unknown as PlannerProposal;
}

test("recipe scaling and package rounding are code-owned", async () => {
  const result = await validateProposal({
    input: { request: "Recipe party", currentParty: { members } },
    budgetUah: null,
    partyWideRestrictions: [],
    proposal: recipeProposal(),
    hydrate: async (id) => products[id] ?? null,
    targets: { foodGramsPerPerson: 0, drinkMillilitersPerPerson: 0 },
  });

  const ingredient = result.draft.recipes[0]?.ingredients[0];
  assert.equal(ingredient?.requiredAmount, 350);
  assert.equal(ingredient?.purchaseQuantity, 2);
  assert.equal(ingredient?.purchasedAmount, 400);
  assert.equal(ingredient?.selectedProduct.quantity, 2);
  assert.equal(ingredient?.selectedProduct.lineTotalUah, 100);

  const scaled = await validateProposal({
    input: { request: "Recipe party", currentParty: { members } },
    budgetUah: null,
    partyWideRestrictions: [],
    proposal: recipeProposal({ servings: 2, ingredients: [{ name: "cheese", amount: 100, unit: "g", productId: "cheese" }] }),
    hydrate: async (id) => products[id] ?? null,
    targets: { foodGramsPerPerson: 0, drinkMillilitersPerPerson: 0 },
  });
  assert.equal(scaled.draft.recipes[0]?.ingredients[0]?.requiredAmount, 300);
  assert.equal(scaled.draft.recipes[0]?.ingredients[0]?.purchaseQuantity, 2);
});

test("a fabricated recipe ingredient product cannot publish", async () => {
  const result = await validateProposal({
    input: { request: "Recipe party", currentParty: { members } },
    budgetUah: null,
    partyWideRestrictions: [],
    proposal: recipeProposal({ ingredients: [{ name: "cheese", amount: 350, unit: "g", productId: "plausible-fake-123" }] }),
    hydrate: async (id) => products[id] ?? null,
    targets: { foodGramsPerPerson: 0, drinkMillilitersPerPerson: 0 },
  });

  assert.equal(result.readiness, "invalid");
  assert.ok(result.blockers.some((blocker) => blocker.code === "product_not_found"));
});

test("recipe restrictions remove coverage only for the affected participant", async () => {
  const party = [
    { id: "vegetarian", restrictions: ["vegetarian"] },
    { id: "other", restrictions: [] },
  ];
  const result = await validateProposal({
    input: { request: "Mixed party", currentParty: { members: party } },
    budgetUah: null,
    partyWideRestrictions: [],
    proposal: recipeProposal({
      title: "Chicken",
      servings: 2,
      assignedMemberIds: party.map((member) => member.id),
      ingredients: [{ name: "chicken", amount: 800, unit: "g", productId: "chicken" }],
    }),
    hydrate: async (id) => products[id] ?? null,
    targets: { foodGramsPerPerson: 400, drinkMillilitersPerPerson: 0 },
  });

  assert.equal(result.coverage.vegetarian.foodGrams, 0);
  assert.equal(result.coverage.other.foodGrams, 400);
  assert.ok(result.blockers.some((blocker) => blocker.code === "restriction_violation" && blocker.memberId === "vegetarian"));
  assert.ok(result.blockers.every((blocker) => blocker.memberId !== "other"));
});

test("web recipes normalize servings, measures, and instructions", () => {
  const recipe = normalizeWebRecipe({
    "@type": "Recipe",
    name: "Tomato cheese plate",
    recipeYield: "Serves 4",
    recipeIngredient: ["350 g cheese", "1 1/2 cups water", "2 tomatoes"],
    recipeInstructions: [{ "@type": "HowToStep", text: "Slice and serve." }],
  }, "https://recipes.example/plate");

  assert.deepEqual(recipe, {
    title: "Tomato cheese plate",
    source: "web",
    sourceUrl: "https://recipes.example/plate",
    servings: 4,
    ingredients: [
      { name: "cheese", amount: 350, unit: "g" },
      { name: "water", amount: 360, unit: "ml" },
      { name: "tomatoes", amount: 2, unit: "piece" },
    ],
    steps: ["Slice and serve."],
  });
});

test("web recipe facts are authoritative only after code re-resolves them", async () => {
  const result = await validateProposal({
    input: { request: "Recipe party", currentParty: { members } },
    budgetUah: null,
    partyWideRestrictions: [],
    proposal: recipeProposal({
      source: "web",
      sourceUrl: "https://fabricated.example/recipe",
      servings: 99,
      ingredients: [{ name: "cheese", amount: 1, unit: "g", productId: "cheese" }],
    }),
    hydrate: async (id) => products[id] ?? null,
    resolveRecipe: async () => ({
      title: "Cheese plate",
      source: "web",
      sourceUrl: "https://recipes.example/real-cheese-plate",
      servings: 6,
      ingredients: [{ name: "cheese", amount: 350, unit: "g" }],
      steps: ["Arrange cheese."],
    }),
    targets: { foodGramsPerPerson: 0, drinkMillilitersPerPerson: 0 },
  });

  assert.equal(result.draft.recipes[0]?.sourceUrl, "https://recipes.example/real-cheese-plate");
  assert.equal(result.draft.recipes[0]?.ingredients[0]?.requiredAmount, 350);
  assert.equal(result.draft.recipes[0]?.ingredients[0]?.purchaseQuantity, 2);
});
