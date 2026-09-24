import assert from "node:assert/strict";
import test from "node:test";

import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";

import { createLlm } from "../src/llm/llm.ts";
import { createDeadline } from "../src/turn/deadline.ts";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

/** A model that answers each call with the next text, recording what it was asked. */
function scriptedModel(answers: string[]) {
  const calls: Array<{ system: string; thinking: unknown }> = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      const system = options.prompt.find((message) => message.role === "system");
      calls.push({
        system: typeof system?.content === "string" ? system.content : "",
        thinking: (options.providerOptions?.deepseek as { thinking?: unknown } | undefined)?.thinking,
      });
      const text = answers[Math.min(calls.length - 1, answers.length - 1)];
      return { content: [{ type: "text", text }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] };
    },
  });
  return { model, calls };
}

const schema = z.object({ items: z.array(z.string()) });
const task = { instructions: "List the items.", data: { message: "молоко і хліб" }, timeoutMs: 5_000 } as const;

test("returns the schema-valid object, with reasoning off for fast jobs and on for smart ones", async () => {
  const { model, calls } = scriptedModel(['{"items":["молоко","хліб"]}']);
  const llm = createLlm(model);
  assert.deepEqual(await llm.json(schema, { ...task, role: "fast" }), { items: ["молоко", "хліб"] });
  await llm.json(schema, { ...task, role: "smart" });
  assert.deepEqual(calls.map((call) => call.thinking), [{ type: "disabled" }, { type: "enabled" }]);
});

test("an answer that breaks the schema gets one correction, then null", async () => {
  const fixed = scriptedModel(['{"items":"молоко"}', '{"items":["молоко"]}']);
  assert.deepEqual(await createLlm(fixed.model).json(schema, { ...task, role: "fast" }), { items: ["молоко"] });
  assert.match(fixed.calls[1].system, /did not match the required JSON schema/);

  const stubborn = scriptedModel(['{"items":"молоко"}']);
  assert.equal(await createLlm(stubborn.model).json(schema, { ...task, role: "fast" }), null);
  assert.equal(stubborn.calls.length, 2);
});

test("a timed-out call returns null without a retry", async () => {
  let calls = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async ({ abortSignal }) => {
      calls += 1;
      await new Promise((_, reject) => abortSignal?.addEventListener("abort", () => reject(abortSignal.reason)));
      throw new Error("unreachable");
    },
  });
  assert.equal(await createLlm(model).json(schema, { ...task, role: "fast", timeoutMs: 20 }), null);
  assert.equal(calls, 1);
});

test("no call is made once the turn deadline is spent", async () => {
  const { model, calls } = scriptedModel(['{"items":[]}']);
  const deadline = createDeadline(500);
  assert.equal(await createLlm(model, deadline).json(schema, { ...task, role: "fast" }), null);
  assert.equal(calls.length, 0);
});
