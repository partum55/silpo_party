import assert from "node:assert/strict";
import test from "node:test";
import type { z } from "zod";

import { createNoopCache } from "../src/cache/cache.ts";
import { conversationInputSchema, conversationOutputSchema, type TurnInput } from "../src/domain/turn-schema.ts";
import { OUT_OF_SCOPE_RESPONSE, runTurn } from "../src/pipeline/turn.ts";
import { createCatalogSession } from "../src/silpo/catalog.ts";
import { createFakeLlm, pickByName } from "./helpers/fake-llm.ts";
import { createFakeSilpo } from "./helpers/fake-silpo.ts";

const ROUTER = "Interpret one chat message";
const PICK = "For each shopping need";
const RECIPE = "Write a practical home-cooked recipe";
const CHECKLIST = "Plan the complete shopping list";

function input(overrides: Partial<z.input<typeof conversationInputSchema>> & { message: string; mode: TurnInput["mode"] }): TurnInput {
  return conversationInputSchema.parse({
    actorId: "anna",
    hostId: "anna",
    currentParty: { members: [{ id: "anna" }, { id: "bohdan" }] },
    ...overrides,
  });
}

function deps(fake: ReturnType<typeof createFakeSilpo>, rules: Parameters<typeof createFakeLlm>[0]) {
  const { llm, prompts } = createFakeLlm(rules);
  let ids = 0;
  return {
    prompts,
    deps: {
      llm,
      cache: createNoopCache(),
      createId: () => `wish-${++ids}`,
      withSession: <T>(operation: (session: ReturnType<typeof createCatalogSession>) => Promise<T>) =>
        operation(createCatalogSession({ userId: "host", client: fake.client, schemas: fake.schemas, cache: createNoopCache() })),
    },
  };
}

const add = (label: string, query: string, extra: Record<string, unknown> = {}) => ({ action: "add", label, query, ...extra });

test("shopping: the reported list is added for the requester with per-item results", async () => {
  const fake = createFakeSilpo();
  const { deps: turnDeps } = deps(fake, [
    [ROUTER, () => ({ kind: "change", productOps: [
      add("желейки", "цукерки желейні"),
      add("картопля", "картопля"),
      add("апельсиновий сік", "сік апельсиновий"),
    ] })],
    [PICK, pickByName],
  ]);
  const output = await runTurn(input({ mode: "SHOPPING", message: "желейки, картопля і апельсиновий сік" }), turnDeps);

  assert.equal(conversationOutputSchema.safeParse(output).success, true);
  assert.deepEqual(output.updatedPlan?.products.map((product) => product.name), [
    "Цукерки желейні Roshen 150 г",
    "Картопля біла",
    "Сік Sandora апельсиновий 0,95 л",
  ]);
  assert.ok(output.updatedPlan?.products.every((product) => product.assignedMemberIds.join() === "anna"));
  assert.ok(output.updatedPlan?.products.every((product) => product.slug));
  assert.match(output.responseText, /^Додано: «Цукерки желейні Roshen 150 г» ×1, «Картопля біла» 1 кг/);
  assert.equal(output.readiness, "ready");
});

test("shopping: a partial Silpo failure keeps the successful items and explains the rest", async () => {
  const fake = createFakeSilpo({ failQueries: ["цукерки желейні"] });
  const { deps: turnDeps } = deps(fake, [
    [ROUTER, () => ({ kind: "change", productOps: [add("желейки", "цукерки желейні"), add("картопля", "картопля")] })],
    [PICK, pickByName],
  ]);
  const output = await runTurn(input({ mode: "SHOPPING", message: "желейки і картопля" }), turnDeps);

  assert.deepEqual(output.updatedPlan?.products.map((product) => product.name), ["Картопля біла"]);
  assert.match(output.responseText, /Не додано: «желейки» — Сільпо не відповів/);
});

test("shopping: when the model is down, a plain list is still split and added", async () => {
  const fake = createFakeSilpo();
  const { deps: turnDeps } = deps(fake, [[ROUTER, () => null], [PICK, () => null]]);
  const output = await runTurn(input({ mode: "SHOPPING", message: "картопля, буряк" }), turnDeps);
  assert.deepEqual(output.updatedPlan?.products.map((product) => product.name), ["Картопля біла", "Буряк столовий"]);
});

test("shopping: removing an item keeps other members' products", async () => {
  const fake = createFakeSilpo();
  const first = deps(fake, [
    [ROUTER, () => ({ kind: "change", productOps: [add("картопля", "картопля")] })],
    [PICK, pickByName],
  ]);
  const afterAnna = await runTurn(input({ mode: "SHOPPING", message: "картопля" }), first.deps);
  const afterBohdan = await runTurn(input({ mode: "SHOPPING", actorId: "bohdan", message: "картопля", currentPlan: afterAnna.updatedPlan }), first.deps);
  assert.equal(afterBohdan.updatedPlan?.products.length, 2);

  const remove = deps(fake, [[ROUTER, () => ({ kind: "change", productOps: [{ action: "remove", label: "картопля", query: "картопля", target: "картопля" }] })]]);
  const output = await runTurn(input({ mode: "SHOPPING", message: "прибери картоплю", currentPlan: afterBohdan.updatedPlan }), remove.deps);
  assert.deepEqual(output.updatedPlan?.products.map((product) => product.assignedMemberIds), [["bohdan"]]);
  assert.match(output.responseText, /Прибрано: «Картопля біла»/);
});

