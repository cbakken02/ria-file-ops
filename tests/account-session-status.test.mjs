import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  SESSION_IDLE_WARNING_THRESHOLD_MS,
  buildAccountSessionStatus,
  getAccountSessionStatusForSession,
} from "../lib/auth/account-session-status.ts";
import {
  buildWorkspaceIdFromOwnerKey,
} from "../lib/auth/principal.ts";
import {
  SESSION_ABSOLUTE_TIMEOUT_MS,
  SESSION_IDLE_TIMEOUT_MS,
  hashSessionIdentifier,
} from "../lib/auth/session-activity.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOW = new Date("2026-05-18T12:00:00.000Z");
const OWNER_EMAIL = "owner@example.com";
const SESSION_HASH = hashSessionIdentifier("account-session-status-test");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function makePrincipal() {
  return {
    email: OWNER_EMAIL,
    legacyOwnerEmail: OWNER_EMAIL,
    normalizedEmail: OWNER_EMAIL,
    ownerKey: OWNER_EMAIL,
    role: "owner",
    userId: "google-user-1",
    workspaceId: buildWorkspaceIdFromOwnerKey(OWNER_EMAIL),
  };
}

function makeSession(createdAt = new Date(NOW.getTime() - 30 * 60 * 1000)) {
  return {
    accessToken: "google-login-token-that-must-not-leak",
    appSessionCreatedAt: createdAt.toISOString(),
    appSessionIdHash: SESSION_HASH,
    authError: undefined,
    driveConnected: true,
    driveWritable: false,
    grantedScopes: [],
    user: {
      email: OWNER_EMAIL,
      id: "google-user-1",
      name: "Owner User",
    },
  };
}

function makeActivity(overrides = {}) {
  return {
    createdAt: new Date(NOW.getTime() - 30 * 60 * 1000).toISOString(),
    invalidatedAt: null,
    lastActivityAt: new Date(NOW.getTime() - 20 * 60 * 1000).toISOString(),
    ownerEmail: OWNER_EMAIL,
    sessionIdHash: SESSION_HASH,
    updatedAt: new Date(NOW.getTime() - 20 * 60 * 1000).toISOString(),
    userId: "google-user-1",
    workspaceId: buildWorkspaceIdFromOwnerKey(OWNER_EMAIL),
    ...overrides,
  };
}

