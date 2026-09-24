import assert from "node:assert/strict";
import test from "node:test";

import { createCache, createMemoryStore, normalizeKey, type CacheStore } from "../src/cache/cache.ts";

test("memory entries expire after their TTL", async () => {
  let now = 0;
  const store = createMemoryStore(10, () => now);
  await store.set("k", "v", 100);
  assert.equal(await store.get("k"), "v");
  now = 101;
  assert.equal(await store.get("k"), undefined);
});

test("memory store evicts the least recently used entry", async () => {
  const store = createMemoryStore(2);
  await store.set("a", 1, 1_000);
  await store.set("b", 2, 1_000);
  await store.get("a");
  await store.set("c", 3, 1_000);
  assert.equal(await store.get("b"), undefined);
  assert.equal(await store.get("a"), 1);
});

test("concurrent loads of one key run the loader once", async () => {
  const cache = createCache({ l1: createMemoryStore() });
  let loads = 0;
  const loader = async () => {
    loads += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return "value";
  };
  const values = await Promise.all([cache.getOrLoad("k", 1_000, loader), cache.getOrLoad("k", 1_000, loader)]);
  assert.deepEqual(values, ["value", "value"]);
  assert.equal(loads, 1);
  assert.equal(await cache.getOrLoad("k", 1_000, loader), "value");
  assert.equal(loads, 1);
});

test("shouldCache keeps failures out of the cache", async () => {
  const cache = createCache({ l1: createMemoryStore() });
  let loads = 0;
  const loader = async () => { loads += 1; return { status: "error" }; };
  await cache.getOrLoad("k", 1_000, loader, { shouldCache: (value) => value.status !== "error" });
  await cache.getOrLoad("k", 1_000, loader, { shouldCache: (value) => value.status !== "error" });
  assert.equal(loads, 2);
});

test("shared L2 hits are promoted to L1 and delete clears both levels", async () => {
  const l1 = createMemoryStore();
  const l2 = createMemoryStore();
  await l2.set("k", "shared", 1_000);
  const cache = createCache({ l1, l2 });
  assert.equal(await cache.getOrLoad("k", 1_000, async () => "loaded"), "shared");
  assert.equal(await l1.get("k"), "shared");
  await cache.delete(["k"]);
  assert.equal(await l1.get("k"), undefined);
  assert.equal(await l2.get("k"), undefined);
});

test("a broken shared store degrades to a miss instead of failing", async () => {
  const broken: CacheStore = {
    get: async () => { throw new Error("db down"); },
    set: async () => { throw new Error("db down"); },
    delete: async () => { throw new Error("db down"); },
  };
  const cache = createCache({ l1: createMemoryStore(), l2: broken });
  assert.equal(await cache.getOrLoad("k", 1_000, async () => "loaded"), "loaded");
});

test("normalizeKey ignores case, punctuation, and spacing", () => {
  assert.equal(normalizeKey("  Сік «Апельсиновий»!! "), normalizeKey("сік апельсиновий"));
});
