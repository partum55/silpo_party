import assert from "node:assert/strict";
import test from "node:test";

import {
  checkActiveMemberAction,
  checkCreate,
  checkDelete,
  checkFinalize,
  checkJoin,
  checkLeave,
  MAX_ACTIVE_PARTIES_PER_USER,
  MAX_MEMBERS,
} from "../src/lib/party/rules.ts";

test("a user at the active-party cap cannot create another", () => {
  assert.deepEqual(checkCreate({ activePartyCountForUser: MAX_ACTIVE_PARTIES_PER_USER - 1 }), { ok: true });
  assert.deepEqual(checkCreate({ activePartyCountForUser: MAX_ACTIVE_PARTIES_PER_USER }), {
    ok: false,
    error: "too_many_active_parties",
  });
});

test("joining enforces existence, active status, membership, capacity, and the per-user cap", () => {
  const base = { partyStatus: "ACTIVE" as const, alreadyMember: false, memberCount: 3, activePartyCountForUser: 0 };
  assert.deepEqual(checkJoin(base), { ok: true });
  assert.deepEqual(checkJoin({ ...base, partyStatus: null }), { ok: false, error: "not_found" });
  assert.deepEqual(checkJoin({ ...base, partyStatus: "COMPLETED" }), { ok: false, error: "party_completed" });
  assert.deepEqual(checkJoin({ ...base, alreadyMember: true }), { ok: false, error: "already_member" });
  assert.deepEqual(checkJoin({ ...base, memberCount: MAX_MEMBERS }), { ok: false, error: "party_full" });
  assert.deepEqual(checkJoin({ ...base, activePartyCountForUser: MAX_ACTIVE_PARTIES_PER_USER }), {
    ok: false,
    error: "too_many_active_parties",
  });
});

test("a normal member can leave; the creator must delete instead", () => {
  assert.deepEqual(checkLeave({ role: "MEMBER" }), { ok: true });
  assert.deepEqual(checkLeave({ role: "CREATOR" }), { ok: false, error: "creator_must_delete_not_leave" });
  assert.deepEqual(checkLeave({ role: null }), { ok: false, error: "not_member" });
});

test("only the creator can delete the party", () => {
  assert.deepEqual(checkDelete({ isCreator: true }), { ok: true });
  assert.deepEqual(checkDelete({ isCreator: false }), { ok: false, error: "not_creator" });
});

test("chat/cart writes require an active member and an ACTIVE party", () => {
  assert.deepEqual(checkActiveMemberAction({ isMember: true, partyStatus: "ACTIVE" }), { ok: true });
  assert.deepEqual(checkActiveMemberAction({ isMember: false, partyStatus: "ACTIVE" }), { ok: false, error: "not_member" });
  assert.deepEqual(checkActiveMemberAction({ isMember: true, partyStatus: "COMPLETED" }), {
    ok: false,
    error: "party_completed",
  });
});

test("only the creator can finalize, and only while ACTIVE", () => {
  assert.deepEqual(checkFinalize({ isCreator: true, partyStatus: "ACTIVE" }), { ok: true });
  assert.deepEqual(checkFinalize({ isCreator: false, partyStatus: "ACTIVE" }), { ok: false, error: "not_creator" });
  assert.deepEqual(checkFinalize({ isCreator: true, partyStatus: "COMPLETED" }), {
    ok: false,
    error: "party_completed",
  });
});
