import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

import { createLlm, extractJson } from "../src/llm/json.ts";

const schema = z.object({ items: z.array(z.string()) });

test("extracts JSON from fenced or chatty model output", () => {
  assert.deepEqual(extractJson("```json\n{\"a\":1}\n```"), { a: 1 });
  assert.deepEqual(extractJson("Ось відповідь: {\"a\": {\"b\": 2}} Дякую!"), { a: { b: 2 } });
  assert.throws(() => extractJson("no json"));
});

test("retries once with the validation error and then succeeds", async () => {
  const prompts: string[] = [];
  const llm = createLlm(async (prompt) => {
    prompts.push(prompt);
    return prompts.length === 1 ? "{\"items\": \"not an array\"}" : "{\"items\": [\"картопля\"]}";
  });
  assert.deepEqual(await llm.json(schema, { instructions: "task", data: {} }), { items: ["картопля"] });
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /previous answer was invalid/);
});

test("returns null instead of throwing when the model keeps failing", async () => {
  let calls = 0;
  const llm = createLlm(async () => { calls += 1; throw new Error("503"); });
  assert.equal(await llm.json(schema, { instructions: "task", data: {} }), null);
  assert.equal(calls, 2);
  assert.equal(await llm.text({ instructions: "task", data: {} }), null);
});

test("puts static instructions and the schema before per-call data", async () => {
  let seen = "";
  const llm = createLlm(async (prompt) => { seen = prompt; return "{\"items\": []}"; });
  await llm.json(schema, { instructions: "STATIC TASK", data: { message: "dynamic" } });
  assert.ok(seen.indexOf("STATIC TASK") < seen.indexOf("JSON Schema"));
  assert.ok(seen.indexOf("JSON Schema") < seen.indexOf("dynamic"));
});
