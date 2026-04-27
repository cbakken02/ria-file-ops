import type { ClientMemoryRule, FirmSettings } from "@/lib/db";
import type { FilingCandidate } from "@/lib/filing";
import { getCleanupDocumentTypeOptions } from "@/lib/cleanup-presets";
import {
  downloadDriveFile,
  getDriveFileMetadata,
  listFilesInFolder,
  type GoogleDriveFile,
} from "@/lib/google-drive";
import {
  getClientDisplayName,
  getClientDisplayNameSecondary,
  getNamingDocumentTypeLabel,
} from "@/lib/naming-rules";
import { buildProcessingPreview } from "@/lib/processing-preview";
import type {
  CleanupMode,
  CleanupPreviewData,
  CleanupPreviewFileRow,
  CleanupScope,
} from "@/lib/cleanup-types";

const MAX_PREVIEW_FILES = 12;

type CleanupCandidate = {
  file: GoogleDriveFile;
  currentLocation: string;
  inferredClientFolder: string | null;
};

type SelectionPayload = {
  candidates: CleanupCandidate[];
  notes: string[];
  selectionLabel: string;
};

export type CleanupPlan = {
  preview: CleanupPreviewData;
  filingCandidates: FilingCandidate[];
};

export type CleanupOverride = {
  fileId: string;
  proposedFilename: string;
  proposedLocation: string;
};

export async function buildCleanupPreview(input: {
  accessToken: string;
  clientMemoryRules?: ClientMemoryRule[];
  mode: CleanupMode;
  scope: CleanupScope;
  selectedIds: string[];
  settings: FirmSettings | null;
}) {
  const plan = await buildCleanupPlan(input);
  return plan.preview;
}

export async function buildCleanupPlan(input: {
  accessToken: string;
  clientMemoryRules?: ClientMemoryRule[];
  mode: CleanupMode;
  scope: CleanupScope;
  selectedIds: string[];
  settings: FirmSettings | null;
}) {
  const selection = await collectCleanupSelection(input);
  const existingClientFolders = await loadExistingClientFolders(
    input.accessToken,
    input.settings,
  );

  if (!selection.candidates.length) {
    return {
      filingCandidates: [],
      preview: {
        clientOptions: [],
        documentTypeOptions: getCleanupDocumentTypeOptions(),
        fileRows: [],
        moveCount: "0",
        notes: [
          "The selected target did not contain any files that can be previewed yet.",
        ],
        renameCount: "0",
        readyCount: 0,
        blockedCount: 0,
        executionSupported: isCleanupExecutionSupported(input.scope),
        canRun: false,
        scopeCount: "0 files",
        selectionLabel: selection.selectionLabel,
        summary:
          "Choose a file or folder with processable documents to see what Cleanup would change.",
        title: getCleanupTitle(input.scope),
      } satisfies CleanupPreviewData,
    } satisfies CleanupPlan;
  }

  const preview = await buildProcessingPreview(
    selection.candidates.map((candidate) => candidate.file),
    input.settings
      ? {
          ...input.settings,
          reviewInstruction: "auto_file_high_confidence",
        }
      : null,
    (fileId) => downloadDriveFile(input.accessToken, fileId),
    existingClientFolders,
    input.clientMemoryRules ?? [],
    { analysisMode: "preview" },
  );

  const rowPlans = preview.items.map((item, index) =>
    buildCleanupRow({
      candidate: selection.candidates[index]!,
      item,
      mode: input.mode,
      scope: input.scope,
    }),
  );
  const fileRows = rowPlans.map((plan) => plan.row);
  const filingCandidates = rowPlans
    .map((plan) => plan.filingCandidate)
    .filter((candidate): candidate is FilingCandidate => Boolean(candidate));

  const renameCount =
    input.mode === "reorganize_only"
      ? 0
      : fileRows.filter((row) => row.sourceName !== row.proposedFilename).length;
  const moveCount =
    input.mode === "rename_only"
      ? 0
      : fileRows.filter((row) => row.currentLocation !== row.proposedLocation).length;
  const needsReviewCount = fileRows.filter(
    (row) => row.statusLabel === "Needs review",
  ).length;
  const readyCount = fileRows.length - needsReviewCount;
  const executionSupported = isCleanupExecutionSupported(input.scope);
  const clientOptions = Array.from(
    new Set(
      [
        ...existingClientFolders,
        ...fileRows
          .map((row) => row.proposedHouseholdFolder ?? row.proposedClientFolder)
          .filter((value): value is string => Boolean(value)),
      ].filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right));

  return {
    filingCandidates,
    preview: {
      clientOptions,
      documentTypeOptions: getCleanupDocumentTypeOptions(),
      fileRows,
      moveCount: String(moveCount),
      notes: selection.notes,
      renameCount: String(renameCount),
      readyCount,
      blockedCount: needsReviewCount,
      executionSupported,
      canRun: executionSupported && needsReviewCount === 0 && filingCandidates.length > 0,
      scopeCount: formatScopeCount(fileRows.length),
      selectionLabel: selection.selectionLabel,
      summary:
        needsReviewCount > 0
          ? `${needsReviewCount} of ${fileRows.length} files still need a human before Cleanup should run.`
          : executionSupported
            ? `All ${fileRows.length} previewed files look structured enough for Cleanup to run.`
            : `Preview is ready. Execution for this larger scope comes next.`,
      title: getCleanupTitle(input.scope),
    } satisfies CleanupPreviewData,
  } satisfies CleanupPlan;
}

