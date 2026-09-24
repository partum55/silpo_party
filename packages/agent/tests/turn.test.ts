import assert from "node:assert/strict";
import test from "node:test";
import { createNoopCache } from "../src/cache/cache.ts";
import type { PlanningMode, TurnResult } from "../src/domain/contract.ts";
import { formatReply } from "../src/turn/reply.ts";
import { OUT_OF_SCOPE_RESPONSE, runTurn } from "../src/turn/run-turn.ts";
import { createCatalogSession } from "../src/silpo/catalog.ts";
import { createFakeLlm, pickByName } from "./helpers/fake-llm.ts";
import { createFakeSilpo } from "./helpers/fake-silpo.ts";

const ROUTER = "Interpret one chat message";
const PICK = "For each shopping need";
const RECIPE = "Write a practical home-cooked recipe";
const CHECKLIST = "Plan the complete shopping list";

const baseMembers = [{ id: "anna" }, { id: "bohdan" }];

function input(overrides: Record<string, unknown> & { message: string; mode: PlanningMode }) {
  return { actorId: "anna", members: baseMembers, ...overrides };
}

/** The chat reply as the web app writes it after saving the turn. */
const text = (output: TurnResult) => formatReply(output.reply, output.plan.totalUah);

/** Members with the wishes a dinner turn changed, as the web app stores them for the next turn. */
const withWishes = (output: TurnResult) => baseMembers.map((member) => ({
  ...member,
  wishes: output.changedWishes.find((changed) => changed.memberId === member.id)?.wishes ?? [],
}));

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

  assert.deepEqual(output.plan.products.map((product) => product.name), [
    "Цукерки желейні Roshen 150 г",
    "Картопля біла",
    "Сік Sandora апельсиновий 0,95 л",
  ]);
  assert.ok(output.plan.products.every((product) => product.assignedMemberIds.join() === "anna"));
  assert.ok(output.plan.products.every((product) => product.slug));
  assert.match(text(output), /^Додано:\n• «Цукерки желейні Roshen 150 г» ×1\n• «Картопля біла» 1 кг/);
});

test("shopping: a partial Silpo failure keeps the successful items and explains the rest", async () => {
  const fake = createFakeSilpo({ failQueries: ["цукерки желейні"] });
  const { deps: turnDeps } = deps(fake, [
    [ROUTER, () => ({ kind: "change", productOps: [add("желейки", "цукерки желейні"), add("картопля", "картопля")] })],
    [PICK, pickByName],
  ]);
  const output = await runTurn(input({ mode: "SHOPPING", message: "желейки і картопля" }), turnDeps);

  assert.deepEqual(output.plan.products.map((product) => product.name), ["Картопля біла"]);
  assert.match(text(output), /Не додано:\n• «желейки» — Сільпо не відповів/);
});

test("shopping: when the model is down, a plain list is still split and added", async () => {
  const fake = createFakeSilpo();
  const { deps: turnDeps } = deps(fake, [[ROUTER, () => null], [PICK, () => null]]);
  const output = await runTurn(input({ mode: "SHOPPING", message: "картопля, буряк" }), turnDeps);
  assert.deepEqual(output.plan.products.map((product) => product.name), ["Картопля біла", "Буряк столовий"]);
});

test("shopping: removing an item keeps other members' products", async () => {
  const fake = createFakeSilpo();
  const first = deps(fake, [
    [ROUTER, () => ({ kind: "change", productOps: [add("картопля", "картопля")] })],
    [PICK, pickByName],
  ]);
  const afterAnna = await runTurn(input({ mode: "SHOPPING", message: "картопля" }), first.deps);
  const afterBohdan = await runTurn(input({ mode: "SHOPPING", actorId: "bohdan", message: "картопля", plan: afterAnna.plan }), first.deps);
  assert.equal(afterBohdan.plan.products.length, 2);

  const remove = deps(fake, [[ROUTER, () => ({ kind: "change", productOps: [{ action: "remove", label: "картопля", query: "картопля", target: "картопля" }] })]]);
  const output = await runTurn(input({ mode: "SHOPPING", message: "прибери картоплю", plan: afterBohdan.plan }), remove.deps);
  assert.deepEqual(output.plan.products.map((product) => product.assignedMemberIds), [["bohdan"]]);
  assert.match(text(output), /Прибрано:\n• «Картопля біла»/);
});

test("a Silpo connection problem is reported once, with an action for the host", async () => {
  const fake = createFakeSilpo();
  const { deps: turnDeps } = deps(fake, [[ROUTER, () => ({ kind: "change", productOps: [add("картопля", "картопля"), add("сік", "сік апельсиновий")] })]]);
  const output = await runTurn(input({ mode: "SHOPPING", message: "картопля і сік" }), {
    ...turnDeps,
    withSession: async () => { throw new Error("Silpo connection must be renewed"); },
  });
  assert.equal(text(output), "Потрібно заново підключити акаунт Сільпо організатора. Не додано: «картопля», «сік».");
});

