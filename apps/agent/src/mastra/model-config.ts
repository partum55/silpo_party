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
