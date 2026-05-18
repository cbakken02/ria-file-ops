import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const API_ROUTE_ALLOWLIST = new Map([
  [
    "app/api/auth/[...nextauth]/route.ts",
    "NextAuth owns authentication callbacks.",
  ],
  [
    "app/api/data-intelligence/v2/qa/preview-smoke/route.ts",
    "Preview-only QA route is guarded by Vercel preview env plus timing-safe shared secret.",
  ],
  [
    "app/api/session/logout/route.ts",
    "Logout is intentionally idempotent for signed-out callers and invalidates when a session exists.",
  ],
]);

const SERVER_ACTION_ALLOWLIST = new Map();

const HIGH_RISK_API_ROUTES = [
  "app/api/bug-reports/route.ts",
  "app/api/cleanup/analyze/route.ts",
  "app/api/cleanup/apply/route.ts",
  "app/api/cleanup/browser/route.ts",
  "app/api/cleanup/preview/route.ts",
  "app/api/cleanup/run/route.ts",
  "app/api/data-intelligence/v2/chat/route.ts",
  "app/api/data-intelligence/v2/reveal/route.ts",
  "app/api/drive/files/[fileId]/route.ts",
  "app/api/history/export/route.ts",
  "app/api/history/paths/[eventId]/route.ts",
  "app/api/intake/approve/route.ts",
  "app/api/preview/files/[snapshotId]/route.ts",
  "app/api/preview/refresh/route.ts",
  "app/api/query-assistant/route.ts",
  "app/api/session/keepalive/route.ts",
  "app/api/session/status/route.ts",
  "app/api/storage/connections/route.ts",
  "app/api/storage/folders/route.ts",
  "app/api/storage/google/callback/route.ts",
  "app/api/storage/google/start/route.ts",
];

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function listFiles(command) {
  return execFileSync("zsh", ["-lc", command], {
    cwd: process.cwd(),
    encoding: "utf8",
  })
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

test("protected API route handlers use an API principal or approved guard", () => {
  const routeFiles = listFiles("find app/api -name route.ts -print | sort");
  const allowed = new Set(API_ROUTE_ALLOWLIST.keys());
  const missingGuard = [];

  for (const relativePath of routeFiles) {
    const source = readRepoFile(relativePath);
    const hasGuard =
      /requireApiPrincipal|getApiPrincipalFromSession|requireAppPrincipal/.test(
        source,
      );
    const isAllowed = allowed.has(relativePath);

    if (!hasGuard && !isAllowed) {
      missingGuard.push(relativePath);
    }
  }

  assert.deepEqual(missingGuard, []);
});

test("public and special API route allowlist is explicit and reviewed", () => {
  assert.deepEqual([...API_ROUTE_ALLOWLIST.keys()].sort(), [
    "app/api/auth/[...nextauth]/route.ts",
    "app/api/data-intelligence/v2/qa/preview-smoke/route.ts",
    "app/api/session/logout/route.ts",
  ]);

  for (const [relativePath, reason] of API_ROUTE_ALLOWLIST) {
    assert.ok(fs.existsSync(path.join(process.cwd(), relativePath)));
    assert.ok(reason.length >= 24);
  }
});

test("server actions require an app principal, session helper, role helper, or migration guard", () => {
  const actionFiles = [
    ...listFiles("find app -name actions.ts -print | sort"),
    ...listFiles("find app/actions -type f -name '*.ts' -print | sort"),
  ];
  const allowed = new Set(SERVER_ACTION_ALLOWLIST.keys());
  const missingGuard = [];

  for (const relativePath of actionFiles) {
    const source = readRepoFile(relativePath);
    const hasGuard =
      /requireAppPrincipal|requireSession|requireWorkspaceRole|requireWorkspaceAccess/.test(
        source,
      );
    const isMigrationSwitch =
      /STORAGE_CONNECTION_SWITCHING_MIGRATION_ENABLED/.test(source);

    if (!hasGuard && !isMigrationSwitch && !allowed.has(relativePath)) {
      missingGuard.push(relativePath);
    }
  }

  assert.deepEqual(missingGuard, []);
});

test("high-risk routes do not trust ownerEmail from request input", () => {
  for (const relativePath of HIGH_RISK_API_ROUTES) {
    const source = readRepoFile(relativePath);
    assert.doesNotMatch(
      source,
      /searchParams\.get\(["']ownerEmail["']|body\??\.[A-Za-z0-9_]*ownerEmail|ownerEmail\s*=\s*url\.searchParams/s,
      `${relativePath} must derive owner scope from AppPrincipal`,
    );
  }
});

test("high-risk routes avoid raw session.user.email as authorization scope", () => {
  for (const relativePath of HIGH_RISK_API_ROUTES) {
    const source = readRepoFile(relativePath);
    assert.doesNotMatch(
      source,
      /session(?:\?|\.)?\.user(?:\?|\.)?\.email/,
      `${relativePath} must use AppPrincipal owner scope`,
    );
  }
});

test("legacy storage switching actions remain fail-closed behind the migration flag", () => {
  for (const relativePath of [
    "app/actions/set-active-storage.ts",
    "app/setup/google-drive/actions.ts",
  ]) {
    const source = readRepoFile(relativePath);
    assert.match(source, /requireAppPrincipal/);
    assert.match(source, /assertCanUseStorageConnection/);
    assert.match(source, /STORAGE_CONNECTION_SWITCHING_MIGRATION_ENABLED/);
    assert.match(source, /Storage switching is disabled/);
  }
});

test("approval and cleanup API routes guard before reading request bodies", () => {
  for (const relativePath of [
    "app/api/cleanup/apply/route.ts",
    "app/api/cleanup/run/route.ts",
    "app/api/intake/approve/route.ts",
  ]) {
    const source = readRepoFile(relativePath);
    assert.ok(
      source.indexOf("requireApiPrincipal()") < source.indexOf("request.json()"),
      `${relativePath} should reject unauthenticated callers before parsing the body`,
    );
  }
});

test("resource routes keep owner/resource guards in place", () => {
  const previewRoute = readRepoFile("app/api/preview/files/[snapshotId]/route.ts");
  assert.match(previewRoute, /requireApiPrincipal/);
  assert.match(previewRoute, /previewFileSnapshotBelongsToOwner/);
  assert.match(previewRoute, /Preview snapshot not found/);

  const historyPathRoute = readRepoFile("app/api/history/paths/[eventId]/route.ts");
  assert.match(historyPathRoute, /getFilingEventByOwnerAndId/);
  assert.match(historyPathRoute, /getLegacyOwnerEmail/);

  const storageFolderRoute = readRepoFile("app/api/storage/folders/route.ts");
  assert.match(storageFolderRoute, /getApiPrincipalFromSession/);
  assert.match(storageFolderRoute, /getVerifiedActiveStorageConnectionForSession/);
});
