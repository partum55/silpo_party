import { requireUser } from "@/lib/auth";
import { toErrorResponse } from "@/lib/api/errors";
import { getParty } from "@/lib/party/service";

export async function GET(_request: Request, { params }: { params: Promise<{ partyId: string }> }) {
  const user = await requireUser();
  const { partyId } = await params;
  try {
    const party = await getParty(partyId, user.id);
    return Response.json({ agentStatus: party.agent_status, agentError: party.agent_error });
  } catch (error) {
    return toErrorResponse(error);
  }
}
