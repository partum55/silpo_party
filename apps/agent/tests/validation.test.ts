import assert from "node:assert/strict";
import test from "node:test";

import {
  coverageTargets,
  validateProposal,
  type HydratedProduct,
} from "../src/domain/validation.ts";
import type { PartyPlanningInput, PlannerProposal } from "../src/domain/schemas.ts";

const members = [
  { id: "a", name: "Anna", restrictions: ["vegetarian"] },
  { id: "b", name: "Bohdan", restrictions: [] },
];

const input: PartyPlanningInput = {
  request: "Party for 2 people, budget 100 UAH",
  currentParty: { members },
};

const products: Record<string, HydratedProduct> = {
  vegetables: {
    id: "vegetables",
    name: "Vegetable platter 800 g",
    priceUah: 80,
    unit: "pack",
    available: true,
    category: "food",
    packageSize: { amount: 800, unit: "g" },
    metadata: { ingredients: ["tomato", "cucumber", "pepper"], allergens: [], labels: [] },
  },
  juice: {
    id: "juice",
    name: "Apple juice 1.5 l",
    priceUah: 70,
    unit: "bottle",
    available: true,
    category: "drink",
    packageSize: { amount: 1500, unit: "ml" },
    metadata: { ingredients: ["apple juice"], allergens: [], labels: ["vegan"] },
  },
  meat: {
    id: "meat",
    name: "Chicken platter 800 g",
    priceUah: 120,
    unit: "pack",
    available: true,
    category: "food",
    packageSize: { amount: 800, unit: "g" },
    metadata: { ingredients: ["chicken", "salt"], allergens: [], labels: [] },
  },
  grapes: {
    id: "grapes",
    name: "Виноград ваговий",
    priceUah: 69.9,
    unit: "кг",
    available: true,
    weighted: true,
    category: "food",
    packageSize: { amount: 100, unit: "g" },
    metadata: { ingredients: ["виноград"], allergens: [], labels: [] },
  },
  water: {
    id: "water",
    name: "Вода мінеральна негазована",
    priceUah: 30,
    unit: "шт",
    available: true,
    category: "drink",
    packageSize: { amount: 750, unit: "ml" },
    metadata: { ingredients: [], allergens: [], labels: [], composition: [] },
  },
  tomatoes: {
    id: "tomatoes",
    name: "Томати рожеві",
    priceUah: 60,
    unit: "кг",
    available: true,
    weighted: true,
    category: "food",
    packageSize: { amount: 300, unit: "g" },
    metadata: { ingredients: [], allergens: [], labels: [], composition: [] },
  },
  almonds: {
    id: "almonds",
    name: "Мигдаль сирий",
    priceUah: 80,
    unit: "шт",
    available: true,
    category: "food",
    packageSize: { amount: 100, unit: "g" },
    metadata: { ingredients: [], allergens: ["мигдаль"], labels: [], composition: [] },
  },
  ambiguous: {
    id: "ambiguous",
    name: "Закуска фірмова",
    priceUah: 90,
    unit: "шт",
    available: true,
    category: "food",
    packageSize: { amount: 400, unit: "g" },
    metadata: { ingredients: [], allergens: [], labels: [], composition: [] },
  },
  veganPrepared: {
    id: "veganPrepared",
    name: "Тофники з тофу веганські",
    priceUah: 120,
    unit: "шт",
    available: true,
    category: "food",
    packageSize: { amount: 400, unit: "g" },
    metadata: { ingredients: [], allergens: ["соя"], labels: [], composition: [] },
  },
  fruitJuice: {
    id: "fruitJuice",
    name: "Сік яблучний",
    priceUah: 50,
    unit: "шт",
    available: true,
    category: "drink",
    packageSize: { amount: 750, unit: "ml" },
    metadata: { ingredients: [], allergens: [], labels: [], composition: [] },
  },
  milk: {
    id: "milk",
    name: "Молоко 2,5% 900 мл",
    priceUah: 48,
    unit: "шт",
    available: true,
    category: "food",
    packageSize: { amount: 900, unit: "ml" },
    metadata: { ingredients: [], allergens: [], labels: [] },
  },
  lactoseFreeMilk: {
    id: "lactoseFreeMilk",
    name: "Молоко безлактозне 2,5% 900 мл",
    priceUah: 58,
    unit: "шт",
    available: true,
    category: "food",
    packageSize: { amount: 900, unit: "ml" },
    metadata: { ingredients: ["молоко коров'яче"], allergens: ["молоко"], labels: [] },
  },
  kvassWithoutMetadata: {
    id: "kvassWithoutMetadata",
    name: "Квас «Квас Тарас» «Чорний» з/б",
    priceUah: 34,
    unit: "шт",
    available: true,
    category: "drink",
    packageSize: { amount: 500, unit: "ml" },
    metadata: { ingredients: [], allergens: [], labels: [] },
  },
  lavashWithoutMetadata: {
    id: "lavashWithoutMetadata",
    name: "Лаваш «Тундир» вірменський",
    priceUah: 46,
    unit: "шт",
    available: true,
    category: "food",
    packageSize: { amount: 200, unit: "g" },
    metadata: { ingredients: [], allergens: [], labels: [] },
  },
  cheeseChipsWithoutMetadata: {
    id: "cheeseChipsWithoutMetadata",
    name: "Чипси Pringles зі смаком сиру",
    priceUah: 119,
    unit: "шт",
    available: true,
    category: "food",
    packageSize: { amount: 165, unit: "g" },
    metadata: { ingredients: [], allergens: [], labels: [] },
  },
  toiletPaper: {
    id: "toiletPaper",
    name: "Папір туалетний 3-шаровий",
    priceUah: 100,
    unit: "шт",
    available: true,
    category: "food",
    packageSize: { amount: 4, unit: "piece" },
    metadata: { ingredients: [], allergens: [], labels: [] },
  },
};

