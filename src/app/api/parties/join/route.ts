import type { NextRequest } from "next/server";

import { requireUser } from "@/lib/auth";
import { toErrorResponse } from "@/lib/api/errors";
import { joinPartyByCode } from "@/lib/party/service";

// Also what a join link resolves to: the frontend builds the link from a party's join code and posts it here.
export async function POST(request: NextRequest) {
  const user = await requireUser();
  const body = await request.json().catch(() => null);
  const joinCode = typeof body?.joinCode === "string" ? body.joinCode.trim() : "";
  if (!joinCode) return Response.json({ error: "join_code_required" }, { status: 400 });
  try {
    return Response.json(await joinPartyByCode(joinCode, user.id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
