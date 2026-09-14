import { requireUser } from "@/lib/auth";
import { toErrorResponse } from "@/lib/api/errors";
import { getCart } from "@/lib/cart/service";

export async function GET(_request: Request, { params }: { params: Promise<{ partyId: string }> }) {
  const user = await requireUser();
  const { partyId } = await params;
  try {
    return Response.json(await getCart(partyId, user.id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
