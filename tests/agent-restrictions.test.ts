import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("chat turns never read food restrictions from the Silpo profile", () => {
  const runner = readFileSync(new URL("../src/lib/agent/runner.ts", import.meta.url), "utf8");
  const gateway = readFileSync(new URL("../apps/agent/src/silpo/gateway.ts", import.meta.url), "utf8");

  assert.match(runner, /restrictions:\s*\[\]/);
  assert.doesNotMatch(runner, /getFoodRestrictions|silpo_get_my_food_restrictions/);
  assert.doesNotMatch(gateway, /call\([^\n]*silpo_get_my_food_restrictions/);
});
