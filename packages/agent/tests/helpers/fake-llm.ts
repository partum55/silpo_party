import type { z } from "zod";

import type { Llm, LlmTask } from "../../src/llm/llm.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each rule reads its own task's data shape
type Handler = (data: any, task: LlmTask) => unknown;

/**
 * A scripted model: each rule matches on a phrase from the task instructions and returns the answer (an object,
 * or text). `null` simulates a model failure. Answers are validated against the task's schema, so a rule that
 * returns the wrong shape fails the test instead of passing silently.
 */
export function createFakeLlm(rules: Array<[needle: string, handler: Handler]>) {
  const prompts: LlmTask[] = [];
  const answer = (task: LlmTask) => {
    prompts.push(task);
    const rule = rules.find(([needle]) => task.instructions.includes(needle));
    if (!rule) throw new Error(`No fake LLM rule for task: ${task.instructions.slice(0, 120)}`);
    return rule[1](task.data, task);
  };
  const llm: Llm = {
    async json<S extends z.ZodType>(schema: S, task: LlmTask) {
      const value = answer(task);
      return value === null ? null : schema.parse(value) as z.output<S>;
    },
    async text(task) {
      const value = answer(task);
      return value === null ? null : String(value);
    },
  };
  return { llm, prompts };
}

/** Picks the first candidate whose name contains a word from the request, the way a sensible model would. */
export function pickByName(data: { needs: Array<{ key: string; request: string; candidates: Array<{ index: number; name: string }> }> }) {
  return {
    choices: data.needs.map((need) => {
      const stem = need.request.toLocaleLowerCase("uk").slice(0, 5);
      const match = need.candidates.find((candidate) => candidate.name.toLocaleLowerCase("uk").includes(stem)
        && (!/чипси/i.test(candidate.name) || /чипс/i.test(need.request)));
      return { key: need.key, index: match ? match.index : null };
    }),
  };
}
