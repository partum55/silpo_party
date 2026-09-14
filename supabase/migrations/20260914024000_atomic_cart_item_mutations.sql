-- Apply a user-initiated cart-line edit together with its derived plan/total so Realtime readers never
-- observe a half-updated basket. Authorization remains in the application service; only service_role may call.
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
begin
  if p_delete then
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

revoke all on function public.apply_cart_item_mutation(uuid, uuid, numeric, numeric, numeric, jsonb, numeric, boolean) from public, anon, authenticated;
grant execute on function public.apply_cart_item_mutation(uuid, uuid, numeric, numeric, numeric, jsonb, numeric, boolean) to service_role;
