import assert from "node:assert/strict";
import test from "node:test";

import { createCache, createMemoryStore, createNoopCache } from "../src/cache/cache.ts";
import { resolveItems, type ItemNeed } from "../src/pipeline/resolve-items.ts";
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
