import { requireUser } from "@/lib/auth";
import { toErrorResponse } from "@/lib/api/errors";
import { listMembers } from "@/lib/party/service";

export async function GET(_request: Request, { params }: { params: Promise<{ partyId: string }> }) {
  const user = await requireUser();
  const { partyId } = await params;
  try {
    return Response.json(await listMembers(partyId, user.id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
