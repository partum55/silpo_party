import { after } from "next/server";

import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { toErrorResponse } from "@/lib/api/errors";
import { resumePendingMessages } from "@/lib/chat/service";
import { getParty } from "@/lib/party/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(_request: Request, { params }: { params: Promise<{ partyId: string }> }) {
  const user = await requireUser();
  const { partyId } = await params;
  try {
    const party = await getParty(partyId, user.id);
    if (party.status === "ACTIVE") {
      after(() => resumePendingMessages(partyId, party.creator_id));
    }
    return Response.json({
      agentStatus: party.agent_status,
      agentError: party.agent_error,
      activeMessageId: party.active_agent_message_id ?? null,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

// Called by apps/agent mid-turn (see reportAgentStatus there) to report which phase it's in, so the chat's
// typing bubble reflects real progress instead of one static "thinking" label. Authenticated with the same
// shared secret both deployments already use for the outbound direction (src/lib/agent/runner.ts) — this is
// a service-to-service callback, not a user request. Deliberately restricted to the two in-progress statuses:
// DONE/ERROR/IDLE/UPDATING_CART stay owned by chat/service.ts and cart/service.ts, so a slow or out-of-order
// callback here can never clobber one of those final-state transitions.
export async function POST(request: Request, { params }: { params: Promise<{ partyId: string }> }) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (token !== env("AGENT_INTERNAL_TOKEN")) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const agentStatus = body?.agentStatus;
  if (agentStatus !== "THINKING" && agentStatus !== "SEARCHING") {
    return Response.json({ error: "invalid_status" }, { status: 400 });
  }
  const { partyId } = await params;
  try {
    const db = createSupabaseAdminClient();
    const { error } = await db.from("parties").update({ agent_status: agentStatus }).eq("id", partyId);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
