import { createSupabaseAdminClient } from "@silpo-party/silpo-mcp";

import type { CacheStore } from "./cache.ts";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

const CLEANUP_INTERVAL_MS = 10 * 60_000;

/** Shared L2 cache backed by the `agent_cache` table (service-role access only; see its migration). */
export function createSupabaseStore(client: AdminClient = createSupabaseAdminClient(), now: () => number = Date.now): CacheStore {
  let lastCleanup = 0;

  function cleanupExpired() {
    if (now() - lastCleanup < CLEANUP_INTERVAL_MS) return;
    lastCleanup = now();
    void client.from("agent_cache").delete().lt("expires_at", new Date(now()).toISOString())
      .then(({ error }) => { if (error) console.warn("cache: l2 cleanup failed", error); });
  }

  return {
    async get(key) {
      const { data, error } = await client.from("agent_cache").select("value, expires_at").eq("key", key).maybeSingle();
      if (error) throw error;
      cleanupExpired();
      if (!data || Date.parse(data.expires_at as string) <= now()) return undefined;
      return data.value as unknown;
    },
    async set(key, value, ttlMs) {
      const { error } = await client.from("agent_cache").upsert({
        key,
        value,
        expires_at: new Date(now() + ttlMs).toISOString(),
      });
      if (error) throw error;
    },
    async delete(keys) {
      const { error } = await client.from("agent_cache").delete().in("key", keys);
      if (error) throw error;
    },
  };
}
