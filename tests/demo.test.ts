import assert from "node:assert/strict";
import test from "node:test";

import { SCENARIOS } from "../src/demo/scenarios.ts";
import { parseRecipeMessages } from "../src/lib/chat/recipe-message.ts";

test("every scenario is internally consistent", () => {
  for (const scenario of SCENARIOS) {
    const ids = new Set(scenario.members.map((member) => member.user_id));
    const itemIds = scenario.steps.flatMap((step) => step.items.map((item) => item.id));
    assert.equal(new Set(itemIds).size, itemIds.length, `${scenario.id}: duplicate item ids`);
    for (const step of scenario.steps) {
      assert.ok(ids.has(step.from), `${scenario.id}: unknown author ${step.from}`);
      for (const item of step.items) for (const payer of item.payers) assert.ok(ids.has(payer), `${scenario.id}: unknown payer ${payer}`);
      if (step.recipes) {
        assert.equal(parseRecipeMessages(step.reply)?.recipes.length, step.recipes.length, `${scenario.id}: recipe message does not parse`);
        const cost = step.items.reduce((sum, item) => sum + item.price * item.qty, 0);
        assert.ok(Math.abs(cost - step.recipes.reduce((sum, recipe) => sum + recipe.cost_uah, 0)) < 0.005, `${scenario.id}: recipe cost != items`);
      }
    }
  }
});
