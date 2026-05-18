import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  getGoogleDriveAccessErrorStatus,
} from "../lib/google-drive.ts";
import {
  IntakeRefreshError,
  refreshIntakeQueue,
} from "../lib/intake-refresh.ts";
import {
  readPreviewAnalysisCache,
  writePreviewAnalysisCache,
} from "../lib/preview-analysis-cache.ts";
import {
  readPreviewSnapshot,
  writePreviewSnapshot,
} from "../lib/preview-snapshot.ts";
import { resolveActiveStorageAuthorizationForSession } from "../lib/storage-connections.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function makeFirmSettings(overrides = {}) {
  return {
    id: "settings-test-owner",
    ownerEmail: "owner@example.com",
    firmName: "Test RIA",
    storageProvider: "google_drive",
    sourceFolderId: "source-folder",
    sourceFolderName: "1_Client Upload",
    destinationFolderId: "destination-folder",
    destinationFolderName: "Legacy Link",
    namingConvention: "{client}_{type}_{account}_{last4}.pdf",
    namingRulesJson: null,
    folderTemplate: "Accounts\nClient Info\nMoney Movement\nPlanning\nReview",
    reviewInstruction: "manual_only",
    createdAt: "2026-04-26T12:00:00.000Z",
    updatedAt: "2026-04-26T12:00:00.000Z",
    ...overrides,
  };
}

function makeConnection(overrides = {}) {
  return {
    id: "connection-1",
    ownerEmail: "owner@example.com",
    provider: "google_drive",
    accountEmail: "owner@gmail.com",
    accountName: "Owner Drive",
    accountImage: null,
    externalAccountId: "owner-google-id",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    grantedScopes: ["https://www.googleapis.com/auth/drive"],
    isPrimary: true,
    status: "connected",
    createdAt: "2026-04-26T12:00:00.000Z",
    updatedAt: "2026-04-26T12:00:00.000Z",
    ...overrides,
  };
}

function makeSnapshotItem(overrides = {}) {
  return {
    id: "file-1",
    sourceName: "Statement.pdf",
    mimeType: "application/pdf",
    status: "Ready to stage",
    documentTypeId: "account_statement",
    debug: {
      parserVersion: "test",
    },
    ...overrides,
  };
}

