"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  getClientMemoryRulesByOwnerEmail,
  getFirmSettingsByOwnerEmail,
  getReviewDecisionByOwnerAndFile,
  setReviewDecisionStatusForOwner,
} from "@/lib/db";
import { executeFilingBatch, type FilingCandidate } from "@/lib/filing";
import {
  downloadDriveFile,
  listFilesInFolder,
  type GoogleDriveFile,
} from "@/lib/google-drive";
import { buildProcessingPreview, type PreviewItem } from "@/lib/processing-preview";
import {
  readPreviewSnapshot,
  restorePreviewItemsFromSnapshot,
  type PreviewSnapshot,
  writePreviewSnapshot,
} from "@/lib/preview-snapshot";
import { requireSession } from "@/lib/session";
import {
  getVerifiedActiveStorageConnectionForSession,
  storageConnectionHasWriteAccess,
} from "@/lib/storage-connections";

type ReadyItemsFilingMode = "auto" | "manual";

function normalizePreviewTab(value: FormDataEntryValue | null) {
  const tab = String(value ?? "all");
  return tab === "review" || tab === "ready" || tab === "filed" ? tab : "all";
}

function buildPreviewRedirect(tab: string, notice: string) {
  const params = new URLSearchParams();
  if (tab !== "all") {
    params.set("tab", tab);
  }
  params.set("notice", notice);
  return `/preview?${params.toString()}`;
}

function getApprovedClientFolder(
  item: PreviewItem,
  decision: ReturnType<typeof getReviewDecisionByOwnerAndFile>,
) {
  return (
    decision?.reviewedClientFolder ??
    item.resolvedHouseholdFolder ??
    item.suggestedHouseholdFolder
  );
}

function getApprovedTopLevelFolder(
  item: PreviewItem,
  decision: ReturnType<typeof getReviewDecisionByOwnerAndFile>,
) {
  return decision?.reviewedTopLevelFolder ?? item.proposedTopLevelFolder;
}

function getApprovedFilename(
  item: PreviewItem,
  decision: ReturnType<typeof getReviewDecisionByOwnerAndFile>,
) {
  return decision?.reviewedFilename ?? item.proposedFilename;
}

