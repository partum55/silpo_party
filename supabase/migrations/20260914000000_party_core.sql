create table public.parties (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  join_code text not null unique,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'COMPLETED')),
  agent_status text not null default 'IDLE' check (agent_status in ('IDLE', 'THINKING', 'SEARCHING', 'UPDATING_CART', 'DONE', 'ERROR')),
  agent_error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.party_members (
  party_id uuid not null references public.parties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('CREATOR', 'MEMBER')),
  joined_at timestamptz not null default now(),
  primary key (party_id, user_id)
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties(id) on delete cascade,
  sender_type text not null check (sender_type in ('USER', 'AGENT', 'SYSTEM')),
  sender_user_id uuid references auth.users(id) on delete set null,
  content text not null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.carts (
  party_id uuid primary key references public.parties(id) on delete cascade,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'FINALIZED')),
  -- Raw last-known agent plan (PartyPlanDraft from @silpo-party/agent), carried between chat turns so the
  -- agent has continuity. cart_items below is the derived, queryable projection of plan.products.
  plan jsonb,
  total_uah numeric,
  checkout_url text,
  finalized_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties(id) on delete cascade,
  product_id text not null,
  company_id text not null,
  -- Not sourced per-product; re-fetched live from the creator's Silpo delivery context at finalize time
  -- (see getDeliveryContext in apps/agent/src/silpo/gateway.ts). Kept here only for display/debugging.
  branch_id text,
  name text not null,
  price_uah numeric,
  quantity integer not null default 1 check (quantity > 0),
  image_url text,
  raw jsonb,
  added_at timestamptz not null default now()
);

create index party_members_user_id_idx on public.party_members (user_id);
create index chat_messages_party_id_idx on public.chat_messages (party_id, created_at);
create index chat_messages_unprocessed_idx on public.chat_messages (party_id) where sender_type = 'USER' and processed_at is null;
create index cart_items_party_id_idx on public.cart_items (party_id);

alter table public.parties enable row level security;
alter table public.party_members enable row level security;
alter table public.chat_messages enable row level security;
alter table public.carts enable row level security;
alter table public.cart_items enable row level security;

create policy "members can read their parties" on public.parties for select
  using (exists (select 1 from public.party_members pm where pm.party_id = id and pm.user_id = auth.uid()));

create policy "members can read party rosters" on public.party_members for select
  using (exists (select 1 from public.party_members pm where pm.party_id = party_members.party_id and pm.user_id = auth.uid()));

create policy "members can read party chat" on public.chat_messages for select
  using (exists (select 1 from public.party_members pm where pm.party_id = chat_messages.party_id and pm.user_id = auth.uid()));

create policy "members can read party cart" on public.carts for select
  using (exists (select 1 from public.party_members pm where pm.party_id = carts.party_id and pm.user_id = auth.uid()));

create policy "members can read party cart items" on public.cart_items for select
  using (exists (select 1 from public.party_members pm where pm.party_id = cart_items.party_id and pm.user_id = auth.uid()));

-- Writes always go through the service-role client with application-level authorization
-- (mirrors silpo_connections: RLS enabled, no write policies, service_role bypasses RLS).
revoke all on public.parties, public.party_members, public.chat_messages, public.carts, public.cart_items from anon, authenticated;
grant select on public.parties, public.party_members, public.chat_messages, public.carts, public.cart_items to authenticated;
grant all on public.parties, public.party_members, public.chat_messages, public.carts, public.cart_items to service_role;

alter publication supabase_realtime add table public.parties, public.chat_messages, public.carts, public.cart_items;
