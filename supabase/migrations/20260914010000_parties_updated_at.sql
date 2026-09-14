-- Lets a stuck agent_status (THINKING/UPDATING_CART) be detected as stale and reclaimed if the serverless
-- function that set it was killed mid-run (e.g. hit the platform's execution time limit) and never got to
-- release the lock. See src/lib/chat/service.ts's tryAcquireAgentLock.
alter table public.parties add column updated_at timestamptz not null default now();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger parties_set_updated_at
  before update on public.parties
  for each row
  execute function public.set_updated_at();
