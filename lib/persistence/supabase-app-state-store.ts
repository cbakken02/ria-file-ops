import "server-only";
import {
  decryptServerValue,
  encryptServerValue,
} from "@/lib/crypto/server-encryption";
import {
  queryPostgresSync,
  runPostgresStatementsSync,
} from "@/lib/postgres/server";
import type {
  BugReport,
  FilingEvent,
  FilingEventOutcome,
  FilingEventType,
  FirmSettings,
  StorageConnection,
  StorageConnectionStatus,
} from "@/lib/db";

type FirmSettingsRow = {
  id: string;
  ownerEmail: string;
  firmName: string | null;
  storageProvider: string;
  sourceFolderId: string | null;
  sourceFolderName: string | null;
  destinationFolderId: string | null;
  destinationFolderName: string | null;
  namingConvention: string;
  namingRulesJson: unknown;
  folderTemplate: string;
  reviewInstruction: string;
  createdAt: string;
  updatedAt: string;
};

type StorageConnectionRow = {
  id: string;
  ownerEmail: string;
  provider: string;
  accountEmail: string | null;
  accountName: string | null;
  accountImage: string | null;
  externalAccountId: string | null;
  accessTokenCiphertext: string | null;
  refreshTokenCiphertext: string | null;
  expiresAt: number | null;
  grantedScopes: unknown;
  isPrimary: boolean;
  status: StorageConnectionStatus;
  createdAt: string;
  updatedAt: string;
};

type FilingEventRow = {
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
  sourceParentIds: unknown;
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
  classifierReasons: unknown;
  classifierExcerpt: string | null;
  outcome: FilingEventOutcome;
  errorMessage: string | null;
  createdAt: string;
};

const FIRM_SETTINGS_SELECT = `
  SELECT
    id,
    owner_email AS "ownerEmail",
    firm_name AS "firmName",
    storage_provider AS "storageProvider",
    source_folder_id AS "sourceFolderId",
    source_folder_name AS "sourceFolderName",
    destination_folder_id AS "destinationFolderId",
    destination_folder_name AS "destinationFolderName",
    naming_convention AS "namingConvention",
    naming_rules_json AS "namingRulesJson",
    folder_template AS "folderTemplate",
    review_instruction AS "reviewInstruction",
    created_at AS "createdAt",
    updated_at AS "updatedAt"
  FROM public.firm_settings
`;

const STORAGE_CONNECTION_SELECT = `
  SELECT
    id,
    owner_email AS "ownerEmail",
    provider,
    account_email AS "accountEmail",
    account_name AS "accountName",
    account_image AS "accountImage",
    external_account_id AS "externalAccountId",
    access_token_ciphertext AS "accessTokenCiphertext",
    refresh_token_ciphertext AS "refreshTokenCiphertext",
    expires_at AS "expiresAt",
    granted_scopes AS "grantedScopes",
    is_primary AS "isPrimary",
    status,
    created_at AS "createdAt",
    updated_at AS "updatedAt"
  FROM public.storage_connections
`;

const FILING_EVENT_SELECT = `
  SELECT
    id,
    owner_email AS "ownerEmail",
    actor_email AS "actorEmail",
    actor_type AS "actorType",
    initiated_by_email AS "initiatedByEmail",
    batch_id AS "batchId",
    event_type AS "eventType",
    storage_provider AS "storageProvider",
    review_decision_id AS "reviewDecisionId",
    file_id AS "fileId",
    source_name AS "sourceName",
    source_mime_type AS "sourceMimeType",
    source_modified_time AS "sourceModifiedTime",
    source_drive_size AS "sourceDriveSize",
    download_byte_length AS "downloadByteLength",
    download_sha1 AS "downloadSha1",
    parser_version AS "parserVersion",
    parser_conflict_summary AS "parserConflictSummary",
    original_client_folder AS "originalClientFolder",
    original_top_level_folder AS "originalTopLevelFolder",
    original_filename AS "originalFilename",
    original_path AS "originalPath",
    final_client_folder AS "finalClientFolder",
    final_top_level_folder AS "finalTopLevelFolder",
    final_filename AS "finalFilename",
    destination_path AS "destinationPath",
    source_parent_ids AS "sourceParentIds",
    destination_root_id AS "destinationRootId",
    destination_root_name AS "destinationRootName",
    client_folder_id AS "clientFolderId",
    client_folder_name AS "clientFolderName",
    top_level_folder_id AS "topLevelFolderId",
    top_level_folder_name AS "topLevelFolderName",
    final_parent_id AS "finalParentId",
    detected_document_type AS "detectedDocumentType",
    detected_client AS "detectedClient",
    detected_client2 AS "detectedClient2",
    detected_ownership_type AS "detectedOwnershipType",
    detected_account_last4 AS "detectedAccountLast4",
    detected_account_type AS "detectedAccountType",
    detected_custodian AS "detectedCustodian",
    detected_tax_year AS "detectedTaxYear",
    detected_document_date AS "detectedDocumentDate",
    detected_id_type AS "detectedIdType",
    detected_entity_name AS "detectedEntityName",
    classifier_confidence AS "classifierConfidence",
    classifier_content_source AS "classifierContentSource",
    classifier_reasons AS "classifierReasons",
    classifier_excerpt AS "classifierExcerpt",
    outcome,
    error_message AS "errorMessage",
    created_at AS "createdAt"
  FROM public.filing_events
`;

