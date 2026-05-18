import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuthAuditEvent,
  getAuthAuditEventsForPrincipal,
  hashAuditIdentifier,
  recordAuthAuditEvent,
  sanitizeAuditMetadata,
  setAuthAuditEventStoreForTests,
} from "../lib/audit/auth-audit-events.ts";
import { buildWorkspaceIdFromOwnerKey } from "../lib/auth/principal.ts";

const NOW = new Date("2026-05-18T12:30:00.000Z");
const OWNER_EMAIL = "owner@example.com";

function makePrincipal(ownerKey = OWNER_EMAIL) {
  return {
    email: ownerKey,
    legacyOwnerEmail: ownerKey,
    normalizedEmail: ownerKey,
    ownerKey,
    role: "owner",
    userId: "google-user-1",
    workspaceId: buildWorkspaceIdFromOwnerKey(ownerKey),
  };
}

function makeMemoryAuditStore({ failAppend = false } = {}) {
  const events = [];

  return {
    events,
    store: {
      append(event) {
        if (failAppend) {
          throw new Error("audit store unavailable");
        }
        events.push(event);
        return event;
      },
      listByOwner(ownerKey) {
        return events.filter((event) => event.actorOwnerKey === ownerKey);
      },
    },
  };
}

test.afterEach(() => {
  setAuthAuditEventStoreForTests(null);
});

test("audit event builder normalizes owner scope and hashes actor/resource identifiers", () => {
  const event = buildAuthAuditEvent(
    {
      actorEmail: " Owner@Example.com ",
      eventType: "storage.oauth.callback_success",
      resourceId: "drive-account-1",
      resourceType: "storage_connection",
      status: "succeeded",
    },
    NOW,
  );

  assert.equal(event.actorOwnerKey, OWNER_EMAIL);
  assert.equal(event.actorWorkspaceId, buildWorkspaceIdFromOwnerKey(OWNER_EMAIL));
  assert.equal(event.actorEmailHash, hashAuditIdentifier(OWNER_EMAIL));
  assert.equal(event.resourceIdHash, hashAuditIdentifier("drive-account-1"));
  assert.equal(event.createdAt, NOW.toISOString());
});

test("audit metadata redacts token, cookie, secret, and session hash fields", () => {
  const metadata = sanitizeAuditMetadata({
    accessToken: "ya29.google-token-that-must-not-leak",
    nested: {
      Authorization: "Bearer raw-session-token",
      refresh_token: "refresh-token-that-must-not-leak",
      safe: "visible",
      sessionIdHash: "abc123",
    },
    provider: "google_drive",
  });

  const serialized = JSON.stringify(metadata);
  assert.doesNotMatch(serialized, /google-token-that-must-not-leak/);
  assert.doesNotMatch(serialized, /raw-session-token/);
  assert.doesNotMatch(serialized, /refresh-token-that-must-not-leak/);
  assert.doesNotMatch(serialized, /abc123/);
  assert.equal(metadata.nested.safe, "visible");
});

test("audit writer persists owner-scoped events and exposes only that owner", () => {
  const memory = makeMemoryAuditStore();
  setAuthAuditEventStoreForTests(memory.store);

  const owner = makePrincipal();
  const other = makePrincipal("other@example.com");
  const result = recordAuthAuditEvent(
    {
      eventType: "auth.logout",
      principal: owner,
      resourceType: "app_session",
      status: "succeeded",
    },
    { now: NOW },
  );
  recordAuthAuditEvent(
    {
      eventType: "preview.file.access_denied",
      principal: other,
      resourceId: "preview-file-1",
      resourceType: "preview_file_snapshot",
      status: "denied",
    },
    { now: NOW },
  );

  assert.equal(result.ok, true);
  assert.equal(memory.events.length, 2);
  assert.deepEqual(
    getAuthAuditEventsForPrincipal(owner).map((event) => event.eventType),
    ["auth.logout"],
  );
});

test("audit writer reports persistence failures without throwing by default", () => {
  const memory = makeMemoryAuditStore({ failAppend: true });
  setAuthAuditEventStoreForTests(memory.store);

  const result = recordAuthAuditEvent(
    {
      eventType: "storage.oauth.callback_denied",
      principal: makePrincipal(),
      reason: "invalid_state",
      status: "denied",
    },
    { now: NOW },
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /unavailable/);
});

test("stage 2 instrumentation avoids token fields in audited flows", async () => {
  const sourceFiles = [
    "app/api/session/logout/route.ts",
    "app/api/session/keepalive/route.ts",
    "app/api/storage/google/start/route.ts",
    "app/api/storage/google/callback/route.ts",
    "app/api/preview/files/[snapshotId]/route.ts",
    "lib/auth/session-activity.ts",
    "lib/storage-connections.ts",
  ];

  const fs = await import("node:fs");
  const path = await import("node:path");
  for (const relativePath of sourceFiles) {
    const source = fs.readFileSync(
      path.join(process.cwd(), relativePath),
      "utf8",
    );
    assert.match(source, /recordAuthAuditEvent/);
    assert.doesNotMatch(
      source,
      /metadata:\s*{[^}]*accessToken|metadata:\s*{[^}]*refreshToken/s,
      `${relativePath} should not place raw tokens in audit metadata`,
    );
  }
});
