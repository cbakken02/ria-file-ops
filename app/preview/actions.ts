"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  getClientMemoryRulesByOwnerEmail,
  getFirmSettingsByOwnerEmail,
} from "@/lib/db";
import { executeFilingBatch } from "@/lib/filing";
import {
  downloadDriveFile,
  listFilesInFolder,
  type GoogleDriveFile,
} from "@/lib/google-drive";
import {
  approvePreviewItemsForIds,
  buildPreviewRedirect,
  getUniqueFormValues,
  normalizePreviewTab,
} from "@/lib/intake-approval";
import { buildProcessingPreview } from "@/lib/processing-preview";
import { requireSession } from "@/lib/session";
import {
  getVerifiedActiveStorageConnectionForSession,
  storageConnectionHasWriteAccess,
} from "@/lib/storage-connections";
import {
  IntakeRefreshError,
  refreshIntakeQueueForSession,
} from "@/lib/intake-refresh";

type ReadyItemsFilingMode = "auto" | "manual";

export async function refreshIntakeAction(formData: FormData) {
  const tab = normalizePreviewTab(formData.get("tab"));
  const session = await requireSession();
  let redirectPath: string;

  try {
    const result = await refreshIntakeQueueForSession(session, {
      forceFresh: true,
    });

    redirectPath = buildIntakeRescanRedirect(
      tab,
      "success",
      `Source folder rescan finished. Scanned ${result.sourceFileCount} source file${result.sourceFileCount === 1 ? "" : "s"} and rebuilt ${result.itemCount} intake item${result.itemCount === 1 ? "" : "s"} (${result.readyCount} ready, ${result.reviewCount} needs review).`,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Intake could not rescan the source folder.";
    const status =
      error instanceof IntakeRefreshError ? error.status : 500;

    redirectPath = buildIntakeRescanRedirect(
      tab,
      "error",
      status === 401
        ? message || "Reconnect Google Drive before rescanning Intake."
        : message,
    );
  }

  revalidatePath("/dashboard");
  revalidatePath("/intake");
  revalidatePath("/preview");
  revalidatePath("/review");
  redirect(redirectPath);
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
    return "/intake?notice=Reconnect+the+active+storage+connection+with+write+access+before+filing.";
  }

  const settings = getFirmSettingsByOwnerEmail(ownerEmail);
  const clientMemoryRules = getClientMemoryRulesByOwnerEmail(ownerEmail);
  if (!settings?.sourceFolderId || !settings.destinationFolderId) {
    return "/intake?notice=Complete+setup+before+filing+ready+items.";
  }

  let sourceFiles: GoogleDriveFile[] = [];
  try {
    sourceFiles = await listFilesInFolder(
      activeConnection.accessToken,
      settings.sourceFolderId,
    );
  } catch (error) {
    return `/intake?notice=${encodeURIComponent(
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
    return `/intake?notice=${encodeURIComponent(
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
    return `/intake?notice=There+are+no+ready-to-stage+items+to+file+right+now.${tabSuffix}`;
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
  revalidatePath("/intake");
  revalidatePath("/review");

  if (mode === "auto") {
    const tab = preview.reviewCount > 0 ? "review" : "filed";
    return `/intake?tab=${tab}&notice=${encodeURIComponent(
      `Auto-file moved ${result.succeededCount} high-confidence items and ${result.failedCount} failed.`,
    )}`;
  }

  return `/intake?notice=${encodeURIComponent(
    `Ready-item filing finished. ${result.succeededCount} succeeded and ${result.failedCount} failed.`,
  )}`;
}

function buildIntakeRescanRedirect(
  tab: ReturnType<typeof normalizePreviewTab>,
  scanStatus: "error" | "success",
  notice: string,
) {
  const params = new URLSearchParams();
  if (tab !== "all") {
    params.set("tab", tab);
  }

  params.set("scanStatus", scanStatus);
  params.set("notice", notice);

  return `/intake?${params.toString()}`;
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

  const result = await approvePreviewItemsForIds({ tab, fileIds: [fileId] });
  redirect(result.redirectPath);
}

export async function approveSelectedPreviewItemsAction(formData: FormData) {
  const tab = normalizePreviewTab(formData.get("tab"));
  const fileIds = getUniqueFormValues(formData, "fileId");

  if (fileIds.length === 0) {
    redirect(buildPreviewRedirect(tab, "Select one or more intake items to approve."));
  }

  const result = await approvePreviewItemsForIds({ tab, fileIds });
  redirect(result.redirectPath);
}
