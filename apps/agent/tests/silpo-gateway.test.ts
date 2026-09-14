import assert from "node:assert/strict";
import test from "node:test";

import {
  extractFoodRestrictions,
  extractSearchProductIds,
  hasTimeslot,
  listSilpoToolSchemas,
  normalizeSilpoProduct,
  serializeSilpoOperation,
  toolArguments,
  withTimeout,
} from "../src/silpo/gateway.ts";

const requiredTools = [
  "silpo_get_my_food_restrictions",
  "silpo_get_my_shopping_cart",
  "silpo_get_shopping_cart_by_id",
  "silpo_get_time_slots",
  "silpo_find_products_batch",
  "silpo_get_product_details",
  "silpo_get_similar_products",
  "silpo_get_replacements",
];

test("normalizes active food restrictions from Silpo profile responses", () => {
  assert.deepEqual(extractFoodRestrictions({
    success: true,
    foodRestrictions: [
      { name: "Без лактози", selected: true },
      { label: "Без глютену", enabled: false },
      { code: "vegetarian", active: true },
      { slug: "no-added-sugar", name: null },
      { slug: "all-food", name: null },
      { slug: "lactoza", name: null },
    ],
  }), ["Без лактози", "vegetarian", "no-added-sugar", "lactose"]);

  assert.deepEqual(extractFoodRestrictions({
    content: [{ type: "text", text: JSON.stringify({ restrictions: { lactoseFree: true, vegan: false } }) }],
  }), ["lactoseFree"]);

  assert.deepEqual(extractFoodRestrictions({
    data: { dietaryRestrictions: [{ title: "Vegan", status: "active" }] },
  }), ["Vegan"]);
});

test("extracts unique external product ids from Silpo search candidates", () => {
  assert.deepEqual(extractSearchProductIds({ groups: [{ items: [
    { id: "internal-a", externalProductId: 101 },
    { id: "internal-b", externalProductId: "202" },
    { id: "duplicate", externalProductId: 101 },
  ] }] }), ["101", "202"]);
});

test("discovers paginated MCP tools and keeps their live input schemas", async () => {
  const cursors: Array<string | undefined> = [];
  const client = { listTools: async (params?: { cursor?: string }) => {
    cursors.push(params?.cursor);
    const names = params?.cursor ? requiredTools.slice(3) : requiredTools.slice(0, 3);
    return {
      tools: names.map((name) => ({ name, inputSchema: { type: "object" as const, properties: { branchId: {} } } })),
      nextCursor: params?.cursor ? undefined : "next-page",
    };
  } } as unknown as Parameters<typeof listSilpoToolSchemas>[0];

  const schemas = await listSilpoToolSchemas(client);
  assert.deepEqual(cursors, [undefined, "next-page"]);
  assert.ok(schemas.has("silpo_get_replacements"));
});

test("fails discovery when a required MCP tool is unavailable", async () => {
  const client = { listTools: async () => ({
    tools: requiredTools.slice(0, -1).map((name) => ({ name, inputSchema: { type: "object" as const } })),
  }) } as unknown as Parameters<typeof listSilpoToolSchemas>[0];
  await assert.rejects(listSilpoToolSchemas(client), /silpo_get_replacements/);
});

test("builds MCP arguments only from the discovered schema", () => {
  assert.deepEqual(toolArguments({
    properties: { branchId: {}, slug: {} },
    required: ["branchId", "slug"],
  }, [{ branchId: "branch", ignored: true }, { slug: "product-slug" }]), {
    branchId: "branch",
    slug: "product-slug",
  });
  assert.throws(() => toolArguments({ properties: { slug: {} }, required: ["slug"] }, [{}]), /slug/);
});

test("validates the active cart timeslot against the live slot response", () => {
  assert.equal(hasTimeslot({ days: [{ slots: [{ start: "2026-09-14T10:00", end: "2026-09-14T12:00" }] }] },
    "2026-09-14T10:00", "2026-09-14T12:00"), true);
  assert.equal(hasTimeslot({ slots: [] }, "2026-09-14T10:00", "2026-09-14T12:00"), false);
});

test("serializes Silpo operations per user to protect OAuth refresh tokens", async () => {
  let active = 0;
  let maximum = 0;
  const operation = () => serializeSilpoOperation("user-1", async () => {
    maximum = Math.max(maximum, ++active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
  });
  await Promise.all([operation(), operation(), operation()]);
  assert.equal(maximum, 1);
});

test("bounds a stalled Silpo operation", async () => {
  await assert.rejects(
    withTimeout(new Promise(() => {}), 5, "catalog lookup"),
    /catalog lookup timed out after 5ms/,
  );
});

test("normalizes the real Silpo product-detail shape", () => {
  assert.deepEqual(normalizeSilpoProduct({
    success: true,
    product: {
      id: "sku-1",
      externalProductId: 123,
      name: "Apple juice 1.5 l",
      image: { url: "https://images.silpo.ua/apple-juice.webp" },
      price: 72.5,
      available: true,
      stock: 4,
      ratio: "шт",
      weighted: false,
      displayRatio: "1.5 l",
      attributes: {
        Ingredients: "apple juice, vitamin C",
        Allergens: "none",
        Labels: "vegan",
      },
    },
  }, "sku-1"), {
    id: "sku-1",
    name: "Apple juice 1.5 l",
    imageUrl: "https://images.silpo.ua/apple-juice.webp",
    priceUah: 72.5,
    unit: "шт",
    available: true,
    weighted: false,
    category: "drink",
    packageSize: { amount: 1500, unit: "ml" },
    metadata: {
      ingredients: ["apple juice, vitamin C"],
      allergens: ["none"],
      labels: ["vegan"],
      composition: [],
    },
  });
});

test("refuses details without an exact matching id or price", () => {
  assert.equal(normalizeSilpoProduct({ id: "other", name: "Product", price: 10 }, "wanted"), null);
  assert.equal(normalizeSilpoProduct({ id: "wanted", name: "Product" }, "wanted"), null);
});

test("uses the search-result image when product details omit it", () => {
  const result = normalizeSilpoProduct({ product: {
    id: "juice",
    name: "Сік яблучний 1 л",
    price: 70,
    available: true,
    ratio: "шт",
    displayRatio: "1 л",
    attributes: {},
  } }, "juice", { images: ["https://images.silpo.ua/juice.webp"] });

  assert.equal(result?.imageUrl, "https://images.silpo.ua/juice.webp");
});

test("uses kilograms as the sell unit for weighted products", () => {
  const result = normalizeSilpoProduct({
    product: {
      id: "weighted",
      name: "Томати вагові",
      price: 90,
      available: true,
      stock: 5,
      ratio: "кг",
      weighted: true,
      displayRatio: "100г",
      attributes: {},
    },
  }, "weighted");

  assert.equal(result?.weighted, true);
  assert.equal(result?.unit, "кг");
  assert.deepEqual(result?.packageSize, { amount: 100, unit: "g" });
});

test("normalizes piece-count recipe products", () => {
  const result = normalizeSilpoProduct({ product: {
    id: "eggs",
    name: "Яйця курячі 10шт",
    price: 70,
    available: true,
    ratio: "шт",
    weighted: false,
    displayRatio: "10шт",
    attributes: {},
  } }, "eggs");

  assert.equal(result?.category, "food");
  assert.deepEqual(result?.packageSize, { amount: 10, unit: "piece" });
});
