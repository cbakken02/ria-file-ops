import "server-only";

import {
  getReviewDecisionByOwnerAndFile,
  setReviewDecisionStatusForOwner,
} from "@/lib/db";
import type { FileApprovalItem, FileApprovalResult } from "@/lib/file-approval";
import { approveFileItems } from "@/lib/file-approval";
import type { FilingCandidate } from "@/lib/filing";
import type { PreviewItem } from "@/lib/processing-preview";
import {
  removePreviewSnapshotItems,
  readPreviewSnapshot,
  restorePreviewItemsFromSnapshot,
} from "@/lib/preview-snapshot";

export type PreviewTab = "all" | "review" | "ready" | "filed";

export type IntakeApprovalResult = FileApprovalResult & {
  redirectPath: string;
};

export function normalizePreviewTab(value: FormDataEntryValue | null): PreviewTab {
  const tab = String(value ?? "all");
  return tab === "review" || tab === "ready" || tab === "filed" ? tab : "all";
}

export function buildPreviewRedirect(tab: string, notice: string) {
  const params = new URLSearchParams();
  if (tab !== "all") {
    params.set("tab", tab);
  }
  params.set("notice", notice);
  return `/intake?${params.toString()}`;
}

export function getUniqueFormValues(formData: FormData, name: string) {
  return Array.from(
    new Set(
      formData
        .getAll(name)
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  );
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

export async function approvePreviewItemsForIds(input: {
  tab: string;
  fileIds: string[];
}): Promise<IntakeApprovalResult> {
  const result = await approveFileItems({
    fileIds: input.fileIds,
    labels: {
      actionNoun: "Approval",
      authNotice: "Sign in before approving files.",
      noCandidatesNotice:
        "Refresh the browser page before approving files. The cached queue no longer includes the selected items.",
      settingsNotice: "Complete setup before approving files.",
      storageNotice: "Reconnect storage before approving files.",
      writeAccessNotice:
        "Reconnect the active storage connection with write access before approving.",
    },
    revalidatePaths: ["/dashboard", "/history", "/intake", "/review"],
    resolveItems: async ({ ownerEmail, requestedFileIds, settings }) => {
      const snapshot = await readPreviewSnapshot(ownerEmail);
      const requestedFileIdSet = new Set(requestedFileIds);
      const selectedItems = restorePreviewItemsFromSnapshot(snapshot).filter((item) =>
        requestedFileIdSet.has(item.id),
      );

      return selectedItems.map((item): FileApprovalItem => {
        const decision = getReviewDecisionByOwnerAndFile(ownerEmail, item.id);
        const finalFilename = getApprovedFilename(item, decision);

        return {
          candidate: buildPreviewFilingCandidate(item, decision),
          fileId: item.id,
          filedFilename: finalFilename ?? item.sourceName,
          onSuccess: async () => {
            if (decision) {
              setReviewDecisionStatusForOwner({
                ownerEmail,
                fileId: item.id,
                status: "filed",
              });
            }

            await removePreviewSnapshotItems({
              destinationRootFallback: settings.destinationFolderName,
              itemIds: [item.id],
              ownerEmail,
              sourceFolderFallback: settings.sourceFolderName,
            });
          },
          sourceName: item.sourceName,
        };
      });
    },
    validateSettings: (settings) =>
      !settings.sourceFolderId || !settings.destinationFolderId
        ? "Complete setup before approving files."
        : null,
  });

  const notice =
    input.fileIds.length === 1
      ? result.succeededCount > 0
        ? `Approved and filed ${result.filedFilenames[0]}.`
        : `Approval failed for ${result.failedItems[0]?.sourceName ?? "the selected file"}. Check Filing history for details.`
      : `Approved ${result.succeededCount} selected file${result.succeededCount === 1 ? "" : "s"}. ${result.failedCount} failed.`;

  return {
    ...result,
    notice,
    redirectPath: buildPreviewRedirect(input.tab, notice),
  };
}
