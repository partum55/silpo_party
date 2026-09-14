import assert from "node:assert/strict";
import test from "node:test";

import { formatUnknownError } from "../src/lib/errors.ts";

test("formats ordinary Error instances", () => {
  assert.equal(formatUnknownError(new Error("Gateway Timeout")), "Gateway Timeout");
});

test("preserves useful Supabase error fields", () => {
  assert.equal(formatUnknownError({
    code: "22P02",
    message: "invalid input syntax for type integer: \"1.5\"",
    details: "Failing row contains a fractional quantity.",
    hint: null,
  }), "invalid input syntax for type integer: \"1.5\" | details: Failing row contains a fractional quantity. | code: 22P02");
});

test("serializes other structured thrown values", () => {
  assert.equal(formatUnknownError({ reason: "bad value" }), '{"reason":"bad value"}');
});
