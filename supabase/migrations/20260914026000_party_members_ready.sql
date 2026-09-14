-- Cosmetic per-member "ready" flag: lets the owner see who's done requesting things without blocking
-- finalize, and gates that member's own chat composer (see checkSendMessage in src/lib/party/rules.ts).
alter table public.party_members
  add column ready boolean not null default false;
