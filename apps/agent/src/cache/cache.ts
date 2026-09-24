/**
 * Two-level cache for catalog lookups, recipes, and learned product choices.
 *
 * L1 is a bounded in-process map (fast, lost on restart, per instance). L2 is an optional shared store
 * (Supabase `agent_cache`) that survives restarts and serverless cold starts. Every read or write failure
 * degrades to a cache miss: caching must never break an agent turn.
 */

export interface CacheStore {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown, ttlMs: number): Promise<void>;
  delete(keys: string[]): Promise<void>;
}

export type CacheLevel = "l1" | "l2" | "both";

export type Cache = {
  get<T>(key: string, level?: CacheLevel): Promise<T | undefined>;
  set(key: string, value: unknown, ttlMs: number, level?: CacheLevel): Promise<void>;
  delete(keys: string[]): Promise<void>;
  /** Returns the cached value or runs `loader` once per key, even for concurrent callers. */
  getOrLoad<T>(key: string, ttlMs: number, loader: () => Promise<T>, options?: {
    level?: CacheLevel;
    shouldCache?: (value: T) => boolean;
  }): Promise<T>;
};

export function createMemoryStore(maxEntries = 2_000, now: () => number = Date.now): CacheStore {
  const entries = new Map<string, { value: unknown; expiresAt: number }>();
  return {
    async get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }
      // Map preserves insertion order; re-inserting marks the entry as most recently used.
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    async set(key, value, ttlMs) {
      entries.delete(key);
      entries.set(key, { value, expiresAt: now() + ttlMs });
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
    },
    async delete(keys) {
      for (const key of keys) entries.delete(key);
    },
  };
}

const disabledStore: CacheStore = {
  async get() { return undefined; },
  async set() {},
  async delete() {},
};

async function quietly<T>(label: string, operation: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    console.warn(`cache: ${label} failed`, error);
    return fallback;
  }
}

export function createCache({ l1, l2 = null, log = false }: { l1: CacheStore; l2?: CacheStore | null; log?: boolean }): Cache {
  const inflight = new Map<string, Promise<unknown>>();
  const l2Store = l2 ?? disabledStore;
  const kind = (key: string) => key.split(":", 1)[0];

  async function get<T>(key: string, level: CacheLevel = "both") {
    if (level !== "l2") {
      const hit = await quietly("l1 read", () => l1.get(key), undefined);
      if (hit !== undefined) return hit as T;
    }
    if (level === "l1") return undefined;
    const hit = await quietly("l2 read", () => l2Store.get(key), undefined);
    return hit as T | undefined;
  }

  async function set(key: string, value: unknown, ttlMs: number, level: CacheLevel = "both") {
    if (level !== "l2") await quietly("l1 write", () => l1.set(key, value, ttlMs), undefined);
    if (level !== "l1") await quietly("l2 write", () => l2Store.set(key, value, ttlMs), undefined);
  }

  return {
    get,
    set,
    async delete(keys) {
      if (!keys.length) return;
      await quietly("l1 delete", () => l1.delete(keys), undefined);
      await quietly("l2 delete", () => l2Store.delete(keys), undefined);
    },
    async getOrLoad<T>(key: string, ttlMs: number, loader: () => Promise<T>, options: {
      level?: CacheLevel;
      shouldCache?: (value: T) => boolean;
    } = {}) {
      const level = options.level ?? "both";
      const pending = inflight.get(key);
      if (pending) return pending as Promise<T>;
      const run = (async () => {
        const cached = await get<T>(key, level);
        if (cached !== undefined) {
          if (log) console.info(`cache hit ${kind(key)}`);
          // Promote a shared (L2) hit into this instance's L1 for the rest of its lifetime.
          if (level === "both") await quietly("l1 promote", () => l1.set(key, cached, ttlMs), undefined);
          return cached;
        }
        if (log) console.info(`cache miss ${kind(key)}`);
        const value = await loader();
        if (value !== undefined && (options.shouldCache?.(value) ?? true)) await set(key, value, ttlMs, level);
        return value;
      })();
      inflight.set(key, run);
      try {
        return await run;
      } finally {
        inflight.delete(key);
      }
    },
  };
}

/** A cache that never stores anything: used when caching is disabled and in tests that need fresh loads. */
export function createNoopCache(): Cache {
  return createCache({ l1: disabledStore, l2: null });
}

/** Stable cache-key fragment for free-text queries: case, punctuation, and spacing do not matter. */
export function normalizeKey(value: string) {
  return value.toLocaleLowerCase("uk").replace(/[’'`"«»]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export const cacheTtl = {
  toolSchemas: 60 * 60_000,
  deliveryContext: 5 * 60_000,
  search: 15 * 60_000,
  details: 30 * 60_000,
  learnedPick: 24 * 60 * 60_000,
  recipe: 7 * 24 * 60 * 60_000,
} as const;
