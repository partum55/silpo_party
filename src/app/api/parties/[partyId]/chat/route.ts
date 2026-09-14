import type { NextRequest } from "next/server";

import { requireUser } from "@/lib/auth";
import { toErrorResponse } from "@/lib/api/errors";
import { listMessages, sendMessage } from "@/lib/chat/service";

// POST synchronously waits for a full agent turn (LLM + Silpo MCP round-trips) — default serverless
// timeouts are too short for that. Vercel clamps to whatever the plan allows.
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
// the response only returns once the agent has finished reacting, so the cart in the response is current.
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