test("a Silpo connection problem is reported once, with an action for the host", async () => {
  const fake = createFakeSilpo();
  const { deps: turnDeps } = deps(fake, [[ROUTER, () => ({ kind: "change", productOps: [add("картопля", "картопля"), add("сік", "сік апельсиновий")] })]]);
  const output = await runTurn(input({ mode: "SHOPPING", message: "картопля і сік" }), {
    ...turnDeps,
    withSession: async () => { throw new Error("Silpo connection must be renewed"); },
  });
  assert.equal(output.responseText, "Потрібно заново підключити акаунт Сільпо організатора. Не додано: «картопля», «сік».");
  assert.equal(output.readiness, "invalid");
  assert.equal(output.blockers.length, 2);
});

test("off-topic messages get the fixed reply and leave the plan alone", async () => {
  const fake = createFakeSilpo();
  const { deps: turnDeps } = deps(fake, [[ROUTER, () => ({ kind: "off_topic" })]]);
  const output = await runTurn(input({ mode: "SHOPPING", message: "розв'яжи рівняння" }), turnDeps);
  assert.equal(output.responseText, OUT_OF_SCOPE_RESPONSE);
  assert.equal(output.intent, "read_only");
  assert.deepEqual(fake.calls, []);
});

const carbonara = {
  title: "Паста карбонара",
  ingredients: [
    { name: "спагеті", amount: 400, unit: "g" },
    { name: "бекон", amount: 200, unit: "g" },
    { name: "яйця курячі", amount: 4, unit: "piece" },
    { name: "сіль", amount: 10, unit: "g" },
    { name: "перець чорний мелений", amount: 2, unit: "g" },
  ],
  steps: ["Відваріть спагеті.", "Обсмажте бекон.", "Змішайте з яйцями."],
};

const borscht = {
  title: "Борщ український",
  ingredients: [
    { name: "буряк", amount: 500, unit: "g" },
    { name: "цибуля ріпчаста", amount: 200, unit: "g" },
    { name: "вода", amount: 2000, unit: "ml" },
  ],
  steps: ["Зваріть бульйон.", "Додайте буряк."],
};

test("dinner: two members' dishes become recipes with pantry staples skipped", async () => {
  const fake = createFakeSilpo();
  const turn = deps(fake, [
    [ROUTER, (data) => ({ kind: "change", dishOps: [{ action: "add", dish: data.message.includes("борщ") ? "борщ" : "карбонара" }] })],
    [RECIPE, (data) => data.dish === "борщ" ? borscht : carbonara],
    [PICK, pickByName],
  ]);
  const first = await runTurn(input({ mode: "DINNER", message: "хочу карбонару" }), turn.deps);
  assert.equal(first.intent, "preference_mutation");
  assert.deepEqual(first.updatedPreferences.find((member) => member.memberId === "anna")?.wishes.map((wish) => wish.text), ["карбонара"]);
  assert.deepEqual(first.updatedPlan?.products.map((product) => product.name).sort(), [
    "Бекон сирокопчений 150 г",
    "Спагеті Barilla 500 г",
    "Яйця курячі 10 шт",
  ]);
  assert.match(first.responseText, /Рецепт «Паста карбонара» \(1 порц\.\):/);
  assert.doesNotMatch(first.responseText, /сіль|перець/);

  const party = { members: first.updatedPreferences.map((member) => ({ id: member.memberId, wishes: member.wishes })) };
  const second = await runTurn(input({ mode: "DINNER", actorId: "bohdan", message: "а я борщ", currentParty: party, currentPlan: first.updatedPlan }), turn.deps);
  const products = second.updatedPlan!.products;
  assert.equal(products.length, 5);
  assert.deepEqual(products.find((product) => product.name === "Буряк столовий")?.assignedMemberIds, ["bohdan"]);
  assert.deepEqual(products.find((product) => product.name.startsWith("Бекон"))?.assignedMemberIds, ["anna"]);
  assert.equal(second.updatedPlan?.recipes.length, 2);
  assert.equal(second.updatedPlan?.wishFulfillments.length, 2);
});

