import { Mastra } from "@mastra/core/mastra";

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
  // A chat turn can chain several LLM calls plus Silpo MCP round-trips (schema discovery, cart context,
  // timeslot check, search, hydrate — repeated per tool call up to maxSteps: 20). That easily exceeds a
  // default serverless timeout, which would kill the function mid-run and leave the party's agent_status
  // stuck at THINKING forever (the compare-and-swap lock in chat/service.ts only releases from
  // IDLE/DONE/ERROR). The standalone service avoids a serverless invocation deadline.
  agents: { partyPlannerAgent },
  workflows: { partyPlanningWorkflow, conversationalPartyWorkflow },
  tools: { silpoSearchProducts, silpoGetProductDetails, silpoGetSimilarProducts, silpoGetReplacements, findRecipeTool },
  server: {
    // Mastra otherwise applies its 180-second Hono request timeout. A recipe turn can legitimately exceed
    // that while the model searches and hydrates several Silpo ingredients, which surfaced as a local 504.
    timeout: 900_000,
    // Keep the shutdown grace period aligned so a rolling deploy does not cut off an allowed request early.
    drainTimeout: 900_000,
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
