import type { NextRequest } from "next/server";

import { requireUser } from "@/lib/auth";
import { toErrorResponse } from "@/lib/api/errors";
import { createParty, listMyParties } from "@/lib/party/service";

export async function GET() {
  const user = await requireUser();
  try {
    return Response.json(await listMyParties(user.id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const user = await requireUser();
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return Response.json({ error: "name_required" }, { status: 400 });
  try {
    return Response.json(await createParty(user.id, name), { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
