import type { NormalizedPartyPlanningInput, WishChange } from "./schemas.ts";

type CurrentParty = NormalizedPartyPlanningInput["currentParty"];

export function applyParticipantWishChanges(
  party: CurrentParty,
  memberId: string,
  changes: WishChange[],
  createId: () => string = () => crypto.randomUUID(),
): CurrentParty {
  const member = party.members.find((candidate) => candidate.id === memberId);
  if (!member) throw new Error(`Unknown party member: ${memberId}`);
  if (member.status === "ready") throw new Error("Reopen preferences before editing wishes.");

  let wishes = member.wishes;
  for (const change of changes) {
    if (change.action === "add") {
      wishes = [...wishes, { id: createId(), text: change.text, fulfillmentStrategy: change.fulfillmentStrategy ?? "either" }];
    }
    if (change.action === "replace") {
      wishes = wishes.map((wish) => wish.id === change.wishId
        ? { ...wish, text: change.text, fulfillmentStrategy: change.fulfillmentStrategy ?? "either" }
        : wish);
    }
    if (change.action === "remove") wishes = wishes.filter((wish) => wish.id !== change.wishId);
    if (change.action === "reset") wishes = [];
  }

  return {
    members: party.members.map((candidate) => candidate.id === memberId ? { ...candidate, wishes } : candidate),
  };
}

export function setParticipantPreferenceStatus(
  party: CurrentParty,
  memberId: string,
  status: "collecting" | "ready",
): CurrentParty {
  if (!party.members.some((member) => member.id === memberId)) throw new Error(`Unknown party member: ${memberId}`);
  return {
    members: party.members.map((member) => member.id === memberId ? { ...member, status } : member),
  };
}

export function getPreferencePhase(party: CurrentParty): "provisional" | "finalized" {
  return party.members.length > 0 && party.members.every((member) => member.status === "ready")
    ? "finalized"
    : "provisional";
}
