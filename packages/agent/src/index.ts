// Public API of the agent, used by the web app (src/lib/agent, src/lib/cart). Internal modules are not imported
// directly from outside this package.

export { MODEL_ID, RECENT_MESSAGE_CHARS, RECENT_MESSAGES, TURN_BUDGET_MS } from "./config.ts";
export { agentCache } from "./cache/index.ts";
export {
  turnInputSchema,
  type Member,
  type PlanningMode,
  type RecentMessage,
  type TurnInput,
  type TurnReply,
  type TurnReport,
  type TurnResult,
  type Wish,
} from "./domain/contract.ts";
export { planSchema, type PartyPlan, type VerifiedProduct } from "./domain/plan.ts";
export { productLineTotalUah, silpoCartQuantity, type PurchasableProduct } from "./domain/purchasing.ts";
export { createDeepSeekLlm, type Llm } from "./llm/llm.ts";
export { readFoodRestrictions, withCatalogSession, type CatalogSession, type DetailsOutcome } from "./silpo/catalog.ts";
export { extractCheckoutUrl, type CartLineItem } from "./silpo/gateway.ts";
export { createDeadline } from "./turn/deadline.ts";
export { formatReply } from "./turn/reply.ts";
export { AGENT_UNAVAILABLE_RESPONSE, runTurn, type TurnDeps } from "./turn/run-turn.ts";
