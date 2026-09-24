import assert from "node:assert/strict";
import test from "node:test";

import { createCache, createMemoryStore, createNoopCache } from "../src/cache/cache.ts";
import { createCatalogSession, splitBatchSearch } from "../src/silpo/catalog.ts";
import { createFakeSilpo } from "./helpers/fake-silpo.ts";

const session = (fake: ReturnType<typeof createFakeSilpo>, cache = createNoopCache(), fresh = false) =>
  createCatalogSession({ userId: "host", client: fake.client, schemas: fake.schemas, cache, fresh });

const searchCalls = (fake: ReturnType<typeof createFakeSilpo>) => fake.calls.filter((call) => call.name === "silpo_find_products_batch");

test("searches several queries in one batch call and attributes results to each query", async () => {
  const fake = createFakeSilpo();
  const results = await session(fake).search(["картопля", "сік апельсиновий", "цукерки желейні"]);

  assert.equal(searchCalls(fake).length, 1);
  assert.deepEqual(results.get("картопля")?.matches.map((match) => match.externalProductId), ["101", "102"]);
  assert.deepEqual(results.get("сік апельсиновий")?.matches.map((match) => match.name), ["Сік Sandora апельсиновий 0,95 л"]);
  assert.equal(results.get("цукерки желейні")?.status, "ok");
});

test("understands positional batch responses", async () => {
  const fake = createFakeSilpo({ shape: "positional" });
  const results = await session(fake).search(["картопля", "сік апельсиновий"]);
  assert.equal(searchCalls(fake).length, 1);
  assert.equal(results.get("сік апельсиновий")?.matches[0]?.slug, "sik-sandora-apelsyn");
});

test("falls back to one call per query when a batch response cannot be attributed", async () => {
  const fake = createFakeSilpo({ shape: "flat" });
  const results = await session(fake).search(["картопля", "сік апельсиновий"]);
  assert.equal(searchCalls(fake).length, 3);
  assert.deepEqual(results.get("картопля")?.matches.map((match) => match.externalProductId), ["101", "102"]);
});

test("a failing query does not break the other queries", async () => {
  const fake = createFakeSilpo({ failQueries: ["цукерки желейні"] });
  const results = await session(fake).search(["картопля", "цукерки желейні", "сік апельсиновий"]);

  assert.equal(results.get("цукерки желейні")?.status, "error");
  assert.equal(results.get("картопля")?.status, "ok");
  assert.equal(results.get("сік апельсиновий")?.status, "ok");
});

test("keeps an empty result distinct from an error", async () => {
  const fake = createFakeSilpo();
  const results = await session(fake).search(["неіснуючий товар"]);
  assert.equal(results.get("неіснуючий товар")?.status, "empty");
});

test("normalizes loose weighted produce that has no explicit package size", async () => {
  const fake = createFakeSilpo();
  const catalog = session(fake);
  const matches = (await catalog.search(["картопля"])).get("картопля")!.matches;
  const outcome = (await catalog.details(matches)).get("101");

  assert.equal(outcome?.status, "ok");
  if (outcome?.status !== "ok") return;
  assert.equal(outcome.product.name, "Картопля біла");
  assert.equal(outcome.product.weighted, true);
  assert.deepEqual(outcome.product.packageSize, { amount: 1000, unit: "g" });
  assert.equal(outcome.product.lookupProductId, "101");
  assert.equal(outcome.product.slug, "kartoplia-bila");
  assert.equal(outcome.product.companyId, "c1");
});

test("uses search data when the details call fails", async () => {
  const fake = createFakeSilpo({ failDetails: ["sik-sandora-apelsyn"] });
  const catalog = session(fake);
  const matches = (await catalog.search(["сік апельсиновий"])).get("сік апельсиновий")!.matches;
  const outcome = (await catalog.details(matches)).get("201");

  assert.equal(outcome?.status, "ok");
  if (outcome?.status === "ok") {
    assert.equal(outcome.source, "search");
    assert.equal(outcome.product.priceUah, 64.5);
  }
});

test("reports unavailable products separately", async () => {
  const fake = createFakeSilpo({ unavailable: ["tsukerky-zhele"] });
  const catalog = session(fake);
  const matches = (await catalog.search(["цукерки желейні"])).get("цукерки желейні")!.matches;
  assert.equal((await catalog.details(matches)).get("301")?.status, "unavailable");
});

test("refreshes a planned product by slug without searching", async () => {
  const fake = createFakeSilpo();
  const outcome = await session(fake).refresh({ id: "p-juice", lookupProductId: "201", slug: "sik-sandora-apelsyn", name: "Сік" });
  assert.equal(outcome.status, "ok");
  assert.equal(searchCalls(fake).length, 0);
});

test("refreshes a legacy product without slug by searching its name", async () => {
  const fake = createFakeSilpo();
  const outcome = await session(fake).refresh({ id: "p-juice", lookupProductId: "201", name: "сік апельсиновий" });
  assert.equal(outcome.status, "ok");
  assert.equal(searchCalls(fake).length, 1);
});

test("caches searches, details, and delivery context across sessions", async () => {
  const cache = createCache({ l1: createMemoryStore() });
  const first = createFakeSilpo();
  const one = session(first, cache);
  await one.details((await one.search(["картопля"])).get("картопля")!.matches);

  const second = createFakeSilpo();
  const two = session(second, cache);
  await two.details((await two.search(["картопля"])).get("картопля")!.matches);
  assert.deepEqual(second.calls, []);
});

test("a fresh session ignores the cache", async () => {
  const cache = createCache({ l1: createMemoryStore() });
  const first = createFakeSilpo();
  await session(first, cache).search(["картопля"]);

  const second = createFakeSilpo();
  await session(second, cache, true).search(["картопля"]);
  assert.equal(searchCalls(second).length, 1);
});

test("splitBatchSearch returns null for unattributable multi-query payloads", () => {
  assert.equal(splitBatchSearch({ items: [{ id: "a", externalProductId: 1 }] }, ["a", "b"]), null);
});
