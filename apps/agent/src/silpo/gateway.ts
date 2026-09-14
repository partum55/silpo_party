import { getAuthenticatedSilpoMcpClient } from "@silpo-party/silpo-mcp";

import type { HydratedProduct } from "../domain/validation.ts";

type JsonObject = Record<string, unknown>;
type SilpoClient = Awaited<ReturnType<typeof getAuthenticatedSilpoMcpClient>>;
export type SilpoToolSchema = { properties?: Record<string, object>; required?: string[] };
type SilpoToolSchemas = Map<string, SilpoToolSchema>;

const requiredAgentTools = [
  "silpo_get_my_shopping_cart",
  "silpo_get_shopping_cart_by_id",
  "silpo_get_time_slots",
  "silpo_find_products_batch",
  "silpo_get_product_details",
  "silpo_get_similar_products",
  "silpo_get_replacements",
] as const;

const userQueues = new Map<string, Promise<void>>();
const SILPO_CALL_TIMEOUT_MS = 20_000;

export async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function serializeSilpoOperation<T>(userId: string, operation: () => Promise<T>) {
  // ponytail: process-local OAuth refresh lock; use a distributed lock if one user spans replicas.
  const run = (userQueues.get(userId) ?? Promise.resolve()).catch(() => {}).then(operation);
  const tail = run.then(() => {}, () => {});
  userQueues.set(userId, tail);
  try { return await run; } finally { if (userQueues.get(userId) === tail) userQueues.delete(userId); }
}

const isObject = (value: unknown): value is JsonObject => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function objects(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.flatMap(objects);
  if (!isObject(value)) return [];
  return [value, ...Object.values(value).flatMap(objects)];
}

function field(object: JsonObject, names: string[]) {
  const wanted = new Set(names.map((name) => name.toLocaleLowerCase("uk")));
  return Object.entries(object).find(([key]) => wanted.has(key.toLocaleLowerCase("uk")))?.[1];
}

export function toolArguments(schema: SilpoToolSchema, sources: unknown[]): JsonObject {
  const candidates = objects(sources);
  const args = Object.fromEntries(Object.keys(schema.properties ?? {}).flatMap((name) => {
    const value = candidates.map((candidate) => field(candidate, [name])).find((candidate) => candidate !== undefined);
    return value === undefined ? [] : [[name, value]];
  }));
  const missing = (schema.required ?? []).filter((name) => args[name] === undefined || args[name] === null || args[name] === "");
  if (missing.length) throw new Error(`Cannot derive required Silpo tool arguments: ${missing.join(", ")}.`);
  return args;
}

export function hasTimeslot(payload: unknown, start: string, end: string) {
  return objects(payload).some((candidate) =>
    field(candidate, ["start", "timeslotStart", "from"]) === start
    && field(candidate, ["end", "timeslotEnd", "to"]) === end);
}

export async function listSilpoToolSchemas(client: Pick<SilpoClient, "listTools">): Promise<SilpoToolSchemas> {
  const schemas: SilpoToolSchemas = new Map();
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    for (const tool of page.tools) schemas.set(tool.name, tool.inputSchema);
    cursor = page.nextCursor;
  } while (cursor);

  const missing = requiredAgentTools.filter((name) => !schemas.has(name));
  if (missing.length) throw new Error(`Silpo MCP is missing required agent tools: ${missing.join(", ")}.`);
  return schemas;
}

const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;

function number(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/\s/g, "").replace(",", ".").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(strings);
  const item = text(value);
  return item ? [item] : [];
}

function packageSize(value: unknown, name: string): HydratedProduct["packageSize"] | null {
  const match = `${text(value) ?? ""} ${name}`.match(/(\d+(?:[.,]\d+)?)\s*(кг|kg|г|g|мл|ml|л|l|шт|pcs?|pieces?)(?=$|\s|[,.)])/i);
  if (!match) return null;
  const amount = Number(match[1].replace(",", "."));
  const unit = match[2].toLowerCase();
  if (unit === "кг" || unit === "kg") return { amount: amount * 1000, unit: "g" };
  if (unit === "л" || unit === "l") return { amount: amount * 1000, unit: "ml" };
  if (["шт", "pc", "pcs", "piece", "pieces"].includes(unit)) return { amount, unit: "piece" };
  return { amount, unit: unit === "мл" || unit === "ml" ? "ml" : "g" };
}

