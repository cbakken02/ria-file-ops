import type { Session } from "next-auth";
import {
  getClientMemoryRulesByOwnerEmail,
  getFirmSettingsByOwnerEmail,
  type ClientMemoryRule,
  type FirmSettings,
} from "@/lib/db";
import {
  downloadDriveFile as downloadGoogleDriveFile,
  listFilesInFolder as listGoogleDriveFilesInFolder,
} from "@/lib/google-drive";
import {
  buildProcessingPreview as buildProcessingPreviewQueue,
  type PreviewItem,
} from "@/lib/processing-preview";
import { writePreviewSnapshot as writePreviewQueueSnapshot } from "@/lib/preview-snapshot";
import { getVerifiedActiveStorageConnectionForSession } from "@/lib/storage-connections";

type RefreshIntakeQueueDependencies = {
  buildProcessingPreview?: typeof buildProcessingPreviewQueue;
  downloadDriveFile?: typeof downloadGoogleDriveFile;
  listFilesInFolder?: typeof listGoogleDriveFilesInFolder;
  writePreviewSnapshot?: typeof writePreviewQueueSnapshot;
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
  deps?: RefreshIntakeQueueDependencies,
) {
  const ownerEmail = session.user?.email ?? null;
  if (!ownerEmail) {
    throw new IntakeRefreshError("Sign in before refreshing Intake.", 401);
  }

  const activeConnection = await getVerifiedActiveStorageConnectionForSession(session);
  if (!activeConnection) {
    throw new IntakeRefreshError(
      "Reconnect storage before refreshing Intake.",
      401,
    );
  }

  const settings = getFirmSettingsByOwnerEmail(ownerEmail);
  if (!settings?.sourceFolderId) {
    throw new IntakeRefreshError(
      "Choose an intake source folder before refreshing Intake.",
      400,
    );
  }

  return refreshIntakeQueue({
    accessToken: activeConnection.accessToken,
    clientMemoryRules: getClientMemoryRulesByOwnerEmail(ownerEmail),
    deps,
    ownerEmail,
    settings,
  });
}

export async function refreshIntakeQueue(input: {
  accessToken: string;
  clientMemoryRules: ClientMemoryRule[];
  deps?: RefreshIntakeQueueDependencies;
  ownerEmail: string;
  settings: FirmSettings;
}) {
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

  const sourceFiles = await loadDriveFolderFiles({
    accessToken: input.accessToken,
    folderId: input.settings.sourceFolderId,
    listFilesInFolder,
    purpose: "source folder",
  });

  const destinationChildren = input.settings.destinationFolderId
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
    { analysisMode: "preview" },
  );

  await writePreviewSnapshot({
    ownerEmail: input.ownerEmail,
    sourceFolder: input.settings.sourceFolderName ?? null,
    destinationRoot: input.settings.destinationFolderName ?? null,
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
  };
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
      error instanceof Error
        ? `Google Drive could not load the ${input.purpose}: ${error.message}`
        : `Google Drive could not load the ${input.purpose}.`,
      502,
    );
  }
}