export function getFirmSettingsByOwnerEmail(ownerEmail: string) {
  const result = queryPostgresSync<FirmSettingsRow>(
    `${FIRM_SETTINGS_SELECT} WHERE owner_email = $1`,
    [ownerEmail],
  );

  return mapFirmSettingsRow(result.rows[0]);
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
  const result = queryPostgresSync<FirmSettingsRow>(
    `
      INSERT INTO public.firm_settings (
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
      ) VALUES (
        $1, $2, $3, 'google_drive', $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $12
      )
      ON CONFLICT (owner_email)
      DO UPDATE SET
        firm_name = EXCLUDED.firm_name,
        storage_provider = EXCLUDED.storage_provider,
        source_folder_id = EXCLUDED.source_folder_id,
        source_folder_name = EXCLUDED.source_folder_name,
        destination_folder_id = EXCLUDED.destination_folder_id,
        destination_folder_name = EXCLUDED.destination_folder_name,
        naming_convention = EXCLUDED.naming_convention,
        naming_rules_json = EXCLUDED.naming_rules_json,
        folder_template = EXCLUDED.folder_template,
        review_instruction = EXCLUDED.review_instruction,
        updated_at = EXCLUDED.updated_at
      RETURNING
        id,
        owner_email AS "ownerEmail",
        firm_name AS "firmName",
        storage_provider AS "storageProvider",
        source_folder_id AS "sourceFolderId",
        source_folder_name AS "sourceFolderName",
        destination_folder_id AS "destinationFolderId",
        destination_folder_name AS "destinationFolderName",
        naming_convention AS "namingConvention",
        naming_rules_json AS "namingRulesJson",
        folder_template AS "folderTemplate",
        review_instruction AS "reviewInstruction",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
    [
      crypto.randomUUID(),
      input.ownerEmail,
      input.firmName || null,
      input.sourceFolderId,
      input.sourceFolderName,
      input.destinationFolderId,
      input.destinationFolderName,
      input.namingConvention,
      parseJsonString(input.namingRulesJson),
      input.folderTemplate,
      input.reviewInstruction,
      now,
    ],
  );

  return mapFirmSettingsRow(result.rows[0]) ?? null;
}

export function getFilingEventsByOwnerEmail(ownerEmail: string) {
  const result = queryPostgresSync<FilingEventRow>(
    `${FILING_EVENT_SELECT} WHERE owner_email = $1 ORDER BY created_at DESC`,
    [ownerEmail],
  );

  return result.rows
    .map((row) => mapFilingEventRow(row))
    .filter((event): event is FilingEvent => Boolean(event));
}

export function getFilingEventByOwnerAndId(ownerEmail: string, eventId: string) {
  const result = queryPostgresSync<FilingEventRow>(
    `${FILING_EVENT_SELECT} WHERE owner_email = $1 AND id = $2`,
    [ownerEmail, eventId],
  );

  return mapFilingEventRow(result.rows[0]) ?? null;
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
  queryPostgresSync(
    `
      INSERT INTO public.filing_events (
        id,
        owner_email,
        actor_email,
        actor_type,
        initiated_by_email,
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
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27::jsonb, $28, $29,
        $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43,
        $44, $45, $46, $47, $48::jsonb, $49, $50, $51, $52
      )
    `,
    [
      crypto.randomUUID(),
      input.ownerEmail,
      input.actorEmail,
      input.actorType ?? "user",
      input.initiatedByEmail ?? null,
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
      input.sourceParentIds,
      input.destinationRootId,
      input.destinationRootName,
      input.clientFolderId,
      input.clientFolderName,
      input.topLevelFolderId,
      input.topLevelFolderName,
      input.finalParentId,
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
      input.classifierReasons ?? null,
      input.classifierExcerpt ?? null,
      input.outcome,
      input.errorMessage,
      new Date().toISOString(),
    ],
  );
}

export function getStorageConnectionsByOwnerEmail(ownerEmail: string) {
  const result = queryPostgresSync<StorageConnectionRow>(
    `
      ${STORAGE_CONNECTION_SELECT}
      WHERE owner_email = $1
      ORDER BY is_primary DESC, updated_at DESC
    `,
    [ownerEmail],
  );

  return result.rows
    .map((row) => mapStorageConnectionRow(row))
    .filter((connection): connection is StorageConnection => Boolean(connection));
}

export function getPrimaryStorageConnectionByOwnerEmail(ownerEmail: string) {
  const result = queryPostgresSync<StorageConnectionRow>(
    `
      ${STORAGE_CONNECTION_SELECT}
      WHERE owner_email = $1 AND is_primary = true
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [ownerEmail],
  );

  return mapStorageConnectionRow(result.rows[0]);
}

