import "server-only";

import {
  createSilpoGateway,
  extractCheckoutUrl,
  productLineTotalUah,
  silpoCartQuantity,
  type CartLineItem,
} from "@silpo-party/agent/gateway";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { assertOk, checkFinalize, checkRead } from "@/lib/party/rules";
import { getMembership, getPartyRow, type Db } from "@/lib/party/access";
import { calculateMemberTotals, type CostMode } from "@/lib/cart/costs";
import { formatUnknownError } from "@/lib/errors";

type PlanProduct = {
  id: string;
  lookupProductId?: string;
  companyId?: string;
  name: string;
  priceUah: number;
  unit: string;
  weighted?: boolean;
  packageSize: { amount: number; unit: "g" | "ml" | "piece" };
  quantity: number;
  assignedMemberIds: string[];
  lineTotalUah?: number;
};

type PlanDraft = {
  products: PlanProduct[];
  totalUah: number;
  recipes?: Array<{
    title: string;
    sourceUrl: string | null;
    steps: string[];
    assignedMemberIds: string[];
    ingredients: Array<{
      name: string;
      requiredAmount: number;
      unit: "g" | "ml" | "piece";
      purchaseQuantity: number;
      purchasedAmount: number;
      selectedProduct: PlanProduct;
    }>;
  }>;
} | null;

type ProjectionRaw = {
  unit: string;
  weighted: boolean;
  packageSize: PlanProduct["packageSize"];
  lineTotalUah: number;
};

function projectionRaw(product: PlanProduct, lineTotalUah = product.lineTotalUah ?? productLineTotalUah(product, product.quantity)): ProjectionRaw {
  return {
    unit: product.unit,
    weighted: product.weighted === true,
    packageSize: product.packageSize,
    lineTotalUah,
  };
}

function isProjectionRaw(value: unknown): value is ProjectionRaw {
  if (!value || typeof value !== "object") return false;
  const raw = value as Partial<ProjectionRaw>;
  return typeof raw.unit === "string"
    && typeof raw.weighted === "boolean"
    && typeof raw.lineTotalUah === "number"
    && Boolean(raw.packageSize)
    && typeof raw.packageSize?.amount === "number"
    && ["g", "ml", "piece"].includes(raw.packageSize.unit ?? "");
}

/** Replaces cart_items with the derived projection of plan.products, and stores the raw plan for continuity. */
export async function syncCartFromPlan(db: Db, partyId: string, plan: PlanDraft) {
  const { error: deleteError } = await db.from("cart_items").delete().eq("party_id", partyId);
  if (deleteError) throw deleteError;

  const grouped = new Map<string, { party_id: string; product_id: string; company_id: string; name: string; price_uah: number; quantity: number; raw: ProjectionRaw }>();
  for (const product of plan?.products ?? []) {
    const productId = product.lookupProductId ?? product.id;
    const existing = grouped.get(productId);
    if (existing) {
      existing.quantity += product.quantity;
      existing.raw.lineTotalUah = Math.round((existing.raw.lineTotalUah + (product.lineTotalUah ?? productLineTotalUah(product, product.quantity))) * 100) / 100;
    }
    else grouped.set(productId, {
      party_id: partyId,
      product_id: productId,
      company_id: product.companyId ?? "",
      name: product.name,
      price_uah: product.priceUah,
      quantity: product.quantity,
      raw: projectionRaw(product),
    });
  }
  const items = [...grouped.values()];
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

  const [{ data: cart, error: cartError }, { data: items, error: itemsError }, { data: members, error: membersError }] = await Promise.all([
    db.from("carts").select("*").eq("party_id", partyId).maybeSingle(),
    db.from("cart_items").select("*").eq("party_id", partyId).order("added_at", { ascending: true }),
    db.from("party_members").select("user_id").eq("party_id", partyId).order("joined_at", { ascending: true }),
  ]);
  if (cartError) throw cartError;
  if (itemsError) throw itemsError;
  if (membersError) throw membersError;
  const memberIds = (members ?? []).map((member) => member.user_id as string);
  const plan = cart?.plan as PlanDraft;
  const totalUah = Number(cart?.total_uah ?? 0);
  return {
    ...cart,
    items: (items ?? []).map((item) => {
      const raw = isProjectionRaw(item.raw) ? item.raw : null;
      return {
        ...item,
        package_size: raw?.packageSize ?? null,
        weighted: raw?.weighted ?? false,
        sell_unit: raw?.unit ?? null,
        line_total_uah: raw?.lineTotalUah ?? Number(item.price_uah ?? 0) * Number(item.quantity),
      };
    }),
    recipes: plan?.recipes ?? [],
    memberTotals: calculateMemberTotals(
      party!.mode as CostMode,
      totalUah,
      memberIds,
      plan?.products ?? [],
    ),
  };
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
    const refreshed: Array<{
      product_id: string;
      company_id: string;
      quantity: number;
      price_uah: number;
      name: string;
      unit: string;
      weighted?: boolean;
      packageSize: PlanProduct["packageSize"];
      lineTotalUah: number;
    }> = [];
    for (const item of items ?? []) {
      const product = await gateway.hydrate(item.product_id);
      if (!product || !product.available || !product.companyId) {
        droppedItems.push(item.name);
        continue;
      }
      const purchaseUnits = Number(item.quantity);
      refreshed.push({
        product_id: item.product_id,
        company_id: product.companyId,
        quantity: purchaseUnits,
        price_uah: product.priceUah,
        name: product.name,
        unit: product.unit,
        weighted: product.weighted,
        packageSize: product.packageSize,
        lineTotalUah: productLineTotalUah(product, purchaseUnits),
      });
    }

    const context = await gateway.getDeliveryContext();
    const lineItems: CartLineItem[] = refreshed.map((item) => ({
      productId: item.product_id,
      companyId: item.company_id,
      branchId: context.branchId,
      quantity: silpoCartQuantity({ ...item, priceUah: item.price_uah }, item.quantity),
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
        raw: projectionRaw({
          id: item.product_id,
          name: item.name,
          priceUah: item.price_uah,
          unit: item.unit,
          weighted: item.weighted,
          packageSize: item.packageSize,
          quantity: item.quantity,
          assignedMemberIds: [],
        }, item.lineTotalUah),
      })));
    }
    const totalUah = Math.round(refreshed.reduce((sum, item) => sum + item.lineTotalUah, 0) * 100) / 100;
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
    const message = formatUnknownError(error);
    await db.from("parties").update({ agent_status: "ERROR", agent_error: message }).eq("id", partyId);
    return { ok: false, error: message };
  }
}
