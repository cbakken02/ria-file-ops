import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  getCachedActiveStorageConnectionForSession,
  resolveStorageOAuthConnectionDecision,
} from "../lib/storage-connections.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

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
    refreshToken: "refresh-token",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    grantedScopes: [],
    isPrimary: true,
    status: "connected",
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:00.000Z",
    ...overrides,
  };
}

test("storage status UI is single-storage and removes multi-connection language", () => {
  const statusSource = readRepoFile("components/workspace-storage-status.tsx");
  const connectSource = readRepoFile("components/add-storage-connection-button.tsx");
  const combinedSource = `${statusSource}\n${connectSource}`;

  assert.match(statusSource, /Storage/);
  assert.match(statusSource, /Google Drive/);
  assert.match(statusSource, /accountEmail/);
  assert.match(statusSource, /Connected/);
  assert.match(statusSource, /Needs reconnect/);
  assert.match(statusSource, /Not connected/);
  assert.match(connectSource, /Connect Google Drive/);
  assert.match(connectSource, /Reconnect/);
  assert.match(connectSource, /Replace storage connection/);

  for (const removedCopy of [
    "Linked storage",
    "linked storage",
    "total",
    "Switch",
    "Add another connection",
    "Manage storage connections",
  ]) {
    assert.equal(
      combinedSource.includes(removedCopy),
      false,
      `Normal storage UI should not render "${removedCopy}"`,
    );
  }
});

test("normal workspace pages render the single storage status instead of a switcher", () => {
  for (const relativePath of [
    "app/preview/intake-workspace-page.tsx",
    "app/cleanup/clean-up-workspace-page.tsx",
    "app/dashboard/page.tsx",
    "app/history/page.tsx",
  ]) {
    const source = readRepoFile(relativePath);
    assert.match(source, /WorkspaceStorageStatus/);
    assert.equal(source.includes("StorageSwitcher"), false);
    assert.equal(source.includes("connections={"), false);
  }
});

test("cached active storage helper returns only an explicit primary connection", () => {
  const primary = makeConnection({ id: "primary", isPrimary: true });
  const inactive = makeConnection({
    id: "inactive",
    accountEmail: "inactive@example.com",
    externalAccountId: "inactive-google-id",
    isPrimary: false,
  });
  const session = { user: { email: "owner@example.com" } };

  assert.equal(
    getCachedActiveStorageConnectionForSession(session, {
      readConnections() {
        return [inactive, primary];
      },
    })?.id,
    "primary",
  );

  assert.equal(
    getCachedActiveStorageConnectionForSession(session, {
      readConnections() {
        return [inactive];
      },
    }),
    null,
  );
});

test("cached active storage lookup normalizes the principal owner key", () => {
  const session = { user: { email: " OWNER@Example.com " } };

  assert.equal(
    getCachedActiveStorageConnectionForSession(session, {
      readConnections(ownerEmail) {
        assert.equal(ownerEmail, "owner@example.com");
        return [makeConnection({ id: "primary", isPrimary: true })];
      },
    })?.id,
    "primary",
  );
});

test("Google OAuth reconnects the same account but blocks different accounts without replace", () => {
  const activeConnection = makeConnection({
    accountEmail: "owner@example.com",
    externalAccountId: "google-owner-1",
  });

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

  assert.deepEqual(
    resolveStorageOAuthConnectionDecision({
      activeConnection: null,
      candidate: {
        accountEmail: "new@example.com",
        externalAccountId: "google-new-1",
        provider: "google_drive",
      },
    }),
    { ok: true, makePrimary: true, mode: "connect" },
  );
});

