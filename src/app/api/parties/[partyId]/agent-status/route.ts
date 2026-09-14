import { after } from "next/server";

import { requireUser } from "@/lib/auth";
import { toErrorResponse } from "@/lib/api/errors";
import { resumePendingMessages } from "@/lib/chat/service";
import { getParty } from "@/lib/party/service";

export async function GET(_request: Request, { params }: { params: Promise<{ partyId: string }> }) {
  const user = await requireUser();
  const { partyId } = await params;
  try {
    const party = await getParty(partyId, user.id);
    if (party.status === "ACTIVE") {
      after(() => resumePendingMessages(partyId, party.creator_id));
    }
    return Response.json({ agentStatus: party.agent_status, agentError: party.agent_error });
  } catch (error) {
    return toErrorResponse(error);
  }
}
