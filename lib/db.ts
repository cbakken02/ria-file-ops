import { createRequire } from "node:module";
import type {
  CleanupFileState,
  CleanupFileStateUpsertInput,
} from "@/lib/cleanup-types";
import { ensureCleanupFileStateSchema } from "@/lib/persistence/cleanup-file-state-schema";
import { isSupabasePersistence } from "@/lib/persistence/backend";
import * as supabaseAppStateStore from "@/lib/persistence/supabase-app-state-store";

export type FirmSettings = {
  id: string;
  ownerEmail: string;
  firmName: string | null;
  storageProvider: string;
  sourceFolderId: string | null;
  sourceFolderName: string | null;
  destinationFolderId: string | null;
  destinationFolderName: string | null;
  namingConvention: string;
  namingRulesJson: string | null;
  folderTemplate: string;
  reviewInstruction: string;
  createdAt: string;
  updatedAt: string;
};

export type ReviewDecisionStatus = "draft" | "approved" | "filed";

export type ReviewDecision = {
  id: string;
  ownerEmail: string;
  fileId: string;
  sourceName: string;
  mimeType: string;
  modifiedTime: string | null;
  detectedDocumentType: string | null;
  detectedDocumentSubtype: string | null;
  originalClientName: string | null;
  originalClientName2: string | null;
  originalOwnershipType: "single" | "joint" | null;
  originalClientFolder: string | null;
  originalTopLevelFolder: string | null;
  originalFilename: string | null;
  reviewedClientName: string | null;
  reviewedClientName2: string | null;
  reviewedOwnershipType: "single" | "joint" | null;
  reviewedDocumentSubtype: string | null;
  reviewedClientFolder: string | null;
  reviewedTopLevelFolder: string | null;
  reviewedFilename: string | null;
  status: ReviewDecisionStatus;
  createdAt: string;
  updatedAt: string;
};

export type ClientMemoryRule = {
  id: string;
  ownerEmail: string;
  rawClientName: string;
  normalizedClientName: string;
  learnedClientFolder: string;
  source: "human_review";
  usageCount: number;
  createdAt: string;
  updatedAt: string;
};

export type FilingEventOutcome = "succeeded" | "failed";
export type FilingEventType =
  | "file_filed"
  | "review_approved"
  | "file_deleted"
  | "action_failed";

export type StorageConnectionStatus = "connected" | "needs_reauth";

export type StorageConnection = {
  id: string;
  ownerEmail: string;
  provider: string;
  accountEmail: string | null;
  accountName: string | null;
  accountImage: string | null;
  externalAccountId: string | null;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  grantedScopes: string[];
  isPrimary: boolean;
  status: StorageConnectionStatus;
  createdAt: string;
  updatedAt: string;
};

export type BugReport = {
  id: string;
  ownerEmail: string;
  reporterName: string | null;
  reporterEmail: string | null;
  currentPath: string | null;
  message: string;
  createdAt: string;
};

export type FilingEvent = {
  id: string;
  ownerEmail: string;
  actorEmail: string;
  actorType: "user" | "automation";
  initiatedByEmail: string | null;
  batchId: string;
  eventType: FilingEventType;
  storageProvider: string;
  reviewDecisionId: string | null;
  fileId: string;
  sourceName: string;
  sourceMimeType: string;
  sourceModifiedTime: string | null;
  sourceDriveSize: string | null;
  downloadByteLength: number | null;
  downloadSha1: string | null;
  parserVersion: string | null;
  parserConflictSummary: string | null;
  originalClientFolder: string | null;
  originalTopLevelFolder: string | null;
  originalFilename: string | null;
  originalPath: string | null;
  finalClientFolder: string | null;
  finalTopLevelFolder: string | null;
  finalFilename: string | null;
  destinationPath: string | null;
  sourceParentIds: string | null;
  destinationRootId: string | null;
  destinationRootName: string | null;
  clientFolderId: string | null;
  clientFolderName: string | null;
  topLevelFolderId: string | null;
  topLevelFolderName: string | null;
  finalParentId: string | null;
  detectedDocumentType: string | null;
  detectedClient: string | null;
  detectedClient2: string | null;
  detectedOwnershipType: "single" | "joint" | null;
  detectedAccountLast4: string | null;
  detectedAccountType: string | null;
  detectedCustodian: string | null;
  detectedTaxYear: string | null;
  detectedDocumentDate: string | null;
  detectedIdType: string | null;
  detectedEntityName: string | null;
  classifierConfidence: number | null;
  classifierContentSource: string | null;
  classifierReasons: string | null;
  classifierExcerpt: string | null;
  outcome: FilingEventOutcome;
  errorMessage: string | null;
  createdAt: string;
};

