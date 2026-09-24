/**
 * Probes the live Silpo MCP catalog for one connected user and saves the raw responses as test fixtures.
 * The fixtures contain catalog data only (no tokens), so they are safe to share and commit.
 *
 *   SILPO_USER_ID=<supabase user id of a connected host> npm --workspace packages/agent run probe -- [query ...]
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { getAuthenticatedSilpoMcpClient } from "@silpo-party/silpo-mcp";

import { createNoopCache } from "../src/cache/cache.ts";
import { createCatalogSession } from "../src/silpo/catalog.ts";
import { call, cartContext, listSilpoToolSchemas } from "../src/silpo/gateway.ts";

const userId = process.env.SILPO_USER_ID;
if (!userId) throw new Error("Set SILPO_USER_ID to the Supabase user id of a host with a connected Silpo account.");

const queries = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["картопля", "цукерки желейні", "сік апельсиновий", "свинина шия", "молоко"];
const outDir = path.join(import.meta.dirname, "..", "tests", "fixtures", "silpo");
await mkdir(outDir, { recursive: true });
const save = async (name: string, value: unknown) => {
  const file = path.join(outDir, `${name}.json`);
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`saved ${path.relative(process.cwd(), file)}`);
};

const client = await getAuthenticatedSilpoMcpClient(userId);
try {
  const schemas = await listSilpoToolSchemas(client);
  await save("tool-schemas", Object.fromEntries(schemas));
  const context = await cartContext(client, schemas);
  console.log("delivery context", context);

  // 1. Raw batch search: shows how results are grouped per query.
  const batch = await call(client, "silpo_find_products_batch", { ...context, products: queries, limit: 10 });
  await save("search-batch", { queries, response: batch });

  // 2. Raw single-query search and details for the first result of each query.
  for (const [index, query] of queries.entries()) {
    const single = await call(client, "silpo_find_products_batch", { ...context, products: [query], limit: 10 });
    await save(`search-${index}`, { query, response: single });
  }

  // 3. What the agent makes of it: normalized products per query.
  const session = createCatalogSession({ userId, client, schemas: async () => schemas, cache: createNoopCache() });
  const found = await session.search(queries);
  for (const [index, query] of queries.entries()) {
    const outcome = found.get(query)!;
    const details = await session.details(outcome.matches.slice(0, 3));
    const first = outcome.matches[0];
    if (first?.slug) {
      await save(`details-${index}`, { slug: first.slug, response: await call(client, "silpo_get_product_details", { ...context, slug: first.slug }) });
    }
    console.log(`\n${query}: ${outcome.status}, ${outcome.matches.length} matches`);
    for (const [id, result] of details) {
      console.log(`  ${id}: ${result.status}${"product" in result ? ` — ${result.product.name}, ${result.product.priceUah} грн, ${JSON.stringify(result.product.packageSize)}, weighted=${result.product.weighted}` : ""}`);
    }
  }

  // 4. Does searching by a numeric product id work? The old agent relied on it.
  const firstId = found.get(queries[0])?.matches[0]?.externalProductId;
  if (firstId) {
    const byId = await call(client, "silpo_find_products_batch", { ...context, products: [firstId], limit: 10 });
    await save("search-by-id", { query: firstId, response: byId });
  }
} finally {
  await client.close();
}
