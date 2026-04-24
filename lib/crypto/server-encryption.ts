import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ENCRYPTION_SCHEME = "aes-256-gcm-v1";
const IV_LENGTH_BYTES = 12;
const REQUIRED_KEY_LENGTH_BYTES = 32;

if (typeof window !== "undefined") {
  throw new Error(
    "lib/crypto/server-encryption.ts can only be imported on the server.",
  );
}

export type EncryptedServerValue = {
  scheme: typeof ENCRYPTION_SCHEME;
  iv: string;
  authTag: string;
  ciphertext: string;
};

export function isAppEncryptionConfigured() {
  return Boolean(process.env.APP_ENCRYPTION_KEY?.trim());
}

export function encryptServerValue(value: string) {
  const key = requireAppEncryptionKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return serializeEncryptedServerValue({
    scheme: ENCRYPTION_SCHEME,
    iv: toBase64Url(iv),
    authTag: toBase64Url(authTag),
    ciphertext: toBase64Url(ciphertext),
  });
}

export function decryptServerValue(payload: string) {
  const key = requireAppEncryptionKey();
  const parsed = parseEncryptedServerValue(payload);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    fromBase64Url(parsed.iv),
  );
  decipher.setAuthTag(fromBase64Url(parsed.authTag));

  const plaintext = Buffer.concat([
    decipher.update(fromBase64Url(parsed.ciphertext)),
    decipher.final(),
  ]);

  return plaintext.toString("utf8");
}

export function requireAppEncryptionKey() {
  const raw = process.env.APP_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error(
      "APP_ENCRYPTION_KEY is required when encrypted server persistence is enabled.",
    );
  }

  const key = parseKeyMaterial(raw);
  if (key.byteLength !== REQUIRED_KEY_LENGTH_BYTES) {
    throw new Error(
      "APP_ENCRYPTION_KEY must decode to exactly 32 bytes for aes-256-gcm encryption.",
    );
  }

  return key;
}

function serializeEncryptedServerValue(value: EncryptedServerValue) {
  return JSON.stringify(value);
}

function parseEncryptedServerValue(payload: string): EncryptedServerValue {
  let parsed: unknown;

  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error("Encrypted server value is not valid JSON.");
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as EncryptedServerValue).scheme !== ENCRYPTION_SCHEME ||
    typeof (parsed as EncryptedServerValue).iv !== "string" ||
    typeof (parsed as EncryptedServerValue).authTag !== "string" ||
    typeof (parsed as EncryptedServerValue).ciphertext !== "string"
  ) {
    throw new Error("Encrypted server value has an invalid structure.");
  }

  return parsed as EncryptedServerValue;
}

function parseKeyMaterial(value: string) {
  if (/^[A-Fa-f0-9]{64}$/.test(value)) {
    return Buffer.from(value, "hex");
  }

  return Buffer.from(value, "base64");
}

function toBase64Url(input: Uint8Array) {
  return Buffer.from(input).toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url");
}