function makeStorageConnection(overrides = {}) {
  return {
    accessToken: "storage-access-token-that-must-not-leak",
    accountEmail: "drive.owner@example.com",
    accountImage: null,
    accountName: "Drive Owner",
    createdAt: NOW.toISOString(),
    expiresAt: null,
    externalAccountId: "drive-account-1",
    grantedScopes: ["https://www.googleapis.com/auth/drive.metadata.readonly"],
    id: "storage-1",
    isPrimary: true,
    ownerEmail: OWNER_EMAIL,
    provider: "google_drive",
    refreshToken: "storage-refresh-token-that-must-not-leak",
    status: "connected",
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

test("account session status exposes safe user, session, and storage state", () => {
  const status = buildAccountSessionStatus({
    activity: makeActivity(),
    activeConnection: makeStorageConnection(),
    now: NOW,
    principal: makePrincipal(),
    session: makeSession(),
  });

  assert.equal(status.user.email, OWNER_EMAIL);
  assert.equal(status.user.role, "owner");
  assert.equal(status.user.workspaceId, buildWorkspaceIdFromOwnerKey(OWNER_EMAIL));
  assert.equal(status.session.status, "active");
  assert.equal(
    status.session.idleExpiresAt,
    new Date(NOW.getTime() + 40 * 60 * 1000).toISOString(),
  );
  assert.equal(status.storage.provider, "google_drive");
  assert.equal(status.storage.providerLabel, "Google Drive");
  assert.equal(status.storage.accountIdentifier, "drive.owner@example.com");
  assert.equal(status.storage.status, "connected");
  assert.equal(status.storage.needsReconnect, false);
});

test("account session status redacts OAuth tokens and session identifiers", () => {
  const status = buildAccountSessionStatus({
    activity: makeActivity(),
    activeConnection: makeStorageConnection(),
    now: NOW,
    principal: makePrincipal(),
    session: makeSession(),
  });
  const serialized = JSON.stringify(status);

  assert.doesNotMatch(serialized, /access-token-that-must-not-leak/);
  assert.doesNotMatch(serialized, /refresh-token-that-must-not-leak/);
  assert.doesNotMatch(serialized, /google-login-token-that-must-not-leak/);
  assert.doesNotMatch(serialized, new RegExp(SESSION_HASH));
  assert.equal("accessToken" in status.storage, false);
  assert.equal("refreshToken" in status.storage, false);
  assert.equal("appSessionIdHash" in status.session, false);
});

test("idle warning threshold and expired status are deterministic", () => {
  const warningActivity = makeActivity({
    lastActivityAt: new Date(
      NOW.getTime() -
        SESSION_IDLE_TIMEOUT_MS +
        SESSION_IDLE_WARNING_THRESHOLD_MS -
        1,
    ).toISOString(),
  });
  const warningStatus = buildAccountSessionStatus({
    activity: warningActivity,
    activeConnection: null,
    now: NOW,
    principal: makePrincipal(),
    session: makeSession(),
  });

  assert.equal(warningStatus.session.status, "idle_warning");
  assert.equal(warningStatus.storage.status, "not_connected");

  const expiredStatus = buildAccountSessionStatus({
    activity: makeActivity({
      lastActivityAt: new Date(
        NOW.getTime() - SESSION_IDLE_TIMEOUT_MS - 1,
      ).toISOString(),
    }),
    activeConnection: makeStorageConnection(),
    now: NOW,
    principal: makePrincipal(),
    session: makeSession(),
  });

  assert.equal(expiredStatus.session.status, "expired");

  const absoluteExpiredStatus = buildAccountSessionStatus({
    activity: makeActivity({
      lastActivityAt: new Date(NOW.getTime() - 1000).toISOString(),
    }),
    activeConnection: makeStorageConnection(),
    now: NOW,
    principal: makePrincipal(),
    session: makeSession(
      new Date(NOW.getTime() - SESSION_ABSOLUTE_TIMEOUT_MS - 1),
    ),
  });

  assert.equal(absoluteExpiredStatus.session.status, "expired");
});

test("server status helper reads one active storage connection without leaking secrets", async () => {
  const status = await getAccountSessionStatusForSession(
    makeSession(),
    makePrincipal(),
    {
      now: NOW,
      readActivity(sessionIdHash) {
        assert.equal(sessionIdHash, SESSION_HASH);
        return makeActivity();
      },
      readStorageConnection() {
        return makeStorageConnection({ status: "needs_reauth" });
      },
    },
  );

  assert.equal(status.storage.status, "needs_reconnect");
  assert.equal(status.storage.needsReconnect, true);
  assert.equal(status.storage.accountIdentifier, "drive.owner@example.com");
  assert.doesNotMatch(JSON.stringify(status), /storage-refresh-token/);
});

test("session status and keepalive routes are API-safe and no-store", () => {
  for (const relativePath of [
    "app/api/session/status/route.ts",
    "app/api/session/keepalive/route.ts",
  ]) {
    const source = readRepoFile(relativePath);

    assert.match(source, /getApiPrincipalFromSession\(session\)/);
    assert.match(source, /principalResult\.response/);
    assert.match(source, /getAccountSessionStatusForSession/);
    assert.match(source, /Cache-Control/);
    assert.match(source, /private, no-store/);
    assert.doesNotMatch(source, /accessToken/);
    assert.doesNotMatch(source, /refreshToken/);
  }

  assert.match(readRepoFile("app/api/session/keepalive/route.ts"), /POST/);
});

test("account status UI keeps single-storage language", () => {
  const combinedSource = [
    "components/account-menu.tsx",
    "components/account-session-status.tsx",
    "components/product-shell.tsx",
  ]
    .map(readRepoFile)
    .join("\n");

  for (const disallowed of [
    "Linked storage",
    "Add another connection",
    "Switch storage",
    "storage totals",
  ]) {
    assert.equal(
      combinedSource.includes(disallowed),
      false,
      `account status UI should not reintroduce ${disallowed}`,
    );
  }

  assert.match(combinedSource, /Signed in/);
  assert.match(combinedSource, /Idle logout/);
  assert.match(combinedSource, /Storage account/);
  assert.match(combinedSource, /Log out/);
  assert.match(combinedSource, /\/api\/session\/keepalive/);
});
