// Separate entry point so the root Next.js app can import the Silpo gateway without pulling in
// ./mastra/index.ts, which registers a Mastra app with @mastra/deployer-vercel — Node build tooling
// (esbuild/babel/mlly) that breaks when Next's own bundler tries to statically analyze it.
export { createSilpoGateway, extractCheckoutUrl, type CartLineItem } from "./silpo/gateway.ts";