function proposal(selections: PlannerProposal["selections"]): PlannerProposal {
  return { summary: "Draft", selections };
}

const hydrate = async (id: string) => products[id] ?? null;

test("hydrates product facts and calculates a soft-budget warning", async () => {
  const result = await validateProposal({
    input,
    budgetUah: 100,
    partyWideRestrictions: [],
    proposal: proposal([
      { productId: "vegetables", quantity: 2, assignedMemberIds: ["a", "b"], reason: "Food" },
      { productId: "juice", quantity: 1, assignedMemberIds: ["a", "b"], reason: "Drinks" },
    ]),
    hydrate,
  });

  assert.equal(result.readiness, "ready");
  assert.equal(result.totalUah, 230);
  assert.deepEqual(result.warnings.find((warning) => warning.code === "budget_exceeded")?.amountUah, 130);
  assert.equal(result.selectedProducts[0].name, "Vegetable platter 800 g");
  assert.equal(result.draft.summary, "План вечірки для 2 учасників із 2 перевіреними товарами Silpo.");
  assert.equal(result.selectedProducts[0].reason, "Призначено для 2 учасників.");
});

test("rejects a plausible fabricated product id", async () => {
  const result = await validateProposal({
    input,
    budgetUah: null,
    partyWideRestrictions: [],
    proposal: proposal([
      { productId: "4820001234567", quantity: 1, assignedMemberIds: ["a", "b"], reason: "Looks real" },
    ]),
    hydrate,
  });

  assert.equal(result.readiness, "invalid");
  assert.equal(result.selectedProducts.length, 0);
  assert.equal(result.blockers[0]?.code, "product_not_found");
});

test("validates restriction safety and coverage per participant", async () => {
  const result = await validateProposal({
    input,
    budgetUah: null,
    partyWideRestrictions: [],
    proposal: proposal([
      { productId: "vegetables", quantity: 1, assignedMemberIds: ["a"], reason: "Vegetarian food" },
      { productId: "meat", quantity: 1, assignedMemberIds: ["b"], reason: "Food" },
      { productId: "juice", quantity: 1, assignedMemberIds: ["a", "b"], reason: "Drinks" },
    ]),
    hydrate,
  });

  assert.equal(result.readiness, "ready");
  assert.deepEqual(result.coverage.a, { foodGrams: 800, drinkMilliliters: 750 });
  assert.deepEqual(result.coverage.b, { foodGrams: 800, drinkMilliliters: 750 });
});

