import assert from "node:assert/strict";
import test from "node:test";

import { authDestination } from "../src/lib/auth-policy.ts";

test("unauthenticated visitors can only stay on login", () => {
  assert.equal(authDestination("/", false, false), "/login");
  assert.equal(authDestination("/connect-silpo", false, false), "/login");
  assert.equal(authDestination("/login", false, false), null);
  assert.equal(authDestination("/auth/callback", false, false), null);
  assert.equal(authDestination("/auth/silpo/callback", false, false), "/login");
  assert.equal(authDestination("/auth/logout", false, false), "/login");
});

test("authenticated users must complete Silpo onboarding", () => {
  assert.equal(authDestination("/", true, false), "/connect-silpo");
  assert.equal(authDestination("/connect-silpo", true, false), null);
  assert.equal(authDestination("/auth/silpo/start", true, false), null);
  assert.equal(authDestination("/auth/silpo/callback", true, false), null);
  assert.equal(authDestination("/auth/logout", true, false), null);
  assert.equal(authDestination("/login", true, false), "/connect-silpo");
});

test("connected users skip onboarding", () => {
  assert.equal(authDestination("/", true, true), null);
  assert.equal(authDestination("/connect-silpo", true, true), "/");
  assert.equal(authDestination("/auth/silpo/start", true, true), "/");
  assert.equal(authDestination("/auth/logout", true, true), null);
  assert.equal(authDestination("/login", true, true), "/");
});
