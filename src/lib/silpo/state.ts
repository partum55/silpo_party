import { timingSafeEqual } from "node:crypto";

import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

export function hasUsableTokens(tokens?: Partial<OAuthTokens>) {
  return Boolean(tokens?.access_token || tokens?.refresh_token);
}

export function verifyOAuthState(expected: string | undefined, actual: string | null) {
  const left = Buffer.from(expected ?? "");
  const right = Buffer.from(actual ?? "");
  if (!left.length || left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new Error("Invalid OAuth state");
  }
}
