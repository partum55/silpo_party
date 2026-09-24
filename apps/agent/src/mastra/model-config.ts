export const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-pro";

const LEGACY_MODEL_ALIASES: Record<string, string> = {
  "deepseek-chat": DEFAULT_DEEPSEEK_MODEL,
  "deepseek-flash": DEFAULT_DEEPSEEK_MODEL,
  "deepseek-v4-flash": DEFAULT_DEEPSEEK_MODEL,
};

export function resolveDeepSeekModel(configuredModel = process.env.AI_MODEL) {
  const model = configuredModel?.trim() || DEFAULT_DEEPSEEK_MODEL;
  return LEGACY_MODEL_ALIASES[model] ?? model;
}

export type ModelRole = "fast" | "smart";

/**
 * Model per job: "fast" parses messages and picks products, "smart" writes recipes and event checklists.
 * AI_MODEL_FAST / AI_MODEL_SMART override AI_MODEL for one role; unset roles share AI_MODEL.
 */
export function resolveRoleModel(role: ModelRole, env: Record<string, string | undefined> = process.env) {
  const specific = role === "fast" ? env.AI_MODEL_FAST : env.AI_MODEL_SMART;
  return specific?.trim() ? specific.trim() : resolveDeepSeekModel(env.AI_MODEL);
}
