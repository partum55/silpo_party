import { requireUser } from "@/lib/auth";
import { toErrorResponse } from "@/lib/api/errors";
import { getCart, mutateCartItem, mutateCartItemSubscription } from "@/lib/cart/service";

export async function GET(_request: Request, { params }: { params: Promise<{ partyId: string }> }) {
  const user = await requireUser();
  const { partyId } = await params;
  try {
    return Response.json(await getCart(partyId, user.id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ partyId: string }> }) {
  const user = await requireUser();
  const { partyId } = await params;
  try {
    const body = await request.json() as { itemId?: unknown; quantity?: unknown };
    if (typeof body.itemId !== "string") return Response.json({ error: "cart_item_not_found" }, { status: 400 });
    if ("subscribed" in body) {
      if (typeof body.subscribed !== "boolean") return Response.json({ error: "invalid_subscription" }, { status: 400 });
      return Response.json(await mutateCartItemSubscription(partyId, user.id, body.itemId, body.subscribed));
    }
    if (typeof body.quantity !== "number") return Response.json({ error: "invalid_quantity" }, { status: 400 });
    return Response.json(await mutateCartItem(partyId, user.id, body.itemId, body.quantity));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ partyId: string }> }) {
  const user = await requireUser();
  const { partyId } = await params;
  try {
    const body = await request.json() as { itemId?: unknown };
    if (typeof body.itemId !== "string") return Response.json({ error: "cart_item_not_found" }, { status: 400 });
    return Response.json(await mutateCartItem(partyId, user.id, body.itemId, null));
  } catch (error) {
    return toErrorResponse(error);
  }
}
