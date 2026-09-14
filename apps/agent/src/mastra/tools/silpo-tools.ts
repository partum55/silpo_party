import { createTool } from "@mastra/core/tools";
import type { RequestContext } from "@mastra/core/request-context";
import { z } from "zod";

import { createSilpoGateway } from "../../silpo/gateway.ts";

export function silpoUserId(requestContext: RequestContext) {
  const userId = (requestContext.get("silpoUserId") as string | undefined) ?? process.env.SILPO_USER_ID;
  if (!userId) throw new Error("No Silpo user id in requestContext and no SILPO_USER_ID fallback is set.");
  return userId;
}

function gateway(requestContext: RequestContext) {
  return createSilpoGateway(silpoUserId(requestContext));
}

export const silpoSearchProducts = createTool({
  id: "silpo-search-products",
  description: "Search the authenticated user's real Silpo product catalog. Returns only live MCP data.",
  inputSchema: z.object({ query: z.string().min(1) }),
  outputSchema: z.object({ data: z.unknown() }),
  execute: async ({ query }, { requestContext }) => ({ data: await gateway(requestContext).search(query) }),
});

export const silpoGetProductDetails = createTool({
  id: "silpo-get-product-details",
  description: "Inspect current details for a numeric Silpo externalProductId returned by search.",
  inputSchema: z.object({ productId: z.string().min(1) }),
  outputSchema: z.object({ data: z.unknown() }),
  execute: async ({ productId }, { requestContext }) => ({ data: await gateway(requestContext).hydrate(productId) }),
});

export const silpoGetSimilarProducts = createTool({
  id: "silpo-get-similar-products",
  description: "Get live Silpo alternatives for a searched product so candidates can be compared before selection.",
  inputSchema: z.object({ productId: z.string().min(1) }),
  outputSchema: z.object({ data: z.unknown() }),
  execute: async ({ productId }, { requestContext }) => ({ data: await gateway(requestContext).similar(productId) }),
});

export const silpoGetReplacements = createTool({
  id: "silpo-get-replacements",
  description: "Get live Silpo replacements for an unavailable searched product.",
  inputSchema: z.object({ productId: z.string().min(1) }),
  outputSchema: z.object({ data: z.unknown() }),
  execute: async ({ productId }, { requestContext }) => ({ data: await gateway(requestContext).replacements(productId) }),
});
