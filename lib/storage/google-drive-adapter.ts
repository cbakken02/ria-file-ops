import {
  downloadDriveFile,
  ensureDriveFolder,
  getDriveFileMetadata,
  listDriveFolders,
  listFilesInFolder,
  moveAndRenameDriveFile,
  verifyDriveBrowserAccess,
} from "@/lib/google-drive";
import type { StorageProviderAdapter } from "@/lib/storage/provider-types";

export const googleDriveStorageProviderAdapter = {
  id: "google_drive",
  displayName: "Google Drive",
  capabilities: {
    canCreateFolder: true,
    canDownloadFile: true,
    canListFolder: true,
    canMoveFile: true,
    canRenameFile: true,
    canRefreshCredentials: true,
  },
  async healthCheck({ connection }) {
    await verifyDriveBrowserAccess(connection.accessToken);
  },
  async listFolders({ connection }) {
    return listDriveFolders(connection.accessToken);
  },
  async listFolder({ connection, folderId }) {
    return listFilesInFolder(connection.accessToken, folderId);
  },
  async getFileMetadata({ connection, fileId }) {
    return getDriveFileMetadata(connection.accessToken, fileId);
  },
  async downloadFile({ connection, fileId }) {
    return downloadDriveFile(connection.accessToken, fileId);
  },
  async createFolder({ connection, folderName, parentFolderId }) {
    return ensureDriveFolder(connection.accessToken, parentFolderId, folderName);
  },
  async moveFile({
    connection,
    fileId,
    newName,
    previousParentIds,
    targetParentId,
  }) {
    return moveAndRenameDriveFile(connection.accessToken, fileId, {
      newName,
      previousParentIds,
      targetParentId,
    });
  },
  async renameFile({ connection, fileId, newName }) {
    return moveAndRenameDriveFile(connection.accessToken, fileId, {
      newName,
      previousParentIds: [],
      targetParentId: "",
    });
  },
} satisfies StorageProviderAdapter;
