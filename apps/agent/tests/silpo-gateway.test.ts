import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSilpoProduct, serializeSilpoOperation } from "../src/silpo/gateway.ts";

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

test("normalizes the real Silpo product-detail shape", () => {
  assert.deepEqual(normalizeSilpoProduct({
    success: true,
    product: {
      id: "sku-1",
      externalProductId: 123,
      name: "Apple juice 1.5 l",
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
