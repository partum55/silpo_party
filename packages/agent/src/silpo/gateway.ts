import { getAuthenticatedSilpoMcpClient } from "@silpo-party/silpo-mcp";

import type { HydratedProduct } from "../domain/plan.ts";

export type JsonObject = Record<string, unknown>;
export type SilpoClient = Awaited<ReturnType<typeof getAuthenticatedSilpoMcpClient>>;
export type SilpoToolSchema = { properties?: Record<string, object>; required?: string[] };
export type SilpoToolSchemas = Map<string, SilpoToolSchema>;
export type DeliveryContext = Record<"branchId" | "deliveryType" | "timeslotStart" | "timeslotEnd", string>;

const requiredAgentTools = [
  "silpo_get_my_shopping_cart",
  "silpo_get_shopping_cart_by_id",
  "silpo_get_time_slots",
  "silpo_find_products_batch",
  "silpo_get_product_details",
] as const;

const userQueues = new Map<string, Promise<void>>();
const SILPO_CALL_TIMEOUT_MS = 15_000;

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

export function objects(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.flatMap(objects);
  if (!isObject(value)) return [];
  return [value, ...Object.values(value).flatMap(objects)];
}

export function field(object: JsonObject, names: string[]) {
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
    && field(candidate, ["end", "timeslotEnd", "to"]) === end
    && field(candidate, ["available", "isAvailable"]) !== false);
}

export function availableTimeslot(payload: unknown, preferredDeliveryType: string) {
  const slots = objects(payload).filter((candidate) => {
    const start = field(candidate, ["start", "timeslotStart", "from"]);
    const end = field(candidate, ["end", "timeslotEnd", "to"]);
    return typeof start === "string" && Boolean(start) && typeof end === "string" && Boolean(end)
      && field(candidate, ["available", "isAvailable"]) !== false;
  });
  return slots.find((candidate) => field(candidate, ["deliveryType"]) === preferredDeliveryType) ?? slots[0] ?? null;
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

export const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;

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
  const pattern = /(\d+(?:[.,]\d+)?)\s*(кг|kg|г|g|мл|ml|л|l|шт|pcs?|pieces?)(?=$|\s|[,.)])/i;
  // Packaged groceries are frequently sold as "1 шт" in displayRatio even though the product name carries
  // the useful recipe measure (for example, cheese 200 g). Prefer the name and use displayRatio as fallback
  // for genuinely weighted products and names without an explicit size.
  const match = name.match(pattern) ?? (text(value) ?? "").match(pattern);
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

const weightUnit = /^(?:кг|kg)$/i;

/**
 * Normalizes a Silpo product payload. Only id, name, and price are mandatory: every other field has a safe
 * default so a sparse catalog response degrades a product instead of silently dropping it. Weighted goods
 * without an explicit measure are priced per kilogram; other products without a measure count as one piece.
 */
