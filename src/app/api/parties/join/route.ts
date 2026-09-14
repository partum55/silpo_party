import type { NextRequest } from "next/server";

import { requireUser } from "@/lib/auth";
import { toErrorResponse } from "@/lib/api/errors";
import { extractJoinCode } from "@/lib/party/join-code";
import { joinPartyByCode } from "@/lib/party/service";

// A join link itself resolves through the page at /join/[code] (it needs to redirect through login/Silpo-
// connect for a signed-out visitor); this JSON endpoint remains for API-only or scripted callers.
export async function POST(request: NextRequest) {
  const user = await requireUser();
  const body = await request.json().catch(() => null);
  const joinCode = typeof body?.joinCode === "string" ? extractJoinCode(body.joinCode) : "";
  if (!joinCode) return Response.json({ error: "join_code_required" }, { status: 400 });
  try {
    return Response.json(await joinPartyByCode(joinCode, user.id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