async function collectCleanupSelection(input: {
  accessToken: string;
  mode: CleanupMode;
  scope: CleanupScope;
  selectedIds: string[];
  settings: FirmSettings | null;
}) {
  const selectedIds = input.selectedIds.filter(Boolean);
  const selectedId = selectedIds[0];

  if (input.scope === "single_file" && selectedId) {
    const file = await getDriveFileMetadata(input.accessToken, selectedId);
    const currentLocation = await resolveParentLocation(
      input.accessToken,
      file.parents?.[0] ?? null,
    );

    return {
      candidates: [
        {
          file,
          currentLocation,
          inferredClientFolder: null,
        },
      ],
      notes: [],
      selectionLabel: file.name,
    } satisfies SelectionPayload;
  }

  if (input.scope === "folder_of_files" && selectedId) {
    const folder = await getDriveFileMetadata(input.accessToken, selectedId);
    const children = await listFilesInFolder(input.accessToken, selectedId);
    const directFiles = children.filter(
      (item) => item.mimeType !== "application/vnd.google-apps.folder",
    );
    const nestedFolders = children.filter(
      (item) => item.mimeType === "application/vnd.google-apps.folder",
    ).length;

    return {
      candidates: directFiles.slice(0, MAX_PREVIEW_FILES).map((file) => ({
        file,
        currentLocation: folder.name,
        inferredClientFolder: null,
      })),
      notes: buildSelectionNotes({
        nestedFolders,
        shownFileCount: Math.min(directFiles.length, MAX_PREVIEW_FILES),
        totalFileCount: directFiles.length,
      }),
      selectionLabel: folder.name,
    } satisfies SelectionPayload;
  }

  if (input.scope === "client_folder" && selectedId) {
    const folder = await getDriveFileMetadata(input.accessToken, selectedId);
    const selection = await collectDescendantFiles({
      accessToken: input.accessToken,
      folderId: selectedId,
      inferredClientFolder: folder.name,
      locationPrefix: folder.name,
      maxFiles: MAX_PREVIEW_FILES,
    });

    return {
      candidates: selection.candidates,
      notes: buildSelectionNotes({
        nestedFolders: selection.nestedFolders,
        shownFileCount: selection.candidates.length,
        totalFileCount: selection.totalFiles,
        truncated: selection.truncated,
      }),
      selectionLabel: folder.name,
    } satisfies SelectionPayload;
  }

  if (input.scope === "multiple_client_folders" && selectedIds.length > 0) {
    const allCandidates: CleanupCandidate[] = [];
    const notes: string[] = [];
    const labels: string[] = [];

    for (const folderId of selectedIds) {
      if (allCandidates.length >= MAX_PREVIEW_FILES) {
        notes.push(
          `Preview capped at the first ${MAX_PREVIEW_FILES} files across the selected folders.`,
        );
        break;
      }

      const folder = await getDriveFileMetadata(input.accessToken, folderId);
      labels.push(folder.name);
      const selection = await collectDescendantFiles({
        accessToken: input.accessToken,
        folderId,
        inferredClientFolder: folder.name,
        locationPrefix: folder.name,
        maxFiles: MAX_PREVIEW_FILES - allCandidates.length,
      });

      allCandidates.push(...selection.candidates);
      notes.push(
        ...buildSelectionNotes({
          nestedFolders: selection.nestedFolders,
          shownFileCount: selection.candidates.length,
          totalFileCount: selection.totalFiles,
          truncated: selection.truncated,
          prefix: folder.name,
        }),
      );
    }

    return {
      candidates: allCandidates,
      notes,
      selectionLabel:
        labels.length > 2 ? `${labels.slice(0, 2).join(", ")} + more` : labels.join(", "),
    } satisfies SelectionPayload;
  }

  return {
    candidates: [],
    notes: [],
    selectionLabel: "Nothing selected",
  } satisfies SelectionPayload;
}

