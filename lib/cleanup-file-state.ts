import { DOCUMENT_ANALYSIS_VERSION } from "@/lib/document-intelligence";
import type { FilingCandidate, FilingCandidateSuccess } from "@/lib/filing";
import type { GoogleDriveFile } from "@/lib/google-drive";
import type {
  CleanupBrowserFileState,
  CleanupFileState,
  CleanupFileStateUpsertInput,
  CleanupPreviewFileRow,
} from "@/lib/cleanup-types";

export const CLEANUP_ANALYSIS_PROFILE = "cleanup_explorer";

export function isCleanupStateFreshForFile(
  state: CleanupFileState | undefined,
  file: Pick<GoogleDriveFile, "name" | "mimeType" | "modifiedTime" | "size">,
) {
  if (!state) {
    return false;
  }

  return (
    state.sourceName === file.name &&
    state.mimeType === file.mimeType &&
    normalizeNullable(state.modifiedTime) === normalizeNullable(file.modifiedTime) &&
    normalizeNullable(state.driveSize) === normalizeNullable(file.size) &&
    state.analysisProfile === CLEANUP_ANALYSIS_PROFILE &&
    state.analysisVersion === DOCUMENT_ANALYSIS_VERSION
  );
}

export function buildNeedsAnalysisCleanupState(
  currentLocation: string | null,
): CleanupBrowserFileState {
  return {
    currentLocation,
    status: "needs_analysis",
  };
}

export function resolveCleanupBrowserState(input: {
  currentLocation: string | null;
  file: Pick<GoogleDriveFile, "name" | "mimeType" | "modifiedTime" | "size">;
  latestSuccessfulFiling?: FilingCandidateSuccess | null;
  state?: CleanupFileState;
}): CleanupBrowserFileState {
  if (input.latestSuccessfulFiling) {
    return {
      appliedFilingEventId: input.latestSuccessfulFiling.eventId,
      completedAt: input.latestSuccessfulFiling.completedAt,
      currentLocation: input.currentLocation,
      proposedFilename: input.latestSuccessfulFiling.finalFilename,
      proposedLocation: input.latestSuccessfulFiling.destinationPath,
      status: "complete",
    };
  }

  const state = input.state;

  if (!state || !isCleanupStateFreshForFile(state, input.file)) {
    return buildNeedsAnalysisCleanupState(input.currentLocation);
  }

  return {
    appliedFilingEventId: state.appliedFilingEventId,
    analyzedAt: state.analyzedAt,
    completedAt: state.completedAt,
    confidenceLabel: state.confidenceLabel,
    currentLocation: state.currentLocation ?? input.currentLocation,
    documentTypeId: state.documentTypeId,
    proposedFilename: state.proposedFilename,
    proposedLocation: state.proposedLocation,
    reasons: state.reasons,
    recognizedFileType: state.recognizedFileType,
    status: state.status,
  };
}

export function cleanupStateInputFromPreviewRow(input: {
  ownerEmail: string;
  row: CleanupPreviewFileRow;
}) {
  const complete =
    normalizeComparable(input.row.sourceName) ===
      normalizeComparable(input.row.proposedFilename) &&
    normalizeComparable(input.row.currentLocation) ===
      normalizeComparable(input.row.proposedLocation);

  const status = complete
    ? "complete"
    : input.row.statusLabel === "Needs review"
      ? "needs_review"
      : "suggestion_ready";
  const now = new Date().toISOString();

  return {
    analyzedAt: now,
    analysisProfile: CLEANUP_ANALYSIS_PROFILE,
    analysisVersion: DOCUMENT_ANALYSIS_VERSION,
    appliedFilingEventId: null,
    completedAt: complete ? now : null,
    confidenceLabel: input.row.confidenceLabel,
    currentLocation: input.row.currentLocation,
    documentTypeId: input.row.documentTypeId,
    driveSize: input.row.driveSize ?? null,
    fileId: input.row.id,
    mimeType: input.row.mimeType,
    modifiedTime: input.row.modifiedTime ?? null,
    ownerEmail: input.ownerEmail,
    parserVersion: input.row.debug.parserVersion,
    proposedFilename: input.row.proposedFilename,
    proposedLocation: input.row.proposedLocation,
    reasons: input.row.reasons,
    recognizedFileType: input.row.detectedDocumentType,
    sourceName: input.row.sourceName,
    status,
  } satisfies CleanupFileStateUpsertInput;
}

export function filingCandidateFromCleanupState(
  state: CleanupFileState,
): FilingCandidate | null {
  if (
    state.status !== "suggestion_ready" ||
    !state.proposedFilename ||
    !state.proposedLocation
  ) {
    return null;
  }

  const parsedLocation = parseCleanupLocation(state.proposedLocation);
  if (!parsedLocation?.clientFolder || !parsedLocation.topLevelFolder) {
    return null;
  }

  return {
    classifierReasons: state.reasons,
    detectedDocumentType: state.recognizedFileType,
    downloadByteLength: null,
    downloadSha1: null,
    fileId: state.fileId,
    finalClientFolder: parsedLocation.clientFolder,
    finalFilename: state.proposedFilename,
    finalTopLevelFolder: parsedLocation.topLevelFolder,
    originalClientFolder: null,
    originalFilename: state.sourceName,
    originalTopLevelFolder: state.currentLocation,
    parserVersion: state.parserVersion,
    reviewDecisionId: null,
    sourceDriveSize: state.driveSize,
    sourceMimeType: state.mimeType,
    sourceModifiedTime: state.modifiedTime,
    sourceName: state.sourceName,
  };
}

export function latestSuccessfulFilingByFileId(
  successes: FilingCandidateSuccess[],
) {
  const byFileId = new Map<string, FilingCandidateSuccess>();
  for (const success of successes) {
    const existing = byFileId.get(success.fileId);
    if (!existing || existing.completedAt < success.completedAt) {
      byFileId.set(success.fileId, success);
    }
  }
  return byFileId;
}

function parseCleanupLocation(value: string) {
  const parts = value
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    return {
      clientFolder: parts[0] ?? null,
      topLevelFolder: parts[1] ?? null,
    };
  }

  return null;
}

function normalizeNullable(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeComparable(value: string | null | undefined) {
  return normalizeNullable(value)?.toLowerCase() ?? "";
}
