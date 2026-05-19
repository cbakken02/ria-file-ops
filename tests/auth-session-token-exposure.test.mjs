import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { applyPublicSessionMetadata } from "../lib/auth/public-session.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function extractDeclarationBlock(source, moduleName) {
  const start = source.indexOf(`declare module "${moduleName}"`);
  assert.notEqual(start, -1, `missing ${moduleName} declaration`);

  const next = source.indexOf("declare module", start + 1);
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

test("public session metadata helper does not return provider token fields", () => {
  const result = applyPublicSessionMetadata(
    {
      accessToken: "legacy-public-access-token",
      authError: "ProviderTokenError",
      driveConnected: true,
      driveWritable: true,
      expires: "2026-05-18T12:00:00.000Z",
      grantedScopes: ["https://www.googleapis.com/auth/drive"],
      refreshToken: "legacy-public-refresh-token",
      user: {
        email: "owner@example.com",
        image: null,
        name: "Owner User",
      },
    },
    {
      accessToken: "jwt-provider-access-token",
      appSessionCreatedAt: Date.parse("2026-05-18T11:00:00.000Z"),
      appSessionId: "auth-session-token-exposure-test",
      error: "RefreshAccessTokenError",
      grantedScopes: ["https://www.googleapis.com/auth/drive"],
      refreshToken: "jwt-provider-refresh-token",
      sub: "google-user-1",
    },
  );

  const serialized = JSON.stringify(result);
  assert.equal("accessToken" in result, false);
  assert.equal("refreshToken" in result, false);
  assert.equal("authError" in result, false);
  assert.equal("grantedScopes" in result, false);
  assert.equal("driveConnected" in result, false);
  assert.equal("driveWritable" in result, false);
  assert.doesNotMatch(serialized, /legacy-public-access-token/);
  assert.doesNotMatch(serialized, /legacy-public-refresh-token/);
  assert.doesNotMatch(serialized, /jwt-provider-access-token/);
  assert.doesNotMatch(serialized, /jwt-provider-refresh-token/);
  assert.equal(result.user?.id, "google-user-1");
  assert.match(result.appSessionIdHash ?? "", /^[a-f0-9]{64}$/);
});

test("browser-visible Session type does not include OAuth token fields", () => {
  const typeSource = readRepoFile("types/next-auth.d.ts");
  const sessionBlock = extractDeclarationBlock(typeSource, "next-auth");
  const jwtBlock = extractDeclarationBlock(typeSource, "next-auth/jwt");

  assert.doesNotMatch(sessionBlock, /\baccessToken\b/);
  assert.doesNotMatch(sessionBlock, /\brefreshToken\b/);
  assert.doesNotMatch(sessionBlock, /\bdriveConnected\b/);
  assert.doesNotMatch(sessionBlock, /\bdriveWritable\b/);
  assert.doesNotMatch(sessionBlock, /\bgrantedScopes\b/);
  assert.doesNotMatch(jwtBlock, /\baccessToken\b/);
  assert.doesNotMatch(jwtBlock, /\brefreshToken\b/);
});

test("NextAuth login and legacy Drive UI do not request Drive tokens", () => {
  const authSource = readRepoFile("auth.ts");
  const driveButtonSource = readRepoFile("components/google-drive-connect-button.tsx");

  assert.match(authSource, /scope:\s*"openid email profile"/);
  assert.match(authSource, /applyPublicSessionMetadata\(session, token\)/);
  assert.doesNotMatch(authSource, /token\.accessToken\s*=/);
  assert.doesNotMatch(authSource, /token\.refreshToken\s*=/);
  assert.doesNotMatch(authSource, /session\.accessToken\s*=/);
  assert.doesNotMatch(authSource, /account\.access_token/);
  assert.doesNotMatch(authSource, /account\.refresh_token/);

  assert.doesNotMatch(driveButtonSource, /next-auth\/react/);
  assert.doesNotMatch(driveButtonSource, /signIn\(/);
  assert.doesNotMatch(driveButtonSource, /GOOGLE_DRIVE_WRITE_SCOPE/);
  assert.match(driveButtonSource, /\/api\/storage\/google\/start/);
});

test("Drive OAuth token handling stays in server-side storage routes", () => {
  const storageStartSource = readRepoFile("app/api/storage/google/start/route.ts");
  const storageCallbackSource = readRepoFile(
    "app/api/storage/google/callback/route.ts",
  );
  const storageConnectionsSource = readRepoFile("lib/storage-connections.ts");

  assert.match(storageStartSource, /GOOGLE_DRIVE_WRITE_SCOPE/);
  assert.match(storageStartSource, /buildGoogleOAuthFlowCookie/);
  assert.match(storageCallbackSource, /saveStorageConnectionForOwner/);
  assert.match(storageCallbackSource, /accessToken:\s*tokenJson\.access_token/);
  assert.match(
    storageCallbackSource,
    /refreshToken:\s*tokenJson\.refresh_token \?\? null/,
  );
  assert.doesNotMatch(storageConnectionsSource, /syncSessionGoogleConnection/);
  assert.doesNotMatch(storageConnectionsSource, /session\.accessToken/);
});
