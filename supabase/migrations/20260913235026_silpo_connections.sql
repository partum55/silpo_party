create table public.silpo_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  credentials text not null,
  connected_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.silpo_connections enable row level security;
revoke all on table public.silpo_connections from anon, authenticated;
grant all on table public.silpo_connections to service_role;
