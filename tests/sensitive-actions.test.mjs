import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { getAppPrincipalFromSession } from "../lib/auth/principal.ts";
import {
  getSensitiveActionAuthorizationResult,
  requireSensitiveActionAuthorization,
} from "../lib/auth/sensitive-actions.ts";
import { setAuthAuditEventStoreForTests } from "../lib/audit/auth-audit-events.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("sensitive actions fail closed without an AppPrincipal and write safe audit metadata", (t) => {
  const events = [];
  setAuthAuditEventStoreForTests({
    append(event) {
      events.push(event);
      return event;
    },
    listByOwner() {
      return events;
    },
  });
  t.after(() => setAuthAuditEventStoreForTests(null));

  const result = getSensitiveActionAuthorizationResult(
    null,
    "storage.replace_connection",
    {
      provider: "google_drive",
      reason: "unit_test",
      resourceId: "connection-secret-id",
      resourceType: "storage_connection",
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, "storage.access.denied");
  assert.equal(events[0].provider, "google_drive");
  assert.equal(events[0].resourceType, "storage_connection");
  assert.equal(events[0].resourceIdHash?.length, 64);
  assert.equal(events[0].metadataJson.includes("connection-secret-id"), false);
});

test("sensitive actions allow a valid non-expired principal", () => {
  const principal = getAppPrincipalFromSession({
    user: { email: " Owner@Example.com ", id: "user-1" },
  });

  const result = getSensitiveActionAuthorizationResult(
    principal,
    "history.export_data",
    { resourceType: "filing_history" },
  );

  assert.equal(result.ok, true);
  assert.equal(result.principal.ownerKey, "owner@example.com");
});

test("requireSensitiveActionAuthorization uses requireAppPrincipal for session enforcement", () => {
  const source = readRepoFile("lib/auth/sensitive-actions.ts");

  assert.match(source, /requireAppPrincipal/);
  assert.match(source, /assertSensitiveActionAuthorized/);
  assert.equal(typeof requireSensitiveActionAuthorization, "function");
});

test("storage replace, storage removal, and history export are wired to sensitive-action helper", () => {
  const startRouteSource = readRepoFile("app/api/storage/google/start/route.ts");
  const setupActionsSource = readRepoFile("app/setup/actions.ts");
  const historyExportSource = readRepoFile("app/api/history/export/route.ts");

  assert.match(startRouteSource, /assertSensitiveActionAuthorized/);
  assert.match(startRouteSource, /storage\.replace_connection/);
  assert.match(setupActionsSource, /assertSensitiveActionAuthorized/);
  assert.match(setupActionsSource, /storage\.remove_connection/);
  assert.match(historyExportSource, /getSensitiveActionAuthorizationResult/);
  assert.match(historyExportSource, /history\.export_data/);
});

test("normal setup save workflow remains outside step-up readiness scope", () => {
  const setupActionsSource = readRepoFile("app/setup/actions.ts");
  const saveSettingsBlock = setupActionsSource.slice(
    setupActionsSource.indexOf("export async function saveFirmSettings"),
    setupActionsSource.indexOf("export async function removeStorageConnectionAction"),
  );

  assert.equal(saveSettingsBlock.includes("assertSensitiveActionAuthorized"), false);
});
