-- Weighted Silpo products are ordered in fractional kilograms (for example 1.5 kg).
-- Preserve that quantity through the cart projection and final checkout.
alter table public.cart_items
  alter column quantity type numeric using quantity::numeric;
