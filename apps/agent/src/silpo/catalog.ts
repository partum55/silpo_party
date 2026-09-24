import { getAuthenticatedSilpoMcpClient } from "@silpo-party/silpo-mcp";

import { agentCache, cacheTtl, createNoopCache, normalizeKey, type Cache } from "../cache/index.ts";
import type { CatalogProduct } from "../domain/plan.ts";
import {
  call,
  cartContext,
  field,
  getFinalCart,
  listSilpoToolSchemas,
  normalizeSilpoProduct,
  objects,
  serializeSilpoOperation,
  syncCartProducts,
  text,
  type CartLineItem,
  type DeliveryContext,
  type JsonObject,
  type SilpoClient,
  type SilpoToolSchemas,
  type ToolClient,
} from "./gateway.ts";

export type SearchMatch = {
  externalProductId: string;
  id: string;
  slug: string | null;
  companyId: string | null;
  name: string | null;
  raw: JsonObject;
};

export type SearchOutcome = { status: "ok" | "empty" | "error"; matches: SearchMatch[]; error?: string };

export type DetailsOutcome =
  | { status: "ok" | "unavailable"; product: CatalogProduct; source: "details" | "search" }
  | { status: "not_found" | "error"; error?: string };

export type RefreshTarget = { id: string; lookupProductId?: string; slug?: string; name: string };

export type CatalogSession = {
  context(): Promise<DeliveryContext>;
  /** Searches every query; a failure affects only the queries it belongs to. Keyed by the original query. */
  search(queries: string[]): Promise<Map<string, SearchOutcome>>;
  /** Loads live details for search matches. Keyed by externalProductId. */
  details(matches: SearchMatch[]): Promise<Map<string, DetailsOutcome>>;
  /** Re-reads a product already in a plan: by slug when known, otherwise by searching its name. */
  refresh(target: RefreshTarget): Promise<DetailsOutcome>;
  /** Drops cached catalog data for products found unavailable, so the next turn does not reuse them. */
  forget(products: Array<{ slug?: string | null }>): Promise<void>;
  syncCart(items: CartLineItem[]): Promise<unknown>;
  finalCart(): Promise<unknown>;
};

const DETAILS_CONCURRENCY = 4;
const SEARCH_FALLBACK_CONCURRENCY = 3;
const DEFAULT_BATCH_SIZE = 8;
const SEARCH_LIMIT = 10;
const debug = () => process.env.SILPO_DEBUG_LOG === "1";

function debugLog(label: string, payload: unknown) {
  if (!debug()) return;
  let serialized: string;
  try { serialized = JSON.stringify(payload); } catch { serialized = String(payload); }
  console.info(`silpo ${label}: ${serialized.slice(0, 4000)}`);
}

