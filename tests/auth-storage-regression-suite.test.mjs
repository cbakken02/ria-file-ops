import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildWorkspaceIdFromOwnerKey,
  getAppPrincipalFromSession,
} from "../lib/auth/principal.ts";
import {
  getSensitiveActionAuthorizationResult,
} from "../lib/auth/sensitive-actions.ts";
import {
  SESSION_IDLE_TIMEOUT_MS,
  enforceSessionActivity,
  hashSessionIdentifier,
} from "../lib/auth/session-activity.ts";
import {
  buildGoogleOAuthFlowCookie,
  parseGoogleOAuthFlowCookie,
} from "../lib/storage/google-oauth-flow.ts";
import {
  getStorageProviderAdapter,
  UnsupportedStorageProviderError,
} from "../lib/storage/provider-registry.ts";
import {
  resolveStorageOAuthConnectionDecision,
} from "../lib/storage-connections.ts";
import { sanitizeAuditMetadata } from "../lib/audit/auth-audit-events.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SESSION_HASH = hashSessionIdentifier("auth-storage-regression-suite");

const API_ROUTE_ALLOWLIST = new Map([
  [
    "app/api/auth/[...nextauth]/route.ts",
    "NextAuth owns the app-login OAuth callbacks.",
  ],
  [
    "app/api/data-intelligence/v2/qa/preview-smoke/route.ts",
    "Preview-only QA route is guarded by Vercel preview env plus shared secret.",
  ],
  [
    "app/api/session/logout/route.ts",
    "Logout is idempotent for signed-out callers and invalidates when a session exists.",
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
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function listFiles(command) {
  return execFileSync("zsh", ["-lc", command], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
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

function makeStorageConnection(overrides = {}) {
  return {
    accessToken: "storage-access-token",
    accountEmail: "owner@example.com",
    accountImage: null,
    accountName: "Owner",
    createdAt: "2026-05-18T00:00:00.000Z",
    expiresAt: null,
    externalAccountId: "google-owner-1",
    grantedScopes: [],
    id: "connection-1",
    isPrimary: true,
    ownerEmail: "owner@example.com",
    provider: "google_drive",
    refreshToken: "storage-refresh-token",
    status: "connected",
    updatedAt: "2026-05-18T00:00:00.000Z",
    ...overrides,
  };
}

test("protected API routes and server actions keep explicit auth allowlists", () => {
  const routeFiles = listFiles("find app/api -name route.ts -print | sort");
  const actionFiles = [
    ...listFiles("find app -name actions.ts -print | sort"),
    ...listFiles("find app/actions -type f -name '*.ts' -print | sort"),
  ];
  const missingApiGuard = [];
  const missingActionGuard = [];

  for (const relativePath of routeFiles) {
    const source = readRepoFile(relativePath);
    const hasGuard =
      /requireApiPrincipal|getApiPrincipalFromSession|requireAppPrincipal/.test(
        source,
      );
    if (!hasGuard && !API_ROUTE_ALLOWLIST.has(relativePath)) {
      missingApiGuard.push(relativePath);
    }
  }

  for (const relativePath of actionFiles) {
    const source = readRepoFile(relativePath);
    const hasGuard =
      /requireAppPrincipal|requireSession|requireWorkspaceRole|requireWorkspaceAccess/.test(
        source,
      );
    const migrationGuarded =
      /STORAGE_CONNECTION_SWITCHING_MIGRATION_ENABLED/.test(source);
    if (!hasGuard && !migrationGuarded && !SERVER_ACTION_ALLOWLIST.has(relativePath)) {
      missingActionGuard.push(relativePath);
    }
  }

  assert.deepEqual(missingApiGuard, []);
  assert.deepEqual(missingActionGuard, []);
});

test("high-risk routes do not trust ownerEmail input or raw session email scope", () => {
  for (const relativePath of HIGH_RISK_API_ROUTES) {
    const source = readRepoFile(relativePath);
    assert.doesNotMatch(
      source,
      /searchParams\.get\(["']ownerEmail["']|body\??\.[A-Za-z0-9_]*ownerEmail|ownerEmail\s*=\s*url\.searchParams/s,
      `${relativePath} must derive owner scope from AppPrincipal`,
    );
    assert.doesNotMatch(
      source,
      /session(?:\?|\.)?\.user(?:\?|\.)?\.email/,
      `${relativePath} must not use raw session.user.email as owner scope`,
    );
  }
});

test("owner-scoped preview, history, and storage resources fail closed", () => {
  const previewRoute = readRepoFile("app/api/preview/files/[snapshotId]/route.ts");
  const historyPathRoute = readRepoFile("app/api/history/paths/[eventId]/route.ts");
  const driveFileRoute = readRepoFile("app/api/drive/files/[fileId]/route.ts");
  const storageFolderRoute = readRepoFile("app/api/storage/folders/route.ts");

  assert.match(previewRoute, /previewFileSnapshotBelongsToOwner/);
  assert.match(previewRoute, /status: 404/);
  assert.match(historyPathRoute, /getFilingEventByOwnerAndId/);
  assert.match(historyPathRoute, /getLegacyOwnerEmail/);
  assert.match(driveFileRoute, /getApiPrincipalFromSession/);
  assert.match(driveFileRoute, /getVerifiedActiveStorageConnectionForSession/);
  assert.match(driveFileRoute, /status: 404/);
  assert.match(storageFolderRoute, /getApiPrincipalFromSession/);
  assert.match(storageFolderRoute, /getVerifiedActiveStorageConnectionForSession/);
});

test("session timeout, status polling, keepalive, and logout remain server-controlled", async () => {
  const now = new Date("2026-05-18T14:00:00.000Z");
  const principal = makePrincipal();
  const session = {
    appSessionCreatedAt: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
    appSessionIdHash: SESSION_HASH,
  };
  const store = {
    get() {
      return {
        createdAt: session.appSessionCreatedAt,
        invalidatedAt: null,
        lastActivityAt: new Date(
          now.getTime() - SESSION_IDLE_TIMEOUT_MS - 1,
        ).toISOString(),
        ownerEmail: principal.ownerKey,
        sessionIdHash: SESSION_HASH,
        updatedAt: session.appSessionCreatedAt,
        userId: principal.userId,
        workspaceId: principal.workspaceId,
      };
    },
    invalidate() {
      return null;
    },
    upsert() {
      throw new Error("expired sessions must not be touched");
    },
  };

  await assert.rejects(
    enforceSessionActivity(session, principal, { now, store }),
    /Session expired/,
  );

  const statusRoute = readRepoFile("app/api/session/status/route.ts");
  const keepaliveRoute = readRepoFile("app/api/session/keepalive/route.ts");
  const logoutRoute = readRepoFile("app/api/session/logout/route.ts");
  const sessionActivitySource = readRepoFile("lib/auth/session-activity.ts");

  assert.match(statusRoute, /touchSessionActivity:\s*false/);
  assert.match(keepaliveRoute, /method|POST/);
  assert.match(keepaliveRoute, /getApiPrincipalFromSession\(session\)/);
  assert.doesNotMatch(keepaliveRoute, /touchSessionActivity:\s*false/);
  assert.match(logoutRoute, /invalidateSessionActivityForSession/);
  assert.match(sessionActivitySource, /SESSION_ABSOLUTE_TIMEOUT_MS/);
  assert.doesNotMatch(logoutRoute, /deleteStorageConnection/i);
  assert.doesNotMatch(sessionActivitySource, /deleteStorageConnection/i);
});

test("storage reconnect and replace preserve the one-active-storage rule", () => {
  const activeConnection = makeStorageConnection();

  assert.deepEqual(
    resolveStorageOAuthConnectionDecision({
      activeConnection,
      candidate: {
        accountEmail: "OWNER@example.com",
        externalAccountId: "google-owner-1",
        provider: "google_drive",
      },
    }),
    { ok: true, makePrimary: true, mode: "reconnect" },
  );
  assert.deepEqual(
    resolveStorageOAuthConnectionDecision({
      activeConnection,
      candidate: {
        accountEmail: "other@example.com",
        externalAccountId: "google-other-1",
        provider: "google_drive",
      },
    }),
    {
      activeAccountLabel: "owner@example.com",
      mode: "blocked_different_account",
      ok: false,
    },
  );
  assert.deepEqual(
    resolveStorageOAuthConnectionDecision({
      activeConnection,
      candidate: {
        accountEmail: "other@example.com",
        externalAccountId: "google-other-1",
        provider: "google_drive",
      },
      replaceRequested: true,
    }),
    { ok: true, makePrimary: true, mode: "replace" },
  );
});

test("storage OAuth state, provider registry, and sensitive actions fail closed", () => {
  const principal = makePrincipal();
  const cookieValue = buildGoogleOAuthFlowCookie({
    mode: "replace",
    now: new Date("2026-05-18T14:00:00.000Z"),
    principal,
    state: "storage-oauth-state-12345",
  });

  assert.equal(
    parseGoogleOAuthFlowCookie(cookieValue, {
      now: new Date("2026-05-18T14:11:00.000Z"),
      principal,
    }),
    null,
  );
  assert.throws(
    () => getStorageProviderAdapter("sharefile"),
    UnsupportedStorageProviderError,
  );
  assert.equal(
    getSensitiveActionAuthorizationResult(null, "storage.replace_connection").ok,
    false,
  );
});

test("audit metadata redacts token-like fields", () => {
  const redacted = sanitizeAuditMetadata({
    accessToken: "access-token-that-must-not-leak",
    nested: {
      Authorization: "Bearer session-token-that-must-not-leak",
      refresh_token: "refresh-token-that-must-not-leak",
      sessionIdHash: "session-hash-that-must-not-leak",
      visible: "safe",
    },
  });
  const serialized = JSON.stringify(redacted);

  assert.doesNotMatch(serialized, /access-token-that-must-not-leak/);
  assert.doesNotMatch(serialized, /session-token-that-must-not-leak/);
  assert.doesNotMatch(serialized, /refresh-token-that-must-not-leak/);
  assert.doesNotMatch(serialized, /session-hash-that-must-not-leak/);
  assert.match(serialized, /safe/);
});

test("normal UI does not reintroduce multi-storage or internal auth identifiers", () => {
  const combinedSource = [
    "app/login/page.tsx",
    "components/account-menu.tsx",
    "components/account-session-status.tsx",
    "components/workspace-storage-status.tsx",
    "components/add-storage-connection-button.tsx",
    "app/setup/setup-form.tsx",
  ]
    .map(readRepoFile)
    .join("\n");

  for (const disallowed of [
    "Linked storage",
    "Add another connection",
    "Switch storage",
    "storage totals",
    "multiple active storages",
    "appSessionIdHash",
    "legacyOwnerEmail",
    "ownerKey",
  ]) {
    assert.equal(
      combinedSource.includes(disallowed),
      false,
      `normal UI should not expose ${disallowed}`,
    );
  }
});

test("AppPrincipal compatibility model remains normalized and deterministic", () => {
  const principal = getAppPrincipalFromSession({
    user: { email: " Owner@Example.com ", id: "google-user-1" },
  });

  assert.equal(principal.email, "owner@example.com");
  assert.equal(principal.ownerKey, "owner@example.com");
  assert.equal(principal.legacyOwnerEmail, "owner@example.com");
  assert.equal(
    principal.workspaceId,
    buildWorkspaceIdFromOwnerKey("owner@example.com"),
  );
});

test("storage credentials are not deleted by app logout or session expiry", () => {
  const logoutRoute = readRepoFile("app/api/session/logout/route.ts");
  const sessionActivitySource = readRepoFile("lib/auth/session-activity.ts");
  const authPrincipalSource = readRepoFile("lib/auth/principal.ts");

  for (const source of [logoutRoute, sessionActivitySource, authPrincipalSource]) {
    assert.doesNotMatch(source, /deleteStorageConnection/i);
    assert.doesNotMatch(source, /refreshToken\s*:\s*null/);
    assert.doesNotMatch(source, /accessToken\s*:\s*null/);
  }
});
