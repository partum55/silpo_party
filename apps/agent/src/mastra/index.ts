import { Mastra } from "@mastra/core/mastra";
import { SimpleAuth } from "@mastra/core/server";
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
  silpoSearchVerifiedProducts,
} from "./tools/silpo-tools.ts";

const internalToken = process.env.AGENT_INTERNAL_TOKEN;
const internalUsers = internalToken
  ? { [internalToken]: { id: "web-backend", name: "Silpo Party Studio", role: "admin" } }
  : {};
export const mastra = new Mastra({
  // A chat turn can chain several LLM calls plus Silpo MCP round-trips (schema discovery, cart context,
  // timeslot check, search, hydrate — repeated per tool call up to maxSteps: 20). That easily exceeds a
  // default serverless timeout, which would kill the function mid-run and leave the party's agent_status
  // stuck at THINKING forever (the compare-and-swap lock in chat/service.ts only releases from
  // IDLE/DONE/ERROR). The standalone service avoids a serverless invocation deadline.
  //
  // Railway/Render run that standalone build (`mastra build` -> `.mastra/output/index.mjs`, see
  // railway.agent.toml / scripts/start-combined.mjs). Vercel is a *second*, separately deployed project for
  // this same app — but setting `deployer` switches what `mastra build` emits for every caller: with it set,
  // the CLI stops producing `.mastra/output` entirely and only emits `.vercel/output`, which broke the
  // Railway/Render start command. So the Vercel deployer is only wired in when building on Vercel itself
  // (which sets VERCEL=1 for both build and runtime); everywhere else the build stays standalone.
  deployer: process.env.VERCEL ? new VercelDeployer({ maxDuration: 300 }) : undefined,
  agents: { partyPlannerAgent },
  workflows: { partyPlanningWorkflow, conversationalPartyWorkflow },
  tools: { silpoSearchProducts, silpoSearchVerifiedProducts, silpoGetProductDetails, silpoGetSimilarProducts, silpoGetReplacements, findRecipeTool },
  server: {
    // Mastra otherwise applies its 180-second Hono request timeout. A recipe turn can legitimately exceed
    // that while the model searches and hydrates several Silpo ingredients, which surfaced as a local 504.
    timeout: 900_000,
    // Keep the shutdown grace period aligned so a rolling deploy does not cut off an allowed request early.
    drainTimeout: 900_000,
    // Deployed standalone (see AGENT_URL in the root app), so every route needs a caller check: without this,
    // anyone with the deployment URL could run workflows with an arbitrary silpoUserId in requestContext and
    // act against a stranger's Silpo account. The root app sends this as a bearer token (see src/lib/agent/runner.ts).
    // SimpleAuth still accepts the web backend's Authorization: Bearer token, while also exposing enough
    // authentication capability metadata for Studio's auth_header token handoff to establish a user session.
    // An absent token produces an empty allow-list, so a misconfigured deployment fails closed.
    auth: new SimpleAuth({ tokens: internalUsers }),
  },
});

// Re-exported for the root app's cart-finalize flow (apps/agent's package.json "exports" only exposes this
// entry point, so subpath imports like "@silpo-party/agent/silpo/gateway" would not resolve).
export { createSilpoGateway, extractCheckoutUrl, type CartLineItem } from "../silpo/gateway.ts";
