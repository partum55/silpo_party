import assert from "node:assert/strict";
import test from "node:test";

import { createCache, createMemoryStore, createNoopCache } from "../src/cache/cache.ts";
import { hasBrand, namesQuery, resolveItems, type ItemNeed } from "../src/turn/resolve-items.ts";
import { createCatalogSession } from "../src/silpo/catalog.ts";
import { createFakeLlm, pickByName } from "./helpers/fake-llm.ts";
import { createFakeSilpo } from "./helpers/fake-silpo.ts";

const need = (key: string, label: string, query: string, extra: Partial<ItemNeed> = {}): ItemNeed => ({
  key, label, query, assignedMemberIds: ["member-a"], ...extra,
});

// The request from the bug report: "желейки, картопля і апельсиновий сік".
const reportNeeds = [
  need("0", "желейки", "цукерки желейні"),
  need("1", "картопля", "картопля", { requested: { amount: 2000, unit: "g" } }),
  need("2", "апельсиновий сік", "сік апельсиновий"),
];

test("resolves the reported three-item list with one batch search", async () => {
  const fake = createFakeSilpo();
  const { llm } = createFakeLlm([["For each shopping need", pickByName]]);
  const result = await resolveItems(reportNeeds, {
    session: createCatalogSession({ userId: "host", client: fake.client, schemas: fake.schemas, cache: createNoopCache() }),
    llm,
  });

  assert.deepEqual(result.unresolved, []);
  assert.deepEqual(result.resolved.map((item) => item.product.name), [
    "Цукерки желейні Roshen 150 г",
    "Картопля біла",
    "Сік Sandora апельсиновий 0,95 л",
  ]);
  // 2 kg of loose potatoes priced per kilogram.
  assert.equal(result.resolved[1].quantity, 2);
  assert.equal(result.resolved[1].lineTotalUah, 49.8);
  assert.equal(fake.calls.filter((call) => call.name === "silpo_find_products_batch").length, 1);
});

test("one failing Silpo search leaves the other items resolved", async () => {
  const fake = createFakeSilpo({ failQueries: ["цукерки желейні"] });
  const { llm } = createFakeLlm([["For each shopping need", pickByName]]);
  const result = await resolveItems(reportNeeds, {
    session: createCatalogSession({ userId: "host", client: fake.client, schemas: fake.schemas, cache: createNoopCache() }),
    llm,
  });

  assert.deepEqual(result.resolved.map((item) => item.need.label), ["картопля", "апельсиновий сік"]);
  assert.deepEqual(result.unresolved.map((item) => [item.need.label, item.reason]), [["желейки", "mcp_error"]]);
});

test("reports a missing product with its own reason", async () => {
  const fake = createFakeSilpo();
  const result = await resolveItems([need("0", "трюфелі", "трюфелі чорні")], {
    session: createCatalogSession({ userId: "host", client: fake.client, schemas: fake.schemas, cache: createNoopCache() }),
    llm: null,
  });
  assert.deepEqual(result.unresolved.map((item) => item.reason), ["no_results"]);
});

test("the model can reject every candidate, which yields suggestions instead of a wrong product", async () => {
  const fake = createFakeSilpo();
  const { llm } = createFakeLlm([["For each shopping need", (data) => ({ choices: data.needs.map((item: { key: string }) => ({ key: item.key, index: null })) })]]);
  const result = await resolveItems([need("0", "картопля фрі", "картопля")], {
    session: createCatalogSession({ userId: "host", client: fake.client, schemas: fake.schemas, cache: createNoopCache() }),
    llm,
  });
  assert.equal(result.unresolved[0]?.reason, "no_match");
  assert.deepEqual(result.unresolved[0]?.suggestions, ["Картопля біла", "Чипси Lay's картопляні 120 г"]);
});