test("unknown restriction evidence cannot count toward coverage", async () => {
  const result = await validateProposal({
    input: {
      ...input,
      currentParty: { members: [{ id: "a", restrictions: ["nut allergy"] }] },
    },
    budgetUah: null,
    partyWideRestrictions: [],
    proposal: proposal([
      { productId: "ambiguous", quantity: 1, assignedMemberIds: ["a"], reason: "Food" },
    ]),
    hydrate,
    targets: { foodGramsPerPerson: 0, drinkMillilitersPerPerson: 0 },
  });

  assert.equal(result.readiness, "invalid");
  assert.ok(result.blockers.some((blocker) => blocker.code === "restriction_unverified"));
  assert.equal(result.selectedProducts.length, 0);
});

test("coverage targets are injectable heuristics", async () => {
  const result = await validateProposal({
    input,
    budgetUah: null,
    partyWideRestrictions: [],
    proposal: proposal([
      { productId: "vegetables", quantity: 1, assignedMemberIds: ["a", "b"], reason: "Food" },
      { productId: "juice", quantity: 1, assignedMemberIds: ["a", "b"], reason: "Drinks" },
    ]),
    hydrate,
    targets: { ...coverageTargets, foodGramsPerPerson: 401 },
  });

  assert.equal(result.readiness, "invalid");
  assert.ok(result.blockers.some((blocker) => blocker.code === "insufficient_food"));
});

test("weighted 100 g pricing units use 100 g for price and coverage", async () => {
  const weightedInput: PartyPlanningInput = {
    request: "Fruit",
    currentParty: { members: [{ id: "a", restrictions: [] }] },
  };
  const result = await validateProposal({
    input: weightedInput,
    budgetUah: null,
    partyWideRestrictions: [],
    proposal: proposal([
      { productId: "grapes", quantity: 1, assignedMemberIds: ["a"], reason: "Fruit" },
    ]),
    hydrate,
    targets: { foodGramsPerPerson: 100, drinkMillilitersPerPerson: 0 },
  });

  assert.equal(result.selectedProducts[0]?.lineTotalUah, 6.99);
  assert.deepEqual(result.selectedProducts[0]?.packageSize, { amount: 100, unit: "g" });
  assert.equal(result.coverage.a.foodGrams, 100);
  assert.equal(result.readiness, "ready");
});

test("vegetarian verification accepts plain water, tomatoes, and almonds", async () => {
  const result = await validateProposal({
    input: { request: "Vegetarian party", currentParty: { members: [{ id: "a", restrictions: ["vegetarian"] }] } },
    budgetUah: null,
    partyWideRestrictions: [],
    proposal: proposal([
      { productId: "water", quantity: 1, assignedMemberIds: ["a"], reason: "Drink" },
      { productId: "tomatoes", quantity: 1, assignedMemberIds: ["a"], reason: "Food" },
      { productId: "almonds", quantity: 1, assignedMemberIds: ["a"], reason: "Food" },
    ]),
    hydrate,
  });

  assert.deepEqual(result.coverage.a, { foodGrams: 400, drinkMilliliters: 750 });
  assert.equal(result.readiness, "ready");
});

test("obvious meat is unsafe only for the restricted participant", async () => {
  const result = await validateProposal({
    input: { request: "Mixed party", currentParty: { members } },
    budgetUah: null,
    partyWideRestrictions: [],
    proposal: proposal([
      { productId: "meat", quantity: 1, assignedMemberIds: ["a", "b"], reason: "Food" },
      { productId: "water", quantity: 2, assignedMemberIds: ["a", "b"], reason: "Drink" },
    ]),
    hydrate,
  });

  assert.deepEqual(result.coverage.a, { foodGrams: 0, drinkMilliliters: 750 });
  assert.deepEqual(result.coverage.b, { foodGrams: 400, drinkMilliliters: 750 });
  assert.ok(result.blockers.some((blocker) => blocker.code === "restriction_violation" && blocker.memberId === "a"));
  assert.ok(result.blockers.every((blocker) => blocker.memberId !== "b"));
});

