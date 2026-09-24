-- Saves an agent turn's plan and its cart_items projection in one transaction. Before this, the web app ran the
-- delete, insert, subscriber cleanup, and plan update as separate requests, so a manual cart edit (or another
-- turn's save) could land in between and be lost or duplicated.
--
-- p_expected_updated_at makes the write conditional: when the cart changed since the caller read it (a manual
-- edit through apply_cart_item_mutation, which bumps carts.updated_at), the function raises 'cart_changed' and
-- the caller merges again on top of the newer plan. Pass null to overwrite unconditionally.
create or replace function public.replace_cart_projection(
  p_party_id uuid,
  p_expected_updated_at timestamptz,
  p_plan jsonb,
  p_total_uah numeric,
  p_items jsonb
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_updated_at timestamptz;
begin
  select updated_at into current_updated_at
    from public.carts
    where party_id = p_party_id
    for update;
  if not found then
    raise exception 'cart_not_found';
  end if;
  if p_expected_updated_at is not null and current_updated_at <> p_expected_updated_at then
    raise exception 'cart_changed';
  end if;

  delete from public.cart_items where party_id = p_party_id;

  insert into public.cart_items (party_id, product_id, company_id, name, image_url, price_uah, quantity, raw)
  select
    p_party_id,
    item->>'product_id',
    coalesce(item->>'company_id', ''),
    item->>'name',
    item->>'image_url',
    (item->>'price_uah')::numeric,
    (item->>'quantity')::numeric,
    item->'raw'
  from jsonb_array_elements(p_items) as item;

  -- Subscriptions survive projection rebuilds, but must not come back for a product the plan no longer has.
  delete from public.cart_item_subscribers as subscriber
    where subscriber.party_id = p_party_id
      and not exists (
        select 1 from jsonb_array_elements(p_items) as item
        where item->>'product_id' = subscriber.product_id
      );

  update public.carts
    set plan = p_plan, total_uah = p_total_uah, updated_at = now()
    where party_id = p_party_id;
end;
$$;

revoke all on function public.replace_cart_projection(uuid, timestamptz, jsonb, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.replace_cart_projection(uuid, timestamptz, jsonb, numeric, jsonb) to service_role;
