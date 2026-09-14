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
  server: {
    // Deployed standalone (see AGENT_URL in the root app), so every route needs a caller check: without this,
    // anyone with the deployment URL could run workflows with an arbitrary silpoUserId in requestContext and
    // act against a stranger's Silpo account. The root app sends this as a bearer token (see src/lib/agent/runner.ts).
    auth: {
      authenticateToken: async (token: string) => {
        const expected = process.env.AGENT_INTERNAL_TOKEN;
        if (!expected) throw new Error("Missing environment variable: AGENT_INTERNAL_TOKEN");
        return token === expected ? { id: "web-backend" } : null;
      },
    },
  },
});

// Re-exported for the root app's cart-finalize flow (apps/agent's package.json "exports" only exposes this
// entry point, so subpath imports like "@silpo-party/agent/silpo/gateway" would not resolve).
export { createSilpoGateway, extractCheckoutUrl, type CartLineItem } from "../silpo/gateway.ts";
