import type { StorageConnection } from "@/lib/db";

export type StorageProviderId = "google_drive";

export type StorageProviderFile = {
  id: string;
  name: string;
  mimeType: string;
  createdTime?: string;
  modifiedTime?: string;
  fileExtension?: string;
  parents?: string[];
  size?: string;
};

export type StorageProviderCapabilities = {
  canCreateFolder: boolean;
  canDownloadFile: boolean;
  canListFolder: boolean;
  canMoveFile: boolean;
  canRenameFile: boolean;
  canRefreshCredentials: boolean;
};

export type StorageProviderConnectionInput = {
  connection: StorageConnection;
};

export type StorageProviderFolderInput = StorageProviderConnectionInput & {
  folderId: string;
};

export type StorageProviderFileInput = StorageProviderConnectionInput & {
  fileId: string;
};

export type StorageProviderCreateFolderInput = StorageProviderConnectionInput & {
  folderName: string;
  parentFolderId: string;
};

export type StorageProviderMoveFileInput = StorageProviderFileInput & {
  newName: string;
  previousParentIds: string[];
  targetParentId: string;
};

export type StorageProviderRenameFileInput = StorageProviderFileInput & {
  newName: string;
};

export type StorageProviderAdapter = {
  capabilities: StorageProviderCapabilities;
  displayName: string;
  healthCheck(input: StorageProviderConnectionInput): Promise<void>;
  listFolders(input: StorageProviderConnectionInput): Promise<StorageProviderFile[]>;
  listFolder(input: StorageProviderFolderInput): Promise<StorageProviderFile[]>;
  getFileMetadata(input: StorageProviderFileInput): Promise<StorageProviderFile>;
  downloadFile(input: StorageProviderFileInput): Promise<Buffer>;
  createFolder(input: StorageProviderCreateFolderInput): Promise<StorageProviderFile>;
  moveFile(input: StorageProviderMoveFileInput): Promise<StorageProviderFile>;
  renameFile(input: StorageProviderRenameFileInput): Promise<StorageProviderFile>;
  id: StorageProviderId;
};
