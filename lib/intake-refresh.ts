import type { Session } from "next-auth";
import {
  getClientMemoryRulesByOwnerEmail,
  getFirmSettingsByOwnerEmail,
  type ClientMemoryRule,
  type FirmSettings,
} from "@/lib/db";
import {
  downloadDriveFile as downloadGoogleDriveFile,
  formatGoogleDriveFolderAccessError,
  getDriveFileMetadata as getGoogleDriveFileMetadata,
  getGoogleDriveAccessErrorStatus,
  listFilesInFolder as listGoogleDriveFilesInFolder,
  type GoogleDriveFile,
} from "@/lib/google-drive";
import {
  buildProcessingPreview as buildProcessingPreviewQueue,
  type PreviewItem,
} from "@/lib/processing-preview";
import {
  clearPreviewAnalysisCacheForOwner as clearPreviewAnalysisCacheForOwnerDefault,
} from "@/lib/preview-analysis-cache";
import {
  clearPreviewSnapshotForOwner as clearPreviewSnapshotForOwnerDefault,
  writePreviewSnapshot as writePreviewQueueSnapshot,
} from "@/lib/preview-snapshot";
import {
  markStorageConnectionNeedsReauth,
  resolveActiveStorageAuthorizationForSession,
} from "@/lib/storage-connections";

type RefreshIntakeQueueDependencies = {
  buildProcessingPreview?: typeof buildProcessingPreviewQueue;
  clearPreviewAnalysisCacheForOwner?: typeof clearPreviewAnalysisCacheForOwnerDefault;
  clearPreviewSnapshotForOwner?: typeof clearPreviewSnapshotForOwnerDefault;
  downloadDriveFile?: typeof downloadGoogleDriveFile;
  getDriveFileMetadata?: typeof getGoogleDriveFileMetadata;
  listFilesInFolder?: typeof listGoogleDriveFilesInFolder;
  writePreviewSnapshot?: typeof writePreviewQueueSnapshot;
};

type RefreshIntakeQueueForSessionOptions = {
  deps?: RefreshIntakeQueueDependencies;
  forceFresh?: boolean;
};

export class IntakeRefreshError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "IntakeRefreshError";
    this.status = status;
  }
}

export async function refreshIntakeQueueForSession(
  session: Session,
  options: RefreshIntakeQueueForSessionOptions = {},
) {
  const storageAuthorization = await resolveActiveStorageAuthorizationForSession(
    session,
    {
      reconnectMessage:
        "Reconnect the active storage connection before rescanning Intake.",
      signInMessage: "Sign in before refreshing Intake.",
    },
  );

  if (!storageAuthorization.ok) {
    throw new IntakeRefreshError(
      storageAuthorization.error,
      storageAuthorization.status,
    );
  }

  const { connection: activeConnection, ownerEmail } = storageAuthorization;
  const settings = getFirmSettingsByOwnerEmail(ownerEmail);
  if (!settings?.sourceFolderId) {
    throw new IntakeRefreshError(
      "Choose an intake source folder before refreshing Intake.",
      400,
    );
  }

  try {
    return await refreshIntakeQueue({
      accessToken: activeConnection.accessToken,
      clientMemoryRules: getClientMemoryRulesByOwnerEmail(ownerEmail),
      deps: options.deps,
      forceFresh: options.forceFresh,
      ownerEmail,
      settings,
    });
  } catch (error) {
    if (error instanceof IntakeRefreshError && error.status === 401) {
      markStorageConnectionNeedsReauth(activeConnection);
    }

    throw error;
  }
}

