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
  const mode = body?.mode === "SHOPPING" || body?.mode === "DINNER" ? body.mode : "EVENT";
  const budgetUah = body?.budgetUah === null || body?.budgetUah === undefined ? null : Number(body.budgetUah);
  if (!name) return Response.json({ error: "name_required" }, { status: 400 });
  if (budgetUah !== null && (!Number.isFinite(budgetUah) || budgetUah < 0)) {
    return Response.json({ error: "invalid_budget" }, { status: 400 });
  }
  try {
    return Response.json(await createParty(user.id, name, mode, budgetUah), { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