async function collectDescendantFiles(input: {
  accessToken: string;
  folderId: string;
  inferredClientFolder: string | null;
  locationPrefix: string;
  maxFiles: number;
}) {
  const candidates: CleanupCandidate[] = [];
  let totalFiles = 0;
  let nestedFolders = 0;
  let truncated = false;

  async function walk(folderId: string, locationPrefix: string) {
    if (candidates.length >= input.maxFiles) {
      truncated = true;
      return;
    }

    const children = await listFilesInFolder(input.accessToken, folderId);
    const folders = children.filter(
      (item) => item.mimeType === "application/vnd.google-apps.folder",
    );
    const files = children.filter(
      (item) => item.mimeType !== "application/vnd.google-apps.folder",
    );

    totalFiles += files.length;
    nestedFolders += folders.length;

    for (const file of files) {
      if (candidates.length >= input.maxFiles) {
        truncated = true;
        break;
      }

      candidates.push({
        file,
        currentLocation: locationPrefix,
        inferredClientFolder: input.inferredClientFolder,
      });
    }

    for (const folder of folders) {
      if (candidates.length >= input.maxFiles) {
        truncated = true;
        break;
      }

      await walk(folder.id, `${locationPrefix} / ${folder.name}`);
    }
  }

  await walk(input.folderId, input.locationPrefix);

  return {
    candidates,
    nestedFolders,
    totalFiles,
    truncated,
  };
}

async function loadExistingClientFolders(
  accessToken: string,
  settings: FirmSettings | null,
) {
  if (!settings?.destinationFolderId) {
    return [];
  }

  const destinationChildren = await listFilesInFolder(
    accessToken,
    settings.destinationFolderId,
  ).catch(() => []);

  return destinationChildren
    .filter((file) => file.mimeType === "application/vnd.google-apps.folder")
    .map((file) => file.name);
}

async function resolveParentLocation(
  accessToken: string,
  parentId: string | null,
) {
  if (!parentId) {
    return "Current folder";
  }

  if (parentId === "root") {
    return "My Drive";
  }

  try {
    const parent = await getDriveFileMetadata(accessToken, parentId);
    return parent.name;
  } catch {
    return "Current folder";
  }
}

