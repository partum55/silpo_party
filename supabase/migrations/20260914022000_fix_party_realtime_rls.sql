create or replace function public.is_party_member(target_party_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.party_members
    where party_id = target_party_id
      and user_id = auth.uid()
  );
$$;

revoke all on function public.is_party_member(uuid) from public;
grant execute on function public.is_party_member(uuid) to authenticated;

drop policy if exists "members can read their parties" on public.parties;
create policy "members can read their parties" on public.parties for select
  using (public.is_party_member(id));

drop policy if exists "members can read party rosters" on public.party_members;
create policy "members can read party rosters" on public.party_members for select
  using (public.is_party_member(party_id));

drop policy if exists "members can read party chat" on public.chat_messages;
create policy "members can read party chat" on public.chat_messages for select
  using (public.is_party_member(party_id));

drop policy if exists "members can read party cart" on public.carts;
create policy "members can read party cart" on public.carts for select
  using (public.is_party_member(party_id));

drop policy if exists "members can read party cart items" on public.cart_items;
create policy "members can read party cart items" on public.cart_items for select
  using (public.is_party_member(party_id));

