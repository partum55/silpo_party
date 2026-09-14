import { requireUser } from "@/lib/auth";
import { toErrorResponse } from "@/lib/api/errors";
import { leaveParty } from "@/lib/party/service";

export async function POST(_request: Request, { params }: { params: Promise<{ partyId: string }> }) {
  const user = await requireUser();
  const { partyId } = await params;
  try {
    await leaveParty(partyId, user.id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
