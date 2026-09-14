export type PartyStatus = "ACTIVE" | "COMPLETED";
export type MemberRole = "CREATOR" | "MEMBER";

export const MAX_MEMBERS = 10;
export const MAX_ACTIVE_PARTIES_PER_USER = 2;

export type RuleError =
  | "not_found"
  | "not_member"
  | "not_creator"
  | "party_completed"
  | "already_member"
  | "party_full"
  | "too_many_active_parties"
  | "creator_must_delete_not_leave"
  | "member_marked_ready";

export type RuleResult = { ok: true } | { ok: false; error: RuleError };

const ok: RuleResult = { ok: true };
const err = (error: RuleError): RuleResult => ({ ok: false, error });

export function checkCreate(args: { activePartyCountForUser: number }): RuleResult {
  if (args.activePartyCountForUser >= MAX_ACTIVE_PARTIES_PER_USER) return err("too_many_active_parties");
  return ok;
}

export function checkJoin(args: {
  partyStatus: PartyStatus | null;
  alreadyMember: boolean;
  memberCount: number;
  activePartyCountForUser: number;
}): RuleResult {
  if (args.partyStatus === null) return err("not_found");
  if (args.partyStatus !== "ACTIVE") return err("party_completed");
  if (args.alreadyMember) return err("already_member");
  if (args.memberCount >= MAX_MEMBERS) return err("party_full");
  if (args.activePartyCountForUser >= MAX_ACTIVE_PARTIES_PER_USER) return err("too_many_active_parties");
  return ok;
}

export function checkLeave(args: { role: MemberRole | null }): RuleResult {
  if (!args.role) return err("not_member");
  if (args.role === "CREATOR") return err("creator_must_delete_not_leave");
  return ok;
}

export function checkDelete(args: { isCreator: boolean }): RuleResult {
  return args.isCreator ? ok : err("not_creator");
}

/** Reading party data, and writing chat/cart while the party is active. */
export function checkActiveMemberAction(args: { isMember: boolean; partyStatus: PartyStatus | null }): RuleResult {
  if (!args.isMember) return err("not_member");
  if (args.partyStatus === null) return err("not_found");
  if (args.partyStatus !== "ACTIVE") return err("party_completed");
  return ok;
}

/** A member marked "ready" has said they're done requesting things — the composer hides itself client-side,
 *  and this is the server-side backstop so a direct API call can't send a message on their behalf either. */
export function checkSendMessage(args: { isMember: boolean; partyStatus: PartyStatus | null; isReady: boolean }): RuleResult {
  const base = checkActiveMemberAction(args);
  if (!base.ok) return base;
  if (args.isReady) return err("member_marked_ready");
  return ok;
}

export function checkRead(args: { isMember: boolean; partyStatus: PartyStatus | null }): RuleResult {
  if (!args.isMember) return err("not_member");
  if (args.partyStatus === null) return err("not_found");
  return ok;
}

export function checkFinalize(args: { isCreator: boolean; partyStatus: PartyStatus | null }): RuleResult {
  if (!args.isCreator) return err("not_creator");
  if (args.partyStatus === null) return err("not_found");
  if (args.partyStatus !== "ACTIVE") return err("party_completed");
  return ok;
}

export class RuleViolation extends Error {
  readonly code: RuleError;
  constructor(code: RuleError) {
    super(code);
    this.code = code;
  }
}

export function assertOk(result: RuleResult): void {
  if (!result.ok) throw new RuleViolation(result.error);
}
