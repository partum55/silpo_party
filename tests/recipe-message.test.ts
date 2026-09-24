import assert from "node:assert/strict";
import test from "node:test";

import { parseRecipeMessage, parseRecipeMessages } from "../src/lib/chat/recipe-message.ts";

test("parses several recipes from one agent reply", () => {
  const result = parseRecipeMessages("Додано: «Спагеті». Не додано: «пармезан» — у Сільпо нічого не знайдено.\n\nРецепт «Карбонара» (1 порц.):\nІнгредієнти:\n• спагеті — 100 г\nПриготування:\n1. Відваріть.\n\nРецепт «Борщ» (2 порц.):\nІнгредієнти:\n• буряк — 250 г\n• пармезан — 20 г (не знайдено в Сільпо)\nПриготування:\n1. Зваріть.\n2. Подавайте.");

  assert.equal(result?.prefix, "Додано: «Спагеті». Не додано: «пармезан» — у Сільпо нічого не знайдено.");
  assert.deepEqual(result?.recipes.map((recipe) => [recipe.title, recipe.steps.length]), [["Карбонара", 1], ["Борщ", 2]]);
  assert.equal(result?.recipes[1].ingredients[1], "пармезан — 20 г (не знайдено в Сільпо)");
});

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
