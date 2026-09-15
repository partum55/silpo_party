import assert from "node:assert/strict";
import test from "node:test";

import { parseRecipeMessage } from "../src/lib/chat/recipe-message.ts";

test("parses an agent recipe into card sections", () => {
  const result = parseRecipeMessage("План вечірки оновлено. Рецепт «Паста карбонара» (1 порц.):\nІнгредієнти:\n• Спагеті — 100 г\n• Яйця — 2 шт.\nПриготування:\n1. Відваріть пасту.\n2. Додайте соус.");

  assert.deepEqual(result, {
    prefix: "План вечірки оновлено.",
    title: "Паста карбонара",
    servings: "1 порц.",
    ingredients: ["Спагеті — 100 г", "Яйця — 2 шт."],
    steps: ["Відваріть пасту.", "Додайте соус."],
    source: null,
  });
});

test("ordinary agent messages remain ordinary text", () => {
  assert.equal(parseRecipeMessage("План вечірки оновлено."), null);
});
