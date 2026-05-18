import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildWorkspaceIdFromOwnerKey,
} from "../lib/auth/principal.ts";
import {
  buildGoogleOAuthFlowCookie,
  GOOGLE_STORAGE_OAUTH_FLOW_COOKIE,
  GOOGLE_STORAGE_OAUTH_FLOW_TTL_MS,
  parseGoogleOAuthFlowCookie,
} from "../lib/storage/google-oauth-flow.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOW = new Date("2026-05-18T13:00:00.000Z");
const STATE = "storage-oauth-state-12345";

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function makePrincipal(ownerKey = "owner@example.com") {
  return {
    email: ownerKey,
    legacyOwnerEmail: ownerKey,
    normalizedEmail: ownerKey,
    ownerKey,
    role: "owner",
    userId: `user:${ownerKey}`,
    workspaceId: buildWorkspaceIdFromOwnerKey(ownerKey),
  };
}

test("storage OAuth flow cookie is signed, expires, and is bound to the principal", () => {
  const principal = makePrincipal();
  const cookieValue = buildGoogleOAuthFlowCookie({
    mode: "replace",
    now: NOW,
    principal,
    state: STATE,
  });

  assert.notEqual(cookieValue, `${STATE}:replace`);
  assert.deepEqual(
    parseGoogleOAuthFlowCookie(cookieValue, { now: NOW, principal }),
    { mode: "replace", state: STATE },
  );
  assert.equal(
    parseGoogleOAuthFlowCookie(`${cookieValue}.extra`, { now: NOW, principal }),
    null,
  );
  assert.equal(
    parseGoogleOAuthFlowCookie(cookieValue.replace(/\.[^.]+$/, ".tampered"), {
      now: NOW,
      principal,
    }),
    null,
  );
  assert.equal(
    parseGoogleOAuthFlowCookie(cookieValue, {
      now: NOW,
      principal: makePrincipal("other@example.com"),
    }),
    null,
  );
  assert.equal(
    parseGoogleOAuthFlowCookie(cookieValue, {
      now: new Date(NOW.getTime() + GOOGLE_STORAGE_OAUTH_FLOW_TTL_MS + 1),
      principal,
    }),
    null,
  );
  assert.equal(
    parseGoogleOAuthFlowCookie(`${STATE}:replace`, { now: NOW, principal }),
    null,
  );
});

test("storage OAuth start route creates a hardened HttpOnly flow cookie", () => {
  const source = readRepoFile("app/api/storage/google/start/route.ts");
  const helperSource = readRepoFile("lib/storage/google-oauth-flow.ts");

  assert.match(source, /GOOGLE_STORAGE_OAUTH_FLOW_COOKIE/);
  assert.match(helperSource, new RegExp(GOOGLE_STORAGE_OAUTH_FLOW_COOKIE));
  assert.match(source, /buildGoogleOAuthFlowCookie/);
  assert.match(source, /principal/);
  assert.match(source, /httpOnly:\s*true/);
  assert.match(source, /sameSite:\s*"lax"/);
  assert.match(source, /secure:\s*process\.env\.NODE_ENV === "production"/);
  assert.match(source, /GOOGLE_STORAGE_OAUTH_FLOW_TTL_MS \/ 1000/);
  assert.match(source, /assertSensitiveActionAuthorized/);
});

test("storage OAuth callback validates signed state and never trusts replace query params", () => {
  const source = readRepoFile("app/api/storage/google/callback/route.ts");

  assert.match(source, /parseGoogleOAuthFlowCookie/);
  assert.match(source, /GOOGLE_STORAGE_OAUTH_FLOW_COOKIE/);
  assert.match(source, /\{ principal \}/);
  assert.match(source, /state !== savedFlow\.state/);
  assert.match(source, /cookieStore\.delete\(GOOGLE_STORAGE_OAUTH_FLOW_COOKIE\)/);
  assert.match(source, /stateMatches/);
  assert.equal(source.includes('searchParams.get("replace")'), false);
  assert.equal(source.includes('searchParams.get("mode")'), false);
  assert.match(source, /replaceRequested: savedFlow\.mode === "replace"/);
});

test("storage OAuth callback keeps safe redirects and token-redacted audits", () => {
  const source = readRepoFile("app/api/storage/google/callback/route.ts");

  assert.match(source, /normalizeOAuthError/);
  assert.match(source, /Google did not authorize storage access/);
  assert.match(source, /recordAuthAuditEvent/);
  assert.doesNotMatch(source, /metadata:\s*{[^}]*access_token/s);
  assert.doesNotMatch(source, /metadata:\s*{[^}]*refresh_token/s);
  assert.doesNotMatch(source, /metadata:\s*{[^}]*code,/s);
  assert.doesNotMatch(source, /redirect\([^`"']*request\.url/);
  assert.match(source, /\/setup\?section=workspace&notice=/);
});

test("app login OAuth stays distinct from Google Drive storage authorization", () => {
  const authSource = readRepoFile("auth.ts");
  const storageStartSource = readRepoFile("app/api/storage/google/start/route.ts");

  assert.match(authSource, /scope:\s*"openid email profile"/);
  assert.doesNotMatch(authSource, /GOOGLE_DRIVE_WRITE_SCOPE[^;]*scope/s);
  assert.match(storageStartSource, /GOOGLE_DRIVE_WRITE_SCOPE/);
  assert.match(storageStartSource, /scope: `openid email profile \$\{GOOGLE_DRIVE_WRITE_SCOPE\}`/);
});
