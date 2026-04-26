import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  IntakeRefreshError,
  refreshIntakeQueue,
} from "../lib/intake-refresh.ts";

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

test("Intake page does not render the old visible Refresh Intake control", () => {
  const queueSource = readRepoFile("app/preview/intake-queue.tsx");
  const pageSource = readRepoFile("app/preview/page.tsx");

  assert.equal(queueSource.includes("RefreshIntakeButton"), false);
  assert.equal(queueSource.includes("Refresh Intake"), false);
  assert.equal(pageSource.includes("RefreshIntakeButton"), false);
});

test("Intake auto refresh only runs after a real browser reload", () => {
  const source = readRepoFile("app/preview/intake-auto-refresh.tsx");

  assert.match(source, /getEntriesByType\("navigation"\)/);
  assert.match(source, /navigationEntry\?\.type !== "reload"/);
  assert.match(source, /sessionStorage\.getItem\(guardKey\)/);
  assert.match(source, /fetch\("\/api\/preview\/refresh"/);
});

test("preview refresh API is wired to the shared Intake refresh helper", () => {
  const source = readRepoFile("app/api/preview/refresh/route.ts");

  assert.match(source, /refreshIntakeQueueForSession/);
  assert.match(source, /revalidatePath\("\/preview"\)/);
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
    "listFilesInFolder",
    "test-access-token",
    "source-folder",
  ]);
  assert.deepEqual(calls[1], [
    "listFilesInFolder",
    "test-access-token",
    "destination-folder",
  ]);
  assert.equal(bufferRequestedFor, "source-file-1");
  assert.equal(result.itemCount, 1);
  assert.equal(result.readyCount, 1);
  assert.equal(result.reviewCount, 0);
  assert.equal(writtenSnapshot.ownerEmail, "owner@example.com");
  assert.equal(writtenSnapshot.sourceFolder, "1_Client Upload");
  assert.equal(writtenSnapshot.destinationRoot, "Legacy Link");
  assert.equal(writtenSnapshot.reviewPosture, "Manual review");
  assert.equal(writtenSnapshot.items[0]?.id, "source-file-1");
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
