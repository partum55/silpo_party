import { requireUser } from "@/lib/auth";
import { toErrorResponse } from "@/lib/api/errors";
import { listMembers, setMemberReady } from "@/lib/party/service";

type Context = { params: Promise<{ partyId: string }> };

export async function GET(_request: Request, { params }: Context) {
  const user = await requireUser();
  const { partyId } = await params;
  try {
    return Response.json(await listMembers(partyId, user.id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

// Always writes the caller's own row — there is no way to mark another member ready.
export async function PATCH(request: Request, { params }: Context) {
  const user = await requireUser();
  const { partyId } = await params;
  const body = await request.json().catch(() => null);
  if (typeof body?.ready !== "boolean") return Response.json({ error: "ready_required" }, { status: 400 });
  try {
    await setMemberReady(partyId, user.id, body.ready);
    return Response.json(await listMembers(partyId, user.id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
