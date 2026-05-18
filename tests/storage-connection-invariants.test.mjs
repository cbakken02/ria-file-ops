import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  findDuplicateActiveStorageConnections,
  normalizeStorageOwnerKey,
  summarizeStorageInvariantDiagnostics,
} from "../lib/storage-connection-invariants.ts";

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
    externalAccountId: "google-owner-1",
    accessToken: "access-token-secret",
    refreshToken: "refresh-token-secret",
    expiresAt: null,
    grantedScopes: [],
    isPrimary: true,
    status: "connected",
    createdAt: "2026-05-18T00:00:00.000Z",
    updatedAt: "2026-05-18T00:00:00.000Z",
    ...overrides,
  };
}

test("storage owner keys are normalized for invariant checks", () => {
  assert.equal(normalizeStorageOwnerKey(" Owner@Example.COM "), "owner@example.com");
});

test("duplicate active storage diagnostics group case and whitespace owner variants", () => {
  const diagnostics = findDuplicateActiveStorageConnections([
    makeConnection({
      id: "active-1",
      ownerEmail: " Owner@Example.com ",
      externalAccountId: "google-owner-1",
    }),
    makeConnection({
      id: "active-2",
      ownerEmail: "owner@example.com",
      accountEmail: "replacement@example.com",
      externalAccountId: "google-owner-2",
    }),
    makeConnection({
      id: "inactive-history",
      ownerEmail: "OWNER@example.com",
      externalAccountId: "google-history",
      isPrimary: false,
    }),
    makeConnection({
      id: "other-owner",
      ownerEmail: "other@example.com",
      externalAccountId: "google-other",
    }),
  ]);

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].normalizedOwnerKey, "owner@example.com");
  assert.equal(diagnostics[0].activeCount, 2);
  assert.deepEqual(diagnostics[0].ownerEmailVariants, [
    " Owner@Example.com ",
    "owner@example.com",
  ]);
  assert.deepEqual(diagnostics[0].activeConnections.map(({ id }) => id), [
    "active-1",
    "active-2",
  ]);
  assert.ok(
    diagnostics[0].activeConnections.every(
      ({ accountIdentifierHash }) => accountIdentifierHash?.length === 64,
    ),
  );
  assert.ok(
    diagnostics[0].reasons.includes("owner_email_case_or_whitespace_variants"),
  );
  assert.ok(
    diagnostics[0].reasons.includes("different_provider_or_account_active"),
  );

  const serialized = JSON.stringify(diagnostics);
  assert.equal(serialized.includes("access-token-secret"), false);
  assert.equal(serialized.includes("refresh-token-secret"), false);
  assert.equal(serialized.includes("google-owner-1"), false);
  assert.equal(serialized.includes("google-owner-2"), false);
});

test("duplicate diagnostics distinguish same account duplicate primaries", () => {
  const diagnostics = findDuplicateActiveStorageConnections([
    makeConnection({ id: "primary-1" }),
    makeConnection({ id: "primary-2" }),
  ]);

  assert.equal(diagnostics.length, 1);
  assert.ok(
    diagnostics[0].reasons.includes("duplicate_primary_for_same_provider_account"),
  );
});

test("diagnostic summaries keep output scoped and token-free", () => {
  const summary = summarizeStorageInvariantDiagnostics(
    findDuplicateActiveStorageConnections([
      makeConnection({ id: "primary-1" }),
      makeConnection({ id: "primary-2" }),
    ]),
  );

  assert.deepEqual(summary[0].activeConnectionIds, ["primary-1", "primary-2"]);
  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes("access-token-secret"), false);
  assert.equal(serialized.includes("refresh-token-secret"), false);
});

test("storage stores enforce active connection operations by normalized owner key", () => {
  for (const relativePath of [
    "lib/persistence/sqlite-app-state-store.ts",
    "lib/persistence/supabase-app-state-store.ts",
  ]) {
    const source = readRepoFile(relativePath);
    const storageBlock = source.slice(
      source.indexOf("export function getStorageConnectionsByOwnerEmail"),
      source.indexOf("export function createBugReport"),
    );

    assert.match(source, /normalizeStorageOwnerKey/);
    assert.match(storageBlock, /normalizeStorageOwnerKey\(ownerEmail\)/);
    assert.match(source, /lower\(trim\(owner_email\)\)/);
  }
});

test("DB-level one-active-storage constraint is deferred until legacy owner data is preflighted", () => {
  const sqliteSource = readRepoFile("lib/persistence/sqlite-app-state-store.ts");
  const migrationSources = fs
    .readdirSync(path.join(repoRoot, "supabase/migrations"))
    .filter((fileName) => fileName.endsWith(".sql"))
    .map((fileName) =>
      readRepoFile(path.join("supabase/migrations", fileName)),
    )
    .join("\n");

  assert.equal(
    /UNIQUE INDEX[\s\S]*storage_connections[\s\S]*is_primary/i.test(sqliteSource),
    false,
  );
  assert.equal(
    /UNIQUE INDEX[\s\S]*storage_connections[\s\S]*is_primary/i.test(
      migrationSources,
    ),
    false,
  );
});