test("storage connection API and OAuth callback expose single-active behavior", () => {
  const apiSource = readRepoFile("app/api/storage/connections/route.ts");
  const startSource = readRepoFile("app/api/storage/google/start/route.ts");
  const callbackSource = readRepoFile("app/api/storage/google/callback/route.ts");
  const oauthFlowSource = readRepoFile("lib/storage/google-oauth-flow.ts");

  assert.match(apiSource, /activeConnection/);
  assert.match(apiSource, /status/);
  assert.match(apiSource, /canReconnect/);
  assert.match(apiSource, /canReplace/);
  assert.match(apiSource, /connections: connections\.map/);
  assert.match(startSource, /GOOGLE_STORAGE_OAUTH_FLOW_COOKIE/);
  assert.match(oauthFlowSource, /storage_google_oauth_flow/);
  assert.match(startSource, /buildGoogleOAuthFlowCookie/);
  assert.match(startSource, /replace/);
  assert.match(callbackSource, /parseGoogleOAuthFlowCookie/);
  assert.match(callbackSource, /state !== savedFlow\.state/);
  assert.equal(callbackSource.includes('searchParams.get("replace")'), false);
  assert.equal(callbackSource.includes('searchParams.get("mode")'), false);
  assert.match(callbackSource, /resolveStorageOAuthConnectionDecision/);
  assert.match(callbackSource, /Storage was not changed/);
  assert.match(callbackSource, /Replace storage connection/);
});

test("legacy switching actions fail closed unless the migration flag is enabled", () => {
  for (const relativePath of [
    "app/actions/set-active-storage.ts",
    "app/setup/google-drive/actions.ts",
  ]) {
    const source = readRepoFile(relativePath);
    assert.match(source, /STORAGE_CONNECTION_SWITCHING_MIGRATION_ENABLED/);
    assert.match(source, /isInternalStorageSwitchingEnabled/);
    assert.match(source, /Storage switching is disabled/);
    assert.match(
      source,
      /if \(!isInternalStorageSwitchingEnabled\(\)\) \{[\s\S]*?redirect[\s\S]*?\}[\s\S]*?setPrimaryStorageConnectionForOwner/,
    );
  }
});

test("removing active storage does not promote another historical connection", () => {
  const sqliteSource = readRepoFile("lib/persistence/sqlite-app-state-store.ts");
  const supabaseSource = readRepoFile("lib/persistence/supabase-app-state-store.ts");
  const sqliteDeleteBlock = sqliteSource.slice(
    sqliteSource.indexOf("export function deleteStorageConnectionForOwner"),
    sqliteSource.indexOf("export function createBugReport"),
  );
  const supabaseDeleteBlock = supabaseSource.slice(
    supabaseSource.indexOf("export function deleteStorageConnectionForOwner"),
    supabaseSource.indexOf("export function createBugReport"),
  );

  assert.equal(sqliteDeleteBlock.includes("markStorageConnectionPrimary"), false);
  assert.equal(supabaseDeleteBlock.includes("next_connection"), false);
  assert.match(sqliteDeleteBlock, /clearPrimaryStorageConnections/);
  assert.match(supabaseDeleteBlock, /SET is_primary = false/);
});

test("storage stores clear existing primary rows before creating or switching active storage", () => {
  const sqliteSource = readRepoFile("lib/persistence/sqlite-app-state-store.ts");
  const supabaseSource = readRepoFile("lib/persistence/supabase-app-state-store.ts");
  const sqliteSaveBlock = sqliteSource.slice(
    sqliteSource.indexOf("export function saveStorageConnectionForOwner"),
    sqliteSource.indexOf("export function setPrimaryStorageConnectionForOwner"),
  );
  const sqliteSetPrimaryBlock = sqliteSource.slice(
    sqliteSource.indexOf("export function setPrimaryStorageConnectionForOwner"),
    sqliteSource.indexOf("export function deleteStorageConnectionForOwner"),
  );
  const supabaseSaveBlock = supabaseSource.slice(
    supabaseSource.indexOf("export function saveStorageConnectionForOwner"),
    supabaseSource.indexOf("export function setPrimaryStorageConnectionForOwner"),
  );
  const supabaseSetPrimaryBlock = supabaseSource.slice(
    supabaseSource.indexOf("export function setPrimaryStorageConnectionForOwner"),
    supabaseSource.indexOf("export function deleteStorageConnectionForOwner"),
  );

  assert.match(sqliteSaveBlock, /clearPrimaryStorageConnections/);
  assert.match(sqliteSetPrimaryBlock, /clearPrimaryStorageConnections/);
  assert.match(supabaseSaveBlock, /SET is_primary = false/);
  assert.match(supabaseSetPrimaryBlock, /SET is_primary = false/);
});
