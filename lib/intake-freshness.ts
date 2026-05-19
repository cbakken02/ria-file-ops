import type { StorageConnection } from "@/lib/db";
import {
  getGoogleDriveAccessErrorStatus,
  type GoogleDriveFile,
} from "@/lib/google-drive";
import type { PreviewSnapshot, PreviewSnapshotItem } from "@/lib/preview-snapshot";
import { markStorageConnectionNeedsReauth } from "@/lib/storage-connections";
import {
  getStorageProviderAdapterForConnection,
  UnsupportedStorageProviderError,
} from "@/lib/storage/provider-registry";

const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

export type IntakeFreshnessCounts = {
  changedFileCount: number;
  liveFileCount: number;
  newFileCount: number;
  removedFileCount: number;
  savedFileCount: number;
  unprocessedFileCount: number;
};

export type IntakeFreshnessResult =
  | (IntakeFreshnessCounts & {
      checkedAt: string;
      status: "current";
    })
  | (IntakeFreshnessCounts & {
      checkedAt: string;
      status: "stale";
    })
  | {
      checkedAt: string | null;
      reason:
        | "metadata_check_failed"
        | "no_active_connection"
        | "no_source_folder"
        | "storage_auth_failed"
        | "unsupported_provider";
      status: "not_checked";
    };

type CheckIntakeSourceFreshnessDependencies = {
  listFolder?: (input: {
    connection: StorageConnection;
    folderId: string;
  }) => Promise<GoogleDriveFile[]>;
  markNeedsReauth?: typeof markStorageConnectionNeedsReauth;
  now?: () => Date;
};

export async function checkIntakeSourceFreshness(input: {
  connection: StorageConnection | null;
  deps?: CheckIntakeSourceFreshnessDependencies;
  snapshot: PreviewSnapshot | null;
  sourceFolderId: string | null | undefined;
}): Promise<IntakeFreshnessResult> {
  const checkedAt = (input.deps?.now ?? (() => new Date()))().toISOString();
  const sourceFolderId = input.sourceFolderId?.trim();

  if (!sourceFolderId) {
    return {
      checkedAt: null,
      reason: "no_source_folder",
      status: "not_checked",
    };
  }

  if (!input.connection || input.connection.status !== "connected") {
    return {
      checkedAt: null,
      reason: "no_active_connection",
      status: "not_checked",
    };
  }

  try {
    const liveFiles = await listSourceFolderMetadata({
      connection: input.connection,
      deps: input.deps,
      sourceFolderId,
    });

    return {
      ...compareIntakeSourceFreshness({
        liveFiles,
        snapshot: input.snapshot,
      }),
      checkedAt,
    };
  } catch (error) {
    if (error instanceof UnsupportedStorageProviderError) {
      return {
        checkedAt,
        reason: "unsupported_provider",
        status: "not_checked",
      };
    }

    if (getGoogleDriveAccessErrorStatus(error) === 401) {
      await (input.deps?.markNeedsReauth ?? markStorageConnectionNeedsReauth)(
        input.connection,
      );

      return {
        checkedAt,
        reason: "storage_auth_failed",
        status: "not_checked",
      };
    }

    return {
      checkedAt,
      reason: "metadata_check_failed",
      status: "not_checked",
    };
  }
}

export function compareIntakeSourceFreshness(input: {
  liveFiles: GoogleDriveFile[];
  snapshot: PreviewSnapshot | null;
}): IntakeFreshnessCounts & { status: "current" | "stale" } {
  const liveFileMap = new Map(
    input.liveFiles
      .filter(isCandidateSourceFile)
      .map((file) => [file.id, normalizeLiveFile(file)]),
  );
  const savedFileMap = new Map(
    (input.snapshot?.items ?? [])
      .filter(isCandidateSnapshotItem)
      .map((item) => [item.id, normalizeSnapshotItem(item)]),
  );

  let newFileCount = 0;
  let changedFileCount = 0;
  let removedFileCount = 0;

  for (const [fileId, liveFile] of liveFileMap) {
    const savedFile = savedFileMap.get(fileId);
    if (!savedFile) {
      newFileCount += 1;
      continue;
    }

    if (hasFileMetadataChanged(savedFile, liveFile)) {
      changedFileCount += 1;
    }
  }

  for (const fileId of savedFileMap.keys()) {
    if (!liveFileMap.has(fileId)) {
      removedFileCount += 1;
    }
  }

  const unprocessedFileCount = newFileCount + changedFileCount;
  const status =
    newFileCount > 0 || changedFileCount > 0 || removedFileCount > 0
      ? "stale"
      : "current";

  return {
    changedFileCount,
    liveFileCount: liveFileMap.size,
    newFileCount,
    removedFileCount,
    savedFileCount: savedFileMap.size,
    status,
    unprocessedFileCount,
  };
}

async function listSourceFolderMetadata(input: {
  connection: StorageConnection;
  deps?: CheckIntakeSourceFreshnessDependencies;
  sourceFolderId: string;
}) {
  if (input.deps?.listFolder) {
    return input.deps.listFolder({
      connection: input.connection,
      folderId: input.sourceFolderId,
    });
  }

  const storageProvider = getStorageProviderAdapterForConnection(input.connection);
  return storageProvider.listFolder({
    connection: input.connection,
    folderId: input.sourceFolderId,
  });
}

function isCandidateSourceFile(file: GoogleDriveFile) {
  return Boolean(file.id) && file.mimeType !== DRIVE_FOLDER_MIME_TYPE;
}

function isCandidateSnapshotItem(item: PreviewSnapshotItem) {
  return Boolean(item.id) && item.mimeType !== DRIVE_FOLDER_MIME_TYPE;
}

function normalizeLiveFile(file: GoogleDriveFile) {
  return {
    id: file.id,
    mimeType: normalizeMetadataValue(file.mimeType),
    modifiedTime: normalizeMetadataValue(file.modifiedTime),
    name: normalizeMetadataValue(file.name),
    size: normalizeMetadataValue(file.size),
  };
}

function normalizeSnapshotItem(item: PreviewSnapshotItem) {
  return {
    id: item.id,
    mimeType: normalizeMetadataValue(item.mimeType),
    modifiedTime: normalizeMetadataValue(item.modifiedTime),
    name: normalizeMetadataValue(item.sourceName),
    size: normalizeMetadataValue(item.driveSize),
  };
}

function hasFileMetadataChanged(
  savedFile: ReturnType<typeof normalizeSnapshotItem>,
  liveFile: ReturnType<typeof normalizeLiveFile>,
) {
  return (
    savedFile.name !== liveFile.name ||
    savedFile.mimeType !== liveFile.mimeType ||
    savedFile.modifiedTime !== liveFile.modifiedTime ||
    savedFile.size !== liveFile.size
  );
}

function normalizeMetadataValue(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
