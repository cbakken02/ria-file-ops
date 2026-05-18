import assert from "node:assert/strict";
import test from "node:test";

import { getAppPrincipalFromSession } from "../lib/auth/principal.ts";
import {
  assertCanAccessPreviewFile,
  assertCanAccessPreviewSnapshot,
  assertCanUseStorageConnection,
  isSameOwner,
  requireOwnerScopedResource,
} from "../lib/auth/resource-guards.ts";

function makePrincipal(email = " owner@example.com ") {
  return getAppPrincipalFromSession({ user: { email } });
}

function makeConnection(ownerEmail = "owner@example.com") {
  return {
    id: "connection-1",
    ownerEmail,
    provider: "google_drive",
    accountEmail: "drive@example.com",
    accountName: "Drive",
    accountImage: null,
    externalAccountId: "drive-account-1",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: null,
    grantedScopes: [],
    isPrimary: true,
    status: "connected",
    createdAt: "2026-05-18T00:00:00.000Z",
    updatedAt: "2026-05-18T00:00:00.000Z",
  };
}

function makeSnapshot(ownerEmail = "owner@example.com") {
  return {
    ownerEmail,
    generatedAt: "2026-05-18T00:00:00.000Z",
    sourceFolder: "Source",
    destinationRoot: "Destination",
    reviewPosture: "Review",
    readyCount: 0,
    reviewCount: 0,
    items: [],
  };
}

test("owner guards accept case and whitespace variants for the same owner", () => {
  const principal = makePrincipal();

  assert.equal(isSameOwner(principal, " OWNER@example.com "), true);
  assert.equal(isSameOwner(principal, "other@example.com"), false);
  assert.doesNotThrow(() =>
    requireOwnerScopedResource(principal, " OWNER@example.com "),
  );
});

test("owner guards fail closed for different owners", () => {
  const principal = makePrincipal();

  assert.throws(() =>
    requireOwnerScopedResource(principal, "other@example.com"),
  );
});

test("storage connection guard blocks cross-owner connections", () => {
  const principal = makePrincipal();

  assert.doesNotThrow(() =>
    assertCanUseStorageConnection(principal, makeConnection(" OWNER@example.com ")),
  );
  assert.throws(() =>
    assertCanUseStorageConnection(principal, makeConnection("other@example.com")),
  );
});

test("preview snapshot and file guards enforce owner scope", () => {
  const principal = makePrincipal();

  assert.doesNotThrow(() =>
    assertCanAccessPreviewSnapshot(principal, makeSnapshot(" OWNER@example.com ")),
  );
  assert.throws(() =>
    assertCanAccessPreviewSnapshot(principal, makeSnapshot("other@example.com")),
  );
  assert.doesNotThrow(() =>
    assertCanAccessPreviewFile(principal, { ownerKey: " OWNER@example.com " }),
  );
  assert.throws(() =>
    assertCanAccessPreviewFile(principal, { ownerEmail: "other@example.com" }),
  );
  assert.throws(() => assertCanAccessPreviewFile(principal, null));
  assert.throws(() => assertCanAccessPreviewFile(principal, {}));
});
