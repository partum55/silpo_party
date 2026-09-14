import assert from "node:assert/strict";
import test from "node:test";

import { decryptJson, encryptJson } from "../src/lib/crypto.ts";

const key = Buffer.alloc(32, 7).toString("base64");

test("OAuth credentials are encrypted at rest", () => {
  const value = { access_token: "secret-token", refresh_token: "refresh-token" };
  const encrypted = encryptJson(value, key);

  assert.equal(encrypted.includes("secret-token"), false);
  assert.deepEqual(decryptJson(encrypted, key), value);
});

test("OAuth credentials fail closed with another key", () => {
  const encrypted = encryptJson({ token: "secret" }, key);
  const wrongKey = Buffer.alloc(32, 8).toString("base64");

  assert.throws(() => decryptJson(encrypted, wrongKey));
});
