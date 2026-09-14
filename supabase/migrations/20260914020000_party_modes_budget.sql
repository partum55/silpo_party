alter table public.parties
  add column mode text not null default 'EVENT'
    check (mode in ('SHOPPING', 'DINNER', 'EVENT')),
  add column budget_uah numeric
    check (budget_uah is null or budget_uah >= 0);

alter table public.party_members
  add column wishes jsonb not null default '[]'::jsonb
    check (jsonb_typeof(wishes) = 'array');

