import type { SilpoToolSchemas, ToolClient } from "../../src/silpo/gateway.ts";

export type FakeProduct = {
  id: string;
  externalProductId: number;
  slug: string;
  name: string;
  price: number;
  ratio?: string;
  weighted?: boolean;
  displayRatio?: string;
  available?: boolean;
  companyId?: string;
};

export const catalog: Record<string, FakeProduct[]> = {
  // The live search is fuzzy: for "шампури" (skewers) it ranks shampoo first.
  "шампури": [
    { id: "p-shampoo", externalProductId: 601, slug: "shampun", name: "Шампунь проти лупи Head & Shoulders", price: 189, ratio: "шт", companyId: "c1" },
    { id: "p-skewers", externalProductId: 602, slug: "shampury", name: "Шампури бамбукові 30 см 100 шт", price: 45, ratio: "шт", companyId: "c1" },
  ],
  "шампур": [
    { id: "p-shampoo", externalProductId: 601, slug: "shampun", name: "Шампунь проти лупи Head & Shoulders", price: 189, ratio: "шт", companyId: "c1" },
  ],
  "картопля": [
    { id: "p-potato", externalProductId: 101, slug: "kartoplia-bila", name: "Картопля біла", price: 24.9, ratio: "кг", weighted: true, companyId: "c1" },
    { id: "p-chips", externalProductId: 102, slug: "chypsy-lays", name: "Чипси Lay's картопляні 120 г", price: 59, ratio: "шт", displayRatio: "1 шт", companyId: "c1" },
  ],
  "сік апельсиновий": [
    { id: "p-juice", externalProductId: 201, slug: "sik-sandora-apelsyn", name: "Сік Sandora апельсиновий 0,95 л", price: 64.5, ratio: "шт", companyId: "c1" },
  ],
  "цукерки желейні": [
    { id: "p-jelly", externalProductId: 301, slug: "tsukerky-zhele", name: "Цукерки желейні Roshen 150 г", price: 38, ratio: "шт", companyId: "c1" },
  ],
  "спагеті": [
    { id: "p-spaghetti", externalProductId: 401, slug: "spagetti", name: "Спагеті Barilla 500 г", price: 72, ratio: "шт", companyId: "c1" },
  ],
  "бекон": [
    { id: "p-bacon", externalProductId: 402, slug: "bekon", name: "Бекон сирокопчений 150 г", price: 95, ratio: "шт", companyId: "c1" },
  ],
  "яйця курячі": [
    { id: "p-eggs", externalProductId: 403, slug: "yaitsia", name: "Яйця курячі 10 шт", price: 70, ratio: "шт", companyId: "c1" },
  ],
  "цибуля ріпчаста": [
    { id: "p-onion", externalProductId: 404, slug: "tsybulia", name: "Цибуля ріпчаста", price: 18, ratio: "кг", weighted: true, companyId: "c1" },
  ],
  "буряк": [
    { id: "p-beet", externalProductId: 405, slug: "buriak", name: "Буряк столовий", price: 15, ratio: "кг", weighted: true, companyId: "c1" },
  ],
  "свинина шия": [
    { id: "p-pork", externalProductId: 501, slug: "svynyna-shyia", name: "Свинина шия охолоджена", price: 289, ratio: "кг", weighted: true, companyId: "c1" },
  ],
  "лаваш": [
    { id: "p-lavash", externalProductId: 502, slug: "lavash", name: "Лаваш вірменський 300 г", price: 32, ratio: "шт", companyId: "c1" },
  ],
  "кетчуп": [
    { id: "p-ketchup", externalProductId: 503, slug: "ketchup", name: "Кетчуп Торчин 270 г", price: 41, ratio: "шт", companyId: "c1" },
  ],
  "чипси": [
    { id: "p-chips-big", externalProductId: 504, slug: "chypsy-big", name: "Чипси Pringles 165 г", price: 139, ratio: "шт", companyId: "c1" },
  ],
  "вода мінеральна": [
    { id: "p-water", externalProductId: 505, slug: "voda", name: "Вода мінеральна Моршинська 1,5 л", price: 28, ratio: "шт", companyId: "c1" },
  ],
};

export const schemas: SilpoToolSchemas = new Map<string, { properties?: Record<string, object>; required?: string[] }>([
  ["silpo_get_my_shopping_cart", { properties: {} }],
  ["silpo_get_shopping_cart_by_id", { properties: { shoppingCartId: {} }, required: ["shoppingCartId"] }],
  ["silpo_get_time_slots", { properties: { branchId: {}, deliveryType: {}, limit: {} }, required: ["branchId"] }],
  ["silpo_find_products_batch", { properties: { products: { maxItems: 10 } } }],
  ["silpo_get_product_details", { properties: { slug: {} } }],
]);

type Options = {
  /** Shape of batch search responses. */
  shape?: "keyed" | "positional" | "flat";
  failQueries?: string[];
  failDetails?: string[];
  unavailable?: string[];
};

/** A scripted Silpo MCP server: records every call so tests can assert on batching and caching. */
export function createFakeSilpo(options: Options = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const bySlug = new Map(Object.values(catalog).flat().map((product) => [product.slug, product]));
  const searchEntry = (product: FakeProduct) => ({
    id: product.id,
    externalProductId: product.externalProductId,
    slug: product.slug,
    name: product.name,
    price: product.price,
    companyId: product.companyId,
  });
  const text = (value: unknown) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

  const client: ToolClient = {
    callTool: (async ({ name, arguments: args = {} }: { name: string; arguments?: Record<string, unknown> }) => {
      calls.push({ name, args });
      switch (name) {
        case "silpo_get_my_shopping_cart":
          return text({ exists: true, shoppingCartId: "cart-1" });
        case "silpo_get_shopping_cart_by_id":
          return text({ cart: {
            deliveryType: "DeliveryHome",
            shipments: [{ branchId: "branch-1" }],
            timeslot: { start: "2026-09-25T10:00", end: "2026-09-25T12:00" },
          } });
        case "silpo_get_time_slots":
          return text({ slots: [{ start: "2026-09-25T10:00", end: "2026-09-25T12:00", available: true, deliveryType: "DeliveryHome" }] });
        case "silpo_find_products_batch": {
          const queries = args.products as string[];
          if (queries.some((query) => options.failQueries?.includes(query))) {
            if (queries.length > 1) return { isError: true, content: [{ type: "text", text: "batch failed" }] };
            throw new Error(`search failed for ${queries[0]}`);
          }
          const groups = queries.map((query) => (catalog[query] ?? []).map(searchEntry));
          if (options.shape === "positional") return text({ results: groups.map((items) => ({ items })) });
          if (options.shape === "flat" && queries.length > 1) return text({ items: groups.flat() });
          return text({ results: queries.map((query, index) => ({ query, items: groups[index] })) });
        }
        case "silpo_get_product_details": {
          const product = bySlug.get(args.slug as string);
          if (!product) return text({ success: false });
          if (options.failDetails?.includes(product.slug)) throw new Error("details timeout");
          return text({ success: true, product: {
            id: product.id,
            name: product.name,
            price: product.price,
            ratio: product.ratio ?? "шт",
            weighted: product.weighted ?? false,
            ...(product.displayRatio ? { displayRatio: product.displayRatio } : {}),
            available: !(options.unavailable?.includes(product.slug)) && (product.available ?? true),
            attributes: {},
          } });
        }
        default:
          throw new Error(`Unexpected tool ${name}`);
      }
    }) as ToolClient["callTool"],
  };
  return { client, calls, schemas: async () => schemas };
}
