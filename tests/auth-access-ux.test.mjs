import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("login page explains safe auth outcomes without exposing tenant internals", () => {
  const source = readRepoFile("app/login/page.tsx");

  for (const reason of [
    "absolute_timeout",
    "access_denied",
    "idle_timeout",
    "invalidated",
    "logged_out",
    "unauthorized",
  ]) {
    assert.match(source, new RegExp(`case "${reason}"`));
  }

  assert.match(source, /Your session expired after inactivity/);
  assert.match(source, /This app session was signed out/);
  assert.match(source, /Log in with an account that has access/);
  assert.match(source, /searchParams\?:\s*Promise/);
  assert.doesNotMatch(source, /ownerKey|legacyOwnerEmail|appSessionIdHash|session token/i);
});

test("account logout returns users to a clear signed-out landing state", () => {
  const source = readRepoFile("components/account-menu.tsx");

  assert.match(source, /fetch\("\/api\/session\/logout"/);
  assert.match(source, /method:\s*"POST"/);
  assert.match(source, /POST_LOGOUT_LANDING_URL/);
  assert.match(source, /signOut\(\{\s*callbackUrl:\s*POST_LOGOUT_LANDING_URL/s);
  assert.doesNotMatch(source, /deleteStorageConnection/i);
});

test("idle-expired and keepalive UX stays explicit and server-backed", () => {
  const source = readRepoFile("components/account-session-status.tsx");

  assert.match(source, /href="\/login\?reason=idle_timeout"/);
  assert.match(source, /fetch\("\/api\/session\/keepalive"/);
  assert.match(source, /method:\s*"POST"/);
  assert.match(source, /Session nearly idle/);
  assert.match(source, /Session expired/);
  assert.doesNotMatch(source, /setInterval\([^)]*fetch\("\/api\/session\/keepalive"/s);
});

test("storage reconnect messaging stays distinct from app login", () => {
  const source = readRepoFile("components/account-session-status.tsx");

  assert.match(source, /needs reconnect/);
  assert.match(source, /Reconnect storage/);
  assert.match(source, /getStorageReconnectHref/);
  assert.match(source, /\/api\/storage\/google\/start/);
  assert.doesNotMatch(source, /Reconnect Google login|Drive login/i);
});

test("auth access UI does not reintroduce multi-storage or internal identifiers", () => {
  const combinedSource = [
    "app/login/page.tsx",
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
    "multiple active storages",
    "ownerKey",
    "legacyOwnerEmail",
    "appSessionIdHash",
  ]) {
    assert.equal(
      combinedSource.includes(disallowed),
      false,
      `auth access UI should not expose ${disallowed}`,
    );
  }
});

test("protected resource denials keep API status patterns safe", () => {
  const previewFileRoute = readRepoFile("app/api/preview/files/[snapshotId]/route.ts");
  const historyExportRoute = readRepoFile("app/api/history/export/route.ts");
  const statusRoute = readRepoFile("app/api/session/status/route.ts");

  assert.match(previewFileRoute, /return new Response\("Unauthorized", \{ status: 401 \}\)/);
  assert.match(previewFileRoute, /Preview snapshot not found/);
  assert.match(previewFileRoute, /\{ status: 404 \}/);
  assert.match(historyExportRoute, /return new Response\("Unauthorized", \{ status: 401 \}\)/);
  assert.match(historyExportRoute, /return new Response\("Forbidden", \{ status: 403 \}\)/);
  assert.match(statusRoute, /Response\.json\(\{ error: "Unauthorized" \}, \{ status: 401 \}\)/);
});
