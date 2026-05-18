import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  getStorageProviderAdapter,
  isSupportedStorageProvider,
  listSupportedStorageProviders,
  UnsupportedStorageProviderError,
} from "../lib/storage/provider-registry.ts";

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
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: null,
    grantedScopes: [],
    isPrimary: true,
    status: "connected",
    createdAt: "2026-05-18T00:00:00.000Z",
    updatedAt: "2026-05-18T00:00:00.000Z",
    ...overrides,
  };
}

test("provider registry exposes Google Drive as the only supported provider", () => {
  const providers = listSupportedStorageProviders();

  assert.deepEqual(providers.map((provider) => provider.id), ["google_drive"]);
  assert.equal(isSupportedStorageProvider("google_drive"), true);
  assert.equal(isSupportedStorageProvider("sharefile"), false);
  assert.equal(getStorageProviderAdapter("google_drive").displayName, "Google Drive");
});

test("provider registry fails closed for unsupported providers", () => {
  assert.throws(
    () => getStorageProviderAdapter("sharefile"),
    UnsupportedStorageProviderError,
  );
});

test("Google Drive adapter lists folders through provider-neutral interface", async (t) => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url, init) => {
    calls.push({ init, url: String(url) });
    return new Response(
      JSON.stringify({
        files: [
          {
            id: "folder-1",
            name: "Client Docs",
            mimeType: "application/vnd.google-apps.folder",
            modifiedTime: "2026-05-18T00:00:00.000Z",
            parents: ["root"],
          },
        ],
      }),
      {
        headers: { "content-type": "application/json" },
        status: 200,
      },
    );
  };

  const adapter = getStorageProviderAdapter("google_drive");
  const folders = await adapter.listFolders({ connection: makeConnection() });

  assert.equal(folders[0].id, "folder-1");
  assert.match(calls[0].url, /googleapis\.com\/drive\/v3\/files/);
  assert.equal(
    calls[0].init.headers.Authorization,
    "Bearer access-token",
  );
});

test("migrated listing and status paths use the provider registry", () => {
  const intakeSource = readRepoFile("lib/intake-refresh.ts");
  const folderRouteSource = readRepoFile("app/api/storage/folders/route.ts");
  const storageConnectionSource = readRepoFile("lib/storage-connections.ts");

  assert.match(intakeSource, /getStorageProviderAdapterForConnection/);
  assert.match(intakeSource, /storageProviderAdapter\.listFolder/);
  assert.match(intakeSource, /storageProviderAdapter\.getFileMetadata/);
  assert.match(intakeSource, /storageProviderAdapter\.downloadFile/);
  assert.match(folderRouteSource, /getStorageProviderAdapterForConnection/);
  assert.equal(folderRouteSource.includes("listDriveFolders"), false);
  assert.match(storageConnectionSource, /storageProvider\.healthCheck/);
});

test("remaining direct Google Drive calls are allowlisted for later adapter migration", () => {
  const directCallAllowlist = new Set([
    "app/api/drive/files/[fileId]/route.ts",
    "app/api/cleanup/browser/route.ts",
    "app/api/cleanup/preview/route.ts",
    "app/api/cleanup/analyze/route.ts",
    "app/review/actions.ts",
    "app/api/history/paths/[eventId]/route.ts",
    "app/api/storage/google/start/route.ts",
    "app/history/history-events.tsx",
    "app/preview/actions.ts",
    "lib/cleanup-preview.ts",
    "lib/filing.ts",
    "lib/google-drive.ts",
    "lib/storage/google-drive-adapter.ts",
    "lib/storage-connections.ts",
    "lib/intake-refresh.ts",
  ]);
  const candidateFiles = [
    ...listFiles("app"),
    ...listFiles("lib"),
  ].filter((filePath) => /\.(ts|tsx)$/.test(filePath));
  const directCallFiles = candidateFiles.filter((filePath) => {
    const source = readRepoFile(filePath).replace(
      /^import\s+type[\s\S]*?from ["']@\/lib\/google-drive["'];?\n?/gm,
      "",
    );
    const importMatches =
      source.match(/from ["']@\/lib\/google-drive["']/g) ?? [];

    return importMatches.length > 0;
  });

  for (const filePath of directCallFiles) {
    assert.ok(
      directCallAllowlist.has(filePath),
      `${filePath} imports Google Drive directly and should be migrated or allowlisted`,
    );
  }
});

function listFiles(relativeDir) {
  const absoluteDir = path.join(repoRoot, relativeDir);
  return fs.readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      return listFiles(relativePath);
    }

    return relativePath;
  });
}