test("dinner: members who want the same dish share it and its ingredient quantities grow", async () => {
  const fake = createFakeSilpo();
  const turn = deps(fake, [
    [ROUTER, () => ({ kind: "change", dishOps: [{ action: "add", dish: "карбонара" }] })],
    [RECIPE, () => carbonara],
    [PICK, pickByName],
  ]);
  const first = await runTurn(input({ mode: "DINNER", message: "карбонара" }), turn.deps);
  const party = { members: first.updatedPreferences.map((member) => ({ id: member.memberId, wishes: member.wishes })) };
  const second = await runTurn(input({ mode: "DINNER", actorId: "bohdan", message: "я теж карбонару", currentParty: party, currentPlan: first.updatedPlan }), turn.deps);

  assert.equal(second.updatedPlan?.recipes.length, 1);
  assert.deepEqual(second.updatedPlan?.recipes[0].assignedMemberIds, ["anna", "bohdan"]);
  const bacon = second.updatedPlan!.products.find((product) => product.name.startsWith("Бекон"))!;
  // 200 g for 4 servings -> 100 g for two people -> one 150 g pack.
  assert.equal(bacon.quantity, 1);
  assert.deepEqual(bacon.assignedMemberIds, ["anna", "bohdan"]);
});

test("dinner: a removed ingredient is not bought again when recipes change", async () => {
  const fake = createFakeSilpo();
  const turn = deps(fake, [
    [ROUTER, (data) => data.message.includes("бекон")
      ? { kind: "change", productOps: [{ action: "remove", label: "бекон", query: "бекон", target: "бекон" }] }
      : { kind: "change", dishOps: [{ action: "add", dish: data.message }] }],
    [RECIPE, (data) => data.dish === "борщ" ? borscht : carbonara],
    [PICK, pickByName],
  ]);
  const first = await runTurn(input({ mode: "DINNER", message: "карбонара" }), turn.deps);
  const removed = await runTurn(input({ mode: "DINNER", message: "прибери бекон", currentPlan: first.updatedPlan }), turn.deps);
  assert.equal(removed.updatedPlan?.products.some((product) => product.name.startsWith("Бекон")), false);
  assert.deepEqual(removed.updatedPlan?.recipes[0].missingIngredients?.map((item) => item.name), ["бекон"]);

  const party = { members: first.updatedPreferences.map((member) => ({ id: member.memberId, wishes: member.wishes })) };
  const more = await runTurn(input({ mode: "DINNER", actorId: "bohdan", message: "борщ", currentParty: party, currentPlan: removed.updatedPlan }), turn.deps);
  assert.equal(more.updatedPlan?.products.some((product) => product.name.startsWith("Бекон")), false);
});

const shashlikChecklist = {
  title: "Шашлики з друзями",
  items: [
    { category: "м'ясо", label: "свинина для шашлику", query: "свинина шия", perPerson: 300, unit: "g", priority: "essential" },
    { category: "хліб", label: "лаваш", query: "лаваш", count: 2, priority: "essential" },
    { category: "соуси", label: "кетчуп", query: "кетчуп", count: 1, priority: "essential" },
    { category: "напої", label: "вода", query: "вода мінеральна", perPerson: 500, unit: "ml", priority: "essential" },
    { category: "снеки", label: "чипси", query: "чипси", count: 2, priority: "extra" },
  ],
};

test("event: an autonomous checklist is scaled to the headcount and shared by everyone", async () => {
  const fake = createFakeSilpo();
  const turn = deps(fake, [
    [ROUTER, (data) => ({ kind: "change", planEvent: { brief: data.message } })],
    [CHECKLIST, () => shashlikChecklist],
    [PICK, pickByName],
  ]);
  const output = await runTurn(input({ mode: "EVENT", message: "заплануй шашлички з друзями на 6" }), turn.deps);
  const products = output.updatedPlan!.products;

  assert.equal(products.length, 5);
  assert.ok(products.every((product) => product.assignedMemberIds.join() === "anna,bohdan"));
  // 300 g x 6 people = 1.8 kg of pork sold per kilogram -> 2 kg.
  assert.equal(products.find((product) => product.name.startsWith("Свинина"))?.quantity, 2);
  // 500 ml x 6 = 3 l of 1.5 l bottles -> 2 bottles.
  assert.equal(products.find((product) => product.name.startsWith("Вода"))?.quantity, 2);
  assert.match(output.responseText, /розраховано на 6 осіб/);
});

test("event: extras are dropped first to fit the budget", async () => {
  const fake = createFakeSilpo();
  const turn = deps(fake, [
    [ROUTER, (data) => ({ kind: "change", planEvent: { brief: data.message } })],
    [CHECKLIST, () => shashlikChecklist],
    [PICK, pickByName],
  ]);
  const output = await runTurn(input({ mode: "EVENT", message: "шашлики на 6", budgetUah: 800 }), turn.deps);

  assert.equal(output.updatedPlan?.products.some((product) => product.name.startsWith("Чипси")), false);
  assert.match(output.responseText, /Щоб вкластися в бюджет, не додано: «чипси»/);
  assert.ok((output.updatedPlan?.totalUah ?? 0) <= 800);
});

test("event: follow-up product requests are shared by all members", async () => {
  const fake = createFakeSilpo();
  const turn = deps(fake, [
    [ROUTER, () => ({ kind: "change", productOps: [add("кетчуп", "кетчуп")] })],
    [PICK, pickByName],
  ]);
  const output = await runTurn(input({ mode: "EVENT", message: "додай кетчуп" }), turn.deps);
  assert.deepEqual(output.updatedPlan?.products[0].assignedMemberIds, ["anna", "bohdan"]);
});
