import "server-only";

import crypto from "node:crypto";
import type { AppPrincipal } from "@/lib/auth/principal";

export const GOOGLE_STORAGE_OAUTH_FLOW_COOKIE = "storage_google_oauth_flow";
export const GOOGLE_STORAGE_OAUTH_FLOW_TTL_MS = 10 * 60 * 1000;

export type GoogleStorageOAuthFlowMode = "connect" | "replace";

type GoogleStorageOAuthFlowPayload = {
  issuedAt: string;
  mode: GoogleStorageOAuthFlowMode;
  principalBindingHash: string;
  state: string;
  version: 1;
};

export function buildGoogleOAuthFlowCookie(input: {
  mode: GoogleStorageOAuthFlowMode;
  now?: Date;
  principal: AppPrincipal;
  state: string;
}) {
  const payload: GoogleStorageOAuthFlowPayload = {
    issuedAt: (input.now ?? new Date()).toISOString(),
    mode: input.mode,
    principalBindingHash: hashPrincipalBinding(input.principal),
    state: input.state,
    version: 1,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signFlowPayload(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

export function parseGoogleOAuthFlowCookie(
  value: string | undefined,
  input: {
    now?: Date;
    principal: AppPrincipal;
  },
) {
  if (!value) {
    return null;
  }

  const [encodedPayload, signature, extra] = value.split(".");
  if (!encodedPayload || !signature || extra !== undefined) {
    return null;
  }

  if (!safeEqual(signature, signFlowPayload(encodedPayload))) {
    return null;
  }

  let payload: GoogleStorageOAuthFlowPayload;
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as GoogleStorageOAuthFlowPayload;
  } catch {
    return null;
  }

  if (
    payload.version !== 1 ||
    (payload.mode !== "connect" && payload.mode !== "replace") ||
    !isValidOAuthState(payload.state) ||
    payload.principalBindingHash !== hashPrincipalBinding(input.principal)
  ) {
    return null;
  }

  const issuedAt = new Date(payload.issuedAt);
  const now = input.now ?? new Date();
  if (
    Number.isNaN(issuedAt.getTime()) ||
    issuedAt.getTime() > now.getTime() ||
    now.getTime() - issuedAt.getTime() > GOOGLE_STORAGE_OAUTH_FLOW_TTL_MS
  ) {
    return null;
  }

  return {
    mode: payload.mode,
    state: payload.state,
  };
}

function signFlowPayload(encodedPayload: string) {
  return crypto
    .createHmac("sha256", getStorageOAuthCookieSigningSecret())
    .update(encodedPayload)
    .digest("base64url");
}

function hashPrincipalBinding(principal: AppPrincipal) {
  return crypto
    .createHash("sha256")
    .update(`${principal.ownerKey}:${principal.userId}:${principal.workspaceId}`)
    .digest("hex");
}

function isValidOAuthState(state: string) {
  return /^[A-Za-z0-9_-]{16,128}$/.test(state);
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.byteLength === rightBuffer.byteLength &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function getStorageOAuthCookieSigningSecret() {
  return (
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET ??
    process.env.GOOGLE_CLIENT_SECRET ??
    "development-storage-oauth-flow-secret"
  );
}
