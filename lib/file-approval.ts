import "server-only";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  getApiPrincipalFromSession,
  getLegacyOwnerEmail,
} from "@/lib/auth/principal";
import {
  getFirmSettingsByOwnerEmail,
  type FirmSettings,
  type StorageConnection,
} from "@/lib/db";
import {
  executeFilingBatch,
  type FilingCandidate,
  type FilingCandidateSuccess,
} from "@/lib/filing";
import {
  getVerifiedActiveStorageConnectionForSession,
  storageConnectionHasWriteAccess,
} from "@/lib/storage-connections";

export type FileApprovalFailedItem = {
  fileId: string;
  sourceName: string;
  errorMessage: string;
};

export type FileApprovalResult = {
  failedCount: number;
  failedItems: FileApprovalFailedItem[];
  filedFilenames: string[];
  filedItemIds: string[];
  notice: string;
  requestedCount: number;
  statusCode: number;
  succeededCount: number;
};

export type FileApprovalContext = {
  activeConnection: StorageConnection;
  ownerEmail: string;
  requestedFileIds: string[];
  settings: FirmSettings;
};

export type FileApprovalItem = {
  alreadyComplete?: boolean;
  candidate?: FilingCandidate | null;
  errorMessage?: string | null;
  fileId: string;
  filedFilename?: string | null;
  onSuccess?: (success: FilingCandidateSuccess) => Promise<void> | void;
  sourceName: string;
};

export class FileApprovalUserError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "FileApprovalUserError";
    this.statusCode = statusCode;
  }
}