export function getStorageConnectionByOwnerAndId(
  ownerEmail: string,
  connectionId: string,
) {
  const result = queryPostgresSync<StorageConnectionRow>(
    `${STORAGE_CONNECTION_SELECT} WHERE owner_email = $1 AND id = $2`,
    [ownerEmail, connectionId],
  );

  return mapStorageConnectionRow(result.rows[0]);
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
  const identityKey =
    buildStorageConnectionIdentityKey(
      input.provider,
      input.externalAccountId,
      input.accountEmail,
    ) ?? `generated:${crypto.randomUUID()}`;
  const existing = getStorageConnectionByOwnerAndIdentity(
    input.ownerEmail,
    input.provider,
    identityKey,
  );
  const hasPrimary = Boolean(getPrimaryStorageConnectionByOwnerEmail(input.ownerEmail));
  const shouldMakePrimary = Boolean(input.makePrimary || !hasPrimary);
  const effectiveRefreshToken = input.refreshToken ?? existing?.refreshToken ?? null;
  const encryptedAccessToken = encryptServerValue(input.accessToken);
  const encryptedRefreshToken = effectiveRefreshToken
    ? encryptServerValue(effectiveRefreshToken)
    : null;

  const statements = [];

  if (shouldMakePrimary) {
    statements.push({
      text: `
        UPDATE public.storage_connections
        SET is_primary = false, updated_at = $2
        WHERE owner_email = $1
      `,
      params: [input.ownerEmail, now],
    });
  }

  if (existing) {
    statements.push({
      text: `
        UPDATE public.storage_connections
        SET
          account_email = $1,
          account_name = $2,
          account_image = $3,
          external_account_id = $4,
          access_token_ciphertext = $5,
          refresh_token_ciphertext = $6,
          expires_at = $7,
          granted_scopes = $8::jsonb,
          is_primary = $9,
          status = $10,
          updated_at = $11
        WHERE owner_email = $12 AND id = $13
      `,
      params: [
        input.accountEmail,
        input.accountName,
        input.accountImage,
        input.externalAccountId,
        encryptedAccessToken,
        encryptedRefreshToken,
        input.expiresAt,
        JSON.stringify(input.grantedScopes),
        shouldMakePrimary ? true : existing.isPrimary,
        input.status ?? "connected",
        now,
        input.ownerEmail,
        existing.id,
      ],
    });
    statements.push({
      text: `${STORAGE_CONNECTION_SELECT} WHERE owner_email = $1 AND id = $2`,
      params: [input.ownerEmail, existing.id],
    });
  } else {
    const id = crypto.randomUUID();
    statements.push({
      text: `
        INSERT INTO public.storage_connections (
          id,
          owner_email,
          provider,
          account_email,
          account_name,
          account_image,
          external_account_id,
          identity_key,
          access_token_ciphertext,
          refresh_token_ciphertext,
          expires_at,
          granted_scopes,
          is_primary,
          status,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $15
        )
      `,
      params: [
        id,
        input.ownerEmail,
        input.provider,
        input.accountEmail,
        input.accountName,
        input.accountImage,
        input.externalAccountId,
        identityKey,
        encryptedAccessToken,
        encryptedRefreshToken,
        input.expiresAt,
        JSON.stringify(input.grantedScopes),
        shouldMakePrimary,
        input.status ?? "connected",
        now,
      ],
    });
    statements.push({
      text: `${STORAGE_CONNECTION_SELECT} WHERE owner_email = $1 AND id = $2`,
      params: [input.ownerEmail, id],
    });
  }

  const result = runPostgresStatementsSync<StorageConnectionRow>(statements, {
    useTransaction: statements.length > 1,
    resultIndex: statements.length - 1,
  });

  return mapStorageConnectionRow(result.rows[0]) ?? null;
}