test("applies common Silpo restrictions to ingredients and explicit free-from labels", async () => {
  const cases = [
    { restriction: "egg allergy", unsafe: "яйця", safe: "без яєць" },
    { restriction: "Без сої", unsafe: "соєвий білок", safe: "без сої" },
    { restriction: "sesame allergy", unsafe: "sesame seeds", safe: "sesame-free" },
    { restriction: "Без цукру", unsafe: "цукор", safe: "без доданого цукру" },
    { restriction: "no alcohol", unsafe: "етиловий спирт", safe: "безалкогольний" },
  ];

  for (const [index, item] of cases.entries()) {
    const unsafeId = `restricted-${index}`;
    const safeId = `free-from-${index}`;
    products[unsafeId] = {
      ...products.ambiguous,
      id: unsafeId,
      name: `Restricted product ${index}`,
      metadata: { ingredients: [item.unsafe], allergens: [], labels: [] },
    };
    products[safeId] = {
      ...products.ambiguous,
      id: safeId,
      name: `Safe product ${index}`,
      metadata: { ingredients: [item.unsafe], allergens: [], labels: [item.safe] },
    };
    const restrictedInput: PartyPlanningInput = {
      request: "Add product",
      currentParty: { members: [{ id: "a", restrictions: [item.restriction] }] },
    };
    const unsafe = await validateProposal({
      input: restrictedInput,
      budgetUah: null,
      partyWideRestrictions: [],
      proposal: proposal([{ productId: unsafeId, quantity: 1, assignedMemberIds: ["a"], reason: "Product" }]),
      hydrate,
      targets: { foodGramsPerPerson: 0, drinkMillilitersPerPerson: 0 },
    });
    const safe = await validateProposal({
      input: restrictedInput,
      budgetUah: null,
      partyWideRestrictions: [],
      proposal: proposal([{ productId: safeId, quantity: 1, assignedMemberIds: ["a"], reason: "Product" }]),
      hydrate,
      targets: { foodGramsPerPerson: 0, drinkMillilitersPerPerson: 0 },
    });

    assert.ok(unsafe.blockers.some((blocker) => blocker.code === "restriction_violation"), item.restriction);
    assert.equal(safe.readiness, "ready", item.restriction);
  }
});

test("unknown Silpo restrictions fail closed unless the product explicitly matches them", async () => {
  const result = await validateProposal({
    input: { request: "Add snack", currentParty: { members: [{ id: "a", restrictions: ["special-profile-diet"] }] } },
    budgetUah: null,
    partyWideRestrictions: [],
    proposal: proposal([{ productId: "vegetables", quantity: 1, assignedMemberIds: ["a"], reason: "Food" }]),
    hydrate,
    targets: { foodGramsPerPerson: 0, drinkMillilitersPerPerson: 0 },
  });

  assert.ok(result.blockers.some((blocker) => blocker.code === "restriction_unverified"));
});

test("a lactose restriction rejects regular milk and accepts lactose-free milk", async () => {
  const restrictedInput: PartyPlanningInput = {
    request: "Add milk",
    currentParty: { members: [{ id: "a", restrictions: ["lactose"] }] },
  };
  const regular = await validateProposal({
    input: restrictedInput,
    budgetUah: null,
    partyWideRestrictions: [],
    proposal: proposal([{ productId: "milk", quantity: 1, assignedMemberIds: ["a"], reason: "Milk" }]),
    hydrate,
    targets: { foodGramsPerPerson: 0, drinkMillilitersPerPerson: 0 },
  });
  const lactoseFree = await validateProposal({
    input: restrictedInput,
    budgetUah: null,
    partyWideRestrictions: [],
    proposal: proposal([{ productId: "lactoseFreeMilk", quantity: 1, assignedMemberIds: ["a"], reason: "Milk" }]),
    hydrate,
    targets: { foodGramsPerPerson: 0, drinkMillilitersPerPerson: 0 },
  });

  assert.ok(regular.blockers.some((blocker) => blocker.code === "restriction_violation"));
  assert.equal(regular.selectedProducts.length, 0);
  assert.equal(lactoseFree.readiness, "ready");
});

test("a lactose restriction accepts a clearly non-dairy drink when Silpo omits metadata", async () => {
  const result = await validateProposal({
    input: { request: "Додай квас", currentParty: { members: [{ id: "a", restrictions: ["lactose"] }] } },
    budgetUah: null,
    partyWideRestrictions: [],
    proposal: proposal([{ productId: "kvassWithoutMetadata", quantity: 1, assignedMemberIds: ["a"], reason: "Kvass" }]),
    hydrate,
    targets: { foodGramsPerPerson: 0, drinkMillilitersPerPerson: 0 },
  });

  assert.equal(result.readiness, "ready");
});

