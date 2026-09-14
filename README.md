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

## Deploy for $0 on Render

The default free deployment runs Next.js and the standalone Mastra server as two supervised processes inside one Render Free web service. Only Next.js is public; it calls Mastra over `127.0.0.1`. This avoids Vercel's function deadline and consumes one free instance instead of two.

1. Push this repository to GitHub.
2. In Render, choose **New → Blueprint** and connect the repository.
3. Render reads `render.yaml` and shows one `silpo-party` service with the **Free** plan.
4. Enter the requested Supabase, Silpo, and AI variables. Render generates the internal agent token.
5. Deploy, then add `https://YOUR-SERVICE.onrender.com/auth/callback` to the Supabase Auth redirect allow-list.

Do not set `AGENT_URL` on Render. The combined launcher sets it to the private agent process automatically.

Render Free sleeps after 15 minutes without inbound traffic, so the first request after inactivity can take about a minute. Free services can also restart, making this suitable for a hackathon/demo rather than a production SLA. Persistent application data remains in Supabase.

## Optional paid deployment on Railway

The repository also includes a two-service Railway setup for a future always-on deployment. Keeping the web and agent services separate prevents a long agent turn from tying up the public Next.js request.

1. Push the repository to GitHub and create an empty Railway project.
2. Add two services from the same repository, named `web` and `agent`. Keep the repository root as the root directory for both services because they share npm workspace packages.
3. For `web`, set the config-as-code file to `/railway.web.toml` and generate a public domain.
4. For `agent`, set the config-as-code file to `/railway.agent.toml`. A public domain is optional when the services use Railway private networking.
5. Leave Railway Serverless/App Sleeping **off** for both services so post-response agent work is not interrupted.

Set these variables on `web`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SECRET_KEY=...
SILPO_CREDENTIALS_KEY=...
AGENT_URL=http://${{agent.RAILWAY_PRIVATE_DOMAIN}}:4111
AGENT_INTERNAL_TOKEN=...
NEXT_TELEMETRY_DISABLED=1
```

Set these variables on `agent`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SECRET_KEY=...
SILPO_CREDENTIALS_KEY=...
AI_API_KEY=...
AI_BASE_URL=https://api.deepseek.com
AI_MODEL=deepseek-chat
AGENT_INTERNAL_TOKEN=...
PORT=4111
```

`AGENT_INTERNAL_TOKEN` must be the same long random value on both services. Generate it with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. `SILPO_CREDENTIALS_KEY` must remain stable because changing it makes existing encrypted Silpo connections unreadable; generate a new one only before users connect with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`.

Finally, add the deployed web callback URL (`https://YOUR_DOMAIN/auth/callback`) to the Supabase Auth redirect allow-list. Google authentication is configured through Supabase, not through additional app environment variables.

The agent build emits a normal Node/Hono server in `apps/agent/.mastra/output`; it is not tied to Vercel.

## Security

Never put real credentials in `.env.example` or commit `.env.local`. If a secret has appeared in a tracked file, terminal output, chat, or Git history, rotate it before deployment. In particular, rotate the Supabase secret key, AI API key, and Silpo encryption key if they were exposed; changing the encryption key requires users to reconnect their Silpo accounts.