test("off-topic messages get the fixed reply and leave the plan alone", async () => {
  const fake = createFakeSilpo();
  const { deps: turnDeps } = deps(fake, [[ROUTER, () => ({ kind: "off_topic" })]]);
  const output = await runTurn(input({ mode: "SHOPPING", message: "розв'яжи рівняння" }), turnDeps);
  assert.equal(text(output), OUT_OF_SCOPE_RESPONSE);
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
  assert.deepEqual(first.changedWishes.find((member) => member.memberId === "anna")?.wishes.map((wish) => wish.text), ["карбонара"]);
  assert.deepEqual(first.plan.products.map((product) => product.name).sort(), [
    "Бекон сирокопчений 150 г",
    "Спагеті Barilla 500 г",
    "Яйця курячі 10 шт",
  ]);
  assert.match(text(first), /Рецепт «Паста карбонара» \(1 порц\.\):/);
  assert.doesNotMatch(text(first), /сіль|перець/);

  const members = withWishes(first);
  const second = await runTurn(input({ mode: "DINNER", actorId: "bohdan", message: "а я борщ", members, plan: first.plan }), turn.deps);
  const products = second.plan.products;
  assert.equal(products.length, 5);
  assert.deepEqual(products.find((product) => product.name === "Буряк столовий")?.assignedMemberIds, ["bohdan"]);
  assert.deepEqual(products.find((product) => product.name.startsWith("Бекон"))?.assignedMemberIds, ["anna"]);
  assert.equal(second.plan.recipes.length, 2);
});

test("dinner: members who want the same dish share it and its ingredient quantities grow", async () => {
  const fake = createFakeSilpo();
  const turn = deps(fake, [
    [ROUTER, () => ({ kind: "change", dishOps: [{ action: "add", dish: "карбонара" }] })],
    [RECIPE, () => carbonara],
    [PICK, pickByName],
  ]);
  const first = await runTurn(input({ mode: "DINNER", message: "карбонара" }), turn.deps);
  const members = withWishes(first);
  const second = await runTurn(input({ mode: "DINNER", actorId: "bohdan", message: "я теж карбонару", members, plan: first.plan }), turn.deps);

  assert.equal(second.plan.recipes.length, 1);
  assert.deepEqual(second.plan.recipes[0].assignedMemberIds, ["anna", "bohdan"]);
  const bacon = second.plan.products.find((product) => product.name.startsWith("Бекон"))!;
  // 200 g for 4 servings -> 100 g for two people -> one 150 g pack.
  assert.equal(bacon.quantity, 1);
  assert.deepEqual(bacon.assignedMemberIds, ["anna", "bohdan"]);
});

test("dinner: more servings rescale ingredient rows from the recipe instead of doubling packages", async () => {
  const fake = createFakeSilpo();
  const turn = deps(fake, [
    [ROUTER, (data) => ({ kind: "change", dishOps: [{ action: "add", dish: "карбонара", servings: data.message.includes("3") ? 3 : null }] })],
    [RECIPE, () => carbonara],
    [PICK, pickByName],
  ]);
  const first = await runTurn(input({ mode: "DINNER", message: "карбонара" }), turn.deps);
  const bigger = await runTurn(input({ mode: "DINNER", message: "на 3 порції", members: withWishes(first), plan: first.plan }), turn.deps);

  assert.equal(bigger.plan.recipes.length, 1);
  assert.equal(bigger.plan.recipes[0].servings, 3);
  // 200 g for 4 servings -> 150 g for three -> still one 150 g pack.
  assert.equal(bigger.plan.products.find((product) => product.name.startsWith("Бекон"))?.quantity, 1);
  assert.match(text(bigger), /Рецепт «Паста карбонара» \(3 порц\.\):/);
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
  const removed = await runTurn(input({ mode: "DINNER", message: "прибери бекон", plan: first.plan }), turn.deps);
  assert.equal(removed.plan.products.some((product) => product.name.startsWith("Бекон")), false);
  assert.deepEqual(removed.plan.recipes[0].missingIngredients?.map((item) => item.name), ["бекон"]);

  const members = withWishes(first);
  const more = await runTurn(input({ mode: "DINNER", actorId: "bohdan", message: "борщ", members, plan: removed.plan }), turn.deps);
  assert.equal(more.plan.products.some((product) => product.name.startsWith("Бекон")), false);
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
  const products = output.plan.products;

  assert.equal(products.length, 5);
  assert.ok(products.every((product) => product.assignedMemberIds.join() === "anna,bohdan"));
  // 300 g x 6 people = 1.8 kg of pork sold per kilogram -> 2 kg.
  assert.equal(products.find((product) => product.name.startsWith("Свинина"))?.quantity, 2);
  // 500 ml x 6 = 3 l of 1.5 l bottles -> 2 bottles.
  assert.equal(products.find((product) => product.name.startsWith("Вода"))?.quantity, 2);
  assert.match(text(output), /розраховано на 6 осіб/);
});