export async function mapLimit<T, R>(items: T[], limit: number, operation: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await operation(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Every product-like object in a search payload, deduplicated by Silpo's external product id. */
export function searchMatches(payload: unknown): SearchMatch[] {
  const seen = new Set<string>();
  return objects(payload).flatMap((candidate) => {
    const external = field(candidate, ["externalProductId"]);
    if (typeof external !== "string" && typeof external !== "number") return [];
    const externalProductId = String(external);
    const id = field(candidate, ["id", "productId"]);
    if (seen.has(externalProductId) || (typeof id !== "string" && typeof id !== "number")) return [];
    seen.add(externalProductId);
    return [{
      externalProductId,
      id: String(id),
      slug: text(field(candidate, ["slug"])),
      companyId: text(field(candidate, ["companyId"])),
      name: text(field(candidate, ["name", "title"])),
      raw: candidate,
    }];
  });
}

const queryFieldNames = ["query", "searchQuery", "searchTerm", "term", "request", "input", "keyword", "product", "productName", "text"];

/**
 * Splits one batch-search payload into per-query match lists. Understands both a keyed shape (each group
 * names its query) and a positional one (one group per query, in request order). Returns null when the
 * payload cannot be attributed confidently; the caller then searches each query separately.
 */
export function splitBatchSearch(payload: unknown, queries: string[]): Map<string, SearchMatch[]> | null {
  if (queries.length === 1) return new Map([[queries[0], searchMatches(payload)]]);
  const byKey = new Map(queries.map((query) => [normalizeKey(query), query]));
  const keyed = new Map<string, SearchMatch[]>();
  for (const candidate of objects(payload)) {
    if (field(candidate, ["externalProductId"]) !== undefined) continue;
    const label = queryFieldNames.map((name) => field(candidate, [name])).find((value) => typeof value === "string");
    const query = typeof label === "string" ? byKey.get(normalizeKey(label)) : undefined;
    if (query && !keyed.has(query)) keyed.set(query, searchMatches(candidate));
  }
  if (keyed.size) return new Map(queries.map((query) => [query, keyed.get(query) ?? []]));

  const positional = [payload, ...objects(payload).flatMap((candidate) => Object.values(candidate))]
    .find((value): value is unknown[] => Array.isArray(value) && value.length === queries.length
      && value.every((entry) => Array.isArray(entry) || (Boolean(entry) && typeof entry === "object" && field(entry as JsonObject, ["externalProductId"]) === undefined)));
  if (positional) return new Map(queries.map((query, index) => [query, searchMatches(positional[index])]));
  return null;
}

function batchSize(schemas: SilpoToolSchemas) {
  const products = schemas.get("silpo_find_products_batch")?.properties?.products as { maxItems?: unknown } | undefined;
  const max = typeof products?.maxItems === "number" ? products.maxItems : DEFAULT_BATCH_SIZE;
  return Math.max(1, Math.min(max, DEFAULT_BATCH_SIZE));
}

export function createCatalogSession({
  userId,
  client,
  schemas,
  cache = agentCache(),
  fresh = false,
}: {
  userId: string;
  client: ToolClient;
  schemas: () => Promise<SilpoToolSchemas>;
  cache?: Cache;
  /** Skips every cache read and write: used by finalization, which must see live prices and availability. */
  fresh?: boolean;
}): CatalogSession {
  const store = fresh ? createNoopCache() : cache;
  let contextPromise: Promise<DeliveryContext> | null = null;

  function context() {
    contextPromise ??= store.getOrLoad(`ctx:${userId}`, cacheTtl.deliveryContext, async () => {
      const value = await cartContext(client, await schemas());
      debugLog("delivery context", value);
      return value;
    }, { level: "l1" }).catch((error) => {
      contextPromise = null;
      throw error;
    });
    return contextPromise;
  }

  const searchKey = (ctx: DeliveryContext, query: string) => `search:${ctx.branchId}:${ctx.deliveryType}:${normalizeKey(query)}`;
  const detailsKey = (ctx: DeliveryContext, slug: string) => `details:${ctx.branchId}:${slug}`;

  async function searchChunk(ctx: DeliveryContext, queries: string[]): Promise<Map<string, SearchOutcome>> {
    const outcome = (matches: SearchMatch[]): SearchOutcome => ({ status: matches.length ? "ok" : "empty", matches });
    try {
      const payload = await call(client, "silpo_find_products_batch", { ...ctx, products: queries, limit: SEARCH_LIMIT });
      debugLog(`search ${JSON.stringify(queries)}`, payload);
      const split = splitBatchSearch(payload, queries);
      if (split) return new Map([...split].map(([query, matches]) => [query, outcome(matches)]));
    } catch (error) {
      if (queries.length === 1) return new Map([[queries[0], { status: "error", matches: [], error: errorMessage(error) }]]);
      console.warn("catalog: batch search failed, retrying each query separately", errorMessage(error));
    }
    const single = await mapLimit(queries, SEARCH_FALLBACK_CONCURRENCY, async (query) => [query, (await searchChunk(ctx, [query])).get(query)!] as const);
    return new Map(single);
  }

  async function search(queries: string[]) {
    const unique = [...new Map(queries.filter((query) => query.trim()).map((query) => [normalizeKey(query), query.trim()])).values()];
    const results = new Map<string, SearchOutcome>();
    if (!unique.length) return results;
    let ctx: DeliveryContext;
    try {
      ctx = await context();
    } catch (error) {
      const failure: SearchOutcome = { status: "error", matches: [], error: errorMessage(error) };
      for (const query of queries) results.set(query, failure);
      return results;
    }

    const misses: string[] = [];
    for (const query of unique) {
      const cached = await store.get<SearchOutcome>(searchKey(ctx, query));
      if (cached) results.set(query, cached);
      else misses.push(query);
    }
    const size = batchSize(await schemas().catch(() => new Map()));
    const chunks = Array.from({ length: Math.ceil(misses.length / size) }, (_, index) => misses.slice(index * size, (index + 1) * size));
    for (const chunk of chunks) {
      for (const [query, outcome] of await searchChunk(ctx, chunk)) {
        results.set(query, outcome);
        if (outcome.status !== "error") await store.set(searchKey(ctx, query), outcome, cacheTtl.search);
      }
    }
    // Answer under every spelling the caller used, not only the deduplicated one.
    for (const query of queries) {
      const canonical = unique.find((candidate) => normalizeKey(candidate) === normalizeKey(query));
      if (canonical && !results.has(query)) results.set(query, results.get(canonical)!);
    }
    return results;
  }

  function fromSearch(match: SearchMatch): DetailsOutcome {
    const product = normalizeSilpoProduct(match.raw, match.id, match.raw);
    if (!product) return { status: "not_found" };
    return {
      status: product.available ? "ok" : "unavailable",
      source: "search",
      product: withIdentifiers(product, match),
    };
  }

  function withIdentifiers(product: NonNullable<ReturnType<typeof normalizeSilpoProduct>>, match: SearchMatch): CatalogProduct {
    return {
      ...product,
      lookupProductId: match.externalProductId,
      ...(match.slug ? { slug: match.slug } : {}),
      ...(match.companyId ? { companyId: match.companyId } : {}),
    };
  }

  async function loadDetails(ctx: DeliveryContext, match: SearchMatch): Promise<DetailsOutcome> {
    if (!match.slug) return fromSearch(match);
    try {
      const payload = await call(client, "silpo_get_product_details", { ...ctx, slug: match.slug });
      debugLog(`details ${match.slug}`, payload);
      const product = normalizeSilpoProduct(payload, match.id, match.raw);
      if (!product) {
        // Details did not describe this listing; the search entry may still carry enough to price it.
        const fallback = fromSearch(match);
        return fallback.status === "not_found" ? { status: "not_found" } : fallback;
      }
      return { status: product.available ? "ok" : "unavailable", source: "details", product: withIdentifiers(product, match) };
    } catch (error) {
      console.warn(`catalog: details failed for ${match.slug}`, errorMessage(error));
      const fallback = fromSearch(match);
      return fallback.status === "not_found" ? { status: "error", error: errorMessage(error) } : fallback;
    }
  }

  async function details(matches: SearchMatch[]) {
    const results = new Map<string, DetailsOutcome>();
    const unique = [...new Map(matches.map((match) => [match.externalProductId, match])).values()];
    if (!unique.length) return results;
    let ctx: DeliveryContext;
    try {
      ctx = await context();
    } catch (error) {
      for (const match of unique) results.set(match.externalProductId, { status: "error", error: errorMessage(error) });
      return results;
    }
    const loaded = await mapLimit(unique, DETAILS_CONCURRENCY, async (match) => {
      if (!match.slug) return [match.externalProductId, fromSearch(match)] as const;
      const outcome = await store.getOrLoad(detailsKey(ctx, match.slug), cacheTtl.details, () => loadDetails(ctx, match), {
        // Only authoritative detail reads are shared; search-derived fallbacks and failures are retried next time.
        shouldCache: (value) => (value.status === "ok" || value.status === "unavailable") && value.source === "details",
      });
      return [match.externalProductId, outcome] as const;
    });
    for (const [id, outcome] of loaded) results.set(id, outcome);
    return results;
  }

  async function refresh(target: RefreshTarget): Promise<DetailsOutcome> {
    const lookupProductId = target.lookupProductId ?? target.id;
    if (target.slug) {
      const outcome = (await details([{
        externalProductId: lookupProductId,
        id: target.id,
        slug: target.slug,
        companyId: null,
        name: target.name,
        raw: {},
      }])).get(lookupProductId)!;
      if (outcome.status !== "not_found") return outcome;
    }
    // Legacy plan rows carry no slug: find the listing again by its name and match the exact product.
    const found = (await search([target.name])).get(target.name);
    if (!found || found.status === "error") return { status: "error", error: found?.error ?? "search failed" };
    const match = found.matches.find((candidate) => candidate.id === target.id || candidate.externalProductId === lookupProductId);
    if (!match) return { status: "not_found" };
    return (await details([match])).get(match.externalProductId)!;
  }

  return {
    context,
    search,
    details,
    refresh,
    async forget(products) {
      const ctx = await context().catch(() => null);
      if (!ctx) return;
      await store.delete(products.flatMap((product) => product.slug ? [detailsKey(ctx, product.slug)] : []));
    },
    syncCart: (items) => syncCartProducts(client, items),
    finalCart: () => getFinalCart(client),
  };
}

// ---- Connection pool -------------------------------------------------------------------------------------

const IDLE_CLOSE_MS = 60_000;

type PooledClient = { client: SilpoClient; timer?: ReturnType<typeof setTimeout> };
const pool = new Map<string, PooledClient>();

async function closeQuietly(client: SilpoClient) {
  try { await client.close(); } catch { /* already closed */ }
}

async function acquire(userId: string): Promise<PooledClient> {
  const pooled = pool.get(userId);
  if (pooled) {
    if (pooled.timer) clearTimeout(pooled.timer);
    return pooled;
  }
  const entry = { client: await getAuthenticatedSilpoMcpClient(userId) };
  pool.set(userId, entry);
  return entry;
}

function release(userId: string, entry: PooledClient) {
  if (pool.get(userId) !== entry) return;
  entry.timer = setTimeout(() => {
    if (pool.get(userId) === entry) pool.delete(userId);
    void closeQuietly(entry.client);
  }, IDLE_CLOSE_MS);
  entry.timer.unref?.();
}

async function discard(userId: string, entry: PooledClient) {
  if (pool.get(userId) === entry) pool.delete(userId);
  await closeQuietly(entry.client);
}

/** JSON-RPC errors (negative numeric codes) come from the server; anything else means the transport broke. */
function isTransportFailure(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  return !(typeof code === "number" && code < 0);
}

/**
 * Runs `operation` with a catalog session for one Silpo user. Operations for the same user are serialized
 * (OAuth refresh tokens rotate), and the MCP connection is reused across turns while it stays healthy.
 */
export function withCatalogSession<T>(
  userId: string,
  operation: (session: CatalogSession) => Promise<T>,
  options: { fresh?: boolean; cache?: Cache } = {},
): Promise<T> {
  return serializeSilpoOperation(userId, async () => {
    let entry = await acquire(userId);
    const client: ToolClient = {
      callTool: async (params, ...rest) => {
        try {
          return await entry.client.callTool(params, ...rest);
        } catch (error) {
          if (!isTransportFailure(error)) throw error;
          // A pooled connection may have gone stale while idle: reconnect once and retry.
          await discard(userId, entry);
          entry = await acquire(userId);
          return entry.client.callTool(params, ...rest);
        }
      },
    };
    const cache = options.fresh ? createNoopCache() : (options.cache ?? agentCache());
    const schemas = () => cache.getOrLoad("schemas", cacheTtl.toolSchemas, () => listSilpoToolSchemas(entry.client), { level: "l1" });
    try {
      return await operation(createCatalogSession({ userId, client, schemas, cache, fresh: options.fresh }));
    } finally {
      release(userId, entry);
    }
  });
}
