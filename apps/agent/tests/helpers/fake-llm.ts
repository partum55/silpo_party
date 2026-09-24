import { createLlm, type TextGenerator } from "../../src/llm/json.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each rule reads its own task's data shape
type Handler = (data: any, prompt: string) => unknown;

/**
 * A scripted model: each rule matches on a phrase from the task instructions and returns a JSON-able value
 * (or a raw string). `null` simulates a model failure (the generator throws).
 */
export function createFakeLlm(rules: Array<[needle: string, handler: Handler]>) {
  const prompts: string[] = [];
  const generate: TextGenerator = async (prompt) => {
    prompts.push(prompt);
    const dataStart = prompt.lastIndexOf("\n\nData:\n");
    const data = dataStart >= 0 ? JSON.parse(prompt.slice(dataStart + "\n\nData:\n".length).split("\n\nYour previous answer")[0]) : null;
    for (const [needle, handler] of rules) {
      if (!prompt.includes(needle)) continue;
      const value = handler(data, prompt);
      if (value === null) throw new Error("model unavailable");
      return typeof value === "string" ? value : JSON.stringify(value);
    }
    throw new Error(`No fake LLM rule for prompt: ${prompt.slice(0, 120)}`);
  };
  return { llm: createLlm(generate), prompts };
}

/** Picks the first candidate whose name contains a word from the request, the way a sensible model would. */
export function pickByName(data: { needs: Array<{ key: string; request: string; candidates: Array<{ index: number; name: string }> }> }) {
  return {
    choices: data.needs.map((need) => {
      const stem = need.request.toLocaleLowerCase("uk").slice(0, 5);
      const match = need.candidates.find((candidate) => candidate.name.toLocaleLowerCase("uk").includes(stem)
        && !/чипси/i.test(candidate.name));
      return { key: need.key, index: match ? match.index : null };
    }),
  };
}
