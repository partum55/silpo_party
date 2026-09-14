# Silpo Party

A Next.js party-planning app backed by Supabase and a separately deployed Mastra agent. The web process stores chat and cart state; the agent calls the LLM and the authenticated Silpo MCP service.

## Local development

Requirements: Node.js 22.13 or newer and a Supabase project with the migrations in `supabase/migrations` applied.

```bash
npm ci
copy .env.example .env.local
npm run dev
```

Run the agent in a second terminal:

```bash
npm --workspace apps/agent run dev
```

The default Mastra development URL is `http://localhost:4111`, so set `AGENT_URL=http://localhost:4111` in `.env.local`.

Before a release, run:

```bash
npm test
npm --workspace apps/agent run test
npm run lint
npm --workspace apps/agent run typecheck
npm run build
npm --workspace apps/agent run build
```

## Deploy on Vercel

The web app and the agent are two separate Vercel projects from this one repository.

1. **Agent project**: create a Vercel project with Root Directory `apps/agent`. `apps/agent/src/mastra/index.ts` only wires in `@mastra/deployer-vercel` when `process.env.VERCEL` is set (Vercel sets this automatically), so `npm --workspace apps/agent run build` emits Vercel's `.vercel/output/functions` format there while still producing a standalone `.mastra/output` build for local use. Set `maxDuration` in that `VercelDeployer` config to whatever your plan allows for long-running chat turns. Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SILPO_CREDENTIALS_KEY`, `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`, `AGENT_INTERNAL_TOKEN`.
2. **Web project**: create a Vercel project with Root Directory at the repo root. Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SILPO_CREDENTIALS_KEY`, `AGENT_URL` (the agent project's deployment URL), `AGENT_INTERNAL_TOKEN`.

`AGENT_INTERNAL_TOKEN` must be the same long random value on both projects. Generate it with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. `SILPO_CREDENTIALS_KEY` must remain stable because changing it makes existing encrypted Silpo connections unreadable; generate a new one only before users connect with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`.

Finally, add the deployed web callback URL (`https://YOUR_DOMAIN/auth/callback`) to the Supabase Auth redirect allow-list. Google authentication is configured through Supabase, not through additional app environment variables.

## Security

Never put real credentials in `.env.example` or commit `.env.local`. If a secret has appeared in a tracked file, terminal output, chat, or Git history, rotate it before deployment. In particular, rotate the Supabase secret key, AI API key, and Silpo encryption key if they were exposed; changing the encryption key requires users to reconnect their Silpo accounts.
