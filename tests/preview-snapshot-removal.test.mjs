import assert from "node:assert/strict";
import test from "node:test";

import { buildPreviewSnapshotWithoutItems } from "../lib/preview-snapshot.ts";

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

test("preview snapshot removal recalculates ready and review counts", () => {
  const nextSnapshot = buildPreviewSnapshotWithoutItems(
    {
      destinationRoot: "Clients",
      generatedAt: "2026-04-20T12:00:00.000Z",
      items: [
        makeSnapshotItem({ id: "ready-1", status: "Ready to stage" }),
        makeSnapshotItem({
          id: "review-1",
          sourceName: "Needs Review.pdf",
          status: "Needs review",
        }),
        makeSnapshotItem({
          id: "ready-2",
          sourceName: "Second Ready.pdf",
          status: "Ready to stage",
        }),
      ],
      readyCount: 2,
      reviewCount: 1,
      reviewPosture: "Manual review",
      sourceFolder: "Client Upload",
    },
    ["ready-1", "review-1"],
  );

  assert.ok(nextSnapshot);
  assert.deepEqual(
    nextSnapshot.items.map((item) => item.id),
    ["ready-2"],
  );
  assert.equal(nextSnapshot.readyCount, 1);
  assert.equal(nextSnapshot.reviewCount, 0);
  assert.equal(nextSnapshot.sourceFolder, "Client Upload");
  assert.equal(nextSnapshot.destinationRoot, "Clients");
});

test("preview snapshot removal is a no-op when ids are already absent", () => {
  const nextSnapshot = buildPreviewSnapshotWithoutItems(
    {
      destinationRoot: null,
      generatedAt: "2026-04-20T12:00:00.000Z",
      items: [makeSnapshotItem()],
      readyCount: 1,
      reviewCount: 0,
      reviewPosture: "Manual review",
      sourceFolder: null,
    },
    ["already-filed"],
  );

  assert.equal(nextSnapshot, null);
});