const require = createRequire(import.meta.url);

type SqliteAppStateStoreModule = typeof import("@/lib/persistence/sqlite-app-state-store");

let sqliteAppStateStore: SqliteAppStateStoreModule | null = null;

function getSqliteAppStateStore() {
  if (!sqliteAppStateStore) {
    sqliteAppStateStore = require("./persistence/sqlite-app-state-store") as SqliteAppStateStoreModule;
  }

  return sqliteAppStateStore;
}

function getActiveAppStateStore() {
  return isSupabasePersistence()
    ? supabaseAppStateStore
    : getSqliteAppStateStore();
}

function ensureSupabaseCleanupFileStateSchema() {
  if (isSupabasePersistence()) {
    ensureCleanupFileStateSchema();
  }
}

function unsupportedSupabaseOperation(name: string): never {
  throw new Error(
    `${name} is not supported yet when PERSISTENCE_BACKEND=supabase.`,
  );
}

export function getFirmSettingsByOwnerEmail(
  ownerEmail: string,
): FirmSettings | undefined {
  return getActiveAppStateStore().getFirmSettingsByOwnerEmail(ownerEmail);
}

export function saveFirmSettingsForOwner(input: {
  ownerEmail: string;
  firmName: string;
  sourceFolderId: string | null;
  sourceFolderName: string | null;
  destinationFolderId: string | null;
  destinationFolderName: string | null;
  namingConvention: string;
  namingRulesJson: string | null;
  folderTemplate: string;
  reviewInstruction: string;
}): FirmSettings | null {
  return getActiveAppStateStore().saveFirmSettingsForOwner(input);
}

export function getReviewDecisionsByOwnerEmail(
  ownerEmail: string,
): ReviewDecision[] {
  return getActiveAppStateStore().getReviewDecisionsByOwnerEmail(ownerEmail);
}

export function getClientMemoryRulesByOwnerEmail(
  ownerEmail: string,
): ClientMemoryRule[] {
  return getActiveAppStateStore().getClientMemoryRulesByOwnerEmail(ownerEmail);
}

export function getReviewDecisionByOwnerAndFile(
  ownerEmail: string,
  fileId: string,
): ReviewDecision | undefined {
  return getActiveAppStateStore().getReviewDecisionByOwnerAndFile(
    ownerEmail,
    fileId,
  );
}

export function saveReviewDecisionForOwner(input: {
  ownerEmail: string;
  fileId: string;
  sourceName: string;
  mimeType: string;
  modifiedTime: string | null;
  detectedDocumentType: string | null;
  detectedDocumentSubtype: string | null;
  originalClientName: string | null;
  originalClientName2: string | null;
  originalOwnershipType: "single" | "joint" | null;
  originalClientFolder: string | null;
  originalTopLevelFolder: string | null;
  originalFilename: string | null;
  reviewedClientName: string | null;
  reviewedClientName2: string | null;
  reviewedOwnershipType: "single" | "joint" | null;
  reviewedDocumentSubtype: string | null;
  reviewedClientFolder: string | null;
  reviewedTopLevelFolder: string | null;
  reviewedFilename: string | null;
  status: ReviewDecisionStatus;
}): ReviewDecision | null {
  return getActiveAppStateStore().saveReviewDecisionForOwner(input);
}

export function setReviewDecisionStatusForOwner(input: {
  ownerEmail: string;
  fileId: string;
  status: ReviewDecisionStatus;
}): ReviewDecision | null {
  return getActiveAppStateStore().setReviewDecisionStatusForOwner(input);
}

export function getCleanupFileStatesByOwnerAndFileIds(
  ownerEmail: string,
  fileIds: string[],
): CleanupFileState[] {
  ensureSupabaseCleanupFileStateSchema();

  return getActiveAppStateStore()
    .getCleanupFileStatesByOwnerAndFileIds(ownerEmail, fileIds)
    .filter((state): state is CleanupFileState => Boolean(state));
}

export function upsertCleanupFileStateForOwner(
  input: CleanupFileStateUpsertInput,
): CleanupFileState | null {
  ensureSupabaseCleanupFileStateSchema();

  return getActiveAppStateStore().upsertCleanupFileStateForOwner(input);
}

export function markCleanupFileStateComplete(input: {
  ownerEmail: string;
  fileId: string;
  appliedFilingEventId: string | null;
  completedAt?: string | null;
}): CleanupFileState | null {
  ensureSupabaseCleanupFileStateSchema();

  return getActiveAppStateStore().markCleanupFileStateComplete(input);
}

