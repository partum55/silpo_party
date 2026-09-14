import { requireUser } from "@/lib/auth";
import { toErrorResponse } from "@/lib/api/errors";
import { deleteParty, getParty } from "@/lib/party/service";

type Context = { params: Promise<{ partyId: string }> };

export async function GET(_request: Request, { params }: Context) {
  const user = await requireUser();
  const { partyId } = await params;
  try {
    return Response.json(await getParty(partyId, user.id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  const user = await requireUser();
  const { partyId } = await params;
  try {
    await deleteParty(partyId, user.id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
