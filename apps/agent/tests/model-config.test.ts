import assert from "node:assert/strict";
import test from "node:test";

import { resolveDeepSeekModel } from "../src/mastra/model-config.ts";

test("uses the responsive DeepSeek pro model by default", () => {
  assert.equal(resolveDeepSeekModel(undefined), "deepseek-v4-pro");
  assert.equal(resolveDeepSeekModel("  "), "deepseek-v4-pro");
});

test("maps retired DeepSeek model names used by existing deployments", () => {
  assert.equal(resolveDeepSeekModel("deepseek-chat"), "deepseek-v4-pro");
  assert.equal(resolveDeepSeekModel("deepseek-flash"), "deepseek-v4-pro");
  assert.equal(resolveDeepSeekModel("deepseek-v4-flash"), "deepseek-v4-pro");
});

test("preserves explicitly configured current models", () => {
  assert.equal(resolveDeepSeekModel("deepseek-v4-pro"), "deepseek-v4-pro");
});