test("event: extras are dropped first to fit the budget", async () => {
  const fake = createFakeSilpo();
  const turn = deps(fake, [
    [ROUTER, (data) => ({ kind: "change", planEvent: { brief: data.message } })],
    [CHECKLIST, () => shashlikChecklist],
    [PICK, pickByName],
  ]);
  const output = await runTurn(input({ mode: "EVENT", message: "шашлики на 6", budgetUah: 800 }), turn.deps);

  assert.equal(output.plan.products.some((product) => product.name.startsWith("Чипси")), false);
  assert.match(text(output), /Щоб вкластися в бюджет, не додано: «чипси»/);
  assert.ok((output.plan.totalUah ?? 0) <= 800);
});

test("event: follow-up product requests are shared by all members", async () => {
  const fake = createFakeSilpo();
  const turn = deps(fake, [
    [ROUTER, () => ({ kind: "change", productOps: [add("кетчуп", "кетчуп")] })],
    [PICK, pickByName],
  ]);
  const output = await runTurn(input({ mode: "EVENT", message: "додай кетчуп" }), turn.deps);
  assert.deepEqual(output.plan.products[0].assignedMemberIds, ["anna", "bohdan"]);
});

test("the router sees the recent chat, labelled relative to the sender, to resolve references", async () => {
  const fake = createFakeSilpo();
  let seen: unknown = null;
  const { deps: turnDeps } = deps(fake, [
    [ROUTER, (data) => { seen = data.recentMessages; return { kind: "change", productOps: [add("картопля", "картопля")] }; }],
    [PICK, pickByName],
  ]);
  await runTurn(input({
    mode: "SHOPPING",
    message: "поверни як було",
    recentMessages: [
      { from: "member", memberId: "anna", text: "заміни картоплю на буряк" },
      { from: "member", memberId: "bohdan", text: "а мені сік" },
      { from: "agent", text: "Прибрано:\n• «Картопля біла»" },
    ],
  }), turnDeps);
  assert.deepEqual(seen, [
    { from: "this member", text: "заміни картоплю на буряк" },
    { from: "another member", text: "а мені сік" },
    { from: "agent", text: "Прибрано:\n• «Картопля біла»" },
  ]);
});

test("shopping: a replacement that finds only the same product, or nothing, keeps the original", async () => {
  const fake = createFakeSilpo();
  const first = deps(fake, [[ROUTER, () => ({ kind: "change", productOps: [add("картопля", "картопля")] })], [PICK, pickByName]]);
  const before = await runTurn(input({ mode: "SHOPPING", message: "картопля" }), first.deps);

  for (const query of ["картопля", "трюфелі"]) {
    const replace = deps(fake, [
      [ROUTER, () => ({ kind: "change", productOps: [{ action: "replace", label: query, query, target: "картопля" }] })],
      [PICK, pickByName],
    ]);
    const output = await runTurn(input({ mode: "SHOPPING", message: `заміни картоплю на ${query}`, plan: before.plan }), replace.deps);
    assert.deepEqual(output.plan.products.map((product) => [product.name, product.quantity]), [["Картопля біла", 1]]);
    assert.doesNotMatch(text(output), /Прибрано/);
    assert.match(text(output), /Не знайшов іншого товару замість «Картопля біла», тому залишив його\./);
  }
});

test("restrictions: the payers' profile restrictions choose the product, and unverified ones are named in the reply", async () => {
  const fake = createFakeSilpo();
  const { deps: turnDeps } = deps(fake, [
    [ROUTER, () => ({ kind: "change", productOps: [add("печиво", "печиво"), add("крекер", "крекер")] })],
    [PICK, (data) => ({ choices: data.needs.map((need: { key: string }) => ({ key: need.key, index: 0 })) })],
  ]);
  const output = await runTurn(input({ mode: "SHOPPING", message: "печиво і крекер" }), {
    ...turnDeps,
    foodRestrictions: async (memberId: string) => memberId === "anna" ? ["горіхи"] : [],
  });
  assert.deepEqual(output.plan.products.map((product) => product.name), ["Печиво вершкове", "Крекер солоний"]);
  assert.match(text(output), /Перевірте склад \(у Сільпо немає даних про нього\):\n• «Крекер солоний» — горіхи/);
});

test("restrictions: a recipe is asked to respect the eaters' restrictions, and an unreadable profile is reported", async () => {
  const fake = createFakeSilpo();
  const turn = deps(fake, [
    [ROUTER, () => ({ kind: "change", dishOps: [{ action: "add", dish: "карбонара" }] })],
    [RECIPE, () => carbonara],
    [PICK, pickByName],
  ]);
  const output = await runTurn(input({ mode: "DINNER", message: "карбонара" }), {
    ...turn.deps,
    foodRestrictions: async (memberId: string) => {
      if (memberId === "bohdan") throw new Error("Silpo connection must be renewed");
      return ["lactose"];
    },
  });
  const recipeTask = turn.prompts.find((task) => task.instructions.includes(RECIPE))!;
  assert.deepEqual((recipeTask.data as { restrictions?: string[] }).restrictions, ["lactose"]);
  assert.match(text(output), /Не вдалося прочитати харчові обмеження одного учасника з Сільпо/);
});
