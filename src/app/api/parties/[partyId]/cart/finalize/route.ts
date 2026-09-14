import { requireUser } from "@/lib/auth";
import { toErrorResponse } from "@/lib/api/errors";
import { finalizeCart } from "@/lib/cart/service";

// Refreshes every cart item against live Silpo data, then writes the whole cart — several Silpo MCP
// round-trips. Default serverless timeouts are too short for that. Vercel clamps to whatever the plan allows.
export const maxDuration = 300;

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
