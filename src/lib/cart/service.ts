import "server-only";

import { createSilpoGateway, extractCheckoutUrl, type CartLineItem } from "@silpo-party/agent";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { assertOk, checkFinalize, checkRead } from "@/lib/party/rules";
import { getMembership, getPartyRow, type Db } from "@/lib/party/access";

type PlanProduct = {
  id: string;
  lookupProductId?: string;
  companyId?: string;
  name: string;
  priceUah: number;
  quantity: number;
};

type PlanDraft = { products: PlanProduct[]; totalUah: number } | null;

/** Replaces cart_items with the derived projection of plan.products, and stores the raw plan for continuity. */
export async function syncCartFromPlan(db: Db, partyId: string, plan: PlanDraft) {
  const { error: deleteError } = await db.from("cart_items").delete().eq("party_id", partyId);
  if (deleteError) throw deleteError;

  const items = (plan?.products ?? []).map((product) => ({
    party_id: partyId,
    product_id: product.lookupProductId ?? product.id,
    company_id: product.companyId ?? "",
    name: product.name,
    price_uah: product.priceUah,
    quantity: product.quantity,
  }));
  if (items.length) {
    const { error: insertError } = await db.from("cart_items").insert(items);
    if (insertError) throw insertError;
  }

  const { error: updateError } = await db
    .from("carts")
    .update({ plan: plan ?? null, total_uah: plan?.totalUah ?? 0, updated_at: new Date().toISOString() })
    .eq("party_id", partyId);
  if (updateError) throw updateError;
}

export async function getCart(partyId: string, userId: string) {
  const db = createSupabaseAdminClient();
  const role = await getMembership(db, partyId, userId);
  const party = await getPartyRow(db, partyId);
  assertOk(checkRead({ isMember: Boolean(role), partyStatus: (party?.status as "ACTIVE" | "COMPLETED" | undefined) ?? null }));

  const [{ data: cart, error: cartError }, { data: items, error: itemsError }] = await Promise.all([
    db.from("carts").select("*").eq("party_id", partyId).maybeSingle(),
    db.from("cart_items").select("*").eq("party_id", partyId).order("added_at", { ascending: true }),
  ]);
  if (cartError) throw cartError;
  if (itemsError) throw itemsError;
  return { ...cart, items: items ?? [] };
}

export type FinalizeResult =
  | { ok: true; checkoutUrl: string | null; droppedItems: string[] }
  | { ok: false; error: string };

/**
 * Refreshes every cart item against live Silpo data, writes the result into the creator's real Silpo cart,
 * and only then marks cart/party FINALIZED/COMPLETED. Any failure leaves the party ACTIVE and the cart DRAFT
 * (spec section 13) and records the error on parties.agent_status/agent_error.
 */
export async function finalizeCart(partyId: string, userId: string): Promise<FinalizeResult> {
  const db = createSupabaseAdminClient();
  const party = await getPartyRow(db, partyId);
  assertOk(checkFinalize({
    isCreator: party?.creator_id === userId,
    partyStatus: (party?.status as "ACTIVE" | "COMPLETED" | undefined) ?? null,
  }));

  const { data: items, error: itemsError } = await db.from("cart_items").select("*").eq("party_id", partyId);
  if (itemsError) throw itemsError;

  const gateway = createSilpoGateway(party!.creator_id);
  try {
    await db.from("parties").update({ agent_status: "UPDATING_CART", agent_error: null }).eq("id", partyId);

    // Final refresh: re-hydrate every item for current price/availability; drop what's gone rather than fail.
    const droppedItems: string[] = [];
    const refreshed: Array<{ product_id: string; company_id: string; quantity: number; price_uah: number; name: string }> = [];
    for (const item of items ?? []) {
      const product = await gateway.hydrate(item.product_id);
      if (!product || !product.available || !product.companyId) {
        droppedItems.push(item.name);
        continue;
      }
      refreshed.push({
        product_id: item.product_id,
        company_id: product.companyId,
        quantity: item.quantity,
        price_uah: product.priceUah,
        name: product.name,
      });
    }

    const context = await gateway.getDeliveryContext();
    const lineItems: CartLineItem[] = refreshed.map((item) => ({
      productId: item.product_id,
      companyId: item.company_id,
      branchId: context.branchId,
      quantity: item.quantity,
    }));
    await gateway.syncCartProducts(lineItems);
    const finalCart = await gateway.getFinalCart();
    const checkoutUrl = extractCheckoutUrl(finalCart);

    const nowIso = new Date().toISOString();
    await db.from("cart_items").delete().eq("party_id", partyId);
    if (refreshed.length) {
      await db.from("cart_items").insert(refreshed.map((item) => ({
        party_id: partyId,
        product_id: item.product_id,
        company_id: item.company_id,
        name: item.name,
        price_uah: item.price_uah,
        quantity: item.quantity,
      })));
    }
    const totalUah = refreshed.reduce((sum, item) => sum + item.price_uah * item.quantity, 0);
    await db.from("carts").update({
      status: "FINALIZED",
      total_uah: totalUah,
      checkout_url: checkoutUrl,
      finalized_at: nowIso,
      updated_at: nowIso,
    }).eq("party_id", partyId);
    await db.from("parties").update({
      status: "COMPLETED",
      agent_status: "DONE",
      completed_at: nowIso,
    }).eq("id", partyId);

    return { ok: true, checkoutUrl, droppedItems };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.from("parties").update({ agent_status: "ERROR", agent_error: message }).eq("id", partyId);
    return { ok: false, error: message };
  }
}
