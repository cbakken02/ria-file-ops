"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import {
  createFilingEvent,
  getClientMemoryRulesByOwnerEmail,
  getFirmSettingsByOwnerEmail,
  getReviewDecisionByOwnerAndFile,
  getReviewDecisionsByOwnerEmail,
  saveReviewDecisionForOwner,
  setReviewDecisionStatusForOwner,
  upsertClientMemoryRule,
} from "@/lib/db";
import { executeFilingBatch } from "@/lib/filing";
import {
  downloadDriveFile,
  listFilesInFolder,
  type GoogleDriveFile,
} from "@/lib/google-drive";
import { buildProcessingPreview } from "@/lib/processing-preview";
import {
  getVerifiedActiveStorageConnectionForSession,
  storageConnectionHasWriteAccess,
} from "@/lib/storage-connections";

function normalizeOptionalValue(value: FormDataEntryValue | null) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

export async function saveReviewDecisionAction(formData: FormData) {
  const session = await requireSession();
  const ownerEmail = session.user?.email;

  if (!ownerEmail) {
    throw new Error("No signed-in email was found for this session.");
  }

  const fileId = normalizeOptionalValue(formData.get("fileId"));
  const sourceName = normalizeOptionalValue(formData.get("sourceName"));
  const mimeType = normalizeOptionalValue(formData.get("mimeType"));
  const decisionStatus = normalizeOptionalValue(formData.get("decisionStatus"));
  const detectedClient = normalizeOptionalValue(formData.get("detectedClient"));

  if (!fileId || !sourceName || !mimeType) {
    throw new Error("The review item is missing required file metadata.");
  }

  const previousDecision = getReviewDecisionByOwnerAndFile(ownerEmail, fileId);
  const savedDecision = saveReviewDecisionForOwner({
    ownerEmail,
    fileId,
    sourceName,
    mimeType,
    modifiedTime: normalizeOptionalValue(formData.get("modifiedTime")),
    detectedDocumentType: normalizeOptionalValue(formData.get("detectedDocumentType")),
    originalClientName: normalizeOptionalValue(formData.get("originalClientName")),
    originalClientName2: normalizeOptionalValue(formData.get("originalClientName2")),
    originalOwnershipType:
      (normalizeOptionalValue(formData.get("originalOwnershipType")) as
        | "single"
        | "joint"
        | null) ?? "single",
    originalClientFolder: normalizeOptionalValue(formData.get("originalClientFolder")),
    originalTopLevelFolder: normalizeOptionalValue(
      formData.get("originalTopLevelFolder"),
    ),
    originalFilename: normalizeOptionalValue(formData.get("originalFilename")),
    reviewedClientName: normalizeOptionalValue(formData.get("reviewedClientName")),
    reviewedClientName2: normalizeOptionalValue(formData.get("reviewedClientName2")),
    reviewedOwnershipType:
      (normalizeOptionalValue(formData.get("reviewedOwnershipType")) as
        | "single"
        | "joint"
        | null) ?? "single",
    reviewedClientFolder: normalizeOptionalValue(formData.get("reviewedClientFolder")),
    reviewedTopLevelFolder: normalizeOptionalValue(
      formData.get("reviewedTopLevelFolder"),
    ),
    reviewedFilename: normalizeOptionalValue(formData.get("reviewedFilename")),
    status: decisionStatus === "approved" ? "approved" : "draft",
  });

  const learnedClientFolder =
    normalizeOptionalValue(formData.get("reviewedClientFolder")) ??
    savedDecision?.originalClientFolder ??
    null;

  if (detectedClient && learnedClientFolder) {
    upsertClientMemoryRule({
      ownerEmail,
      rawClientName: detectedClient,
      learnedClientFolder,
    });
  }

  if (decisionStatus === "approved" && previousDecision?.status !== "approved") {
    createFilingEvent({
      ownerEmail,
      actorEmail: ownerEmail,
      actorType: "user",
      batchId: `review-${crypto.randomUUID()}`,
      eventType: "review_approved",
      storageProvider: "google_drive",
      reviewDecisionId: savedDecision?.id ?? null,
      fileId,
      sourceName,
      sourceMimeType: mimeType,
      sourceModifiedTime: normalizeOptionalValue(formData.get("modifiedTime")),
      sourceDriveSize: null,
      downloadByteLength: null,
      downloadSha1: null,
      parserVersion: null,
      parserConflictSummary: null,
      originalClientFolder: normalizeOptionalValue(formData.get("originalClientFolder")),
      originalTopLevelFolder: normalizeOptionalValue(
        formData.get("originalTopLevelFolder"),
      ),
      originalFilename: normalizeOptionalValue(formData.get("originalFilename")),
      originalPath: null,
      finalClientFolder:
        normalizeOptionalValue(formData.get("reviewedClientFolder")) ??
        normalizeOptionalValue(formData.get("originalClientFolder")),
      finalTopLevelFolder:
        normalizeOptionalValue(formData.get("reviewedTopLevelFolder")) ??
        normalizeOptionalValue(formData.get("originalTopLevelFolder")),
      finalFilename:
        normalizeOptionalValue(formData.get("reviewedFilename")) ??
        normalizeOptionalValue(formData.get("originalFilename")) ??
        sourceName,
      destinationPath: null,
      sourceParentIds: null,
      destinationRootId: null,
      destinationRootName: null,
      clientFolderId: null,
      clientFolderName:
        normalizeOptionalValue(formData.get("reviewedClientFolder")) ??
        normalizeOptionalValue(formData.get("originalClientFolder")),
      topLevelFolderId: null,
      topLevelFolderName:
        normalizeOptionalValue(formData.get("reviewedTopLevelFolder")) ??
        normalizeOptionalValue(formData.get("originalTopLevelFolder")),
      finalParentId: null,
      detectedDocumentType: normalizeOptionalValue(formData.get("detectedDocumentType")),
      detectedClient:
        normalizeOptionalValue(formData.get("reviewedClientName")) ??
        normalizeOptionalValue(formData.get("originalClientName")),
      detectedClient2:
        normalizeOptionalValue(formData.get("reviewedClientName2")) ??
        normalizeOptionalValue(formData.get("originalClientName2")),
      detectedOwnershipType:
        (normalizeOptionalValue(formData.get("reviewedOwnershipType")) as
          | "single"
          | "joint"
          | null) ??
        (normalizeOptionalValue(formData.get("originalOwnershipType")) as
          | "single"
          | "joint"
          | null),
      outcome: "succeeded",
      errorMessage: null,
    });
  }

  revalidatePath("/review");
  revalidatePath("/dashboard");
  revalidatePath("/preview");
  redirect("/preview?notice=Review+changes+saved.");
}

