create table public.cart_item_subscribers (
  party_id uuid not null references public.parties(id) on delete cascade,
  product_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (party_id, product_id, user_id)
);

create index cart_item_subscribers_party_id_idx on public.cart_item_subscribers (party_id);

alter table public.cart_item_subscribers enable row level security;
create policy "members can read cart item subscribers" on public.cart_item_subscribers for select
  using (exists (
    select 1 from public.party_members pm
    where pm.party_id = cart_item_subscribers.party_id and pm.user_id = auth.uid()
  ));

revoke all on public.cart_item_subscribers from anon, authenticated;
grant select on public.cart_item_subscribers to authenticated;
grant all on public.cart_item_subscribers to service_role;
alter publication supabase_realtime add table public.cart_item_subscribers;

create or replace function public.set_cart_item_subscription(
  p_party_id uuid,
  p_item_id uuid,
  p_user_id uuid,
  p_subscribed boolean
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_product_id text;
begin
  select ci.product_id into target_product_id
    from public.cart_items ci
    join public.parties p on p.id = ci.party_id and p.status = 'ACTIVE'
    join public.carts c on c.party_id = ci.party_id and c.status = 'DRAFT'
    join public.party_members pm on pm.party_id = ci.party_id and pm.user_id = p_user_id
    where ci.id = p_item_id and ci.party_id = p_party_id;

  if target_product_id is null then
    raise exception 'cart_item_changed' using errcode = 'P0001';
  end if;

  if p_subscribed then
    insert into public.cart_item_subscribers (party_id, product_id, user_id)
      values (p_party_id, target_product_id, p_user_id)
      on conflict do nothing;
  else
    delete from public.cart_item_subscribers
      where party_id = p_party_id and product_id = target_product_id and user_id = p_user_id;
  end if;
end;
$$;

revoke all on function public.set_cart_item_subscription(uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_cart_item_subscription(uuid, uuid, uuid, boolean) to service_role;

-- Keep subscriber cleanup in the same transaction as an explicit cart-line deletion.
create or replace function public.apply_cart_item_mutation(
  p_party_id uuid,
  p_item_id uuid,
  p_expected_quantity numeric,
  p_quantity numeric,
  p_line_total_uah numeric,
  p_plan jsonb,
  p_total_uah numeric,
  p_delete boolean
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_product_id text;
begin
  if p_delete then
    select product_id into target_product_id
      from public.cart_items
      where id = p_item_id and party_id = p_party_id and quantity = p_expected_quantity;

    if target_product_id is null then
      raise exception 'cart_item_changed' using errcode = 'P0001';
    end if;

    delete from public.cart_item_subscribers
      where party_id = p_party_id and product_id = target_product_id;

    delete from public.cart_items
      where id = p_item_id
        and party_id = p_party_id
        and quantity = p_expected_quantity
        and exists (
          select 1 from public.parties p
          join public.carts c on c.party_id = p.id
          where p.id = p_party_id and p.status = 'ACTIVE' and c.status = 'DRAFT'
        );
  else
    update public.cart_items
      set quantity = p_quantity,
          raw = jsonb_set(coalesce(raw, '{}'::jsonb), '{lineTotalUah}', to_jsonb(p_line_total_uah), true)
      where id = p_item_id
        and party_id = p_party_id
        and quantity = p_expected_quantity
        and exists (
          select 1 from public.parties p
          join public.carts c on c.party_id = p.id
          where p.id = p_party_id and p.status = 'ACTIVE' and c.status = 'DRAFT'
        );
  end if;

  if not found then
    raise exception 'cart_item_changed' using errcode = 'P0001';
  end if;

  update public.carts
    set plan = p_plan, total_uah = p_total_uah, updated_at = now()
    where party_id = p_party_id and status = 'DRAFT';

  if not found then
    raise exception 'cart_item_changed' using errcode = 'P0001';
  end if;
end;
$$;
