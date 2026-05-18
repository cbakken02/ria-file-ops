import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  getApiPrincipalFromSession,
} from "../lib/auth/principal.ts";
import {
  SESSION_IDLE_TIMEOUT_MS,
  hashSessionIdentifier,
  setSessionActivityStoreForTests,
} from "../lib/auth/session-activity.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SESSION_HASH = hashSessionIdentifier("session-timeout-test");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function makeSession(now = new Date()) {
  return {
    appSessionCreatedAt: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
    appSessionIdHash: SESSION_HASH,
    user: {
      email: "owner@example.com",
      id: "google-user-1",
    },
  };
}

function makeStore(record) {
  return {
    get() {
      return record;
    },
    invalidate() {
      return null;
    },
    upsert(input) {
      return {
        invalidatedAt: null,
        ...input,
      };
    },
  };
}

test("API principal helper returns unauthorized for expired session", async () => {
  const now = new Date();
  setSessionActivityStoreForTests(
    makeStore({
      createdAt: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
      invalidatedAt: null,
      lastActivityAt: new Date(
        now.getTime() - SESSION_IDLE_TIMEOUT_MS - 1,
      ).toISOString(),
      ownerEmail: "owner@example.com",
      sessionIdHash: SESSION_HASH,
      updatedAt: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
      userId: "google-user-1",
      workspaceId: "workspace:test",
    }),
  );

  try {
    const result = await getApiPrincipalFromSession(makeSession(now));

    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
    assert.equal(result.error, "Session expired");
    assert.equal(result.response.status, 401);
  } finally {
    setSessionActivityStoreForTests(null);
  }
});

test("page and server-action session helper redirects expired sessions", () => {
  const source = readRepoFile("lib/session.ts");

  assert.match(source, /getAppPrincipalResultFromSession/);
  assert.match(source, /redirect\(/);
  assert.match(source, /reason/);
  assert.match(source, /\/login\?reason=/);
});

test("logout invalidates app session state without deleting storage credentials", () => {
  const routeSource = readRepoFile("app/api/session/logout/route.ts");
  const activitySource = readRepoFile("lib/auth/session-activity.ts");

  assert.match(routeSource, /invalidateSessionActivityForSession/);
  assert.doesNotMatch(routeSource, /deleteStorageConnection/i);
  assert.doesNotMatch(activitySource, /deleteStorageConnection/i);
});

test("storage-backed API routes fail expired sessions before provider authorization", () => {
  for (const relativePath of [
    "app/api/cleanup/analyze/route.ts",
    "app/api/drive/files/[fileId]/route.ts",
    "app/api/storage/folders/route.ts",
  ]) {
    const source = readRepoFile(relativePath);
    const principalGuardIndex = source.indexOf(
      "if (!principalResult.ok || !session)",
    );
    const providerAuthorizationIndex = source.indexOf(
      "await getVerifiedActiveStorageConnectionForSession(session)",
    );

    assert.notEqual(
      principalGuardIndex,
      -1,
      `${relativePath} should guard expired sessions before storage access`,
    );
    assert.notEqual(
      providerAuthorizationIndex,
      -1,
      `${relativePath} should use verified active storage authorization`,
    );
    assert.equal(
      principalGuardIndex < providerAuthorizationIndex,
      true,
      `${relativePath} should not touch storage/provider authorization before returning 401 for an expired session`,
    );
    assert.doesNotMatch(
      source,
      /session\s*\?\s*await getVerifiedActiveStorageConnectionForSession/,
    );
  }
});
