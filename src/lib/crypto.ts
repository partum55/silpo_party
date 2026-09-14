import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV_BYTES = 12;

function decodeKey(key: string) {
  const decoded = Buffer.from(key, "base64");
  if (decoded.length !== 32) throw new Error("SILPO_CREDENTIALS_KEY must decode to 32 bytes");
  return decoded;
}

export function encryptJson(value: unknown, key: string) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", decodeKey(key), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

export function decryptJson<T>(payload: string, key: string): T {
  const encrypted = Buffer.from(payload, "base64url");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    decodeKey(key),
    encrypted.subarray(0, IV_BYTES),
  );
  decipher.setAuthTag(encrypted.subarray(IV_BYTES, IV_BYTES + 16));
  return JSON.parse(
    Buffer.concat([
      decipher.update(encrypted.subarray(IV_BYTES + 16)),
      decipher.final(),
    ]).toString("utf8"),
  ) as T;
}