test("lactose validation accepts unrelated sparse food but rejects a dairy-named snack", async () => {
  const restrictedInput: PartyPlanningInput = {
    request: "Add a product",
    currentParty: { members: [{ id: "a", restrictions: ["lactose"] }] },
  };
  const lavash = await validateProposal({
    input: restrictedInput,
    budgetUah: null,
    partyWideRestrictions: [],
    proposal: proposal([{ productId: "lavashWithoutMetadata", productType: "food", quantity: 1, assignedMemberIds: ["a"], reason: "Lavash" }]),
    hydrate,
    targets: { foodGramsPerPerson: 0, drinkMillilitersPerPerson: 0 },
  });
  const cheeseChips = await validateProposal({
    input: restrictedInput,
    budgetUah: null,
    partyWideRestrictions: [],
    proposal: proposal([{ productId: "cheeseChipsWithoutMetadata", productType: "food", quantity: 1, assignedMemberIds: ["a"], reason: "Chips" }]),
    hydrate,
    targets: { foodGramsPerPerson: 0, drinkMillilitersPerPerson: 0 },
  });

  assert.equal(lavash.readiness, "ready");
  assert.ok(cheeseChips.blockers.some((blocker) => blocker.code === "restriction_violation"));
});

test("dietary restrictions do not block model-classified non-food Silpo merchandise", async () => {
  const result = await validateProposal({
    input: { request: "Add toilet paper", currentParty: { members: [{ id: "a", restrictions: ["lactose", "vegan"] }] } },
    budgetUah: null,
    partyWideRestrictions: [],
    proposal: proposal([{ productId: "toiletPaper", productType: "non_food", quantity: 1, assignedMemberIds: ["a"], reason: "Household item" }]),
    hydrate,
    targets: { foodGramsPerPerson: 0, drinkMillilitersPerPerson: 0 },
  });

  assert.equal(result.readiness, "ready");
  assert.equal(result.selectedProducts[0]?.category, "non_food");
});

test("a vegan restriction rejects cow milk by name even when Silpo omits metadata", async () => {
  const result = await validateProposal({
    input: { request: "Додай молоко", currentParty: { members: [{ id: "a", restrictions: ["vegan"] }] } },
    budgetUah: null,
    partyWideRestrictions: [],
    proposal: proposal([{ productId: "milk", quantity: 1, assignedMemberIds: ["a"], reason: "Milk" }]),
    hydrate,
    targets: { foodGramsPerPerson: 0, drinkMillilitersPerPerson: 0 },
  });

  assert.ok(result.blockers.some((blocker) => blocker.code === "restriction_violation"));
  assert.equal(result.readiness, "invalid");
  assert.equal(result.selectedProducts.length, 0);
});

test("ambiguous processed food without evidence remains unverified", async () => {
  const result = await validateProposal({
    input: { request: "Vegetarian party", currentParty: { members: [{ id: "a", restrictions: ["vegetarian"] }] } },
    budgetUah: null,
    partyWideRestrictions: [],
    proposal: proposal([
      { productId: "ambiguous", quantity: 1, assignedMemberIds: ["a"], reason: "Food" },
      { productId: "water", quantity: 1, assignedMemberIds: ["a"], reason: "Drink" },
    ]),
    hydrate,
  });

  assert.equal(result.coverage.a.foodGrams, 0);
  assert.ok(result.blockers.some((blocker) => blocker.code === "restriction_unverified" && blocker.productId === "ambiguous"));
});

test("explicit vegan names and clearly identified fruit juice are vegetarian-safe", async () => {
  const result = await validateProposal({
    input: { request: "Vegetarian party", currentParty: { members: [{ id: "a", restrictions: ["vegetarian"] }] } },
    budgetUah: null,
    partyWideRestrictions: [],
    proposal: proposal([
      { productId: "veganPrepared", quantity: 1, assignedMemberIds: ["a"], reason: "Food" },
      { productId: "fruitJuice", quantity: 1, assignedMemberIds: ["a"], reason: "Drink" },
    ]),
    hydrate,
  });

  assert.deepEqual(result.coverage.a, { foodGrams: 400, drinkMilliliters: 750 });
  assert.equal(result.readiness, "ready");
});