function buildCleanupRow(input: {
  candidate: CleanupCandidate;
  item: Awaited<ReturnType<typeof buildProcessingPreview>>["items"][number];
  mode: CleanupMode;
  scope: CleanupScope;
}): { row: CleanupPreviewFileRow; filingCandidate: FilingCandidate | null } {
  const fallbackClientFolder =
    input.scope === "client_folder" || input.scope === "multiple_client_folders"
      ? input.candidate.inferredClientFolder
      : null;
  const targetClientFolder =
    input.item.resolvedClientFolder ??
    fallbackClientFolder ??
    input.item.suggestedClientFolder;
  const proposedFilename =
    input.mode === "reorganize_only"
      ? input.item.sourceName
      : input.item.proposedFilename;
  const proposedLocation =
    input.mode === "rename_only"
      ? input.candidate.currentLocation
      : `${targetClientFolder ?? "Needs review"} / ${
          input.item.proposedTopLevelFolder
        }`;
  const needsReview =
    input.item.status === "Needs review" ||
    (!targetClientFolder && input.mode !== "rename_only");

  const row = {
    confidenceLabel: input.item.confidenceLabel,
    contentSource: input.item.contentSource,
    currentLocation: input.candidate.currentLocation,
    downloadByteLength: input.item.downloadByteLength,
    downloadSha1: input.item.downloadSha1,
    previewSnapshotId: input.item.previewSnapshotId,
    parserConflictSummary: input.item.parserConflictSummary,
    detectedClient: input.item.detectedClient,
    detectedClient2: input.item.detectedClient2,
    detectedDocumentType: input.item.detectedDocumentType,
    detectedDocumentSubtype: input.item.detectedDocumentSubtype,
    driveSize: input.item.driveSize,
    diagnosticText: input.item.diagnosticText,
    pdfFields: input.item.pdfFields,
    debug: input.item.debug,
    documentTypeId: input.item.documentTypeId,
    extractedAccountLast4: input.item.extractedAccountLast4,
    extractedAccountType: input.item.extractedAccountType,
    extractedCustodian: input.item.extractedCustodian,
    extractedDocumentDate: input.item.extractedDocumentDate,
    extractedEntityName: input.item.extractedEntityName,
    extractedIdType: input.item.extractedIdType,
    extractedTaxYear: input.item.extractedTaxYear,
    id: input.item.id,
    mimeType: input.item.mimeType,
    modifiedTime: input.item.modifiedTime,
    proposedClientName:
      getClientDisplayName({
        detectedClient: input.item.detectedClient,
        clientFolder: targetClientFolder,
      }) || null,
    proposedClientName2:
      getClientDisplayNameSecondary({
        detectedClient2: input.item.detectedClient2,
      }) || null,
    proposedHouseholdFolder: targetClientFolder,
    proposedClientFolder: targetClientFolder,
    proposedDocumentType: getNamingDocumentTypeLabel(input.item.documentTypeId),
    proposedDocumentSubtype: input.item.detectedDocumentSubtype,
    proposedFilename,
    proposedLocation,
    ownershipType: input.item.ownershipType,
    reason: input.item.reasons[0] ?? input.item.clientMatchReason,
    reasons: input.item.reasons,
    sourceName: input.item.sourceName,
    statusLabel: needsReview ? "Needs review" : "Ready to clean",
    textExcerpt: input.item.textExcerpt,
  } satisfies CleanupPreviewFileRow;

  if (needsReview) {
    return { row, filingCandidate: null };
  }

  return {
    row,
    filingCandidate: {
      reviewDecisionId: null,
      fileId: input.item.id,
      sourceName: input.item.sourceName,
      sourceMimeType: input.item.mimeType,
      sourceModifiedTime: input.item.modifiedTime ?? null,
      sourceDriveSize: input.item.driveSize ?? null,
      downloadByteLength: input.item.downloadByteLength,
      downloadSha1: input.item.downloadSha1,
      parserVersion: input.item.debug.parserVersion,
      parserConflictSummary: input.item.parserConflictSummary,
      originalClientFolder: input.candidate.inferredClientFolder,
      originalTopLevelFolder: input.candidate.currentLocation,
      originalFilename: input.item.sourceName,
      finalClientFolder: targetClientFolder,
      finalTopLevelFolder:
        input.mode === "rename_only"
          ? input.candidate.currentLocation
          : input.item.proposedTopLevelFolder,
      finalFilename: proposedFilename,
    detectedDocumentType: input.item.detectedDocumentType,
    detectedDocumentSubtype: input.item.detectedDocumentSubtype,
      detectedClient: input.item.detectedClient,
      detectedClient2: input.item.detectedClient2,
      detectedOwnershipType: input.item.ownershipType,
      detectedAccountLast4: input.item.extractedAccountLast4,
      detectedAccountType: input.item.extractedAccountType,
      detectedCustodian: input.item.extractedCustodian,
      detectedTaxYear: input.item.extractedTaxYear,
      detectedDocumentDate: input.item.extractedDocumentDate,
      detectedIdType: input.item.extractedIdType,
      detectedEntityName: input.item.extractedEntityName,
      classifierConfidence: input.item.confidenceScore,
      classifierContentSource: input.item.contentSource,
      classifierReasons: input.item.reasons,
      classifierExcerpt: input.item.textExcerpt,
      targetParentIdOverride:
        input.mode === "rename_only" ? input.candidate.file.parents?.[0] ?? null : null,
      targetParentLabelOverride:
        input.mode === "rename_only" ? input.candidate.currentLocation : null,
    },
  };
}

