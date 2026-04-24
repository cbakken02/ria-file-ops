import {
  createFilingEvent,
  type FirmSettings,
} from "@/lib/db";
import {
  buildDriveItemPath,
  ensureDriveFolder,
  getDriveFileMetadata,
  moveAndRenameDriveFile,
} from "@/lib/google-drive";

export type FilingCandidate = {
  reviewDecisionId: string | null;
  fileId: string;
  sourceName: string;
  sourceMimeType: string;
  sourceModifiedTime?: string | null;
  sourceDriveSize?: string | null;
  downloadByteLength?: number | null;
  downloadSha1?: string | null;
  parserVersion?: string | null;
  parserConflictSummary?: string | null;
  originalClientFolder: string | null;
  originalTopLevelFolder: string | null;
  originalFilename: string | null;
  finalClientFolder: string | null;
  finalTopLevelFolder: string | null;
  finalFilename: string | null;
  detectedDocumentType?: string | null;
  detectedDocumentSubtype?: string | null;
  detectedClient?: string | null;
  detectedClient2?: string | null;
  detectedOwnershipType?: "single" | "joint" | null;
  detectedAccountLast4?: string | null;
  detectedAccountType?: string | null;
  detectedCustodian?: string | null;
  detectedTaxYear?: string | null;
  detectedDocumentDate?: string | null;
  detectedIdType?: string | null;
  detectedEntityName?: string | null;
  classifierConfidence?: number | null;
  classifierContentSource?: string | null;
  classifierReasons?: string[] | null;
  classifierExcerpt?: string | null;
  targetParentIdOverride?: string | null;
  targetParentLabelOverride?: string | null;
};