test("without a usable model, the top search result is used", async () => {
  const fake = createFakeSilpo();
  const { llm } = createFakeLlm([["For each shopping need", () => null]]);
  const result = await resolveItems([need("0", "картопля", "картопля")], {
    session: createCatalogSession({ userId: "host", client: fake.client, schemas: fake.schemas, cache: createNoopCache() }),
    llm,
  });
  assert.equal(result.resolved[0]?.product.name, "Картопля біла");
  assert.equal(result.resolved[0]?.via, "top");
});

test("without a usable model, a fuzzy top hit of the wrong kind is skipped for one that names the request", async () => {
  const fake = createFakeSilpo();
  const { llm } = createFakeLlm([["For each shopping need", () => null]]);
  const result = await resolveItems([need("0", "шампури", "шампури")], {
    session: createCatalogSession({ userId: "host", client: fake.client, schemas: fake.schemas, cache: createNoopCache() }),
    llm,
  });
  assert.equal(result.resolved[0]?.product.name, "Шампури бамбукові 30 см 100 шт");
});

test("without a usable model, a lone wrong hit is reported instead of added", async () => {
  const fake = createFakeSilpo();
  const { llm } = createFakeLlm([["For each shopping need", () => null]]);
  const result = await resolveItems([need("0", "шампур", "шампур")], {
    session: createCatalogSession({ userId: "host", client: fake.client, schemas: fake.schemas, cache: createNoopCache() }),
    llm,
  });
  assert.deepEqual(result.resolved, []);
  assert.deepEqual(result.unresolved.map((item) => item.reason), ["timeout"]);
});

test("namesQuery tolerates inflection and word order but not a shared prefix", () => {
  assert.equal(namesQuery({ name: "Вода мінеральна Borjomi" }, "мінеральна вода"), true);
  assert.equal(namesQuery({ name: "Шампури бамбукові" }, "шампури"), true);
  assert.equal(namesQuery({ name: "Шампунь проти лупи" }, "шампури"), false);
});

test("a learned choice skips search and model selection on the next request", async () => {
  const cache = createCache({ l1: createMemoryStore() });
  const first = createFakeSilpo();
  const { llm, prompts } = createFakeLlm([["For each shopping need", pickByName]]);
  await resolveItems([need("0", "картопля", "картопля")], {
    session: createCatalogSession({ userId: "host", client: first.client, schemas: first.schemas, cache }),
    llm,
    cache,
  });
  assert.equal(prompts.length, 1);

  const second = createFakeSilpo();
  const result = await resolveItems([need("0", "картопля", "картопля")], {
    session: createCatalogSession({ userId: "host", client: second.client, schemas: second.schemas, cache }),
    llm,
    cache,
  });
  assert.equal(result.resolved[0]?.via, "learned");
  assert.equal(prompts.length, 1);
  assert.equal(second.calls.filter((call) => call.name === "silpo_find_products_batch").length, 0);
});

test("a learned choice that became unavailable is forgotten and searched again", async () => {
  const cache = createCache({ l1: createMemoryStore() });
  const first = createFakeSilpo();
  const { llm } = createFakeLlm([["For each shopping need", pickByName]]);
  await resolveItems([need("0", "картопля", "картопля")], {
    session: createCatalogSession({ userId: "host", client: first.client, schemas: first.schemas, cache }),
    llm,
    cache,
  });

  const second = createFakeSilpo({ unavailable: ["kartoplia-bila"] });
  const secondSession = createCatalogSession({ userId: "host", client: second.client, schemas: second.schemas, cache: createNoopCache() });
  const result = await resolveItems([need("0", "картопля", "картопля")], { session: secondSession, llm, cache });
  assert.equal(result.resolved[0]?.via === "learned", false);
  assert.equal(second.calls.filter((call) => call.name === "silpo_find_products_batch").length, 1);
});

