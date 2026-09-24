import { after } from "next/server";

import { requireUser } from "@/lib/auth";
import { toErrorResponse } from "@/lib/api/errors";
import { resumePendingMessages } from "@/lib/chat/service";
import { getParty } from "@/lib/party/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// A poll may resume the chat queue in after(), which runs agent turns (up to 75 s each).
export const maxDuration = 300;

export async function GET(_request: Request, { params }: { params: Promise<{ partyId: string }> }) {
  const user = await requireUser();
  const { partyId } = await params;
  try {
    const party = await getParty(partyId, user.id);
    const storedStatus = party.agent_status as string;
    const inProgress = storedStatus === "THINKING" || storedStatus === "SEARCHING" || storedStatus === "UPDATING_CART";
    let activeMessageId = (party.active_agent_message_id as string | null | undefined) ?? null;
    let hasPendingMessage = false;
    if (party.status === "ACTIVE" && (!activeMessageId || !inProgress)) {
      const db = createSupabaseAdminClient();
      const { data: pending, error: pendingError } = await db
        .from("chat_messages")
        .select("id")
        .eq("party_id", partyId)
        .eq("sender_type", "USER")
        .is("processed_at", null)
        .order("created_at", { ascending: true })
        .limit(1);
      if (pendingError) throw pendingError;
      activeMessageId = (pending?.[0]?.id as string | undefined) ?? null;
      hasPendingMessage = Boolean(activeMessageId);
    }
    if (party.status === "ACTIVE") {
      after(() => resumePendingMessages(partyId, party.creator_id));
    }
    return Response.json({
      // A queued message is already work in progress from the participant's perspective, even in the brief
      // interval before the post-response worker has persisted its THINKING lock.
      agentStatus: hasPendingMessage && !inProgress ? "THINKING" : storedStatus,
      agentError: party.agent_error,
      activeMessageId,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