function attributeValues(product: JsonObject, pattern: RegExp) {
  const attributes = field(product, ["attributes"]);
  if (!isObject(attributes)) return [];
  return Object.entries(attributes).filter(([key]) => pattern.test(key)).flatMap(([, value]) => strings(value));
}

function productImageUrl(...sources: unknown[]) {
  for (const source of sources) {
    for (const candidate of objects(source)) {
      for (const [key, value] of Object.entries(candidate)) {
        if (!/image|img|photo|picture|thumbnail/i.test(key)) continue;
        const possible = typeof value === "string"
          ? [value]
          : [...strings(value), ...objects(value).flatMap((entry) => strings(field(entry, ["url", "src", "href"])))];
        const url = possible.find((item) => /^https?:\/\//i.test(item));
        if (url) return url;
      }
    }
  }
  return undefined;
}

function productCategory(name: string, size: HydratedProduct["packageSize"]) {
  if (size.unit !== "ml") return "food" as const;
  return /вода|сік|напій|нектар|лимонад|квас|компот|морс|чай|кава|пиво|вино|сидр|water|juice|drink|tea|coffee|beer|wine/i.test(name)
    ? "drink" as const
    : "food" as const;
}

export function normalizeSilpoProduct(payload: unknown, requestedId: string, fallback?: unknown): HydratedProduct | null {
  const product = objects(payload).find((candidate) => String(field(candidate, ["id"]) ?? "") === requestedId);
  if (!product) return null;
  const id = text(field(product, ["id"]));
  const name = text(field(product, ["name"]));
  const priceUah = number(field(product, ["price"]));
  const unit = text(field(product, ["ratio"]));
  const available = field(product, ["available"]);
  const size = name ? packageSize(field(product, ["displayRatio"]), name) : null;
  const category = name && size ? productCategory(name, size) : null;
  if (!id || !name || priceUah === null || !unit || typeof available !== "boolean" || !size || !category) return null;
  const imageUrl = productImageUrl(product, fallback);

  return {
    id,
    name,
    ...(imageUrl ? { imageUrl } : {}),
    priceUah,
    unit,
    available,
    weighted: field(product, ["weighted"]) === true,
    category,
    packageSize: size,
    metadata: {
      ingredients: attributeValues(product, /склад|ingredients?/i),
      allergens: attributeValues(product, /алерген|allergens?/i),
      labels: attributeValues(product, /маркування|labels?|особливост/i),
      composition: attributeValues(product, /опис|composition/i),
    },
  };
}

export function extractSearchProductIds(payload: unknown): string[] {
  return [...new Set(objects(payload).flatMap((candidate) => {
    const id = field(candidate, ["externalProductId"]);
    return typeof id === "string" || typeof id === "number" ? [String(id)] : [];
  }))];
}

function decodeToolResult(result: unknown) {
  if (!isObject(result)) return result;
  if (result.structuredContent !== undefined) return result.structuredContent;
  if (!Array.isArray(result.content)) return result;
  const values = result.content.flatMap((item) => {
    if (!isObject(item) || item.type !== "text" || typeof item.text !== "string") return [];
    try { return [JSON.parse(item.text)]; } catch { return [item.text]; }
  });
  return values.length === 1 ? values[0] : values;
}

async function call(client: SilpoClient, name: string, args: JsonObject) {
  return decodeToolResult(await withTimeout(
    client.callTool({ name, arguments: args }),
    SILPO_CALL_TIMEOUT_MS,
    `Silpo tool ${name}`,
  ));
}

async function cartContext(client: SilpoClient, schemas: SilpoToolSchemas) {
  const current = await call(client, "silpo_get_my_shopping_cart", {});
  if (!isObject(current) || current.exists !== true || typeof current.shoppingCartId !== "string") {
    throw new Error("An existing Silpo shopping cart is required to search the current catalog.");
  }
  const result = await call(client, "silpo_get_shopping_cart_by_id", { shoppingCartId: current.shoppingCartId });
  const cart = isObject(result) && isObject(result.cart) ? result.cart : result;
  if (!isObject(cart) || !Array.isArray(cart.shipments) || !isObject(cart.shipments[0]) || !isObject(cart.timeslot)) {
    throw new Error("Silpo cart is missing branch or timeslot context.");
  }
  const context = {
    branchId: cart.shipments[0].branchId,
    deliveryType: cart.deliveryType === "DeliveryExpressByPromise" ? "DeliveryHome" : cart.deliveryType,
    timeslotStart: cart.timeslot.start,
    timeslotEnd: cart.timeslot.end,
  };
  if (Object.values(context).some((value) => typeof value !== "string" || !value)) {
    throw new Error("Silpo cart is missing branch, delivery, or timeslot context.");
  }
  const typed = context as Record<"branchId" | "deliveryType" | "timeslotStart" | "timeslotEnd", string>;
  const slots = await call(client, "silpo_get_time_slots", toolArguments(
    schemas.get("silpo_get_time_slots")!,
    [{
      ...typed,
      shoppingCartId: current.shoppingCartId,
      start: typed.timeslotStart,
      end: typed.timeslotEnd,
      date: typed.timeslotStart.slice(0, 10),
    }, cart.shipments[0], cart],
  ));
  if (!hasTimeslot(slots, typed.timeslotStart, typed.timeslotEnd)) {
    throw new Error("The active Silpo cart timeslot is no longer available.");
  }
  return typed;
}

async function ensureCart(client: SilpoClient) {
  const current = await call(client, "silpo_get_my_shopping_cart", {});
  if (isObject(current) && current.exists === true && typeof current.shoppingCartId === "string") {
    return current.shoppingCartId;
  }
  // silpo_create_shopping_cart is idempotent: it returns the existing cart if one already exists.
  const created = await call(client, "silpo_create_shopping_cart", {});
  const id = isObject(created) ? field(created, ["shoppingCartId"]) : null;
  if (typeof id !== "string" || !id) throw new Error("Silpo did not return a shopping cart id after creation.");
  return id;
}

async function fetchCart(client: SilpoClient, shoppingCartId: string) {
  const result = await call(client, "silpo_get_shopping_cart_by_id", { shoppingCartId });
  return isObject(result) && isObject(result.cart) ? result.cart : result;
}

// ponytail: exact checkout-link field name is unverified against a live tools/list call; falls back to null
// rather than throwing, so finalization still succeeds without it. Confirm the real field on first live run.
export function extractCheckoutUrl(cart: unknown): string | null {
  if (!isObject(cart)) return null;
  return text(field(cart, ["checkoutUrl", "checkoutLink", "checkout_url", "checkoutURL", "url"]));
}

export type CartLineItem = { productId: string; companyId: string; branchId: string; quantity: number };

export function createSilpoGateway(userId: string) {
  let schemasPromise: Promise<SilpoToolSchemas> | null = null;
  // Cached per gateway instance (i.e. per conversational turn — see conversationalTurn/discoverCandidates/
  // planAndValidate, each of which creates one gateway). Branch/delivery/timeslot context doesn't change
  // within a single turn, but cartContext() itself costs 3 sequential Silpo calls — recomputing it on every
  // single search/hydrate/similar/replacements call (dozens of times per turn) was the dominant source of
  // agent latency.
  let contextPromise: ReturnType<typeof cartContext> | null = null;

  async function withClient<T>(operation: (client: SilpoClient, schemas: SilpoToolSchemas) => Promise<T>) {
    return serializeSilpoOperation(userId, async () => {
      const client = await getAuthenticatedSilpoMcpClient(userId);
      try {
        schemasPromise ??= listSilpoToolSchemas(client).catch((error) => {
          schemasPromise = null;
          throw error;
        });
        return await operation(client, await schemasPromise);
      } finally { await client.close(); }
    });
  }

  function getContext(client: SilpoClient, schemas: SilpoToolSchemas) {
    contextPromise ??= cartContext(client, schemas).catch((error) => {
      contextPromise = null;
      throw error;
    });
    return contextPromise;
  }

  async function productReference(client: SilpoClient, schemas: SilpoToolSchemas, productId: string) {
    const context = await getContext(client, schemas);
    const search = await call(client, "silpo_find_products_batch", { ...context, products: [productId], limit: 10 });
    const match = objects(search).find((candidate) => String(field(candidate, ["externalProductId"]) ?? "") === productId);
    if (!match) return null;
    return {
      context,
      match,
      values: {
        ...context,
        slug: text(field(match, ["slug"])),
        slugs: [text(field(match, ["slug"]))].filter(Boolean),
        productId: field(match, ["productId", "id"]),
        productIds: [field(match, ["productId", "id"])],
        externalProductId: productId,
        externalProductIds: [productId],
        companyId: field(match, ["companyId"]),
      },
    };
  }

  return {
    searchVerified: (queries: string[], limit = 12) => withClient(async (client, schemas) => {
      const context = await getContext(client, schemas);
      const searches = await Promise.all(queries.map((query) => call(client, "silpo_find_products_batch", {
        ...context,
        products: [query],
        limit: 10,
      })));
      const perQuery = searches.map((search) => objects(search).filter((candidate) => {
          const externalProductId = field(candidate, ["externalProductId"]);
          return (typeof externalProductId === "string" || typeof externalProductId === "number")
            && Boolean(text(field(candidate, ["slug"])));
        }));
      const interleaved: JsonObject[] = [];
      for (let index = 0; interleaved.length < limit && perQuery.some((matches) => index < matches.length); index += 1) {
        for (const matches of perQuery) {
          const match = matches[index];
          if (match && !interleaved.some((candidate) => field(candidate, ["externalProductId"]) === field(match, ["externalProductId"]))) {
            interleaved.push(match);
          }
          if (interleaved.length === limit) break;
        }
      }
      const unique = interleaved.map((match) => [String(field(match, ["externalProductId"])), match] as const);
      return (await Promise.all(unique.map(async ([lookupProductId, match]) => {
        try {
          const details = await call(client, "silpo_get_product_details", {
            ...context,
            slug: text(field(match, ["slug"]))!,
          });
          const product = normalizeSilpoProduct(details, String(field(match, ["id"]) ?? ""), match);
          if (!product) return null;
          const companyId = text(field(match, ["companyId"]));
          return {
            lookupProductId,
            product: companyId ? { ...product, companyId } : product,
          };
        } catch {
          return null;
        }
      }))).flatMap((candidate) => candidate ? [candidate] : []);
    }),
    search: (query: string) => withClient(async (client, schemas) => call(client, "silpo_find_products_batch", {
      ...await getContext(client, schemas),
      products: [query],
      limit: 10,
    })),
    searchProductIds: (query: string) => withClient(async (client, schemas) => extractSearchProductIds(await call(client, "silpo_find_products_batch", {
      ...await getContext(client, schemas),
      products: [query],
      limit: 10,
    }))),
    hydrate: (productId: string) => withClient(async (client, schemas) => {
      const reference = await productReference(client, schemas, productId);
      const slug = reference && text(reference.values.slug);
      if (!slug) return null;
      const details = await call(client, "silpo_get_product_details", { ...reference.context, slug });
      const normalized = normalizeSilpoProduct(details, String(field(reference.match, ["id"]) ?? ""), reference.match);
      if (!normalized) return null;
      const companyId = text(field(reference.match, ["companyId"]));
      return companyId ? { ...normalized, companyId } : normalized;
    }),
    similar: (productId: string) => withClient(async (client, schemas) => {
      const reference = await productReference(client, schemas, productId);
      return reference
        ? call(client, "silpo_get_similar_products", toolArguments(schemas.get("silpo_get_similar_products")!, [reference.values, reference.match]))
        : null;
    }),
    replacements: (productId: string) => withClient(async (client, schemas) => {
      const reference = await productReference(client, schemas, productId);
      return reference
        ? call(client, "silpo_get_replacements", toolArguments(schemas.get("silpo_get_replacements")!, [reference.values, reference.match]))
        : null;
    }),
    // Builds the real Silpo cart to exactly match `items`: clears whatever is there, then writes every line.
    // This is the "finalize" write path — the MCP catalog has no atomic checkout tool, only cart-mutation
    // tools plus a checkout link returned from silpo_get_shopping_cart_by_id (see extractCheckoutUrl).
    syncCartProducts: (items: CartLineItem[]) => withClient(async (client) => {
      const shoppingCartId = await ensureCart(client);
      await call(client, "silpo_clear_shopping_cart", { shoppingCartId });
      if (items.length) {
        await call(client, "silpo_add_or_update_cart_products", {
          shoppingCartId,
          products: items.map((item) => ({
            productId: item.productId,
            companyId: item.companyId,
            branchId: item.branchId,
            quantity: item.quantity,
          })),
        });
      }
      return fetchCart(client, shoppingCartId);
    }),
    getFinalCart: () => withClient(async (client) => fetchCart(client, await ensureCart(client))),
    // The branchId every cart line item must share when writing via syncCartProducts. Shares the same cache
    // as search/hydrate, so a finalize that just refreshed every item via hydrate() reuses that context
    // instead of recomputing it (and stays consistent with whatever branch those refreshes were scoped to).
    getDeliveryContext: () => withClient(async (client, schemas) => getContext(client, schemas)),
  };
}
