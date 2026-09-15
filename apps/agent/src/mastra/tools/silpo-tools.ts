import { createTool } from "@mastra/core/tools";
import type { RequestContext } from "@mastra/core/request-context";
import { z } from "zod";

import { createSilpoGateway } from "../../silpo/gateway.ts";

export function silpoUserId(requestContext: RequestContext) {
  const userId = (requestContext.get("silpoUserId") as string | undefined) ?? process.env.SILPO_USER_ID;
  if (!userId) throw new Error("No Silpo user id in requestContext and no SILPO_USER_ID fallback is set.");
  return userId;
}

const GATEWAY_CACHE_MS = 120_000;
const userGateways = new Map<string, {
  gateway: ReturnType<typeof createSilpoGateway>;
  expiresAt: number;
}>();

export function cachedSilpoGateway(userId: string) {
  const cached = userGateways.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.gateway;

  const instance = createSilpoGateway(userId);
  const entry = { gateway: instance, expiresAt: Date.now() + GATEWAY_CACHE_MS };
  userGateways.set(userId, entry);
  const cleanup = setTimeout(() => {
    if (userGateways.get(userId) === entry) userGateways.delete(userId);
  }, GATEWAY_CACHE_MS);
  cleanup.unref();
  return instance;
}

function gateway(requestContext: RequestContext) {
  return cachedSilpoGateway(silpoUserId(requestContext));
}

export const silpoSearchProducts = createTool({
  id: "silpo-search-products",
  description: "Search the authenticated user's real Silpo product catalog. Returns only live MCP data.",
  inputSchema: z.object({ query: z.string().min(1) }),
  outputSchema: z.object({ data: z.unknown() }),
  execute: async ({ query }, { requestContext }) => ({ data: await gateway(requestContext).search(query) }),
});

export const silpoSearchVerifiedProducts = createTool({
  id: "silpo-search-verified-products",
  description: "Batch-search several product needs and inspect live details for the returned candidates in one call. Use short catalog terms naming one product or category per query, without quantities, event context, or full request phrases. Each lookupProductId is a valid external product id for a proposal.",
  inputSchema: z.object({
    queries: z.array(z.string().min(1)).min(1).max(4),
  }),
  outputSchema: z.object({ data: z.unknown() }),
  execute: async ({ queries }, { requestContext }) => ({
    // Two hydrated choices per ingredient are enough for fit/restriction selection and keep recipe tool
    // payloads and catalog-detail calls bounded. The previous default hydrated up to 12 products per call.
    data: await gateway(requestContext).searchVerified(queries, Math.min(queries.length * 2, 8)),
  }),
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
