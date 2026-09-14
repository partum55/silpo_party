import { getAuthenticatedSilpoMcpClient } from "@silpo-party/silpo-mcp";

import type { HydratedProduct } from "../domain/validation.ts";

type JsonObject = Record<string, unknown>;
type SilpoClient = Awaited<ReturnType<typeof getAuthenticatedSilpoMcpClient>>;

const userQueues = new Map<string, Promise<void>>();

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
  const match = `${text(value) ?? ""} ${name}`.match(/(\d+(?:[.,]\d+)?)\s*(кг|kg|г|g|мл|ml|л|l)(?=$|\s|[,.)])/i);
  if (!match) return null;
  const amount = Number(match[1].replace(",", "."));
  const unit = match[2].toLowerCase();
  if (unit === "кг" || unit === "kg") return { amount: amount * 1000, unit: "g" };
  if (unit === "л" || unit === "l") return { amount: amount * 1000, unit: "ml" };
  return { amount, unit: unit === "мл" || unit === "ml" ? "ml" : "g" };
}

function attributeValues(product: JsonObject, pattern: RegExp) {
  const attributes = field(product, ["attributes"]);
  if (!isObject(attributes)) return [];
  return Object.entries(attributes).filter(([key]) => pattern.test(key)).flatMap(([, value]) => strings(value));
}

function productCategory(name: string, size: HydratedProduct["packageSize"]) {
  if (size.unit === "g") return "food" as const;
  return /вода|сік|напій|нектар|лимонад|квас|компот|морс|чай|кава|пиво|вино|сидр|water|juice|drink|tea|coffee|beer|wine/i.test(name)
    ? "drink" as const
    : null;
}

export function normalizeSilpoProduct(payload: unknown, requestedId: string): HydratedProduct | null {
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

  return {
    id,
    name,
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
  return decodeToolResult(await client.callTool({ name, arguments: args }));
}

async function cartContext(client: SilpoClient) {
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
  return context as Record<"branchId" | "deliveryType" | "timeslotStart" | "timeslotEnd", string>;
}

export function createSilpoGateway(userId: string) {
  async function withClient<T>(operation: (client: SilpoClient) => Promise<T>) {
    return serializeSilpoOperation(userId, async () => {
      const client = await getAuthenticatedSilpoMcpClient(userId);
      try { return await operation(client); } finally { await client.close(); }
    });
  }

  return {
    search: (query: string) => withClient(async (client) => call(client, "silpo_find_products_batch", {
      ...await cartContext(client),
      products: [query],
      limit: 10,
    })),
    hydrate: (productId: string) => withClient(async (client) => {
      const context = await cartContext(client);
      const search = await call(client, "silpo_find_products_batch", {
        ...context,
        products: [productId],
        limit: 10,
      });
      const match = objects(search).find((candidate) => String(field(candidate, ["externalProductId"]) ?? "") === productId);
      const slug = match && text(field(match, ["slug"]));
      if (!slug) return null;
      const details = await call(client, "silpo_get_product_details", { ...context, slug });
      return normalizeSilpoProduct(details, String(field(match, ["id"]) ?? ""));
    }),
  };
}
