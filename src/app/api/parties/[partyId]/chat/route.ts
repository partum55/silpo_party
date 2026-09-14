import type { NextRequest } from "next/server";

import { requireUser } from "@/lib/auth";
import { toErrorResponse } from "@/lib/api/errors";
import { listMessages, sendMessage } from "@/lib/chat/service";

// The post-response agent callback can run for several minutes on the self-hosted Node process.
export const maxDuration = 300;

type Context = { params: Promise<{ partyId: string }> };

export async function GET(_request: Request, { params }: Context) {
  const user = await requireUser();
  const { partyId } = await params;
  try {
    return Response.json(await listMessages(partyId, user.id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

// Inserts the message, then synchronously drains the agent's pending-message queue (see chat/service.ts) —
// The response returns before the agent finishes; the client observes status, reply, and cart changes live.
export async function POST(request: NextRequest, { params }: Context) {
  const user = await requireUser();
  const { partyId } = await params;
  const body = await request.json().catch(() => null);
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!content) return Response.json({ error: "content_required" }, { status: 400 });
  try {
    return Response.json(await sendMessage(partyId, user.id, content), { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
