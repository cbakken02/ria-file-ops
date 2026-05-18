import assert from "node:assert/strict";
import test from "node:test";

import {
  previewFileSnapshotBelongsToOwner,
} from "../lib/preview-file-access.ts";
import { getAppPrincipalFromSession } from "../lib/auth/principal.ts";

function makeSnapshot(snapshotId) {
  return {
    ownerEmail: "owner-a@example.com",
    generatedAt: "2026-05-17T20:00:00.000Z",
    sourceFolder: "Client Upload",
    destinationRoot: "Clients",
    reviewPosture: "Manual review",
    readyCount: 1,
    reviewCount: 0,
    items: [
      {
        id: "drive-file-1",
        sourceName: "Statement.pdf",
        mimeType: "application/pdf",
        previewSnapshotId: snapshotId,
      },
    ],
  };
}

test("preview file snapshots are authorized through the owner's latest preview snapshot", async () => {
  const snapshots = new Map([
    ["owner-a@example.com", makeSnapshot("snapshot-owner-a")],
  ]);
  const readSnapshot = async (ownerEmail) => snapshots.get(ownerEmail) ?? null;

  assert.equal(
    await previewFileSnapshotBelongsToOwner({
      ownerEmail: "owner-a@example.com",
      readSnapshot,
      snapshotId: "snapshot-owner-a",
    }),
    true,
  );

  assert.equal(
    await previewFileSnapshotBelongsToOwner({
      ownerEmail: "owner-b@example.com",
      readSnapshot,
      snapshotId: "snapshot-owner-a",
    }),
    false,
  );

  assert.equal(
    await previewFileSnapshotBelongsToOwner({
      ownerEmail: "owner-a@example.com",
      readSnapshot,
      snapshotId: "missing-snapshot",
    }),
    false,
  );
});

test("preview file snapshot ownership uses normalized AppPrincipal owner scope", async () => {
  const snapshots = new Map([
    ["owner-a@example.com", makeSnapshot("snapshot-owner-a")],
  ]);
  const readSnapshot = async (ownerEmail) => snapshots.get(ownerEmail) ?? null;
  const principal = getAppPrincipalFromSession({
    user: { email: " OWNER-A@example.com " },
  });

  assert.equal(
    await previewFileSnapshotBelongsToOwner({
      principal,
      readSnapshot,
      snapshotId: "snapshot-owner-a",
    }),
    true,
  );

  assert.equal(
    await previewFileSnapshotBelongsToOwner({
      principal: getAppPrincipalFromSession({
        user: { email: "owner-b@example.com" },
      }),
      readSnapshot,
      snapshotId: "snapshot-owner-a",
    }),
    false,
  );
});