function getUniqueFormValues(formData: FormData, name: string) {
  return Array.from(
    new Set(
      formData
        .getAll(name)
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  );
}

function buildPreviewFilingCandidate(
  item: PreviewItem,
  decision: ReturnType<typeof getReviewDecisionByOwnerAndFile>,
): FilingCandidate {
  return {
    reviewDecisionId: decision?.id ?? null,
    fileId: item.id,
    sourceName: item.sourceName,
    sourceMimeType: item.mimeType,
    sourceModifiedTime: item.modifiedTime ?? null,
    sourceDriveSize: item.driveSize ?? null,
    downloadByteLength: item.downloadByteLength,
    downloadSha1: item.downloadSha1,
    parserVersion: item.debug.parserVersion,
    parserConflictSummary: item.parserConflictSummary,
    originalClientFolder:
      item.resolvedHouseholdFolder ?? item.suggestedHouseholdFolder,
    originalTopLevelFolder: item.proposedTopLevelFolder,
    originalFilename: item.sourceName,
    finalClientFolder: getApprovedClientFolder(item, decision),
    finalTopLevelFolder: getApprovedTopLevelFolder(item, decision),
    finalFilename: getApprovedFilename(item, decision),
    detectedDocumentType: item.detectedDocumentType,
    detectedDocumentSubtype: item.detectedDocumentSubtype,
    detectedClient: decision?.reviewedClientName ?? item.detectedClient ?? null,
    detectedClient2: decision?.reviewedClientName2 ?? item.detectedClient2 ?? null,
    detectedOwnershipType:
      decision?.reviewedOwnershipType ??
      decision?.originalOwnershipType ??
      item.ownershipType ??
      null,
    detectedAccountLast4: item.extractedAccountLast4,
    detectedAccountType: item.extractedAccountType,
    detectedCustodian: item.extractedCustodian,
    detectedTaxYear: item.extractedTaxYear,
    detectedDocumentDate: item.extractedDocumentDate,
    detectedIdType: item.extractedIdType,
    detectedEntityName: item.extractedEntityName,
    classifierConfidence: item.confidenceScore,
    classifierContentSource: item.contentSource,
    classifierReasons: item.reasons,
    classifierExcerpt: item.textExcerpt,
  };
}

async function removeFiledItemsFromSnapshot(input: {
  ownerEmail: string;
  snapshot: PreviewSnapshot | null;
  filedItemIds: string[];
  settingsSourceFolderName: string | null | undefined;
  settingsDestinationFolderName: string | null | undefined;
}) {
  const filedItemIds = new Set(input.filedItemIds);
  const remainingItems = restorePreviewItemsFromSnapshot(input.snapshot).filter(
    (item) => !filedItemIds.has(item.id),
  );

  if (!input.snapshot || remainingItems.length === input.snapshot.items.length) {
    return;
  }

  await writePreviewSnapshot({
    ownerEmail: input.ownerEmail,
    sourceFolder: input.snapshot.sourceFolder ?? input.settingsSourceFolderName ?? null,
    destinationRoot:
      input.snapshot.destinationRoot ?? input.settingsDestinationFolderName ?? null,
    reviewPosture: input.snapshot.reviewPosture,
    readyCount: remainingItems.filter((item) => item.status === "Ready to stage").length,
    reviewCount: remainingItems.filter((item) => item.status === "Needs review").length,
    items: remainingItems,
  });
}

export async function prepareReadyItemsFilingRedirect(
  mode: ReadyItemsFilingMode = "manual",
) {
  const session = await requireSession();
  const ownerEmail = session.user?.email;
  const activeConnection = await getVerifiedActiveStorageConnectionForSession(session);

  if (!ownerEmail || !activeConnection) {
    throw new Error("An active storage connection is required to file documents.");
  }

  if (!storageConnectionHasWriteAccess(activeConnection)) {
    return "/preview?notice=Reconnect+the+active+storage+connection+with+write+access+before+filing.";
  }

  const settings = getFirmSettingsByOwnerEmail(ownerEmail);
  const clientMemoryRules = getClientMemoryRulesByOwnerEmail(ownerEmail);
  if (!settings?.sourceFolderId || !settings.destinationFolderId) {
    return "/preview?notice=Complete+setup+before+filing+ready+items.";
  }

  let sourceFiles: GoogleDriveFile[] = [];
  try {
    sourceFiles = await listFilesInFolder(
      activeConnection.accessToken,
      settings.sourceFolderId,
    );
  } catch (error) {
    return `/preview?notice=${encodeURIComponent(
      error instanceof Error
        ? `Google Drive could not load the source folder: ${error.message}`
        : "Google Drive could not load the source folder.",
    )}`;
  }

  let destinationChildren: GoogleDriveFile[] = [];
  try {
    destinationChildren = await listFilesInFolder(
      activeConnection.accessToken,
      settings.destinationFolderId,
    );
  } catch (error) {
    return `/preview?notice=${encodeURIComponent(
      error instanceof Error
        ? `Google Drive could not load the destination root: ${error.message}`
        : "Google Drive could not load the destination root.",
    )}`;
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

  const readyItems = preview.items.filter((item) => item.status === "Ready to stage");

  if (!readyItems.length) {
    const tabSuffix =
      mode === "auto" && preview.reviewCount > 0 ? "&tab=review" : "";
    return `/preview?notice=There+are+no+ready-to-stage+items+to+file+right+now.${tabSuffix}`;
  }

  const result = await executeFilingBatch({
    accessToken: activeConnection.accessToken,
    ownerEmail,
    actorEmail: "System",
    actorType: "automation",
    initiatedByEmail: ownerEmail,
    settings,
    candidates: readyItems.map((item) => ({
      reviewDecisionId: null,
      fileId: item.id,
      sourceName: item.sourceName,
      sourceMimeType: item.mimeType,
      sourceModifiedTime: item.modifiedTime ?? null,
      sourceDriveSize: item.driveSize ?? null,
      downloadByteLength: item.downloadByteLength,
      downloadSha1: item.downloadSha1,
      parserVersion: item.debug.parserVersion,
      parserConflictSummary: item.parserConflictSummary,
      originalClientFolder: item.resolvedClientFolder,
      originalTopLevelFolder: item.proposedTopLevelFolder,
      originalFilename: item.proposedFilename,
      finalClientFolder: item.resolvedClientFolder,
      finalTopLevelFolder: item.proposedTopLevelFolder,
      finalFilename: item.proposedFilename,
      detectedDocumentType: item.detectedDocumentType,
      detectedClient: item.detectedClient,
      detectedClient2: item.detectedClient2,
      detectedOwnershipType: item.ownershipType,
      detectedAccountLast4: item.extractedAccountLast4,
      detectedAccountType: item.extractedAccountType,
      detectedCustodian: item.extractedCustodian,
      detectedTaxYear: item.extractedTaxYear,
      detectedDocumentDate: item.extractedDocumentDate,
      detectedIdType: item.extractedIdType,
      detectedEntityName: item.extractedEntityName,
      classifierConfidence: item.confidenceScore,
      classifierContentSource: item.contentSource,
      classifierReasons: item.reasons,
      classifierExcerpt: item.textExcerpt,
    })),
  });

  revalidatePath("/dashboard");
  revalidatePath("/history");
  revalidatePath("/preview");
  revalidatePath("/review");

  if (mode === "auto") {
    const tab = preview.reviewCount > 0 ? "review" : "filed";
    return `/preview?tab=${tab}&notice=${encodeURIComponent(
      `Auto-file moved ${result.succeededCount} high-confidence items and ${result.failedCount} failed.`,
    )}`;
  }

  return `/preview?notice=${encodeURIComponent(
    `Ready-item filing finished. ${result.succeededCount} succeeded and ${result.failedCount} failed.`,
  )}`;
}

export async function fileReadyItemsAction() {
  redirect(await prepareReadyItemsFilingRedirect("manual"));
}

export async function approvePreviewItemAction(formData: FormData) {
  const tab = normalizePreviewTab(formData.get("tab"));
  const fileId = String(formData.get("fileId") ?? "").trim();

  if (!fileId) {
    redirect(buildPreviewRedirect(tab, "Choose an intake item before approving."));
  }

  redirect(await approvePreviewItemsForIds({ tab, fileIds: [fileId] }));
}

export async function approveSelectedPreviewItemsAction(formData: FormData) {
  const tab = normalizePreviewTab(formData.get("tab"));
  const fileIds = getUniqueFormValues(formData, "fileId");

  if (fileIds.length === 0) {
    redirect(buildPreviewRedirect(tab, "Select one or more intake items to approve."));
  }

  redirect(await approvePreviewItemsForIds({ tab, fileIds }));
}

async function approvePreviewItemsForIds(input: {
  tab: string;
  fileIds: string[];
}) {
  const session = await requireSession();
  const ownerEmail = session.user?.email;
  const activeConnection = await getVerifiedActiveStorageConnectionForSession(session);

  if (!ownerEmail || !activeConnection) {
    return buildPreviewRedirect(
      input.tab,
      "Reconnect storage before approving files.",
    );
  }

  if (!storageConnectionHasWriteAccess(activeConnection)) {
    return buildPreviewRedirect(
      input.tab,
      "Reconnect the active storage connection with write access before approving.",
    );
  }

  const settings = getFirmSettingsByOwnerEmail(ownerEmail);
  if (!settings?.sourceFolderId || !settings.destinationFolderId) {
    return buildPreviewRedirect(input.tab, "Complete setup before approving files.");
  }

  const snapshot = await readPreviewSnapshot(ownerEmail);
  const requestedFileIds = new Set(input.fileIds);
  const selectedItems = restorePreviewItemsFromSnapshot(snapshot).filter((item) =>
    requestedFileIds.has(item.id),
  );

  if (selectedItems.length === 0) {
    return buildPreviewRedirect(
      input.tab,
      "Refresh the browser page before approving files. The cached queue no longer includes the selected items.",
    );
  }

  let succeededCount = 0;
  let failedCount = 0;
  const filedItemIds: string[] = [];
  const filedFilenames: string[] = [];

  for (const item of selectedItems) {
    const decision = getReviewDecisionByOwnerAndFile(ownerEmail, item.id);
    const finalFilename = getApprovedFilename(item, decision);
    const result = await executeFilingBatch({
      accessToken: activeConnection.accessToken,
      ownerEmail,
      actorEmail: ownerEmail,
      actorType: "user",
      initiatedByEmail: ownerEmail,
      settings,
      candidates: [buildPreviewFilingCandidate(item, decision)],
    });

    succeededCount += result.succeededCount;
    failedCount += result.failedCount;

    if (result.succeededCount > 0) {
      filedItemIds.push(item.id);
      filedFilenames.push(finalFilename ?? item.sourceName);

      if (decision) {
        setReviewDecisionStatusForOwner({
          ownerEmail,
          fileId: item.id,
          status: "filed",
        });
      }
    }
  }

  if (filedItemIds.length > 0) {
    await removeFiledItemsFromSnapshot({
      ownerEmail,
      snapshot,
      filedItemIds,
      settingsSourceFolderName: settings.sourceFolderName,
      settingsDestinationFolderName: settings.destinationFolderName,
    });
  }

  revalidatePath("/dashboard");
  revalidatePath("/history");
  revalidatePath("/preview");
  revalidatePath("/review");

  const notice =
    selectedItems.length === 1
      ? succeededCount > 0
        ? `Approved and filed ${filedFilenames[0]}.`
        : `Approval failed for ${selectedItems[0].sourceName}. Check Filing history for details.`
      : `Approved ${succeededCount} selected file${succeededCount === 1 ? "" : "s"}. ${failedCount} failed.`;

  return buildPreviewRedirect(input.tab, notice);
}