export async function refreshIntakeQueue(input: {
  accessToken: string;
  clientMemoryRules: ClientMemoryRule[];
  deps?: RefreshIntakeQueueDependencies;
  forceFresh?: boolean;
  ownerEmail: string;
  settings: FirmSettings;
}) {
  const clearPreviewAnalysisCacheForOwner =
    input.deps?.clearPreviewAnalysisCacheForOwner ??
    clearPreviewAnalysisCacheForOwnerDefault;
  const clearPreviewSnapshotForOwner =
    input.deps?.clearPreviewSnapshotForOwner ?? clearPreviewSnapshotForOwnerDefault;
  const getDriveFileMetadata =
    input.deps?.getDriveFileMetadata ?? getGoogleDriveFileMetadata;
  const listFilesInFolder =
    input.deps?.listFilesInFolder ?? listGoogleDriveFilesInFolder;
  const downloadDriveFile =
    input.deps?.downloadDriveFile ?? downloadGoogleDriveFile;
  const buildProcessingPreview =
    input.deps?.buildProcessingPreview ?? buildProcessingPreviewQueue;
  const writePreviewSnapshot =
    input.deps?.writePreviewSnapshot ?? writePreviewQueueSnapshot;

  if (!input.settings.sourceFolderId) {
    throw new IntakeRefreshError(
      "Choose an intake source folder before refreshing Intake.",
      400,
    );
  }

  if (input.forceFresh) {
    await Promise.all([
      clearPreviewAnalysisCacheForOwner(input.ownerEmail),
      clearPreviewSnapshotForOwner(input.ownerEmail),
    ]);
  }

  const sourceFolder = await loadDriveFolderMetadata({
    accessToken: input.accessToken,
    folderId: input.settings.sourceFolderId,
    getDriveFileMetadata,
    purpose: "source folder",
  });
  const sourceFiles = await loadDriveFolderFiles({
    accessToken: input.accessToken,
    folderId: input.settings.sourceFolderId,
    listFilesInFolder,
    purpose: "source folder",
  });

  const destinationFolder = input.settings.destinationFolderId
    ? await loadDriveFolderMetadata({
        accessToken: input.accessToken,
        folderId: input.settings.destinationFolderId,
        getDriveFileMetadata,
        purpose: "destination root",
      })
    : null;
  const destinationChildren =
    input.settings.destinationFolderId && destinationFolder
      ? await loadDriveFolderFiles({
          accessToken: input.accessToken,
          folderId: input.settings.destinationFolderId,
          listFilesInFolder,
          purpose: "destination root",
        })
      : [];

  const existingClientFolders = destinationChildren
    .filter((file) => file.mimeType === "application/vnd.google-apps.folder")
    .map((file) => file.name);

  const preview = await buildProcessingPreview(
    sourceFiles,
    input.settings,
    async (fileId) => downloadDriveFile(input.accessToken, fileId),
    existingClientFolders,
    input.clientMemoryRules,
    {
      analysisMode: "preview",
      forceFreshAnalysis: input.forceFresh ?? false,
    },
  );

  await writePreviewSnapshot({
    ownerEmail: input.ownerEmail,
    sourceFolder: sourceFolder.name,
    destinationRoot: destinationFolder?.name ?? input.settings.destinationFolderName ?? null,
    reviewPosture: preview.reviewRule.title,
    readyCount: preview.readyCount,
    reviewCount: preview.reviewCount,
    items: preview.items as PreviewItem[],
  });

  return {
    generatedAt: new Date().toISOString(),
    itemCount: preview.items.length,
    readyCount: preview.readyCount,
    reviewCount: preview.reviewCount,
    sourceFileCount: sourceFiles.filter(
      (file) => file.mimeType !== "application/vnd.google-apps.folder",
    ).length,
    sourceFolder: {
      id: sourceFolder.id,
      name: sourceFolder.name,
    },
  };
}

async function loadDriveFolderMetadata(input: {
  accessToken: string;
  folderId: string;
  getDriveFileMetadata: typeof getGoogleDriveFileMetadata;
  purpose: "destination root" | "source folder";
}) {
  let folder: GoogleDriveFile;

  try {
    folder = await input.getDriveFileMetadata(input.accessToken, input.folderId);
  } catch (error) {
    throw new IntakeRefreshError(
      formatGoogleDriveFolderAccessError(error, input.purpose),
      getGoogleDriveAccessErrorStatus(error),
    );
  }

  if (folder.mimeType !== "application/vnd.google-apps.folder") {
    throw new IntakeRefreshError(
      `Google Drive could not load the ${input.purpose}: the selected item is not a folder.`,
      400,
    );
  }

  return folder;
}

async function loadDriveFolderFiles(input: {
  accessToken: string;
  folderId: string;
  listFilesInFolder: typeof listGoogleDriveFilesInFolder;
  purpose: "destination root" | "source folder";
}) {
  try {
    return await input.listFilesInFolder(input.accessToken, input.folderId);
  } catch (error) {
    throw new IntakeRefreshError(
      formatGoogleDriveFolderAccessError(error, input.purpose),
      getGoogleDriveAccessErrorStatus(error),
    );
  }
}