export function getFilingEventsByOwnerEmail(ownerEmail: string): FilingEvent[] {
  return getActiveAppStateStore().getFilingEventsByOwnerEmail(ownerEmail);
}

export function getFilingEventByOwnerAndId(
  ownerEmail: string,
  eventId: string,
): FilingEvent | null {
  return getActiveAppStateStore().getFilingEventByOwnerAndId(ownerEmail, eventId);
}

export function createFilingEvent(input: {
  ownerEmail: string;
  actorEmail: string;
  actorType?: "user" | "automation";
  initiatedByEmail?: string | null;
  batchId: string;
  eventType?: FilingEventType | null;
  storageProvider: string;
  reviewDecisionId: string | null;
  fileId: string;
  sourceName: string;
  sourceMimeType: string;
  sourceModifiedTime?: string | null;
  sourceDriveSize?: string | null;
  downloadByteLength?: number | null;
  downloadSha1?: string | null;
  parserVersion?: string | null;
  parserConflictSummary?: string | null;
  originalClientFolder: string | null;
  originalTopLevelFolder: string | null;
  originalFilename: string | null;
  originalPath: string | null;
  finalClientFolder: string | null;
  finalTopLevelFolder: string | null;
  finalFilename: string | null;
  destinationPath: string | null;
  sourceParentIds: string[] | null;
  destinationRootId: string | null;
  destinationRootName: string | null;
  clientFolderId: string | null;
  clientFolderName: string | null;
  topLevelFolderId: string | null;
  topLevelFolderName: string | null;
  finalParentId: string | null;
  detectedDocumentType?: string | null;
  detectedClient?: string | null;
  detectedClient2?: string | null;
  detectedOwnershipType?: "single" | "joint" | null;
  detectedAccountLast4?: string | null;
  detectedAccountType?: string | null;
  detectedCustodian?: string | null;
  detectedTaxYear?: string | null;
  detectedDocumentDate?: string | null;
  detectedIdType?: string | null;
  detectedEntityName?: string | null;
  classifierConfidence?: number | null;
  classifierContentSource?: string | null;
  classifierReasons?: string[] | null;
  classifierExcerpt?: string | null;
  outcome: FilingEventOutcome;
  errorMessage: string | null;
}): FilingEvent {
  return getActiveAppStateStore().createFilingEvent(input);
}

export function upsertClientMemoryRule(input: {
  ownerEmail: string;
  rawClientName: string;
  learnedClientFolder: string;
}): ClientMemoryRule | undefined | null {
  return getActiveAppStateStore().upsertClientMemoryRule(input);
}

export function getStorageConnectionsByOwnerEmail(
  ownerEmail: string,
): StorageConnection[] {
  return getActiveAppStateStore().getStorageConnectionsByOwnerEmail(ownerEmail);
}

export function getPrimaryStorageConnectionByOwnerEmail(
  ownerEmail: string,
): StorageConnection | undefined {
  return getActiveAppStateStore().getPrimaryStorageConnectionByOwnerEmail(ownerEmail);
}

export function getStorageConnectionByOwnerAndId(
  ownerEmail: string,
  connectionId: string,
): StorageConnection | undefined {
  return getActiveAppStateStore().getStorageConnectionByOwnerAndId(
    ownerEmail,
    connectionId,
  );
}

export function saveStorageConnectionForOwner(input: {
  ownerEmail: string;
  provider: string;
  accountEmail: string | null;
  accountName: string | null;
  accountImage: string | null;
  externalAccountId: string | null;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  grantedScopes: string[];
  status?: StorageConnectionStatus;
  makePrimary?: boolean;
}): StorageConnection | null {
  return getActiveAppStateStore().saveStorageConnectionForOwner(input);
}

export function setPrimaryStorageConnectionForOwner(input: {
  ownerEmail: string;
  connectionId: string;
}): StorageConnection | null {
  return getActiveAppStateStore().setPrimaryStorageConnectionForOwner(input);
}

export function deleteStorageConnectionForOwner(input: {
  ownerEmail: string;
  connectionId: string;
}): StorageConnection[] {
  return getActiveAppStateStore().deleteStorageConnectionForOwner(input);
}

export function createBugReport(input: {
  ownerEmail: string;
  reporterName: string | null;
  reporterEmail: string | null;
  currentPath: string | null;
  message: string;
}): void {
  return getActiveAppStateStore().createBugReport(input);
}
