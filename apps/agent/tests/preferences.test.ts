import assert from "node:assert/strict";
import test from "node:test";

import {
  applyParticipantWishChanges,
  getPreferencePhase,
  setParticipantPreferenceStatus,
} from "../src/domain/preferences.ts";
import { memberSchema, wishChangesSchema } from "../src/domain/schemas.ts";

test("message-derived wish changes cannot set readiness", () => {
  assert.throws(() => wishChangesSchema.parse({ changes: [], status: "ready" }));
  assert.throws(() => wishChangesSchema.parse({ changes: [{ action: "add", text: "cola", status: "ready" }] }));
});

test("messages mutate only the collecting participant's wishes", () => {
  const party = {
    members: [
      memberSchema.parse({ id: "a", wishes: [{ id: "chips", text: "chips" }] }),
      memberSchema.parse({ id: "b", wishes: [{ id: "pizza", text: "pizza" }] }),
    ],
  };
  const changed = applyParticipantWishChanges(party, "a", [
    { action: "replace", wishId: "chips", text: "spicy chips" },
    { action: "add", text: "cola" },
    { action: "remove", wishId: "chips" },
  ], () => "cola");

  assert.deepEqual(changed.members[0]?.wishes, [{ id: "cola", text: "cola", fulfillmentStrategy: "either" }]);
  assert.deepEqual(changed.members[1], party.members[1]);
  assert.equal(changed.members[0]?.status, "collecting");
});

test("preference messages append by default across turns", () => {
  const party = { members: [memberSchema.parse({ id: "a" })] };
  const first = applyParticipantWishChanges(party, "a", [
    { action: "add", text: "чіпси" },
    { action: "add", text: "кола" },
  ], (() => {
    const ids = ["chips", "cola"];
    return () => ids.shift()!;
  })());
  const second = applyParticipantWishChanges(first, "a", [{ action: "add", text: "нутелла" }], () => "nutella");

  assert.deepEqual(second.members[0]?.wishes.map((wish) => wish.text), ["чіпси", "кола", "нутелла"]);
});

test("wish strategy defaults to either and explicit cooking is preserved", () => {
  const party = { members: [memberSchema.parse({ id: "a" })] };
  const changed = applyParticipantWishChanges(party, "a", [
    { action: "add", text: "піца" },
    { action: "add", text: "приготуємо салат", fulfillmentStrategy: "recipe" },
  ], (() => {
    const ids = ["pizza", "salad"];
    return () => ids.shift()!;
  })());

  assert.deepEqual(changed.members[0]?.wishes.map((wish) => wish.fulfillmentStrategy), ["either", "recipe"]);
});

test("only explicit destructive operations discard existing wishes", () => {
  const party = {
    members: [memberSchema.parse({
      id: "a",
      wishes: [{ id: "chips", text: "чіпси" }, { id: "cola", text: "кола" }],
    })],
  };
  const replaced = applyParticipantWishChanges(party, "a", [
    { action: "replace", wishId: "chips", text: "начос" },
  ]);
  const removed = applyParticipantWishChanges(replaced, "a", [{ action: "remove", wishId: "cola" }]);
  const reset = applyParticipantWishChanges(removed, "a", [{ action: "reset" }]);

  assert.deepEqual(replaced.members[0]?.wishes.map((wish) => wish.text), ["начос", "кола"]);
  assert.deepEqual(removed.members[0]?.wishes.map((wish) => wish.text), ["начос"]);
  assert.deepEqual(reset.members[0]?.wishes, []);
});

test("only explicit actions finalize and reopen participant preferences", () => {
  const party = { members: [memberSchema.parse({ id: "a" })] };
  const ready = setParticipantPreferenceStatus(party, "a", "ready");

  assert.equal(getPreferencePhase(party), "provisional");
  assert.equal(getPreferencePhase(ready), "finalized");
  assert.throws(() => applyParticipantWishChanges(ready, "a", [{ action: "add", text: "pizza" }]));
  assert.equal(setParticipantPreferenceStatus(ready, "a", "collecting").members[0]?.status, "collecting");
});
