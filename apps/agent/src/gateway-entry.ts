// Separate entry point so the root Next.js app can import the Silpo gateway without pulling in
// ./mastra/index.ts, which registers and bundles the complete Mastra server — Node build tooling
// (esbuild/babel/mlly) that breaks when Next's own bundler tries to statically analyze it.
export { extractCheckoutUrl, extractFoodRestrictions, type CartLineItem } from "./silpo/gateway.ts";
export { withCatalogSession, type CatalogSession, type DetailsOutcome } from "./silpo/catalog.ts";
export { productLineTotalUah, silpoCartQuantity, type PurchasableProduct } from "./domain/purchasing.ts";
