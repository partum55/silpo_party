import { requireUser } from "@/lib/auth";
import { toErrorResponse } from "@/lib/api/errors";
import { finalizeCart } from "@/lib/cart/service";

export async function POST(_request: Request, { params }: { params: Promise<{ partyId: string }> }) {
  const user = await requireUser();
  const { partyId } = await params;
  try {
    const result = await finalizeCart(partyId, user.id);
    return Response.json(result, { status: result.ok ? 200 : 422 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
