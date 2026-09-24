import { createCache, createMemoryStore, createNoopCache, type Cache } from "./cache.ts";
import { createSupabaseStore } from "./supabase-store.ts";

export { cacheTtl, createNoopCache, normalizeKey, type Cache } from "./cache.ts";

let shared: Cache | null = null;

/** Process-wide agent cache. SILPO_CACHE_DISABLED=1 turns it off; L2 is used when Supabase is configured. */
export function agentCache(): Cache {
  if (shared) return shared;
  if (process.env.SILPO_CACHE_DISABLED === "1") {
    shared = createNoopCache();
    return shared;
  }
  const hasSupabase = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
  shared = createCache({
    l1: createMemoryStore(),
    l2: hasSupabase ? createSupabaseStore() : null,
    log: process.env.SILPO_DEBUG_LOG === "1",
  });
  return shared;
}
