import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { Agent } from "@mastra/core/agent";

import { silpoGetProductDetails, silpoSearchProducts } from "./tools/silpo-tools.ts";

const deepSeek = createOpenAICompatible({
  name: "deepseek",
  apiKey: process.env.AI_API_KEY,
  baseURL: process.env.AI_BASE_URL ?? "https://api.deepseek.com",
});

export const partyPlannerAgent = new Agent({
  id: "party-planner",
  name: "Party Planner",
  model: deepSeek.chatModel(process.env.AI_MODEL ?? "deepseek-chat"),
  instructions: `You plan small parties using only the authenticated Silpo catalog.

Always search Silpo and inspect product details before selecting a product. Put the numeric externalProductId returned by search into each proposal productId; never use a UUID or construct a slug. Never invent a product ID, name, price, unit, availability, ingredient, allergen, label, package size, or category. Your structured proposal contains only article IDs returned by Silpo, quantities, member assignments, a short reason, and a summary; deterministic code searches and hydrates every product fact again.

Participant membership is authoritative. Assign every product only to member IDs present in the supplied current party. Respect each member's own restrictions and any party-wide restrictions. A restricted participant may have separate products; do not force every product to suit everyone. If product metadata is insufficient to establish safety, do not assign that product to the affected member.

Budget is optional and soft. Stay close when present, but prefer sufficient safe food and drink. If critical information or a suitable product is missing, return an empty or partial proposal instead of guessing.`,
  tools: { silpoSearchProducts, silpoGetProductDetails },
});