function buildSelectionNotes(input: {
  nestedFolders?: number;
  prefix?: string;
  shownFileCount: number;
  totalFileCount: number;
  truncated?: boolean;
}) {
  const notes: string[] = [];
  const prefix = input.prefix ? `${input.prefix}: ` : "";

  if (input.nestedFolders && input.nestedFolders > 0) {
    notes.push(
      `${prefix}${input.nestedFolders} nested folder${
        input.nestedFolders === 1 ? "" : "s"
      } are included in this preview.`,
    );
  }

  if (input.truncated) {
    notes.push(
      `${prefix}Preview capped at ${input.shownFileCount} files so Cleanup stays fast and readable.`,
    );
  } else if (input.totalFileCount > input.shownFileCount) {
    notes.push(
      `${prefix}${input.totalFileCount - input.shownFileCount} additional files are not shown yet.`,
    );
  }

  return notes;
}

function getCleanupTitle(scope: CleanupScope) {
  if (scope === "single_file") {
    return "Preview one file cleanup";
  }

  if (scope === "folder_of_files") {
    return "Preview one folder of files";
  }

  if (scope === "multiple_client_folders") {
    return "Preview a multi-household cleanup batch";
  }

  return "Preview one household folder cleanup";
}

function formatScopeCount(fileCount: number) {
  return `${fileCount} file${fileCount === 1 ? "" : "s"}`;
}

function isCleanupExecutionSupported(scope: CleanupScope) {
  return scope === "single_file" || scope === "folder_of_files";
}

export function applyCleanupOverrides(input: {
  filingCandidates: FilingCandidate[];
  overrides: CleanupOverride[];
}) {
  const overridesById = new Map(
    input.overrides.map((override) => [override.fileId, override]),
  );

  return input.filingCandidates.map((candidate) => {
    const override = overridesById.get(candidate.fileId);
    if (!override) {
      return candidate;
    }

    const nextCandidate: FilingCandidate = {
      ...candidate,
      finalFilename: override.proposedFilename.trim() || candidate.finalFilename,
    };

    const parsedLocation = parseCleanupLocation(override.proposedLocation);
    if (!parsedLocation) {
      return nextCandidate;
    }

    if (parsedLocation.clientFolder && parsedLocation.topLevelFolder) {
      nextCandidate.targetParentIdOverride = null;
      nextCandidate.targetParentLabelOverride = null;
      nextCandidate.finalClientFolder = parsedLocation.clientFolder;
      nextCandidate.finalTopLevelFolder = parsedLocation.topLevelFolder;
      return nextCandidate;
    }

    if (parsedLocation.topLevelFolder) {
      nextCandidate.targetParentIdOverride = null;
      nextCandidate.targetParentLabelOverride = null;
      nextCandidate.finalClientFolder =
        candidate.finalClientFolder ?? candidate.originalClientFolder;
      nextCandidate.finalTopLevelFolder = parsedLocation.topLevelFolder;
      return nextCandidate;
    }

    return nextCandidate;
  });
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

  if (parts.length === 1) {
    return {
      clientFolder: null,
      topLevelFolder: parts[0] ?? null,
    };
  }

  return null;
}