export async function approveFileItems(input: {
  fileIds: string[];
  labels: {
    actionNoun: string;
    authNotice: string;
    noCandidatesNotice: string;
    settingsNotice: string;
    storageNotice: string;
    writeAccessNotice: string;
  };
  revalidatePaths?: string[];
  resolveItems: (context: FileApprovalContext) => Promise<FileApprovalItem[]> | FileApprovalItem[];
  validateSettings?: (settings: FirmSettings) => string | null;
}): Promise<FileApprovalResult> {
  const requestedFileIds = Array.from(new Set(input.fileIds.filter(Boolean)));
  const requestedCount = requestedFileIds.length;
  const session = await auth();
  const principalResult = await getApiPrincipalFromSession(session);

  if (!principalResult.ok || !session) {
    return buildFileApprovalResult({
      notice: input.labels.authNotice,
      requestedCount,
      statusCode: 401,
    });
  }

  const ownerEmail = getLegacyOwnerEmail(principalResult.principal);
  const activeConnection = await getVerifiedActiveStorageConnectionForSession(session);

  if (!activeConnection) {
    return buildFileApprovalResult({
      notice: input.labels.storageNotice,
      requestedCount,
      statusCode: 401,
    });
  }

  if (!storageConnectionHasWriteAccess(activeConnection)) {
    return buildFileApprovalResult({
      notice: input.labels.writeAccessNotice,
      requestedCount,
      statusCode: 400,
    });
  }

  const settings = getFirmSettingsByOwnerEmail(ownerEmail);
  if (!settings) {
    return buildFileApprovalResult({
      notice: input.labels.settingsNotice,
      requestedCount,
      statusCode: 400,
    });
  }

  const settingsError = input.validateSettings?.(settings);
  if (settingsError) {
    return buildFileApprovalResult({
      notice: settingsError,
      requestedCount,
      statusCode: 400,
    });
  }

  let approvalItems: FileApprovalItem[];
  try {
    approvalItems = await input.resolveItems({
      activeConnection,
      ownerEmail,
      requestedFileIds,
      settings,
    });
  } catch (error) {
    if (error instanceof FileApprovalUserError) {
      return buildFileApprovalResult({
        failedCount: requestedCount,
        failedItems: requestedFileIds.map((fileId) => ({
          errorMessage: error.message,
          fileId,
          sourceName: fileId,
        })),
        notice: error.message,
        requestedCount,
        statusCode: error.statusCode,
      });
    }

    throw error;
  }

  if (approvalItems.length === 0) {
    return buildFileApprovalResult({
      notice: input.labels.noCandidatesNotice,
      requestedCount,
      statusCode: 400,
    });
  }

  const failedItems: FileApprovalFailedItem[] = [];
  const filedFilenames: string[] = [];
  const filedItemIds: string[] = [];
  let failedCount = 0;
  let succeededCount = 0;

  for (const item of approvalItems) {
    if (item.errorMessage) {
      failedCount += 1;
      failedItems.push({
        errorMessage: item.errorMessage,
        fileId: item.fileId,
        sourceName: item.sourceName,
      });
      continue;
    }

    if (item.alreadyComplete) {
      succeededCount += 1;
      filedItemIds.push(item.fileId);
      filedFilenames.push(item.filedFilename ?? item.sourceName);
      continue;
    }

    if (!item.candidate) {
      failedCount += 1;
      failedItems.push({
        errorMessage: `${input.labels.actionNoun} is not ready for this file.`,
        fileId: item.fileId,
        sourceName: item.sourceName,
      });
      continue;
    }

    try {
      const result = await executeFilingBatch({
        accessToken: activeConnection.accessToken,
        actorEmail: ownerEmail,
        actorType: "user",
        candidates: [item.candidate],
        initiatedByEmail: ownerEmail,
        ownerEmail,
        settings,
      });
      const success = result.successfulFiles.find(
        (file) => file.fileId === item.fileId,
      );

      failedCount += result.failedCount;

      if (success) {
        succeededCount += 1;
        filedItemIds.push(item.fileId);
        filedFilenames.push(
          item.filedFilename ?? success.finalFilename ?? item.sourceName,
        );
        try {
          await item.onSuccess?.(success);
        } catch (error) {
          console.warn("[file-approval] post-success update failed", {
            errorMessage:
              error instanceof Error
                ? error.message
                : "Unknown post-success update error.",
            fileId: item.fileId,
            sourceName: item.sourceName,
          });
        }
      } else {
        failedItems.push({
          errorMessage: "The file could not be moved or renamed.",
          fileId: item.fileId,
          sourceName: item.sourceName,
        });
      }
    } catch (error) {
      failedCount += 1;
      const errorMessage =
        error instanceof Error
          ? error.message
          : "The file could not be moved or renamed.";
      failedItems.push({
        errorMessage,
        fileId: item.fileId,
        sourceName: item.sourceName,
      });
      console.error("[file-approval] filing failed", {
        errorMessage,
        fileId: item.fileId,
        sourceName: item.sourceName,
      });
    }
  }

  const notice =
    approvalItems.length === 1
      ? succeededCount > 0
        ? `${input.labels.actionNoun} finished for ${filedFilenames[0]}.`
        : `${input.labels.actionNoun} failed for ${approvalItems[0]?.sourceName ?? "the selected file"}.`
      : `${input.labels.actionNoun} finished. ${succeededCount} succeeded and ${failedCount} failed.`;

  for (const path of input.revalidatePaths ?? []) {
    revalidatePath(path);
  }

  return buildFileApprovalResult({
    failedCount,
    failedItems,
    filedFilenames,
    filedItemIds,
    notice,
    requestedCount,
    statusCode: succeededCount > 0 ? 200 : 400,
    succeededCount,
  });
}

export function buildFileApprovalResult(input: {
  failedCount?: number;
  failedItems?: FileApprovalFailedItem[];
  filedFilenames?: string[];
  filedItemIds?: string[];
  notice: string;
  requestedCount?: number;
  statusCode?: number;
  succeededCount?: number;
}): FileApprovalResult {
  return {
    failedCount: input.failedCount ?? 0,
    failedItems: input.failedItems ?? [],
    filedFilenames: input.filedFilenames ?? [],
    filedItemIds: input.filedItemIds ?? [],
    notice: input.notice,
    requestedCount: input.requestedCount ?? 0,
    statusCode: input.statusCode ?? 200,
    succeededCount: input.succeededCount ?? 0,
  };
}