export function setPrimaryStorageConnectionForOwner(input: {
  ownerEmail: string;
  connectionId: string;
}) {
  const now = new Date().toISOString();
  const result = runPostgresStatementsSync<StorageConnectionRow>(
    [
      {
        text: `
          UPDATE public.storage_connections
          SET is_primary = false, updated_at = $2
          WHERE owner_email = $1
        `,
        params: [input.ownerEmail, now],
      },
      {
        text: `
          UPDATE public.storage_connections
          SET is_primary = true, updated_at = $3
          WHERE owner_email = $1 AND id = $2
        `,
        params: [input.ownerEmail, input.connectionId, now],
      },
      {
        text: `${STORAGE_CONNECTION_SELECT} WHERE owner_email = $1 AND id = $2`,
        params: [input.ownerEmail, input.connectionId],
      },
    ],
    {
      useTransaction: true,
      resultIndex: 2,
    },
  );

  return mapStorageConnectionRow(result.rows[0]) ?? null;
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

  queryPostgresSync(
    `
      WITH deleted AS (
        DELETE FROM public.storage_connections
        WHERE owner_email = $1 AND id = $2
        RETURNING is_primary
      ),
      next_connection AS (
        SELECT id
        FROM public.storage_connections
        WHERE owner_email = $1
        ORDER BY updated_at DESC, id DESC
        LIMIT CASE
          WHEN EXISTS (SELECT 1 FROM deleted WHERE is_primary = true) THEN 1
          ELSE 0
        END
      )
      UPDATE public.storage_connections
      SET is_primary = true, updated_at = $3
      WHERE owner_email = $1 AND id IN (SELECT id FROM next_connection)
    `,
    [input.ownerEmail, input.connectionId, new Date().toISOString()],
  );

  return getStorageConnectionsByOwnerEmail(input.ownerEmail);
}

export function createBugReport(input: {
  ownerEmail: string;
  reporterName: string | null;
  reporterEmail: string | null;
  currentPath: string | null;
  message: string;
}) {
  queryPostgresSync(
    `
      INSERT INTO public.bug_reports (
        id,
        owner_email,
        reporter_name,
        reporter_email,
        current_path,
        message,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      crypto.randomUUID(),
      input.ownerEmail,
      input.reporterName,
      input.reporterEmail,
      input.currentPath,
      input.message,
      new Date().toISOString(),
    ],
  );
}

function getStorageConnectionByOwnerAndIdentity(
  ownerEmail: string,
  provider: string,
  identityKey: string,
) {
  const result = queryPostgresSync<StorageConnectionRow>(
    `
      ${STORAGE_CONNECTION_SELECT}
      WHERE owner_email = $1 AND provider = $2 AND identity_key = $3
    `,
    [ownerEmail, provider, identityKey],
  );

  return mapStorageConnectionRow(result.rows[0]);
}

function mapFirmSettingsRow(row: FirmSettingsRow | undefined) {
  if (!row) {
    return undefined;
  }

  return {
    ...row,
    namingRulesJson:
      row.namingRulesJson == null ? null : JSON.stringify(row.namingRulesJson),
  } satisfies FirmSettings;
}

function mapStorageConnectionRow(row: StorageConnectionRow | undefined) {
  if (!row) {
    return undefined;
  }

  if (!row.accessTokenCiphertext) {
    throw new Error(
      `Supabase storage connection ${row.id} is missing an encrypted access token.`,
    );
  }

  return {
    id: row.id,
    ownerEmail: row.ownerEmail,
    provider: row.provider,
    accountEmail: row.accountEmail,
    accountName: row.accountName,
    accountImage: row.accountImage,
    externalAccountId: row.externalAccountId,
    accessToken: decryptServerValue(row.accessTokenCiphertext),
    refreshToken: row.refreshTokenCiphertext
      ? decryptServerValue(row.refreshTokenCiphertext)
      : null,
    expiresAt: row.expiresAt,
    grantedScopes: normalizeStringArray(row.grantedScopes),
    isPrimary: Boolean(row.isPrimary),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } satisfies StorageConnection;
}

function mapFilingEventRow(row: FilingEventRow | undefined) {
  if (!row) {
    return undefined;
  }

  return {
    ...row,
    sourceParentIds:
      row.sourceParentIds == null ? null : JSON.stringify(row.sourceParentIds),
    classifierReasons:
      row.classifierReasons == null ? null : JSON.stringify(row.classifierReasons),
  } satisfies FilingEvent;
}

function normalizeStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [];
    } catch {
      return [];
    }
  }

  return [];
}

function parseJsonString(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Invalid JSON value provided for app-state persistence: ${error.message}`
        : "Invalid JSON value provided for app-state persistence.",
    );
  }
}

function buildStorageConnectionIdentityKey(
  provider: string,
  externalAccountId: string | null,
  accountEmail: string | null,
) {
  const external = externalAccountId?.trim();
  if (external) {
    return `external:${provider}:${external}`;
  }

  const email = accountEmail?.trim().toLowerCase();
  if (email) {
    return `email:${provider}:${email}`;
  }

  return null;
}
