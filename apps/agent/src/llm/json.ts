import { z } from "zod";

import type { ModelRole } from "../mastra/model-config.ts";
import { unlimitedDeadline, type Deadline } from "../pipeline/deadline.ts";

export type TextGenerator = (prompt: string, options: { role: ModelRole; signal: AbortSignal }) => Promise<string>;

export type JsonTask = {
  /** Static task description. Kept first in the prompt so provider-side prefix caching can reuse it. */
  instructions: string;
  /** Per-call data, appended after the instructions and the schema. */
  data: unknown;
  role?: ModelRole;
  timeoutMs?: number;
};

export type Llm = {
  /** Returns schema-valid JSON, retrying once with the validation error; null when the model cannot comply. */
  json<S extends z.ZodType>(schema: S, task: JsonTask): Promise<z.output<S> | null>;
  /** Free text (a short answer to a question); null on failure. */
  text(task: JsonTask): Promise<string | null>;
};

const MIN_RETRY_BUDGET_MS = 8_000;

/** Extracts the first JSON object from model output, tolerating code fences and surrounding prose. */
export function extractJson(value: string): unknown {
  const cleaned = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(cleaned); } catch { /* fall through to the outermost braces */ }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object in model output.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

const schemaText = new WeakMap<z.ZodType, string>();

function describeSchema(schema: z.ZodType) {
  let described = schemaText.get(schema);
  if (!described) {
    try {
      described = JSON.stringify(z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }));
    } catch {
      described = "(see the task description)";
    }
    schemaText.set(schema, described);
  }
  return described;
}

function issuesText(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues.slice(0, 5).map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

export function createLlm(generate: TextGenerator, deadline: Deadline = unlimitedDeadline): Llm {
  async function attempt(prompt: string, role: ModelRole, timeoutMs: number) {
    if (deadline.remaining() < 1_000) throw new Error("Turn deadline reached before the model call.");
    return generate(prompt, { role, signal: deadline.signal(timeoutMs) });
  }

  return {
    async json(schema, task) {
      const role = task.role ?? "fast";
      const timeoutMs = task.timeoutMs ?? 20_000;
      const base = `${task.instructions}\n\nReturn only one JSON object matching this JSON Schema:\n${describeSchema(schema)}\n\nData:\n${JSON.stringify(task.data)}`;
      let prompt = base;
      for (let round = 0; round < 2; round += 1) {
        let output = "";
        try {
          output = await attempt(prompt, role, timeoutMs);
          const parsed = schema.safeParse(extractJson(output));
          if (parsed.success) return parsed.data;
          throw parsed.error;
        } catch (error) {
          const aborted = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
          console.warn(`llm: JSON attempt ${round + 1} failed`, issuesText(error));
          if (aborted || round === 1 || deadline.remaining() < MIN_RETRY_BUDGET_MS) return null;
          prompt = `${base}\n\nYour previous answer was invalid (${issuesText(error)}). Previous answer:\n${output.slice(0, 1500)}\nReturn only the corrected JSON object.`;
        }
      }
      return null;
    },
    async text(task) {
      try {
        const output = await attempt(`${task.instructions}\n\nData:\n${JSON.stringify(task.data)}`, task.role ?? "fast", task.timeoutMs ?? 20_000);
        return output.trim() || null;
      } catch (error) {
        console.warn("llm: text call failed", issuesText(error));
        return null;
      }
    },
  };
}
