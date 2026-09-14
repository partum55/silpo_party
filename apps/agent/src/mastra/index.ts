import { Mastra } from "@mastra/core/mastra";
import { VercelDeployer } from "@mastra/deployer-vercel";

import { partyPlannerAgent } from "./party-planner-agent.ts";
import { conversationalPartyWorkflow } from "./conversational-workflow.ts";
import { partyPlanningWorkflow } from "./party-planning-workflow.ts";
import { findRecipeTool } from "./tools/recipe-tool.ts";
import {
  silpoGetProductDetails,
  silpoGetReplacements,
  silpoGetSimilarProducts,
  silpoSearchProducts,
} from "./tools/silpo-tools.ts";

export const mastra = new Mastra({
  deployer: new VercelDeployer(),
  agents: { partyPlannerAgent },
  workflows: { partyPlanningWorkflow, conversationalPartyWorkflow },
  tools: { silpoSearchProducts, silpoGetProductDetails, silpoGetSimilarProducts, silpoGetReplacements, findRecipeTool },
});

// Re-exported for the root app's cart-finalize flow (apps/agent's package.json "exports" only exposes this
// entry point, so subpath imports like "@silpo-party/agent/silpo/gateway" would not resolve).
export { createSilpoGateway, extractCheckoutUrl, type CartLineItem } from "../silpo/gateway.ts";
