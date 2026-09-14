import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { createSilpoGateway } from "../../silpo/gateway.ts";

function gateway() {
  const userId = process.env.SILPO_USER_ID;
  if (!userId) throw new Error("Missing environment variable: SILPO_USER_ID");
  return createSilpoGateway(userId);
}

export const silpoSearchProducts = createTool({
  id: "silpo-search-products",
  description: "Search the authenticated user's real Silpo product catalog. Returns only live MCP data.",
  inputSchema: z.object({ query: z.string().min(1) }),
  outputSchema: z.object({ data: z.unknown() }),
  execute: async ({ query }) => ({ data: await gateway().search(query) }),
});

export const silpoGetProductDetails = createTool({
  id: "silpo-get-product-details",
  description: "Inspect current details for a numeric Silpo externalProductId returned by search.",
  inputSchema: z.object({ productId: z.string().min(1) }),
  outputSchema: z.object({ data: z.unknown() }),
  execute: async ({ productId }) => ({ data: await gateway().hydrate(productId) }),
});
