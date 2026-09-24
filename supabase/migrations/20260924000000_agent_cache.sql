-- Shared cache for the agent service: Silpo search results, product details, learned query -> product
-- choices, and generated recipes. Only the service role reads or writes it; RLS without policies denies
-- every browser client.
create table if not exists public.agent_cache (
  key text primary key,
  value jsonb not null,
  expires_at timestamptz not null
);

create index if not exists agent_cache_expires_at_idx on public.agent_cache (expires_at);

alter table public.agent_cache enable row level security;
