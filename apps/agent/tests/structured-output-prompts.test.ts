import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

// DeepSeek's OpenAI-compatible API rejects response_format: "json_object" with
// "Prompt must contain the word 'json' in some form" unless the prompt text itself mentions it —
// JSON.stringify(...) interpolated into the string does not count, since its output never spells the word.
// This guards every structuredOutput call site against that regression.

const dir = path.dirname(fileURLToPath(import.meta.url));

function promptsUsingStructuredOutput(relativePath: string) {
  const source = readFileSync(path.join(dir, "..", relativePath), "utf8");
  const prompts: string[] = [];
  const pattern = /`([^`]*)`\s*,\s*\{\s*structuredOutput/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) prompts.push(match[1]);
  return prompts;
}

test("every structuredOutput prompt mentions 'json'", () => {
  const files = ["src/mastra/party-planning-workflow.ts", "src/mastra/conversational-workflow.ts"];
  let total = 0;
  for (const file of files) {
    const prompts = promptsUsingStructuredOutput(file);
    total += prompts.length;
    for (const prompt of prompts) {
      assert.match(prompt, /json/i, `prompt in ${file} is missing the word "json": ${prompt.slice(0, 80)}...`);
    }
  }
  assert.equal(total, 4, "expected 4 structuredOutput call sites across these files; update this count if you add/remove one");
});

test("the agent contract and deterministic replies require Ukrainian", () => {
  const agent = readFileSync(path.join(dir, "..", "src/mastra/party-planner-agent.ts"), "utf8");
  const conversation = readFileSync(path.join(dir, "..", "src/mastra/conversational-workflow.ts"), "utf8");

  assert.match(agent, /every user-facing value in Ukrainian/i);
  assert.match(conversation, /План вечірки оновлено/);
  assert.doesNotMatch(conversation, /Party plan updated|Sorry,|I updated the draft/);
});
