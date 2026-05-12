import assert from "node:assert/strict";
import test from "node:test";

import {
  getCachedStorageConnectionsForSession,
  getSafeStorageConnectionsByOwnerEmail,
} from "../lib/storage-connections.ts";

function makeConnection(overrides = {}) {
  return {
    id: "connection-1",
    ownerEmail: "owner@example.com",
    provider: "google_drive",
    accountEmail: "owner@example.com",
    accountName: "Owner",
    accountImage: null,
    externalAccountId: "owner-google-id",
    accessToken: "access-token",
    refreshToken: null,
    expiresAt: null,
    grantedScopes: [],
    isPrimary: true,
    status: "connected",
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:00.000Z",
    ...overrides,
  };
}

test("safe storage connection reads fall back to no connections when persistence is unavailable", (t) => {
  const warn = t.mock.method(console, "warn", () => {});

  const connections = getSafeStorageConnectionsByOwnerEmail("owner@example.com", {
    readConnections() {
      throw new Error("Tenant or user not found");
    },
    source: "unit-test",
  });

  assert.deepEqual(connections, []);
  assert.equal(warn.mock.callCount(), 1);
});

test("cached session storage reads return persisted connections when the read succeeds", () => {
  const persistedConnection = makeConnection();
  const connections = getCachedStorageConnectionsForSession(
    {
      user: { email: "owner@example.com" },
    },
    {
      readConnections(ownerEmail) {
        assert.equal(ownerEmail, "owner@example.com");
        return [persistedConnection];
      },
    },
  );

  assert.deepEqual(connections, [persistedConnection]);
});