export function normalizeSilpoProduct(payload: unknown, requestedId: string, fallback?: unknown): HydratedProduct | null {
  const product = objects(payload).find((candidate) => String(field(candidate, ["id"]) ?? "") === requestedId);
  if (!product) return null;
  const id = text(field(product, ["id"]));
  const name = text(field(product, ["name"]));
  const priceUah = number(field(product, ["price"]));
  if (!id || !name || priceUah === null) {
    console.warn("normalizeSilpoProduct: dropped product without id, name, or price", { requestedId, name });
    return null;
  }
  const ratio = text(field(product, ["ratio"]));
  const weighted = field(product, ["weighted"]) === true || Boolean(ratio && weightUnit.test(ratio));
  const unit = ratio ?? (weighted ? "кг" : "шт");
  const available = field(product, ["available"]);
  const size = packageSize(field(product, ["displayRatio"]), name)
    ?? (weighted ? { amount: 1000, unit: "g" as const } : { amount: 1, unit: "piece" as const });
  const category = productCategory(name, size);
  const imageUrl = productImageUrl(product, fallback);

  return {
    id,
    name,
    ...(imageUrl ? { imageUrl } : {}),
    priceUah,
    unit,
    available: typeof available === "boolean" ? available : true,
    weighted,
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

const restrictionContainerNames = [
  "restrictions",
  "foodRestrictions",
  "dietaryRestrictions",
  "preferences",
  "foodPreferences",
  "items",
] as const;

const restrictionLabelNames = ["name", "title", "label", "displayName", "description", "type", "code", "slug"] as const;

function isInactiveRestriction(value: JsonObject) {
  return ["active", "enabled", "selected", "isActive", "isEnabled", "isSelected"]
    .some((name) => field(value, [name]) === false)
    || /^(?:inactive|disabled|unselected)$/i.test(String(field(value, ["status"]) ?? ""));
}

function restrictionValues(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(restrictionValues);
  if (!isObject(value) || isInactiveRestriction(value)) return [];

  const labels = restrictionLabelNames.flatMap((name) => strings(field(value, [name])));
  const booleanLabels = Object.entries(value).flatMap(([name, enabled]) =>
    enabled === true && !/^(?:active|enabled|selected|isActive|isEnabled|isSelected|success)$/i.test(name)
      ? [name]
      : []);
  const nested = restrictionContainerNames.flatMap((name) => restrictionValues(field(value, [name])));
  return [...labels, ...booleanLabels, ...nested];
}

function canonicalRestriction(value: string): string | null {
  const normalized = value.trim().toLocaleLowerCase("uk");
  // Silpo returns machine slugs with name: null. `all-food` means no dietary exclusion, while the live
  // vegan profile is represented as `all-meat` (all animal-meat/animal-product food excluded).
  if (normalized === "all-food") return null;
  if (normalized === "all-meat") return "vegan";
  // Silpo currently returns this transliterated slug (with name: null) for lactose intolerance.
  if (normalized === "lactoza") return "lactose";
  return value.trim() || null;
}

/** Normalizes the intentionally schema-flexible Silpo profile response into restriction labels for the planner. */
export function extractFoodRestrictions(payload: unknown): string[] {
  const decoded = decodeToolResult(payload);
  const roots = objects(decoded).flatMap((candidate) =>
    restrictionContainerNames.flatMap((name) => {
        const value = field(candidate, [name]);
        return value === undefined ? [] : [value];
      }));
  const values = (roots.length ? roots.flatMap(restrictionValues) : restrictionValues(decoded))
    .flatMap((value) => canonicalRestriction(value) ?? []);
  return [...new Map(values.map((value) => [value.toLocaleLowerCase("uk"), value])).values()];
}

/** The subset of the MCP client used for tool calls; lets tests and the connection pool substitute it. */
export type ToolClient = Pick<SilpoClient, "callTool">;

class SilpoToolError extends Error {
  readonly tool: string;
  constructor(tool: string, message: string) {
    super(`Silpo tool ${tool} failed: ${message}`);
    this.tool = tool;
  }
}

export async function call(client: ToolClient, name: string, args: JsonObject, timeoutMs = SILPO_CALL_TIMEOUT_MS) {
  const result = await withTimeout(client.callTool({ name, arguments: args }), timeoutMs, `Silpo tool ${name}`);
  // MCP reports tool-level failures in-band. Surface them as errors instead of treating the error text as data.
  if (isObject(result) && result.isError === true) {
    const decoded = decodeToolResult({ ...result, structuredContent: undefined });
    throw new SilpoToolError(name, (typeof decoded === "string" ? decoded : JSON.stringify(decoded)).slice(0, 300));
  }
  return decodeToolResult(result);
}

export async function cartContext(client: ToolClient, schemas: SilpoToolSchemas): Promise<DeliveryContext> {
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
  const typed = context as DeliveryContext;
  const timeslotSchema = schemas.get("silpo_get_time_slots")!;
  // A Silpo cart can retain an expired delivery interval. Product search does not report that context error;
  // it simply returns zero matches for every query. Ask for the branch's current slots without constraining
  // the call to the stale interval, then use the cart's slot when it is still available or the next available
  // slot of the same delivery type for read-only catalog discovery.
  const slotSources = [{
    branchId: typed.branchId,
    deliveryType: typed.deliveryType,
    deliveryTypes: [typed.deliveryType],
    limit: 100,
  }];
  let slotArguments: JsonObject;
  try {
    slotArguments = toolArguments(timeslotSchema, slotSources);
  } catch {
    // Compatibility with an older MCP schema that required the current interval.
    slotArguments = toolArguments(timeslotSchema, [{
      ...typed,
      shoppingCartId: current.shoppingCartId,
      start: typed.timeslotStart,
      end: typed.timeslotEnd,
      date: typed.timeslotStart.slice(0, 10),
    }, cart.shipments[0], cart]);
  }
  const slots = await call(client, "silpo_get_time_slots", slotArguments);
  if (hasTimeslot(slots, typed.timeslotStart, typed.timeslotEnd)) return typed;

  const replacement = availableTimeslot(slots, typed.deliveryType);
  const timeslotStart = replacement && field(replacement, ["start", "timeslotStart", "from"]);
  const timeslotEnd = replacement && field(replacement, ["end", "timeslotEnd", "to"]);
  const deliveryType = replacement && field(replacement, ["deliveryType"]);
  if (typeof timeslotStart !== "string" || typeof timeslotEnd !== "string") {
    throw new Error("The active Silpo cart timeslot is no longer available and no replacement slot was found.");
  }
  return {
    branchId: typed.branchId,
    deliveryType: typeof deliveryType === "string" && deliveryType ? deliveryType : typed.deliveryType,
    timeslotStart,
    timeslotEnd,
  };
}

async function ensureCart(client: ToolClient) {
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

async function fetchCart(client: ToolClient, shoppingCartId: string) {
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

/**
 * Builds the real Silpo cart to exactly match `items`: clears whatever is there, then writes every line.
 * This is the "finalize" write path — the MCP catalog has no atomic checkout tool, only cart-mutation
 * tools plus a checkout link returned from silpo_get_shopping_cart_by_id (see extractCheckoutUrl).
 */
export async function syncCartProducts(client: ToolClient, items: CartLineItem[]) {
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
}
export async function getFinalCart(client: ToolClient) {
  return fetchCart(client, await ensureCart(client));
}