export async function executeFilingBatch(input: {
  accessToken: string;
  ownerEmail: string;
  actorEmail: string;
  actorType?: "user" | "automation";
  initiatedByEmail?: string | null;
  settings: FirmSettings;
  candidates: FilingCandidate[];
}) {
  const batchId = crypto.randomUUID();
  let succeededCount = 0;
  let failedCount = 0;
  const successfulReviewDecisionIds: string[] = [];

  for (const candidate of input.candidates) {
    const missingStandardDestination =
      !candidate.targetParentIdOverride &&
      (!candidate.finalClientFolder || !candidate.finalTopLevelFolder);

    if (missingStandardDestination || !candidate.finalFilename) {
      failedCount += 1;
      createFilingEvent({
        ownerEmail: input.ownerEmail,
        actorEmail: input.actorEmail,
        actorType: input.actorType,
        initiatedByEmail: input.initiatedByEmail,
        batchId,
        storageProvider: input.settings.storageProvider,
        reviewDecisionId: candidate.reviewDecisionId,
        fileId: candidate.fileId,
        sourceName: candidate.sourceName,
        sourceMimeType: candidate.sourceMimeType,
        sourceModifiedTime: candidate.sourceModifiedTime,
        sourceDriveSize: candidate.sourceDriveSize,
        downloadByteLength: candidate.downloadByteLength,
        downloadSha1: candidate.downloadSha1,
        parserVersion: candidate.parserVersion,
        parserConflictSummary: candidate.parserConflictSummary,
        originalClientFolder: candidate.originalClientFolder,
        originalTopLevelFolder: candidate.originalTopLevelFolder,
        originalFilename: candidate.originalFilename,
        originalPath: null,
        finalClientFolder: candidate.finalClientFolder,
        finalTopLevelFolder: candidate.finalTopLevelFolder,
        finalFilename: candidate.finalFilename,
        destinationPath: null,
        sourceParentIds: null,
        destinationRootId: input.settings.destinationFolderId,
        destinationRootName: input.settings.destinationFolderName,
        clientFolderId: null,
        clientFolderName: candidate.finalClientFolder,
        topLevelFolderId: null,
        topLevelFolderName: candidate.finalTopLevelFolder,
        finalParentId: null,
        detectedDocumentType: candidate.detectedDocumentType,
        detectedClient: candidate.detectedClient,
        detectedClient2: candidate.detectedClient2,
        detectedOwnershipType: candidate.detectedOwnershipType,
        detectedAccountLast4: candidate.detectedAccountLast4,
        detectedAccountType: candidate.detectedAccountType,
        detectedCustodian: candidate.detectedCustodian,
        detectedTaxYear: candidate.detectedTaxYear,
        detectedDocumentDate: candidate.detectedDocumentDate,
        detectedIdType: candidate.detectedIdType,
        detectedEntityName: candidate.detectedEntityName,
        classifierConfidence: candidate.classifierConfidence,
        classifierContentSource: candidate.classifierContentSource,
        classifierReasons: candidate.classifierReasons,
        classifierExcerpt: candidate.classifierExcerpt,
        outcome: "failed",
        errorMessage:
          candidate.targetParentIdOverride
            ? "The cleanup candidate is missing a target folder or filename."
            : "The filing candidate is missing a client folder, destination folder, or filename.",
      });
      continue;
    }

    try {
      const metadata = await getDriveFileMetadata(input.accessToken, candidate.fileId);
      let clientFolder: { id: string; name: string } | null = null;
      let topLevelFolder: { id: string; name: string } | null = null;
      let targetParentId: string;

      if (candidate.targetParentIdOverride) {
        targetParentId = candidate.targetParentIdOverride;
        topLevelFolder = {
          id: candidate.targetParentIdOverride,
          name:
            candidate.targetParentLabelOverride ??
            candidate.finalTopLevelFolder ??
            "Current folder",
        };
      } else {
        const finalClientFolder = candidate.finalClientFolder as string;
        const finalTopLevelFolder = candidate.finalTopLevelFolder as string;
        clientFolder = await ensureDriveFolder(
          input.accessToken,
          input.settings.destinationFolderId ?? "",
          finalClientFolder,
        );
        topLevelFolder = await ensureDriveFolder(
          input.accessToken,
          clientFolder.id,
          finalTopLevelFolder,
        );
        targetParentId = topLevelFolder.id;
      }

      const originalPath = await buildDriveItemPath({
        accessToken: input.accessToken,
        parentFolderId: metadata.parents?.[0] ?? "root",
        itemName: candidate.originalFilename ?? candidate.sourceName,
      });

      await moveAndRenameDriveFile(input.accessToken, candidate.fileId, {
        newName: candidate.finalFilename,
        targetParentId,
        previousParentIds: metadata.parents ?? [],
      });

      const destinationPath = await buildDriveItemPath({
        accessToken: input.accessToken,
        parentFolderId: targetParentId,
        itemName: candidate.finalFilename,
      });

      createFilingEvent({
        ownerEmail: input.ownerEmail,
        actorEmail: input.actorEmail,
        actorType: input.actorType,
        initiatedByEmail: input.initiatedByEmail,
        batchId,
        storageProvider: input.settings.storageProvider,
        reviewDecisionId: candidate.reviewDecisionId,
        fileId: candidate.fileId,
        sourceName: candidate.sourceName,
        sourceMimeType: candidate.sourceMimeType,
        sourceModifiedTime: candidate.sourceModifiedTime,
        sourceDriveSize: candidate.sourceDriveSize,
        downloadByteLength: candidate.downloadByteLength,
        downloadSha1: candidate.downloadSha1,
        parserVersion: candidate.parserVersion,
        parserConflictSummary: candidate.parserConflictSummary,
        originalClientFolder: candidate.originalClientFolder,
        originalTopLevelFolder: candidate.originalTopLevelFolder,
        originalFilename: candidate.originalFilename,
        originalPath,
        finalClientFolder: candidate.finalClientFolder,
        finalTopLevelFolder: candidate.finalTopLevelFolder,
        finalFilename: candidate.finalFilename,
        destinationPath,
        sourceParentIds: metadata.parents ?? [],
        destinationRootId: input.settings.destinationFolderId,
        destinationRootName: input.settings.destinationFolderName,
        clientFolderId: clientFolder?.id ?? null,
        clientFolderName: clientFolder?.name ?? candidate.finalClientFolder,
        topLevelFolderId: topLevelFolder?.id ?? null,
        topLevelFolderName: topLevelFolder?.name ?? candidate.finalTopLevelFolder,
        finalParentId: topLevelFolder?.id ?? null,
        detectedDocumentType: candidate.detectedDocumentType,
        detectedClient: candidate.detectedClient,
        detectedClient2: candidate.detectedClient2,
        detectedOwnershipType: candidate.detectedOwnershipType,
        detectedAccountLast4: candidate.detectedAccountLast4,
        detectedAccountType: candidate.detectedAccountType,
        detectedCustodian: candidate.detectedCustodian,
        detectedTaxYear: candidate.detectedTaxYear,
        detectedDocumentDate: candidate.detectedDocumentDate,
        detectedIdType: candidate.detectedIdType,
        detectedEntityName: candidate.detectedEntityName,
        classifierConfidence: candidate.classifierConfidence,
        classifierContentSource: candidate.classifierContentSource,
        classifierReasons: candidate.classifierReasons,
        classifierExcerpt: candidate.classifierExcerpt,
        outcome: "succeeded",
        errorMessage: null,
      });

      if (candidate.reviewDecisionId) {
        successfulReviewDecisionIds.push(candidate.reviewDecisionId);
      }

      succeededCount += 1;
    } catch (error) {
      failedCount += 1;
      createFilingEvent({
        ownerEmail: input.ownerEmail,
        actorEmail: input.actorEmail,
        actorType: input.actorType,
        initiatedByEmail: input.initiatedByEmail,
        batchId,
        storageProvider: input.settings.storageProvider,
        reviewDecisionId: candidate.reviewDecisionId,
        fileId: candidate.fileId,
        sourceName: candidate.sourceName,
        sourceMimeType: candidate.sourceMimeType,
        sourceModifiedTime: candidate.sourceModifiedTime,
        sourceDriveSize: candidate.sourceDriveSize,
        downloadByteLength: candidate.downloadByteLength,
        downloadSha1: candidate.downloadSha1,
        parserVersion: candidate.parserVersion,
        parserConflictSummary: candidate.parserConflictSummary,
        originalClientFolder: candidate.originalClientFolder,
        originalTopLevelFolder: candidate.originalTopLevelFolder,
        originalFilename: candidate.originalFilename,
        originalPath: null,
        finalClientFolder: candidate.finalClientFolder,
        finalTopLevelFolder: candidate.finalTopLevelFolder,
        finalFilename: candidate.finalFilename,
        destinationPath: null,
        sourceParentIds: null,
        destinationRootId: input.settings.destinationFolderId,
        destinationRootName: input.settings.destinationFolderName,
        clientFolderId: null,
        clientFolderName: candidate.finalClientFolder,
        topLevelFolderId: null,
        topLevelFolderName: candidate.finalTopLevelFolder,
        finalParentId: null,
        detectedDocumentType: candidate.detectedDocumentType,
        detectedClient: candidate.detectedClient,
        detectedClient2: candidate.detectedClient2,
        detectedOwnershipType: candidate.detectedOwnershipType,
        detectedAccountLast4: candidate.detectedAccountLast4,
        detectedAccountType: candidate.detectedAccountType,
        detectedCustodian: candidate.detectedCustodian,
        detectedTaxYear: candidate.detectedTaxYear,
        detectedDocumentDate: candidate.detectedDocumentDate,
        detectedIdType: candidate.detectedIdType,
        detectedEntityName: candidate.detectedEntityName,
        classifierConfidence: candidate.classifierConfidence,
        classifierContentSource: candidate.classifierContentSource,
        classifierReasons: candidate.classifierReasons,
        classifierExcerpt: candidate.classifierExcerpt,
        outcome: "failed",
        errorMessage:
          error instanceof Error
            ? error.message
            : "The filing action failed unexpectedly.",
      });
    }
  }

  return {
    batchId,
    succeededCount,
    failedCount,
    successfulReviewDecisionIds,
  };
}
