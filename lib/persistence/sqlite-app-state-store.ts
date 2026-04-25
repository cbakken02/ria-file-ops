import "server-only";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type {
  BugReport,
  ClientMemoryRule,
  FilingEvent,
  FilingEventOutcome,
  FilingEventType,
  FirmSettings,
  ReviewDecision,
  ReviewDecisionStatus,
  StorageConnection,
  StorageConnectionStatus,
} from "@/lib/db";

function ensureTableColumn(
  tableName: string,
  columnName: string,
  definition: string,
) {
  const columns = database
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;

  const exists = columns.some((column) => column.name === columnName);
  if (!exists) {
    database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
  }
}

const dataDir = path.join(process.cwd(), "data");
const databasePath = path.join(dataDir, "ria-file-ops.db");

fs.mkdirSync(dataDir, { recursive: true });

const database = new Database(databasePath);

database.exec(`
  CREATE TABLE IF NOT EXISTS firm_settings (
    id TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL UNIQUE,
    firm_name TEXT,
    storage_provider TEXT NOT NULL DEFAULT 'google_drive',
    source_folder_id TEXT,
    source_folder_name TEXT,
    destination_folder_id TEXT,
    destination_folder_name TEXT,
    naming_convention TEXT NOT NULL DEFAULT 'Last_First_DocType_Date',
    naming_rules_json TEXT,
    folder_template TEXT NOT NULL DEFAULT 'Client Info\nAccounts\nMoney Movement\nPlanning\nReview',
    review_instruction TEXT NOT NULL DEFAULT 'Send uncertain files to a human review queue before moving anything.',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

database.exec(`
  CREATE TABLE IF NOT EXISTS review_decisions (
    id TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    file_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    modified_time TEXT,
    detected_document_type TEXT,
    detected_document_subtype TEXT,
    original_client_name TEXT,
    original_client_name2 TEXT,
    original_ownership_type TEXT,
    original_client_folder TEXT,
    original_top_level_folder TEXT,
    original_filename TEXT,
    reviewed_client_name TEXT,
    reviewed_client_name2 TEXT,
    reviewed_ownership_type TEXT,
    reviewed_document_subtype TEXT,
    reviewed_client_folder TEXT,
    reviewed_top_level_folder TEXT,
    reviewed_filename TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(owner_email, file_id)
  )
`);

database.exec(`
  CREATE TABLE IF NOT EXISTS filing_events (
    id TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    actor_email TEXT NOT NULL,
    actor_type TEXT NOT NULL DEFAULT 'user',
    batch_id TEXT NOT NULL,
    event_type TEXT NOT NULL DEFAULT 'file_filed',
    storage_provider TEXT NOT NULL DEFAULT 'google_drive',
    review_decision_id TEXT,
    file_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    source_mime_type TEXT NOT NULL,
    source_modified_time TEXT,
    source_drive_size TEXT,
    download_byte_length INTEGER,
    download_sha1 TEXT,
    parser_version TEXT,
    parser_conflict_summary TEXT,
    original_client_folder TEXT,
    original_top_level_folder TEXT,
    original_filename TEXT,
    final_client_folder TEXT,
    final_top_level_folder TEXT,
    final_filename TEXT,
    source_parent_ids TEXT,
    destination_root_id TEXT,
    destination_root_name TEXT,
    client_folder_id TEXT,
    client_folder_name TEXT,
    top_level_folder_id TEXT,
    top_level_folder_name TEXT,
    final_parent_id TEXT,
    initiated_by_email TEXT,
    detected_document_type TEXT,
    detected_client TEXT,
    detected_client2 TEXT,
    detected_ownership_type TEXT,
    detected_account_last4 TEXT,
    detected_account_type TEXT,
    detected_custodian TEXT,
    detected_tax_year TEXT,
    detected_document_date TEXT,
    detected_id_type TEXT,
    detected_entity_name TEXT,
    classifier_confidence REAL,
    classifier_content_source TEXT,
    classifier_reasons TEXT,
    classifier_excerpt TEXT,
    outcome TEXT NOT NULL,
    error_message TEXT,
    created_at TEXT NOT NULL
  )
`);

database.exec(`
  CREATE TABLE IF NOT EXISTS client_memory_rules (
    id TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    raw_client_name TEXT NOT NULL,
    normalized_client_name TEXT NOT NULL,
    learned_client_folder TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'human_review',
    usage_count INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(owner_email, normalized_client_name)
  )
`);

database.exec(`
  CREATE TABLE IF NOT EXISTS storage_connections (
    id TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    provider TEXT NOT NULL,
    account_email TEXT,
    account_name TEXT,
    account_image TEXT,
    external_account_id TEXT,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at INTEGER,
    granted_scopes TEXT NOT NULL DEFAULT '[]',
    is_primary INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'connected',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(owner_email, provider, external_account_id)
  )
`);

database.exec(`
  CREATE TABLE IF NOT EXISTS bug_reports (
    id TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    reporter_name TEXT,
    reporter_email TEXT,
    current_path TEXT,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);

ensureTableColumn(
  "firm_settings",
  "review_instruction",
  "review_instruction TEXT NOT NULL DEFAULT 'review_uncertain'",
);
ensureTableColumn(
  "filing_events",
  "event_type",
  "event_type TEXT NOT NULL DEFAULT 'file_filed'",
);
ensureTableColumn(
  "filing_events",
  "source_modified_time",
  "source_modified_time TEXT",
);
ensureTableColumn(
  "filing_events",
  "source_drive_size",
  "source_drive_size TEXT",
);
ensureTableColumn(
  "filing_events",
  "download_byte_length",
  "download_byte_length INTEGER",
);
ensureTableColumn(
  "filing_events",
  "download_sha1",
  "download_sha1 TEXT",
);
ensureTableColumn(
  "filing_events",
  "parser_version",
  "parser_version TEXT",
);
ensureTableColumn(
  "filing_events",
  "parser_conflict_summary",
  "parser_conflict_summary TEXT",
);
ensureTableColumn(
  "filing_events",
  "initiated_by_email",
  "initiated_by_email TEXT",
);
ensureTableColumn(
  "filing_events",
  "original_path",
  "original_path TEXT",
);
ensureTableColumn(
  "filing_events",
  "destination_path",
  "destination_path TEXT",
);
ensureTableColumn(
  "filing_events",
  "detected_document_type",
  "detected_document_type TEXT",
);
ensureTableColumn(
  "filing_events",
  "detected_client",
  "detected_client TEXT",
);
ensureTableColumn(
  "filing_events",
  "detected_client2",
  "detected_client2 TEXT",
);
ensureTableColumn(
  "filing_events",
  "detected_ownership_type",
  "detected_ownership_type TEXT",
);
ensureTableColumn(
  "filing_events",
  "detected_account_last4",
  "detected_account_last4 TEXT",
);
ensureTableColumn(
  "filing_events",
  "detected_account_type",
  "detected_account_type TEXT",
);
ensureTableColumn(
  "filing_events",
  "detected_custodian",
  "detected_custodian TEXT",
);
ensureTableColumn(
  "filing_events",
  "detected_tax_year",
  "detected_tax_year TEXT",
);
ensureTableColumn(
  "filing_events",
  "detected_document_date",
  "detected_document_date TEXT",
);
ensureTableColumn(
  "filing_events",
  "detected_id_type",
  "detected_id_type TEXT",
);
ensureTableColumn(
  "filing_events",
  "detected_entity_name",
  "detected_entity_name TEXT",
);
ensureTableColumn(
  "filing_events",
  "classifier_confidence",
  "classifier_confidence REAL",
);
ensureTableColumn(
  "filing_events",
  "classifier_content_source",
  "classifier_content_source TEXT",
);
ensureTableColumn(
  "filing_events",
  "classifier_reasons",
  "classifier_reasons TEXT",
);
ensureTableColumn(
  "filing_events",
  "classifier_excerpt",
  "classifier_excerpt TEXT",
);

ensureTableColumn(
  "firm_settings",
  "naming_rules_json",
  "naming_rules_json TEXT",
);
ensureTableColumn(
  "review_decisions",
  "original_client_name",
  "original_client_name TEXT",
);
ensureTableColumn(
  "review_decisions",
  "reviewed_client_name",
  "reviewed_client_name TEXT",
);
ensureTableColumn(
  "review_decisions",
  "original_client_name2",
  "original_client_name2 TEXT",
);
ensureTableColumn(
  "review_decisions",
  "original_ownership_type",
  "original_ownership_type TEXT",
);
ensureTableColumn(
  "review_decisions",
  "reviewed_client_name2",
  "reviewed_client_name2 TEXT",
);
ensureTableColumn(
  "review_decisions",
  "reviewed_ownership_type",
  "reviewed_ownership_type TEXT",
);
ensureTableColumn(
  "review_decisions",
  "detected_document_subtype",
  "detected_document_subtype TEXT",
);
ensureTableColumn(
  "review_decisions",
  "reviewed_document_subtype",
  "reviewed_document_subtype TEXT",
);
const selectByOwnerEmail = database.prepare(`
  SELECT
    id,
    owner_email AS ownerEmail,
    firm_name AS firmName,
    storage_provider AS storageProvider,
    source_folder_id AS sourceFolderId,
    source_folder_name AS sourceFolderName,
    destination_folder_id AS destinationFolderId,
    destination_folder_name AS destinationFolderName,
    naming_convention AS namingConvention,
    naming_rules_json AS namingRulesJson,
    folder_template AS folderTemplate,
    review_instruction AS reviewInstruction,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM firm_settings
  WHERE owner_email = ?
`);

const insertSettings = database.prepare(`
  INSERT INTO firm_settings (
    id,
    owner_email,
    firm_name,
    storage_provider,
    source_folder_id,
    source_folder_name,
    destination_folder_id,
    destination_folder_name,
    naming_convention,
    naming_rules_json,
    folder_template,
    review_instruction,
    created_at,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateSettings = database.prepare(`
  UPDATE firm_settings
  SET
    firm_name = ?,
    source_folder_id = ?,
    source_folder_name = ?,
    destination_folder_id = ?,
    destination_folder_name = ?,
    naming_convention = ?,
    naming_rules_json = ?,
    folder_template = ?,
    review_instruction = ?,
    updated_at = ?
  WHERE owner_email = ?
`);

const selectReviewDecisionsByOwnerEmail = database.prepare(`
  SELECT
    id,
    owner_email AS ownerEmail,
    file_id AS fileId,
    source_name AS sourceName,
    mime_type AS mimeType,
    modified_time AS modifiedTime,
    detected_document_type AS detectedDocumentType,
    detected_document_subtype AS detectedDocumentSubtype,
    original_client_name AS originalClientName,
    original_client_name2 AS originalClientName2,
    original_ownership_type AS originalOwnershipType,
    original_client_folder AS originalClientFolder,
    original_top_level_folder AS originalTopLevelFolder,
    original_filename AS originalFilename,
    reviewed_client_name AS reviewedClientName,
    reviewed_client_name2 AS reviewedClientName2,
    reviewed_ownership_type AS reviewedOwnershipType,
    reviewed_document_subtype AS reviewedDocumentSubtype,
    reviewed_client_folder AS reviewedClientFolder,
    reviewed_top_level_folder AS reviewedTopLevelFolder,
    reviewed_filename AS reviewedFilename,
    status,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM review_decisions
  WHERE owner_email = ?
  ORDER BY updated_at DESC
`);

const selectReviewDecisionByOwnerAndFile = database.prepare(`
  SELECT
    id,
    owner_email AS ownerEmail,
    file_id AS fileId,
    source_name AS sourceName,
    mime_type AS mimeType,
    modified_time AS modifiedTime,
    detected_document_type AS detectedDocumentType,
    detected_document_subtype AS detectedDocumentSubtype,
    original_client_name AS originalClientName,
    original_client_name2 AS originalClientName2,
    original_ownership_type AS originalOwnershipType,
    original_client_folder AS originalClientFolder,
    original_top_level_folder AS originalTopLevelFolder,
    original_filename AS originalFilename,
    reviewed_client_name AS reviewedClientName,
    reviewed_client_name2 AS reviewedClientName2,
    reviewed_ownership_type AS reviewedOwnershipType,
    reviewed_document_subtype AS reviewedDocumentSubtype,
    reviewed_client_folder AS reviewedClientFolder,
    reviewed_top_level_folder AS reviewedTopLevelFolder,
    reviewed_filename AS reviewedFilename,
    status,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM review_decisions
  WHERE owner_email = ? AND file_id = ?
`);

const insertReviewDecision = database.prepare(`
  INSERT INTO review_decisions (
    id,
    owner_email,
    file_id,
    source_name,
    mime_type,
    modified_time,
    detected_document_type,
    detected_document_subtype,
    original_client_name,
    original_client_name2,
    original_ownership_type,
    original_client_folder,
    original_top_level_folder,
    original_filename,
    reviewed_client_name,
    reviewed_client_name2,
    reviewed_ownership_type,
    reviewed_document_subtype,
    reviewed_client_folder,
    reviewed_top_level_folder,
    reviewed_filename,
    status,
    created_at,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateReviewDecision = database.prepare(`
  UPDATE review_decisions
  SET
    source_name = ?,
    mime_type = ?,
    modified_time = ?,
    detected_document_type = ?,
    detected_document_subtype = ?,
    original_client_name = ?,
    original_client_name2 = ?,
    original_ownership_type = ?,
    original_client_folder = ?,
    original_top_level_folder = ?,
    original_filename = ?,
    reviewed_client_name = ?,
    reviewed_client_name2 = ?,
    reviewed_ownership_type = ?,
    reviewed_document_subtype = ?,
    reviewed_client_folder = ?,
    reviewed_top_level_folder = ?,
    reviewed_filename = ?,
    status = ?,
    updated_at = ?
  WHERE owner_email = ? AND file_id = ?
`);

const updateReviewDecisionStatus = database.prepare(`
  UPDATE review_decisions
  SET
    status = ?,
    updated_at = ?
  WHERE owner_email = ? AND file_id = ?
`);

const selectFilingEventsByOwnerEmail = database.prepare(`
  SELECT
    id,
    owner_email AS ownerEmail,
    actor_email AS actorEmail,
    actor_type AS actorType,
    batch_id AS batchId,
    event_type AS eventType,
    storage_provider AS storageProvider,
    review_decision_id AS reviewDecisionId,
    file_id AS fileId,
    source_name AS sourceName,
    source_mime_type AS sourceMimeType,
    source_modified_time AS sourceModifiedTime,
    source_drive_size AS sourceDriveSize,
    download_byte_length AS downloadByteLength,
    download_sha1 AS downloadSha1,
    parser_version AS parserVersion,
    parser_conflict_summary AS parserConflictSummary,
    original_client_folder AS originalClientFolder,
    original_top_level_folder AS originalTopLevelFolder,
    original_filename AS originalFilename,
    original_path AS originalPath,
    final_client_folder AS finalClientFolder,
    final_top_level_folder AS finalTopLevelFolder,
    final_filename AS finalFilename,
    destination_path AS destinationPath,
    source_parent_ids AS sourceParentIds,
    destination_root_id AS destinationRootId,
    destination_root_name AS destinationRootName,
    client_folder_id AS clientFolderId,
    client_folder_name AS clientFolderName,
    top_level_folder_id AS topLevelFolderId,
    top_level_folder_name AS topLevelFolderName,
    final_parent_id AS finalParentId,
    initiated_by_email AS initiatedByEmail,
    detected_document_type AS detectedDocumentType,
    detected_client AS detectedClient,
    detected_client2 AS detectedClient2,
    detected_ownership_type AS detectedOwnershipType,
    detected_account_last4 AS detectedAccountLast4,
    detected_account_type AS detectedAccountType,
    detected_custodian AS detectedCustodian,
    detected_tax_year AS detectedTaxYear,
    detected_document_date AS detectedDocumentDate,
    detected_id_type AS detectedIdType,
    detected_entity_name AS detectedEntityName,
    classifier_confidence AS classifierConfidence,
    classifier_content_source AS classifierContentSource,
    classifier_reasons AS classifierReasons,
    classifier_excerpt AS classifierExcerpt,
    outcome,
    error_message AS errorMessage,
    created_at AS createdAt
  FROM filing_events
  WHERE owner_email = ?
  ORDER BY created_at DESC
`);

const selectFilingEventByOwnerAndId = database.prepare(`
  SELECT
    id,
    owner_email AS ownerEmail,
    actor_email AS actorEmail,
    actor_type AS actorType,
    batch_id AS batchId,
    event_type AS eventType,
    storage_provider AS storageProvider,
    review_decision_id AS reviewDecisionId,
    file_id AS fileId,
    source_name AS sourceName,
    source_mime_type AS sourceMimeType,
    source_modified_time AS sourceModifiedTime,
    source_drive_size AS sourceDriveSize,
    download_byte_length AS downloadByteLength,
    download_sha1 AS downloadSha1,
    parser_version AS parserVersion,
    parser_conflict_summary AS parserConflictSummary,
    original_client_folder AS originalClientFolder,
    original_top_level_folder AS originalTopLevelFolder,
    original_filename AS originalFilename,
    original_path AS originalPath,
    final_client_folder AS finalClientFolder,
    final_top_level_folder AS finalTopLevelFolder,
    final_filename AS finalFilename,
    destination_path AS destinationPath,
    source_parent_ids AS sourceParentIds,
    destination_root_id AS destinationRootId,
    destination_root_name AS destinationRootName,
    client_folder_id AS clientFolderId,
    client_folder_name AS clientFolderName,
    top_level_folder_id AS topLevelFolderId,
    top_level_folder_name AS topLevelFolderName,
    final_parent_id AS finalParentId,
    initiated_by_email AS initiatedByEmail,
    detected_document_type AS detectedDocumentType,
    detected_client AS detectedClient,
    detected_client2 AS detectedClient2,
    detected_ownership_type AS detectedOwnershipType,
    detected_account_last4 AS detectedAccountLast4,
    detected_account_type AS detectedAccountType,
    detected_custodian AS detectedCustodian,
    detected_tax_year AS detectedTaxYear,
    detected_document_date AS detectedDocumentDate,
    detected_id_type AS detectedIdType,
    detected_entity_name AS detectedEntityName,
    classifier_confidence AS classifierConfidence,
    classifier_content_source AS classifierContentSource,
    classifier_reasons AS classifierReasons,
    classifier_excerpt AS classifierExcerpt,
    outcome,
    error_message AS errorMessage,
    created_at AS createdAt
  FROM filing_events
  WHERE owner_email = ? AND id = ?
`);

const insertFilingEvent = database.prepare(`
  INSERT INTO filing_events (
    id,
    owner_email,
    actor_email,
    actor_type,
    batch_id,
    event_type,
    storage_provider,
    review_decision_id,
    file_id,
    source_name,
    source_mime_type,
    source_modified_time,
    source_drive_size,
    download_byte_length,
    download_sha1,
    parser_version,
    parser_conflict_summary,
    original_client_folder,
    original_top_level_folder,
    original_filename,
    original_path,
    final_client_folder,
    final_top_level_folder,
    final_filename,
    destination_path,
    source_parent_ids,
    destination_root_id,
    destination_root_name,
    client_folder_id,
    client_folder_name,
    top_level_folder_id,
    top_level_folder_name,
    final_parent_id,
    initiated_by_email,
    detected_document_type,
    detected_client,
    detected_client2,
    detected_ownership_type,
    detected_account_last4,
    detected_account_type,
    detected_custodian,
    detected_tax_year,
    detected_document_date,
    detected_id_type,
    detected_entity_name,
    classifier_confidence,
    classifier_content_source,
    classifier_reasons,
    classifier_excerpt,
    outcome,
    error_message,
    created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const selectClientMemoryRulesByOwnerEmail = database.prepare(`
  SELECT
    id,
    owner_email AS ownerEmail,
    raw_client_name AS rawClientName,
    normalized_client_name AS normalizedClientName,
    learned_client_folder AS learnedClientFolder,
    source,
    usage_count AS usageCount,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM client_memory_rules
  WHERE owner_email = ?
  ORDER BY usage_count DESC, updated_at DESC
`);

const selectClientMemoryRuleByOwnerAndKey = database.prepare(`
  SELECT
    id,
    owner_email AS ownerEmail,
    raw_client_name AS rawClientName,
    normalized_client_name AS normalizedClientName,
    learned_client_folder AS learnedClientFolder,
    source,
    usage_count AS usageCount,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM client_memory_rules
  WHERE owner_email = ? AND normalized_client_name = ?
`);

const insertClientMemoryRule = database.prepare(`
  INSERT INTO client_memory_rules (
    id,
    owner_email,
    raw_client_name,
    normalized_client_name,
    learned_client_folder,
    source,
    usage_count,
    created_at,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateClientMemoryRule = database.prepare(`
  UPDATE client_memory_rules
  SET
    raw_client_name = ?,
    learned_client_folder = ?,
    source = ?,
    usage_count = usage_count + 1,
    updated_at = ?
  WHERE owner_email = ? AND normalized_client_name = ?
`);

const selectStorageConnectionsByOwnerEmail = database.prepare(`
  SELECT
    id,
    owner_email AS ownerEmail,
    provider,
    account_email AS accountEmail,
    account_name AS accountName,
    account_image AS accountImage,
    external_account_id AS externalAccountId,
    access_token AS accessToken,
    refresh_token AS refreshToken,
    expires_at AS expiresAt,
    granted_scopes AS grantedScopes,
    is_primary AS isPrimary,
    status,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM storage_connections
  WHERE owner_email = ?
  ORDER BY is_primary DESC, updated_at DESC
`);

const selectPrimaryStorageConnectionByOwnerEmail = database.prepare(`
  SELECT
    id,
    owner_email AS ownerEmail,
    provider,
    account_email AS accountEmail,
    account_name AS accountName,
    account_image AS accountImage,
    external_account_id AS externalAccountId,
    access_token AS accessToken,
    refresh_token AS refreshToken,
    expires_at AS expiresAt,
    granted_scopes AS grantedScopes,
    is_primary AS isPrimary,
    status,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM storage_connections
  WHERE owner_email = ? AND is_primary = 1
  LIMIT 1
`);

const selectStorageConnectionByOwnerAndId = database.prepare(`
  SELECT
    id,
    owner_email AS ownerEmail,
    provider,
    account_email AS accountEmail,
    account_name AS accountName,
    account_image AS accountImage,
    external_account_id AS externalAccountId,
    access_token AS accessToken,
    refresh_token AS refreshToken,
    expires_at AS expiresAt,
    granted_scopes AS grantedScopes,
    is_primary AS isPrimary,
    status,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM storage_connections
  WHERE owner_email = ? AND id = ?
  LIMIT 1
`);

const selectStorageConnectionByOwnerAndProviderIdentity = database.prepare(`
  SELECT
    id,
    owner_email AS ownerEmail,
    provider,
    account_email AS accountEmail,
    account_name AS accountName,
    account_image AS accountImage,
    external_account_id AS externalAccountId,
    access_token AS accessToken,
    refresh_token AS refreshToken,
    expires_at AS expiresAt,
    granted_scopes AS grantedScopes,
    is_primary AS isPrimary,
    status,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM storage_connections
  WHERE owner_email = ?
    AND provider = ?
    AND (
      (external_account_id IS NOT NULL AND external_account_id = ?)
      OR (external_account_id IS NULL AND account_email = ?)
    )
  LIMIT 1
`);

const clearPrimaryStorageConnections = database.prepare(`
  UPDATE storage_connections
  SET
    is_primary = 0,
    updated_at = ?
  WHERE owner_email = ?
`);

const markStorageConnectionPrimary = database.prepare(`
  UPDATE storage_connections
  SET
    is_primary = 1,
    updated_at = ?
  WHERE owner_email = ? AND id = ?
`);

const insertStorageConnection = database.prepare(`
  INSERT INTO storage_connections (
    id,
    owner_email,
    provider,
    account_email,
    account_name,
    account_image,
    external_account_id,
    access_token,
    refresh_token,
    expires_at,
    granted_scopes,
    is_primary,
    status,
    created_at,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateStorageConnection = database.prepare(`
  UPDATE storage_connections
  SET
    account_email = ?,
    account_name = ?,
    account_image = ?,
    access_token = ?,
    refresh_token = ?,
    expires_at = ?,
    granted_scopes = ?,
    is_primary = ?,
    status = ?,
    updated_at = ?
  WHERE owner_email = ? AND id = ?
`);

const deleteStorageConnectionByOwnerAndId = database.prepare(`
  DELETE FROM storage_connections
  WHERE owner_email = ? AND id = ?
`);

const insertBugReport = database.prepare(`
  INSERT INTO bug_reports (
    id,
    owner_email,
    reporter_name,
    reporter_email,
    current_path,
    message,
    created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`);

export function getFirmSettingsByOwnerEmail(ownerEmail: string) {
  return selectByOwnerEmail.get(ownerEmail) as FirmSettings | undefined;
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
}) {
  const now = new Date().toISOString();
  const existing = getFirmSettingsByOwnerEmail(input.ownerEmail);

  if (existing) {
    updateSettings.run(
      input.firmName || null,
      input.sourceFolderId,
      input.sourceFolderName,
      input.destinationFolderId,
      input.destinationFolderName,
      input.namingConvention,
      input.namingRulesJson,
      input.folderTemplate,
      input.reviewInstruction,
      now,
      input.ownerEmail,
    );

    return getFirmSettingsByOwnerEmail(input.ownerEmail) ?? null;
  }

  insertSettings.run(
    crypto.randomUUID(),
    input.ownerEmail,
    input.firmName || null,
    "google_drive",
    input.sourceFolderId,
    input.sourceFolderName,
    input.destinationFolderId,
    input.destinationFolderName,
    input.namingConvention,
    input.namingRulesJson,
    input.folderTemplate,
    input.reviewInstruction,
    now,
    now,
  );

  return getFirmSettingsByOwnerEmail(input.ownerEmail) ?? null;
}

export function getReviewDecisionsByOwnerEmail(ownerEmail: string) {
  return selectReviewDecisionsByOwnerEmail.all(ownerEmail) as ReviewDecision[];
}

export function getClientMemoryRulesByOwnerEmail(ownerEmail: string) {
  return selectClientMemoryRulesByOwnerEmail.all(ownerEmail) as ClientMemoryRule[];
}

export function getReviewDecisionByOwnerAndFile(
  ownerEmail: string,
  fileId: string,
) {
  return selectReviewDecisionByOwnerAndFile.get(
    ownerEmail,
    fileId,
  ) as ReviewDecision | undefined;
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
}) {
  const now = new Date().toISOString();
  const existing = getReviewDecisionByOwnerAndFile(input.ownerEmail, input.fileId);

  if (existing) {
    updateReviewDecision.run(
      input.sourceName,
      input.mimeType,
      input.modifiedTime,
      input.detectedDocumentType,
      input.detectedDocumentSubtype,
      input.originalClientName,
      input.originalClientName2,
      input.originalOwnershipType,
      input.originalClientFolder,
      input.originalTopLevelFolder,
      input.originalFilename,
      input.reviewedClientName,
      input.reviewedClientName2,
      input.reviewedOwnershipType,
      input.reviewedDocumentSubtype,
      input.reviewedClientFolder,
      input.reviewedTopLevelFolder,
      input.reviewedFilename,
      input.status,
      now,
      input.ownerEmail,
      input.fileId,
    );

    return getReviewDecisionByOwnerAndFile(input.ownerEmail, input.fileId) ?? null;
  }

  insertReviewDecision.run(
    crypto.randomUUID(),
    input.ownerEmail,
    input.fileId,
    input.sourceName,
    input.mimeType,
    input.modifiedTime,
    input.detectedDocumentType,
    input.detectedDocumentSubtype,
    input.originalClientName,
    input.originalClientName2,
    input.originalOwnershipType,
    input.originalClientFolder,
    input.originalTopLevelFolder,
    input.originalFilename,
    input.reviewedClientName,
    input.reviewedClientName2,
    input.reviewedOwnershipType,
    input.reviewedDocumentSubtype,
    input.reviewedClientFolder,
    input.reviewedTopLevelFolder,
    input.reviewedFilename,
    input.status,
    now,
    now,
  );

  return getReviewDecisionByOwnerAndFile(input.ownerEmail, input.fileId) ?? null;
}

export function setReviewDecisionStatusForOwner(input: {
  ownerEmail: string;
  fileId: string;
  status: ReviewDecisionStatus;
}) {
  updateReviewDecisionStatus.run(
    input.status,
    new Date().toISOString(),
    input.ownerEmail,
    input.fileId,
  );

  return getReviewDecisionByOwnerAndFile(input.ownerEmail, input.fileId) ?? null;
}

export function getFilingEventsByOwnerEmail(ownerEmail: string) {
  return selectFilingEventsByOwnerEmail.all(ownerEmail) as FilingEvent[];
}

export function getFilingEventByOwnerAndId(ownerEmail: string, eventId: string) {
  const row = selectFilingEventByOwnerAndId.get(ownerEmail, eventId);
  return row ? (row as FilingEvent) : null;
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
}) {
  insertFilingEvent.run(
    crypto.randomUUID(),
    input.ownerEmail,
    input.actorEmail,
    input.actorType ?? "user",
    input.batchId,
    input.eventType ?? (input.outcome === "failed" ? "action_failed" : "file_filed"),
    input.storageProvider,
    input.reviewDecisionId,
    input.fileId,
    input.sourceName,
    input.sourceMimeType,
    input.sourceModifiedTime ?? null,
    input.sourceDriveSize ?? null,
    input.downloadByteLength ?? null,
    input.downloadSha1 ?? null,
    input.parserVersion ?? null,
    input.parserConflictSummary ?? null,
    input.originalClientFolder,
    input.originalTopLevelFolder,
    input.originalFilename,
    input.originalPath,
    input.finalClientFolder,
    input.finalTopLevelFolder,
    input.finalFilename,
    input.destinationPath,
    input.sourceParentIds ? JSON.stringify(input.sourceParentIds) : null,
    input.destinationRootId,
    input.destinationRootName,
    input.clientFolderId,
    input.clientFolderName,
    input.topLevelFolderId,
    input.topLevelFolderName,
    input.finalParentId,
    input.initiatedByEmail ?? null,
    input.detectedDocumentType ?? null,
    input.detectedClient ?? null,
    input.detectedClient2 ?? null,
    input.detectedOwnershipType ?? null,
    input.detectedAccountLast4 ?? null,
    input.detectedAccountType ?? null,
    input.detectedCustodian ?? null,
    input.detectedTaxYear ?? null,
    input.detectedDocumentDate ?? null,
    input.detectedIdType ?? null,
    input.detectedEntityName ?? null,
    input.classifierConfidence ?? null,
    input.classifierContentSource ?? null,
    input.classifierReasons ? JSON.stringify(input.classifierReasons) : null,
    input.classifierExcerpt ?? null,
    input.outcome,
    input.errorMessage,
    new Date().toISOString(),
  );
}

function normalizeClientMemoryKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mapStorageConnectionRow(row: {
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
  grantedScopes: string | string[] | null;
  isPrimary: number | boolean;
  status: StorageConnectionStatus;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    ...row,
    grantedScopes:
      typeof row.grantedScopes === "string"
        ? safeParseScopes(row.grantedScopes)
        : Array.isArray(row.grantedScopes)
          ? row.grantedScopes
          : [],
    isPrimary: Boolean(row.isPrimary),
  } satisfies StorageConnection;
}

function safeParseScopes(value: string) {
  try {
    const parsed = JSON.parse(value) as string[];
    return Array.isArray(parsed)
      ? parsed.filter((scope): scope is string => typeof scope === "string")
      : [];
  } catch {
    return [];
  }
}

export function upsertClientMemoryRule(input: {
  ownerEmail: string;
  rawClientName: string;
  learnedClientFolder: string;
}) {
  const normalizedClientName = normalizeClientMemoryKey(input.rawClientName);
  if (!normalizedClientName || !input.learnedClientFolder.trim()) {
    return null;
  }

  const now = new Date().toISOString();
  const existing = selectClientMemoryRuleByOwnerAndKey.get(
    input.ownerEmail,
    normalizedClientName,
  ) as ClientMemoryRule | undefined;

  if (existing) {
    updateClientMemoryRule.run(
      input.rawClientName,
      input.learnedClientFolder,
      "human_review",
      now,
      input.ownerEmail,
      normalizedClientName,
    );

    return selectClientMemoryRuleByOwnerAndKey.get(
      input.ownerEmail,
      normalizedClientName,
    ) as ClientMemoryRule | undefined;
  }

  insertClientMemoryRule.run(
    crypto.randomUUID(),
    input.ownerEmail,
    input.rawClientName,
    normalizedClientName,
    input.learnedClientFolder,
    "human_review",
    1,
    now,
    now,
  );

  return selectClientMemoryRuleByOwnerAndKey.get(
    input.ownerEmail,
    normalizedClientName,
  ) as ClientMemoryRule | undefined;
}

export function getStorageConnectionsByOwnerEmail(ownerEmail: string) {
  return (
    selectStorageConnectionsByOwnerEmail
      .all(ownerEmail)
      .map((row) =>
        mapStorageConnectionRow(
          row as Parameters<typeof mapStorageConnectionRow>[0],
        ),
      ) as StorageConnection[]
  );
}

export function getPrimaryStorageConnectionByOwnerEmail(ownerEmail: string) {
  const row = selectPrimaryStorageConnectionByOwnerEmail.get(ownerEmail);
  if (!row) {
    return undefined;
  }

  return mapStorageConnectionRow(
    row as Parameters<typeof mapStorageConnectionRow>[0],
  );
}

export function getStorageConnectionByOwnerAndId(
  ownerEmail: string,
  connectionId: string,
) {
  const row = selectStorageConnectionByOwnerAndId.get(ownerEmail, connectionId);
  if (!row) {
    return undefined;
  }

  return mapStorageConnectionRow(
    row as Parameters<typeof mapStorageConnectionRow>[0],
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
}) {
  const now = new Date().toISOString();
  const existing = selectStorageConnectionByOwnerAndProviderIdentity.get(
    input.ownerEmail,
    input.provider,
    input.externalAccountId,
    input.accountEmail,
  ) as Parameters<typeof mapStorageConnectionRow>[0] | undefined;
  const hasPrimary = Boolean(
    getPrimaryStorageConnectionByOwnerEmail(input.ownerEmail),
  );
  const shouldMakePrimary = input.makePrimary || !hasPrimary;
  const grantedScopes = JSON.stringify(input.grantedScopes);

  if (shouldMakePrimary) {
    clearPrimaryStorageConnections.run(now, input.ownerEmail);
  }

  if (existing) {
    updateStorageConnection.run(
      input.accountEmail,
      input.accountName,
      input.accountImage,
      input.accessToken,
      input.refreshToken ?? existing.refreshToken ?? null,
      input.expiresAt,
      grantedScopes,
      shouldMakePrimary ? 1 : existing.isPrimary ? 1 : 0,
      input.status ?? "connected",
      now,
      input.ownerEmail,
      existing.id,
    );

    return getStorageConnectionByOwnerAndId(input.ownerEmail, existing.id) ?? null;
  }

  const id = crypto.randomUUID();
  insertStorageConnection.run(
    id,
    input.ownerEmail,
    input.provider,
    input.accountEmail,
    input.accountName,
    input.accountImage,
    input.externalAccountId,
    input.accessToken,
    input.refreshToken,
    input.expiresAt,
    grantedScopes,
    shouldMakePrimary ? 1 : 0,
    input.status ?? "connected",
    now,
    now,
  );

  return getStorageConnectionByOwnerAndId(input.ownerEmail, id) ?? null;
}

export function setPrimaryStorageConnectionForOwner(input: {
  ownerEmail: string;
  connectionId: string;
}) {
  const now = new Date().toISOString();
  clearPrimaryStorageConnections.run(now, input.ownerEmail);
  markStorageConnectionPrimary.run(now, input.ownerEmail, input.connectionId);

  return getStorageConnectionByOwnerAndId(input.ownerEmail, input.connectionId) ?? null;
}

export function deleteStorageConnectionForOwner(input: {
  ownerEmail: string;
  connectionId: string;
}) {
  const existing = getStorageConnectionByOwnerAndId(
    input.ownerEmail,
    input.connectionId,
  );

  if (!existing) {
    return getStorageConnectionsByOwnerEmail(input.ownerEmail);
  }

  const now = new Date().toISOString();

  database.transaction(() => {
    deleteStorageConnectionByOwnerAndId.run(input.ownerEmail, input.connectionId);

    if (existing.isPrimary) {
      const remaining = getStorageConnectionsByOwnerEmail(input.ownerEmail);

      if (remaining.length > 0) {
        clearPrimaryStorageConnections.run(now, input.ownerEmail);
        markStorageConnectionPrimary.run(now, input.ownerEmail, remaining[0]!.id);
      }
    }
  })();

  return getStorageConnectionsByOwnerEmail(input.ownerEmail);
}

export function createBugReport(input: {
  ownerEmail: string;
  reporterName: string | null;
  reporterEmail: string | null;
  currentPath: string | null;
  message: string;
}) {
  const createdAt = new Date().toISOString();

  insertBugReport.run(
    crypto.randomUUID(),
    input.ownerEmail,
    input.reporterName,
    input.reporterEmail,
    input.currentPath,
    input.message,
    createdAt,
  );
}