test("a named brand filters candidates before the model sees them, even a model that takes the first hit", async () => {
  const fake = createFakeSilpo();
  const firstHit = (data: { needs: Array<{ key: string }> }) => ({ choices: data.needs.map((entry) => ({ key: entry.key, index: 0 })) });
  const { llm } = createFakeLlm([["For each shopping need", firstHit]]);
  const session = createCatalogSession({ userId: "host", client: fake.client, schemas: fake.schemas, cache: createNoopCache() });

  const oldSpice = await resolveItems([need("0", "old spice", "гель для душу", { brand: "Old Spice" })], { session, llm });
  assert.equal(oldSpice.resolved[0]?.product.name, "Гель для душу-шампунь Old Spice 2в1 Bearglove");
});

test("when no name spells the brand as written, the model must confirm it, and without it nothing is bought", async () => {
  const fake = createFakeSilpo();
  const session = createCatalogSession({ userId: "host", client: fake.client, schemas: fake.schemas, cache: createNoopCache() });
  const { llm, prompts } = createFakeLlm([["For each shopping need", (data) => ({ choices: data.needs.map((entry: { key: string }) => ({ key: entry.key, index: null })) })]]);

  const nivea = await resolveItems([need("0", "nivea", "гель для душу", { brand: "Nivea" })], { session, llm });
  assert.equal((prompts[0].data as { needs: Array<{ mustBeBrand?: string }> }).needs[0].mustBeBrand, "Nivea");
  assert.deepEqual(nivea.resolved, []);
  assert.deepEqual(nivea.unresolved.map((item) => [item.reason, item.suggestions]), [
    ["no_brand", ["Гель для душу Palmolive з ожиною", "Гель для душу-шампунь Old Spice 2в1 Bearglove"]],
  ]);

  const { llm: down } = createFakeLlm([["For each shopping need", () => null]]);
  const guessed = await resolveItems([need("0", "nivea", "гель для душу", { brand: "Nivea" })], { session, llm: down });
  assert.deepEqual(guessed.unresolved.map((item) => item.reason), ["no_brand"]);
});

test("hasBrand ignores case, spaces, and punctuation", () => {
  assert.equal(hasBrand("Напій COCA COLA 1 л", "Coca-Cola"), true);
  assert.equal(hasBrand("Шоколад молочний Milka з малиною", "milka"), true);
  assert.equal(hasBrand("Гель для душу Palmolive", "Old Spice"), false);
});

test("restrictions: conflicting products are dropped and confirmed-safe ones win, even over the model's first pick", async () => {
  const fake = createFakeSilpo();
  const firstHit = (data: { needs: Array<{ key: string }> }) => ({ choices: data.needs.map((entry) => ({ key: entry.key, index: 0 })) });
  const { llm } = createFakeLlm([["For each shopping need", firstHit]]);
  const session = createCatalogSession({ userId: "host", client: fake.client, schemas: fake.schemas, cache: createNoopCache() });

  const result = await resolveItems([need("0", "печиво", "печиво", { restrictions: ["горіхи"] })], { session, llm });
  assert.equal(result.resolved[0]?.product.name, "Печиво вершкове");
  assert.deepEqual(result.resolved[0]?.unverifiedRestrictions, []);
});

test("restrictions: a product without composition data is bought but flagged; one that conflicts is not bought", async () => {
  const fake = createFakeSilpo();
  const { llm } = createFakeLlm([["For each shopping need", pickByName]]);
  const session = createCatalogSession({ userId: "host", client: fake.client, schemas: fake.schemas, cache: createNoopCache() });

  const result = await resolveItems([
    need("0", "крекер", "крекер", { restrictions: ["горіхи"] }),
    need("1", "паста горіхова", "паста горіхова", { restrictions: ["горіхи"] }),
  ], { session, llm });
  assert.deepEqual(result.resolved.map((item) => [item.product.name, item.unverifiedRestrictions]), [["Крекер солоний", ["горіхи"]]]);
  assert.deepEqual(result.unresolved.map((item) => [item.need.label, item.reason]), [["паста горіхова", "restricted"]]);
});
