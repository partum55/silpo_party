/**
 * Every tuning knob of the agent, with where its value comes from. Latencies were measured against the live
 * DeepSeek API and Silpo catalog on 2026-09-24 (16-item event checklist, see evals/).
 */

/** The only model the agent uses. Hidden reasoning is switched per call (see llm/llm.ts). */
export const MODEL_ID = "deepseek-flash";

/** Wall-clock budget for one chat turn, shared by every model and Silpo call inside it. */
export const TURN_BUDGET_MS = 75_000;

/** Per-call model timeouts; the turn deadline still caps each one. */
export const MODEL_TIMEOUT_MS = {
  /** Message routing, no reasoning: ~1-3 s. */
  route: 20_000,
  /** One pick batch, no reasoning: ~1 s, rare outliers past 15 s. */
  pick: 25_000,
  /** Short answer to a question about the plan, no reasoning. */
  answer: 15_000,
  /** Recipe with reasoning: 12 s measured. */
  recipe: 45_000,
  /** Event checklist with reasoning: 27 s measured. */
  checklist: 45_000,
} as const;

/** A model call is skipped (and its items fall back) when less than this remains of the turn budget. */
export const MIN_MODEL_BUDGET_MS = 6_000;

/**
 * Search hits shown to the product picker per need (Silpo returns up to 10 per query). 8 instead of 4 lets it
 * compare brands and sizes for +1 s of product-detail calls on a 16-item checklist.
 */
export const CANDIDATES_PER_NEED = 8;

/**
 * Needs per product-picker call. One call for a whole 16-item checklist (~8k chars) outran its timeout and
 * left every item to the raw top search hit; small parallel batches fail independently.
 */
export const PICK_BATCH_SIZE = 4;

/** Chat messages before the current one that the router sees, to resolve "поміняй назад" or "ще одну таку". */
export const RECENT_MESSAGES = 8;
/** Long agent replies (event lists) are cut to this length in that history. */
export const RECENT_MESSAGE_CHARS = 600;

/** Recipes are generated for this many servings and scaled to the members who want the dish. */
export const RECIPE_BASE_SERVINGS = 4;
