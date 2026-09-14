// No 0/O/1/I: avoids characters that are easy to misread when a join code is read aloud or typed.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateJoinCode(length = 6): string {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

export function joinPath(code: string): string {
  return `/join/${code.trim().toUpperCase()}`;
}

/** Accepts either a bare code or a pasted invite link (`.../join/CODE`) and returns the code alone. */
export function extractJoinCode(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const segment = trimmed.includes("/") ? (trimmed.split("/").filter(Boolean).pop() ?? "") : trimmed;
  return segment.toUpperCase();
}

/** Short-lived cookie carrying an invite code through the login/Silpo-connect redirect chain. */
export const PENDING_JOIN_COOKIE = "pending_join_code";
