import assert from "node:assert/strict";
import test from "node:test";

import { hasUsableTokens, verifyOAuthState } from "../src/lib/silpo/state.ts";

test("a refresh token keeps a Silpo connection reusable", () => {
  assert.equal(hasUsableTokens({ access_token: "access", token_type: "bearer" }), true);
  assert.equal(hasUsableTokens({ refresh_token: "refresh", token_type: "bearer" }), true);
  assert.equal(hasUsableTokens(undefined), false);
});

test("Silpo callback state must match the initiating user flow", () => {
  assert.doesNotThrow(() => verifyOAuthState("stored-state", "stored-state"));
  assert.throws(() => verifyOAuthState("stored-state", "attacker-state"), /Invalid OAuth state/);
});
