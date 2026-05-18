import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const migratedFiles = [
  "app/actions/set-active-storage.ts",
  "app/api/bug-reports/route.ts",
  "app/api/cleanup/analyze/route.ts",
  "app/api/cleanup/browser/route.ts",
  "app/api/cleanup/preview/route.ts",
  "app/api/drive/files/[fileId]/route.ts",
  "app/api/history/export/route.ts",
  "app/api/history/paths/[eventId]/route.ts",
  "app/api/preview/files/[snapshotId]/route.ts",
  "app/api/preview/refresh/route.ts",
  "app/api/storage/connections/route.ts",
  "app/api/storage/folders/route.ts",
  "app/api/storage/google/callback/route.ts",
  "app/api/storage/google/start/route.ts",
  "app/cleanup/clean-up-workspace-page.tsx",
  "app/dashboard/page.tsx",
  "app/history/page.tsx",
  "app/preview/actions.ts",
  "app/preview/intake-workspace-page.tsx",
  "app/review/actions.ts",
  "app/setup/actions.ts",
  "app/setup/google-drive/actions.ts",
  "app/setup/page.tsx",
  "lib/file-approval.ts",
  "lib/preview-file-access.ts",
  "lib/preview-snapshot.ts",
  "lib/storage-connections.ts",
];

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("migrated auth-sensitive files do not use raw session email as owner scope", () => {
  for (const relativePath of migratedFiles) {
    const source = readRepoFile(relativePath);
    assert.equal(
      /session(?:\?|\.)?\.user(?:\?|\.)?\.email/.test(source),
      false,
      `${relativePath} should derive owner scope through AppPrincipal`,
    );
  }
});

test("migrated owner-scoped files do not hand-roll owner email lowercase logic", () => {
  for (const relativePath of migratedFiles) {
    const source = readRepoFile(relativePath);
    assert.equal(
      /ownerEmail[^;\n]*\.trim\(\)\.toLowerCase\(\)/.test(source),
      false,
      `${relativePath} should use normalizeOwnerEmail/AppPrincipal for owner scope`,
    );
  }
});

test("high-risk routes and actions import the principal authorization layer", () => {
  for (const relativePath of [
    "app/api/storage/connections/route.ts",
    "app/api/storage/google/start/route.ts",
    "app/api/storage/google/callback/route.ts",
    "app/api/cleanup/browser/route.ts",
    "app/api/cleanup/preview/route.ts",
    "app/api/preview/refresh/route.ts",
    "app/api/preview/files/[snapshotId]/route.ts",
    "app/api/history/export/route.ts",
    "app/actions/set-active-storage.ts",
    "app/setup/google-drive/actions.ts",
  ]) {
    assert.match(readRepoFile(relativePath), /@\/lib\/auth\/principal/);
  }
});
