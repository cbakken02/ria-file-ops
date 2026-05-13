import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { DOCUMENT_ANALYSIS_VERSION } from "../lib/document-intelligence.ts";
import {
  CLEANUP_ANALYSIS_PROFILE,
  cleanupStateInputFromPreviewRow,
  isCleanupStateFreshForFile,
  resolveCleanupBrowserState,
} from "../lib/cleanup-file-state.ts";
import { buildCleanupApprovalItemsFromStates } from "../lib/cleanup-approval-items.ts";

function makeState(overrides = {}) {
  return {
    id: "state-1",
    ownerEmail: "owner@example.com",
    fileId: "file-1",
    sourceName: "Statement.pdf",
    mimeType: "application/pdf",
    modifiedTime: "2026-04-20T12:00:00.000Z",
    driveSize: "1000",
    currentLocation: "Client Upload",
    proposedFilename: "Bakken_Christopher_Statement_Checking_x1234.pdf",
    proposedLocation: "Bakken_Christopher / Accounts",
    recognizedFileType: "Account statement",
    documentTypeId: "account_statement",
    confidenceLabel: "High",
    reasons: ["Matched statement naming convention."],
    status: "suggestion_ready",
    analysisProfile: CLEANUP_ANALYSIS_PROFILE,
    analysisVersion: DOCUMENT_ANALYSIS_VERSION,
    parserVersion: DOCUMENT_ANALYSIS_VERSION,
    analyzedAt: "2026-04-20T12:01:00.000Z",
    completedAt: null,
    appliedFilingEventId: null,
    createdAt: "2026-04-20T12:01:00.000Z",
    updatedAt: "2026-04-20T12:01:00.000Z",
    ...overrides,
  };
}

const matchingFile = {
  id: "file-1",
  name: "Statement.pdf",
  mimeType: "application/pdf",
  modifiedTime: "2026-04-20T12:00:00.000Z",
  size: "1000",
};

test("cleanup browser state defaults to needs analysis without stored state", () => {
  const cleanup = resolveCleanupBrowserState({
    currentLocation: "Client Upload",
    file: matchingFile,
  });

  assert.equal(cleanup.status, "needs_analysis");
  assert.equal(cleanup.currentLocation, "Client Upload");
});

test("cleanup browser state uses fresh stored suggestion", () => {
  const cleanup = resolveCleanupBrowserState({
    currentLocation: "Client Upload",
    file: matchingFile,
    state: makeState(),
  });

  assert.equal(cleanup.status, "suggestion_ready");
  assert.equal(
    cleanup.proposedFilename,
    "Bakken_Christopher_Statement_Checking_x1234.pdf",
  );
});

test("cleanup approval items treat completed states as idempotent successes", () => {
  const items = buildCleanupApprovalItemsFromStates({
    requestedFileIds: ["file-1"],
    states: [
      makeState({
        appliedFilingEventId: "filing-event-1",
        completedAt: "2026-04-20T12:02:00.000Z",
        status: "complete",
      }),
    ],
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].alreadyComplete, true);
  assert.equal(items[0].candidate, undefined);
  assert.equal(items[0].fileId, "file-1");
});

test("cleanup approval items keep non-ready suggestions retryable instead of filing", () => {
  const items = buildCleanupApprovalItemsFromStates({
    requestedFileIds: ["file-1", "missing-file"],
    states: [
      makeState({
        status: "needs_review",
      }),
    ],
  });

  assert.equal(items.length, 2);
  assert.equal(items[0].candidate, undefined);
  assert.match(items[0].errorMessage, /Review this Clean Up suggestion/);
  assert.equal(items[1].sourceName, "missing-file");
  assert.match(items[1].errorMessage, /No Clean Up suggestion/);
});

test("cleanup browser state returns needs analysis for stale Drive metadata", () => {
  assert.equal(
    isCleanupStateFreshForFile(makeState(), {
      ...matchingFile,
      size: "2000",
    }),
    false,
  );

  const cleanup = resolveCleanupBrowserState({
    currentLocation: "Client Upload",
    file: {
      ...matchingFile,
      size: "2000",
    },
    state: makeState(),
  });

  assert.equal(cleanup.status, "needs_analysis");
});

test("cleanup preview rows map complete when current and proposed values match", () => {
  const input = cleanupStateInputFromPreviewRow({
    ownerEmail: "owner@example.com",
    row: {
      confidenceLabel: "High",
      contentSource: "pdf_text",
      currentLocation: "Bakken_Christopher / Accounts",
      debug: {
        accountContextCandidate: null,
        accountLooseCandidate: null,
        documentSignal: null,
        ownershipClientCandidate: null,
        parserConflictSummary: null,
        parserVersion: DOCUMENT_ANALYSIS_VERSION,
        taxKeywordDetected: false,
        yearCandidates: [],
      },
      detectedClient: "Christopher Bakken",
      detectedClient2: null,
      detectedDocumentSubtype: null,
      detectedDocumentType: "Account statement",
      diagnosticText: null,
      documentTypeId: "account_statement",
      downloadByteLength: 1000,
      downloadSha1: "abc",
      driveSize: "1000",
      extractedAccountLast4: "1234",
      extractedAccountType: "Checking",
      extractedCustodian: "U.S. Bank",
      extractedDocumentDate: "2026-04-20",
      extractedEntityName: null,
      extractedIdType: null,
      extractedTaxYear: null,
      id: "file-1",
      mimeType: "application/pdf",
      modifiedTime: "2026-04-20T12:00:00.000Z",
      ownershipType: "single",
      parserConflictSummary: null,
      pdfFields: [],
      previewSnapshotId: null,
      proposedClientFolder: "Bakken_Christopher",
      proposedClientName: "Christopher Bakken",
      proposedClientName2: null,
      proposedDocumentSubtype: null,
      proposedDocumentType: "Account statement",
      proposedFilename: "Bakken_Christopher_Statement_Checking_x1234.pdf",
      proposedHouseholdFolder: "Bakken_Christopher",
      proposedLocation: "Bakken_Christopher / Accounts",
      reason: "Already matches convention.",
      reasons: ["Already matches convention."],
      sourceName: "Bakken_Christopher_Statement_Checking_x1234.pdf",
      statusLabel: "Ready to clean",
      textExcerpt: null,
    },
  });

  assert.equal(input.status, "complete");
  assert.equal(input.completedAt !== null, true);
});

test("cleanup browser route stays metadata-only and does not import extraction paths", () => {
  const routeSource = fs.readFileSync(
    new URL("../app/api/cleanup/browser/route.ts", import.meta.url),
    "utf8",
  );

  assert.equal(routeSource.includes("buildCleanupPlan"), false);
  assert.equal(routeSource.includes("buildProcessingPreview"), false);
  assert.equal(routeSource.includes("downloadDriveFile"), false);
});