function withTemporaryEnv(t, values) {
  const previous = new Map();

  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  t.after(() => {
    for (const [key, value] of previous.entries()) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

test("Intake exposes a server-side Rescan source folder action instead of the browser-refresh banner", () => {
  const pageSource = readRepoFile("app/preview/intake-workspace-page.tsx");
  const actionSource = readRepoFile("app/preview/actions.ts");
  const apiSource = readRepoFile("app/api/preview/refresh/route.ts");

  assert.match(pageSource, /Rescan source folder/);
  assert.match(pageSource, /refreshIntakeAction/);
  assert.equal(pageSource.includes("Cached intake preview needs a browser refresh"), false);
  assert.equal(pageSource.includes("Sidebar navigation no longer scans Drive"), false);
  assert.match(actionSource, /refreshIntakeQueueForSession\(session,\s*{\s*forceFresh: true/s);
  assert.match(apiSource, /forceFresh: true/);
});

test("preview refresh API is wired to the shared Intake refresh helper", () => {
  const source = readRepoFile("app/api/preview/refresh/route.ts");

  assert.match(source, /refreshIntakeQueueForSession/);
  assert.match(source, /revalidatePath\("\/intake"\)/);
});

test("Intake and Clean Up live scans resolve active storage through the same authorization helper", async () => {
  const intakeSource = readRepoFile("lib/intake-refresh.ts");
  const cleanupSource = readRepoFile("app/api/cleanup/browser/route.ts");
  const session = {
    user: { email: "owner@example.com" },
  };
  const expectedConnection = makeConnection();

  const result = await resolveActiveStorageAuthorizationForSession(session, {
    async getActiveStorageConnection(receivedSession) {
      assert.equal(receivedSession, session);
      return expectedConnection;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.connection.id, expectedConnection.id);
  assert.equal(result.ownerEmail, "owner@example.com");
  assert.match(intakeSource, /resolveActiveStorageAuthorizationForSession/);
  assert.match(cleanupSource, /resolveActiveStorageAuthorizationForSession/);
});

test("revoked Drive auth maps to the same reconnect status for Intake and Clean Up", () => {
  const intakeSource = readRepoFile("lib/intake-refresh.ts");
  const cleanupSource = readRepoFile("app/api/cleanup/browser/route.ts");

  assert.equal(
    getGoogleDriveAccessErrorStatus(
      new Error("Invalid authentication credentials"),
    ),
    401,
  );
  assert.match(intakeSource, /getGoogleDriveAccessErrorStatus/);
  assert.match(cleanupSource, /getGoogleDriveAccessErrorStatus/);
  assert.match(intakeSource, /markStorageConnectionNeedsReauth/);
  assert.match(cleanupSource, /markStorageConnectionNeedsReauth/);
});

test("refreshIntakeQueue lists Drive folders, builds a preview, and writes the cached snapshot", async () => {
  const calls = [];
  let writtenSnapshot = null;
  let bufferRequestedFor = null;

  const result = await refreshIntakeQueue({
    accessToken: "test-access-token",
    clientMemoryRules: [],
    ownerEmail: "owner@example.com",
    settings: makeFirmSettings(),
    deps: {
      async getDriveFileMetadata(accessToken, fileId) {
        calls.push(["getDriveFileMetadata", accessToken, fileId]);

        if (fileId === "source-folder") {
          return {
            id: "source-folder",
            name: "1_Client Upload",
            mimeType: "application/vnd.google-apps.folder",
          };
        }

        if (fileId === "destination-folder") {
          return {
            id: "destination-folder",
            name: "Legacy Link",
            mimeType: "application/vnd.google-apps.folder",
          };
        }

        throw new Error(`Unexpected metadata ${fileId}`);
      },
      async listFilesInFolder(accessToken, folderId) {
        calls.push(["listFilesInFolder", accessToken, folderId]);

        if (folderId === "source-folder") {
          return [
            {
              id: "source-file-1",
              name: "statement-upload.pdf",
              mimeType: "application/pdf",
              modifiedTime: "2026-04-22T13:39:00.000Z",
              driveSize: "12345",
            },
          ];
        }

        if (folderId === "destination-folder") {
          return [
            {
              id: "client-folder-1",
              name: "Bakken_Christopher",
              mimeType: "application/vnd.google-apps.folder",
            },
            {
              id: "ignored-file",
              name: "notes.txt",
              mimeType: "text/plain",
            },
          ];
        }

        throw new Error(`Unexpected folder ${folderId}`);
      },
      async downloadDriveFile(accessToken, fileId) {
        calls.push(["downloadDriveFile", accessToken, fileId]);
        bufferRequestedFor = fileId;
        return Buffer.from("pdf bytes");
      },
      async buildProcessingPreview(
        sourceFiles,
        settings,
        getFileBuffer,
        existingClientFolders,
        clientMemoryRules,
        options,
      ) {
        calls.push([
          "buildProcessingPreview",
          sourceFiles.map((file) => file.id),
          settings.sourceFolderId,
          existingClientFolders,
          clientMemoryRules,
          options,
        ]);

        await getFileBuffer("source-file-1");

        return {
          reviewRule: { title: "Manual review" },
          readyCount: 1,
          reviewCount: 0,
          items: [
            {
              id: "source-file-1",
              sourceName: "statement-upload.pdf",
              mimeType: "application/pdf",
              status: "Ready to stage",
            },
          ],
        };
      },
      async writePreviewSnapshot(snapshot) {
        calls.push(["writePreviewSnapshot", snapshot.ownerEmail]);
        writtenSnapshot = snapshot;
      },
    },
  });

  assert.deepEqual(calls[0], [
    "getDriveFileMetadata",
    "test-access-token",
    "source-folder",
  ]);
  assert.deepEqual(calls[1], [
    "listFilesInFolder",
    "test-access-token",
    "source-folder",
  ]);
  assert.deepEqual(calls[2], [
    "getDriveFileMetadata",
    "test-access-token",
    "destination-folder",
  ]);
  assert.deepEqual(calls[3], [
    "listFilesInFolder",
    "test-access-token",
    "destination-folder",
  ]);
  assert.equal(bufferRequestedFor, "source-file-1");
  assert.equal(result.itemCount, 1);
  assert.equal(result.readyCount, 1);
  assert.equal(result.reviewCount, 0);
  assert.equal(result.sourceFileCount, 1);
  assert.deepEqual(result.sourceFolder, {
    id: "source-folder",
    name: "1_Client Upload",
  });
  assert.equal(writtenSnapshot.ownerEmail, "owner@example.com");
  assert.equal(writtenSnapshot.sourceFolder, "1_Client Upload");
  assert.equal(writtenSnapshot.destinationRoot, "Legacy Link");
  assert.equal(writtenSnapshot.reviewPosture, "Manual review");
  assert.equal(writtenSnapshot.items[0]?.id, "source-file-1");
});

test("inaccessible source folder returns the same Drive access status shape as Clean Up", async () => {
  await assert.rejects(
    () =>
      refreshIntakeQueue({
        accessToken: "test-access-token",
        clientMemoryRules: [],
        ownerEmail: "owner@example.com",
        settings: makeFirmSettings(),
        deps: {
          async getDriveFileMetadata() {
            return {
              id: "source-folder",
              name: "1_Client Upload",
              mimeType: "application/vnd.google-apps.folder",
            };
          },
          async listFilesInFolder() {
            throw new Error("Permission denied");
          },
        },
      }),
    (error) => {
      assert.ok(error instanceof IntakeRefreshError);
      assert.equal(error.status, 401);
      assert.match(error.message, /Google Drive could not load the source folder/);
      assert.match(error.message, /Permission denied/);
      return true;
    },
  );
});

test("forceFresh Rescan clears owner caches and bypasses preview-analysis-cache", async () => {
  const calls = [];
  let previewOptions = null;

  await refreshIntakeQueue({
    accessToken: "test-access-token",
    clientMemoryRules: [],
    forceFresh: true,
    ownerEmail: "owner@example.com",
    settings: makeFirmSettings(),
    deps: {
      async clearPreviewAnalysisCacheForOwner(ownerEmail) {
        calls.push(["clearPreviewAnalysisCacheForOwner", ownerEmail]);
      },
      async clearPreviewSnapshotForOwner(ownerEmail) {
        calls.push(["clearPreviewSnapshotForOwner", ownerEmail]);
      },
      async getDriveFileMetadata(accessToken, fileId) {
        calls.push(["getDriveFileMetadata", accessToken, fileId]);
        return {
          id: fileId,
          name: fileId === "source-folder" ? "1_Client Upload" : "Legacy Link",
          mimeType: "application/vnd.google-apps.folder",
        };
      },
      async listFilesInFolder(accessToken, folderId) {
        calls.push(["listFilesInFolder", accessToken, folderId]);
        return folderId === "source-folder"
          ? [
              {
                id: "source-file-1",
                name: "statement-upload.pdf",
                mimeType: "application/pdf",
              },
            ]
          : [];
      },
      async buildProcessingPreview(
        sourceFiles,
        settings,
        getFileBuffer,
        existingClientFolders,
        clientMemoryRules,
        options,
      ) {
        calls.push(["buildProcessingPreview", sourceFiles.map((file) => file.id)]);
        previewOptions = options;

        return {
          reviewRule: { title: "Manual review" },
          readyCount: 0,
          reviewCount: 0,
          items: [],
        };
      },
      async writePreviewSnapshot(snapshot) {
        calls.push(["writePreviewSnapshot", snapshot.ownerEmail]);
      },
    },
  });

  assert.deepEqual(calls.slice(0, 2), [
    ["clearPreviewAnalysisCacheForOwner", "owner@example.com"],
    ["clearPreviewSnapshotForOwner", "owner@example.com"],
  ]);
  assert.deepEqual(previewOptions, {
    analysisMode: "preview",
    forceFreshAnalysis: true,
  });
});

test("owner A cannot read owner B preview snapshot or analysis cache", async (t) => {
  const snapshotDir = fs.mkdtempSync(path.join(os.tmpdir(), "ria-snapshots-"));
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "ria-analysis-cache-"));
  withTemporaryEnv(t, {
    PERSISTENCE_BACKEND: "sqlite",
    RIA_PREVIEW_ANALYSIS_CACHE_DIR: cacheDir,
    RIA_PREVIEW_SNAPSHOT_DIR: snapshotDir,
  });

  await writePreviewSnapshot({
    destinationRoot: "Clients",
    items: [makeSnapshotItem({ id: "owner-a-file" })],
    ownerEmail: "owner-a@example.com",
    readyCount: 1,
    reviewCount: 0,
    reviewPosture: "Manual review",
    sourceFolder: "Client Upload",
  });

  assert.equal(await readPreviewSnapshot("owner-b@example.com"), null);
  assert.equal(
    (await readPreviewSnapshot("owner-a@example.com"))?.items[0]?.id,
    "owner-a-file",
  );

  const file = {
    id: "shared-file-id",
    name: "Statement.pdf",
    mimeType: "application/pdf",
    size: "123",
  };

  await writePreviewAnalysisCache({
    analysisProfile: "preview_ai_primary",
    file,
    insight: {},
    ownerEmail: "owner-a@example.com",
    previewSnapshotId: null,
  });

  assert.equal(
    await readPreviewAnalysisCache({
      analysisProfile: "preview_ai_primary",
      file,
      ownerEmail: "owner-b@example.com",
    }),
    null,
  );
  assert.equal(
    (await readPreviewAnalysisCache({
      analysisProfile: "preview_ai_primary",
      file,
      ownerEmail: "owner-a@example.com",
    }))?.fileId,
    "shared-file-id",
  );
});

test("force refresh clears latest-preview snapshot before a failed live Drive scan", async (t) => {
  const snapshotDir = fs.mkdtempSync(path.join(os.tmpdir(), "ria-snapshots-"));
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "ria-analysis-cache-"));
  withTemporaryEnv(t, {
    PERSISTENCE_BACKEND: "sqlite",
    RIA_PREVIEW_ANALYSIS_CACHE_DIR: cacheDir,
    RIA_PREVIEW_SNAPSHOT_DIR: snapshotDir,
  });

  await writePreviewSnapshot({
    destinationRoot: "Clients",
    items: [makeSnapshotItem({ id: "stale-file" })],
    ownerEmail: "owner@example.com",
    readyCount: 1,
    reviewCount: 0,
    reviewPosture: "Manual review",
    sourceFolder: "Client Upload",
  });

  await assert.rejects(
    () =>
      refreshIntakeQueue({
        accessToken: "test-access-token",
        clientMemoryRules: [],
        forceFresh: true,
        ownerEmail: "owner@example.com",
        settings: makeFirmSettings(),
        deps: {
          async getDriveFileMetadata() {
            throw new Error("Permission denied");
          },
          async listFilesInFolder() {
            throw new Error("Drive should not be listed");
          },
        },
      }),
    IntakeRefreshError,
  );

  assert.equal(await readPreviewSnapshot("owner@example.com"), null);
});

test("refreshIntakeQueue fails clearly before scanning when no source folder is selected", async () => {
  await assert.rejects(
    () =>
      refreshIntakeQueue({
        accessToken: "test-access-token",
        clientMemoryRules: [],
        ownerEmail: "owner@example.com",
        settings: makeFirmSettings({ sourceFolderId: null }),
        deps: {
          async listFilesInFolder() {
            throw new Error("Drive should not be called");
          },
        },
      }),
    (error) => {
      assert.ok(error instanceof IntakeRefreshError);
      assert.equal(error.status, 400);
      assert.match(error.message, /Choose an intake source folder/);
      return true;
    },
  );
});
