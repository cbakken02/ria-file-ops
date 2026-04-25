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
import { clearPreviewAnalysisCacheForOwner } from "@/lib/preview-analysis-cache";
import { buildProcessingPreview } from "@/lib/processing-preview";
import { writePreviewSnapshot } from "@/lib/preview-snapshot";
import { requireSession } from "@/lib/session";
import {
  getVerifiedActiveStorageConnectionForSession,
  storageConnectionHasWriteAccess,
} from "@/lib/storage-connections";

type ReadyItemsFilingMode = "auto" | "manual";

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
      `Auto-file rule moved ${result.succeededCount} high-confidence items and ${result.failedCount} failed.`,
    )}`;
  }

  return `/preview?notice=${encodeURIComponent(
    `Ready-item filing finished. ${result.succeededCount} succeeded and ${result.failedCount} failed.`,
  )}`;
}

export async function fileReadyItemsAction() {
  redirect(await prepareReadyItemsFilingRedirect("manual"));
}

export async function refreshIntakeAction(formData: FormData) {
  const requestedTab = String(formData.get("tab") ?? "all");
  const tab =
    requestedTab === "review" ||
    requestedTab === "ready" ||
    requestedTab === "filed"
      ? requestedTab
      : "all";
  const tabQuery = tab === "all" ? "" : `?tab=${tab}`;
  const session = await requireSession();
  const ownerEmail = session.user?.email;
  const activeConnection = await getVerifiedActiveStorageConnectionForSession(session);

  if (!ownerEmail || !activeConnection) {
    redirect(
      `/preview${tabQuery ? `${tabQuery}&` : "?"}notice=${encodeURIComponent(
        "Reconnect storage before refreshing Intake.",
      )}`,
    );
  }

  const settings = getFirmSettingsByOwnerEmail(ownerEmail);
  if (!settings?.sourceFolderId) {
    redirect(
      `/preview${tabQuery ? `${tabQuery}&` : "?"}notice=${encodeURIComponent(
        "Choose an intake source folder before refreshing Intake.",
      )}`,
    );
  }

  const clientMemoryRules = getClientMemoryRulesByOwnerEmail(ownerEmail);
  let sourceFiles: GoogleDriveFile[] = [];
  try {
    sourceFiles = await listFilesInFolder(
      activeConnection.accessToken,
      settings.sourceFolderId,
    );
  } catch (error) {
    redirect(
      `/preview${tabQuery ? `${tabQuery}&` : "?"}notice=${encodeURIComponent(
        error instanceof Error
          ? `Google Drive could not load the source folder: ${error.message}`
          : "Google Drive could not load the source folder.",
      )}`,
    );
  }

  let destinationChildren: GoogleDriveFile[] = [];
  if (settings.destinationFolderId) {
    try {
      destinationChildren = await listFilesInFolder(
        activeConnection.accessToken,
        settings.destinationFolderId,
      );
    } catch (error) {
      redirect(
        `/preview${tabQuery ? `${tabQuery}&` : "?"}notice=${encodeURIComponent(
          error instanceof Error
            ? `Google Drive could not load the destination root: ${error.message}`
            : "Google Drive could not load the destination root.",
        )}`,
      );
    }
  }

  const existingClientFolders = destinationChildren
    .filter((file) => file.mimeType === "application/vnd.google-apps.folder")
    .map((file) => file.name);

  await clearPreviewAnalysisCacheForOwner(ownerEmail);
  const preview = await buildProcessingPreview(
    sourceFiles,
    settings,
    async (fileId) => downloadDriveFile(activeConnection.accessToken, fileId),
    existingClientFolders,
    clientMemoryRules,
    { analysisMode: "preview" },
  );

  await writePreviewSnapshot({
    ownerEmail,
    sourceFolder: settings.sourceFolderName ?? null,
    destinationRoot: settings.destinationFolderName ?? null,
    reviewPosture: preview.reviewRule.title,
    readyCount: preview.readyCount,
    reviewCount: preview.reviewCount,
    items: preview.items,
  });

  revalidatePath("/preview");
  const refreshedAt = new Intl.DateTimeFormat("en-US", {
    timeStyle: "short",
  }).format(new Date());

  redirect(
    `/preview${tabQuery ? `${tabQuery}&` : "?"}notice=${encodeURIComponent(
      `Intake refreshed at ${refreshedAt}. ${preview.items.length} files checked.`,
    )}`,
  );
}
