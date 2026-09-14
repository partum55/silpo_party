import { RuleViolation } from "@/lib/party/rules";

const statusByCode: Record<string, number> = {
  not_found: 404,
  not_member: 403,
  not_creator: 403,
  party_completed: 409,
  already_member: 409,
  party_full: 409,
  too_many_active_parties: 409,
  creator_must_delete_not_leave: 409,
};

export function toErrorResponse(error: unknown) {
  if (error instanceof RuleViolation) {
    return Response.json({ error: error.code }, { status: statusByCode[error.code] ?? 400 });
  }
  console.error(error);
  return Response.json({ error: "internal_error" }, { status: 500 });
}