export async function fileApprovedDecisionsAction() {
  const session = await requireSession();
  const ownerEmail = session.user?.email;
  const activeConnection = await getVerifiedActiveStorageConnectionForSession(session);

  if (!ownerEmail || !activeConnection) {
    throw new Error("An active storage connection is required to file documents.");
  }

  if (!storageConnectionHasWriteAccess(activeConnection)) {
    redirect("/preview?notice=Reconnect+the+active+storage+connection+with+write+access+before+filing.");
  }

  const settings = getFirmSettingsByOwnerEmail(ownerEmail);
  if (!settings?.destinationFolderId || !settings?.sourceFolderId) {
    throw new Error("Choose a destination root before filing approved items.");
  }
  const clientMemoryRules = getClientMemoryRulesByOwnerEmail(ownerEmail);

  const approvedDecisions = getReviewDecisionsByOwnerEmail(ownerEmail).filter(
    (decision) => decision.status === "approved",
  );

  if (!approvedDecisions.length) {
    redirect("/preview?notice=There+are+no+approved+items+to+file+right+now.");
  }

  let sourceFiles: GoogleDriveFile[] = [];
  try {
    sourceFiles = await listFilesInFolder(
      activeConnection.accessToken,
      settings.sourceFolderId,
    );
  } catch (error) {
    redirect(
      `/preview?notice=${encodeURIComponent(
        error instanceof Error
          ? `Google Drive could not load the source folder: ${error.message}`
          : "Google Drive could not load the source folder.",
      )}`,
    );
  }

  let destinationChildren: GoogleDriveFile[] = [];
  try {
    destinationChildren = await listFilesInFolder(
      activeConnection.accessToken,
      settings.destinationFolderId,
    );
  } catch (error) {
    redirect(
      `/preview?notice=${encodeURIComponent(
        error instanceof Error
          ? `Google Drive could not load the destination root: ${error.message}`
          : "Google Drive could not load the destination root.",
      )}`,
    );
  }

  const existingClientFolders = destinationChildren
    .filter((file) => file.mimeType === "application/vnd.google-apps.folder")
    .map((file) => file.name);

  const preview = await buildProcessingPreview(
    sourceFiles,
    settings,
    async (fileId) => downloadDriveFile(activeConnection.accessToken, fileId),
    existingClientFolders,
    clientMemoryRules,
  );
  const previewById = new Map(preview.items.map((item) => [item.id, item]));

  const result = await executeFilingBatch({
    accessToken: activeConnection.accessToken,
    ownerEmail,
    actorEmail: ownerEmail,
    actorType: "user",
    settings,
    candidates: approvedDecisions.map((decision) => {
      const previewItem = previewById.get(decision.fileId);

      return {
        reviewDecisionId: decision.id,
        fileId: decision.fileId,
        sourceName: decision.sourceName,
        sourceMimeType: decision.mimeType,
        sourceModifiedTime: previewItem?.modifiedTime ?? decision.modifiedTime ?? null,
        sourceDriveSize: previewItem?.driveSize ?? null,
        downloadByteLength: previewItem?.downloadByteLength ?? null,
        downloadSha1: previewItem?.downloadSha1 ?? null,
        parserVersion: previewItem?.debug.parserVersion ?? null,
        parserConflictSummary: previewItem?.parserConflictSummary ?? null,
        originalClientFolder: decision.originalClientFolder,
        originalTopLevelFolder: decision.originalTopLevelFolder,
        originalFilename: decision.originalFilename,
        finalClientFolder:
          decision.reviewedClientFolder || decision.originalClientFolder,
        finalTopLevelFolder:
          decision.reviewedTopLevelFolder || decision.originalTopLevelFolder,
        finalFilename: decision.reviewedFilename || decision.originalFilename,
        detectedDocumentType:
          previewItem?.detectedDocumentType ?? decision.detectedDocumentType,
        detectedClient:
          decision.reviewedClientName ?? previewItem?.detectedClient ?? null,
        detectedClient2:
          decision.reviewedClientName2 ?? previewItem?.detectedClient2 ?? null,
        detectedOwnershipType:
          decision.reviewedOwnershipType ??
          decision.originalOwnershipType ??
          previewItem?.ownershipType ??
          null,
        detectedAccountLast4: previewItem?.extractedAccountLast4 ?? null,
        detectedAccountType: previewItem?.extractedAccountType ?? null,
        detectedCustodian: previewItem?.extractedCustodian ?? null,
        detectedTaxYear: previewItem?.extractedTaxYear ?? null,
        detectedDocumentDate: previewItem?.extractedDocumentDate ?? null,
        detectedIdType: previewItem?.extractedIdType ?? null,
        detectedEntityName: previewItem?.extractedEntityName ?? null,
        classifierConfidence: previewItem?.confidenceScore ?? null,
        classifierContentSource: previewItem?.contentSource ?? null,
        classifierReasons: previewItem?.reasons ?? [
          "Filed after human review and approval.",
        ],
        classifierExcerpt: previewItem?.textExcerpt ?? null,
      };
    }),
  });

  for (const decision of approvedDecisions) {
    if (result.successfulReviewDecisionIds.includes(decision.id)) {
      setReviewDecisionStatusForOwner({
        ownerEmail,
        fileId: decision.fileId,
        status: "filed",
      });
    }
  }

  revalidatePath("/review");
  revalidatePath("/dashboard");
  revalidatePath("/preview");
  revalidatePath("/history");
  redirect(
    `/preview?notice=${encodeURIComponent(
      `Approved filing finished. ${result.succeededCount} succeeded and ${result.failedCount} failed.`,
    )}`,
  );
}
