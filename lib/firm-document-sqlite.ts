import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { AnalysisProfile } from "@/lib/ai-primary-parser-types";
import type {
  CanonicalAccountPartyRole,
  CanonicalAddress,
  CanonicalExtractedDocument,
  ExtractedAccount,
  ExtractedContact,
  NormalizedAccount,
  NormalizedAccountParty,
  NormalizedContact,
  NormalizedDate,
} from "@/lib/canonical-extracted-document";

const FIRM_DOCUMENT_DB_PATH_ENV = "RIA_FIRM_DOCUMENT_DB_PATH";
const FIRM_DOCUMENT_DB_DIR_ENV = "RIA_FIRM_DOCUMENT_DB_DIR";
const DEFAULT_FIRM_DOCUMENT_DB_DIR = path.join(
  process.cwd(),
  "data",
  ".firm-owned-documents",
);
const ACCOUNT_STATEMENT_CANONICAL_PAYLOAD_SCHEMA_VERSION =
  "canonical-account-statement-v1";
const IDENTITY_DOCUMENT_CANONICAL_PAYLOAD_SCHEMA_VERSION =
  "canonical-identity-document-v1";

type SqliteConnection = InstanceType<typeof Database>;

type AccountResolverResult = {
  accountId: string;
  resolutionBasis: string;
  resolverKey: string;
  primaryInstitutionId: string | null;
};

export type CanonicalSqliteWriteInput = {
  ownerEmail: string;
  dbPath?: string | null;
  analysisProfile: AnalysisProfile;
  analysisVersion: string;
  analysisRanAt: string;
  canonical: CanonicalExtractedDocument;
};

export type CanonicalSqliteWriteResult = {
  dbPath: string;
  documentId: string;
  ownerEmail: string;
};

const connectionCache = new Map<string, SqliteConnection>();

export function getFirmDocumentSqlitePath(ownerEmail: string) {
  const explicitPath = process.env[FIRM_DOCUMENT_DB_PATH_ENV]?.trim();
  if (explicitPath) {
    return path.resolve(explicitPath);
  }

  const configuredDir =
    process.env[FIRM_DOCUMENT_DB_DIR_ENV]?.trim() || DEFAULT_FIRM_DOCUMENT_DB_DIR;
  const ownerHash = sha1(normalizeResolverValue(ownerEmail));
  return path.join(path.resolve(configuredDir), `${ownerHash}.sqlite`);
}

export function closeFirmDocumentSqliteConnectionsForTests() {
  for (const connection of connectionCache.values()) {
    connection.close();
  }
  connectionCache.clear();
}

export function closeFirmDocumentSqliteConnection(dbPath: string) {
  const normalizedPath = path.resolve(dbPath);
  const connection = connectionCache.get(normalizedPath);
  if (!connection) {
    return;
  }

  connection.close();
  connectionCache.delete(normalizedPath);
}

export function writeCanonicalAccountStatementToSqlite(
  input: CanonicalSqliteWriteInput,
): CanonicalSqliteWriteResult | null {
  if (
    input.canonical.classification.normalized.documentTypeId !== "account_statement"
  ) {
    return null;
  }

  const dbPath = input.dbPath?.trim() || getFirmDocumentSqlitePath(input.ownerEmail);
  const db = getFirmDocumentDatabase(dbPath);

  const transaction = db.transaction(
    (transactionInput: CanonicalSqliteWriteInput): CanonicalSqliteWriteResult => {
      const now = new Date().toISOString();
      const ownerEmail = transactionInput.ownerEmail.trim().toLowerCase();
      const sourceFileId = resolveSourceFileId(transactionInput.canonical);
      const documentId = stableId("doc", ownerEmail, sourceFileId);
      const preferredDocumentDate =
        transactionInput.canonical.normalized.primaryFacts.documentDate ??
        resolveFirstDateValue(
          transactionInput.canonical.normalized.dates,
          "document_date",
        ) ??
        resolveFirstDateValue(
          transactionInput.canonical.normalized.dates,
          "statement_period_end",
        );

      upsertDocument(db, {
        documentId,
        ownerEmail,
        sourceFileId,
        canonical: transactionInput.canonical,
        analysisProfile: transactionInput.analysisProfile,
        analysisVersion: transactionInput.analysisVersion,
        analysisRanAt: transactionInput.analysisRanAt,
        now,
        documentDate: preferredDocumentDate,
      });
      upsertCanonicalPayload(db, {
        documentId,
        canonical: transactionInput.canonical,
        now,
      });

      const stableInstitutionIdByCanonicalId = new Map<string, string>();
      const stablePartyIdByCanonicalId = new Map<string, string>();
      const stableAccountIdByCanonicalId = new Map<string, string>();

      const documentInstitutionRows = buildDocumentInstitutions({
        ownerEmail,
        documentId,
        canonical: transactionInput.canonical,
        stableInstitutionIdByCanonicalId,
        now,
      });
      for (const row of documentInstitutionRows) {
        upsertInstitution(db, row.stableUpsert);
      }

      const documentPartyRows = buildDocumentParties({
        ownerEmail,
        documentId,
        canonical: transactionInput.canonical,
        stablePartyIdByCanonicalId,
        now,
      });
      for (const row of documentPartyRows) {
        upsertParty(db, row.stableUpsert);
      }

      const stableAccountPartyRoleInputs = expandNormalizedAccountPartyRoles(
        transactionInput.canonical.normalized.accountParties,
      );
      const documentAccountRows = buildDocumentAccountSnapshots({
        ownerEmail,
        documentId,
        canonical: transactionInput.canonical,
        stableInstitutionIdByCanonicalId,
        stablePartyIdByCanonicalId,
        stableAccountIdByCanonicalId,
        normalizedAccountPartyRoles: stableAccountPartyRoleInputs,
        now,
      });
      for (const row of documentAccountRows) {
        upsertAccount(db, row.stableUpsert);
      }

      const stableAccountPartyRows = buildStableAccountParties({
        ownerEmail,
        documentId,
        stableAccountIdByCanonicalId,
        stablePartyIdByCanonicalId,
        normalizedAccountPartyRoles: stableAccountPartyRoleInputs,
        normalizedAccountParties: transactionInput.canonical.normalized.accountParties,
        now,
      });
      for (const row of stableAccountPartyRows) {
        upsertAccountParty(db, row);
      }

      replaceDocumentScopedRows(db, documentId);

      const documentInstitutionIdByCanonicalId = new Map<string, string>();
      const documentInstitutionIdByStableInstitutionId = new Map<string, string>();
      for (const row of documentInstitutionRows) {
        insertDocumentInstitution(db, row.documentInsert);
        for (const key of row.canonicalReferenceIds) {
          documentInstitutionIdByCanonicalId.set(key, row.documentInsert.documentInstitutionId);
        }
        if (row.documentInsert.institutionId) {
          documentInstitutionIdByStableInstitutionId.set(
            row.documentInsert.institutionId,
            row.documentInsert.documentInstitutionId,
          );
        }
      }

      const documentPartyIdByCanonicalId = new Map<string, string>();
      const stablePartyIdByNormalizedName = new Map<string, string>();
      for (const row of documentPartyRows) {
        insertDocumentParty(db, row.documentInsert);
        for (const key of row.canonicalReferenceIds) {
          documentPartyIdByCanonicalId.set(key, row.documentInsert.documentPartyId);
        }
        if (row.documentInsert.normalizedDisplayName && row.documentInsert.partyId) {
          stablePartyIdByNormalizedName.set(
            normalizeResolverValue(row.documentInsert.normalizedDisplayName),
            row.documentInsert.partyId,
          );
        }
      }

      const documentAccountSnapshotIdByCanonicalId = new Map<string, string>();
      const documentSnapshotRows = documentAccountRows.map((row, index) =>
        createDocumentAccountSnapshotInsert({
          documentId,
          row,
          index,
          canonical: transactionInput.canonical,
          documentInstitutionIdByStableInstitutionId,
          primaryFacts: transactionInput.canonical.normalized.primaryFacts,
        }),
      );
      for (const row of documentSnapshotRows) {
        insertDocumentAccountSnapshot(db, row.documentInsert);
        for (const key of row.canonicalReferenceIds) {
          documentAccountSnapshotIdByCanonicalId.set(
            key,
            row.documentInsert.documentAccountSnapshotId,
          );
        }
      }

      const documentAccountPartyRows = buildDocumentAccountParties({
        ownerEmail,
        documentId,
        canonical: transactionInput.canonical,
        documentAccountSnapshotIdByCanonicalId,
        documentPartyIdByCanonicalId,
        stableAccountIdByCanonicalId,
        stablePartyIdByCanonicalId,
        now,
      });
      for (const row of documentAccountPartyRows) {
        insertDocumentAccountParty(db, row);
      }

      const documentContacts = buildDocumentContacts({
        ownerEmail,
        documentId,
        extractedContacts: transactionInput.canonical.extracted.contacts,
        normalizedContacts: transactionInput.canonical.normalized.contacts,
        stableInstitutionIdByCanonicalId,
        documentInstitutionIdByCanonicalId,
        documentInstitutionIdByStableInstitutionId,
        documentSnapshotRows,
      });
      for (const row of documentContacts) {
        insertDocumentContact(db, row);
      }

      const accountValueRows = buildAccountValues({
        ownerEmail,
        canonical: transactionInput.canonical,
        documentSnapshotRows,
      });
      for (const row of accountValueRows) {
        insertAccountValue(db, row);
      }

      upsertDocumentPrimaryFacts(db, {
        documentId,
        ownerEmail,
        canonical: transactionInput.canonical,
        stablePartyIdByNormalizedName,
        stableAccountIdByCanonicalId,
        stableInstitutionIdByCanonicalId,
        analysisVersion: transactionInput.analysisVersion,
        updatedAt: now,
      });

      return {
        dbPath,
        documentId,
        ownerEmail,
      };
    },
  );

  return transaction(input);
}

export function writeCanonicalIdentityDocumentToSqlite(
  input: CanonicalSqliteWriteInput,
): CanonicalSqliteWriteResult | null {
  if (input.canonical.classification.normalized.documentTypeId !== "identity_document") {
    return null;
  }

  const dbPath = input.dbPath?.trim() || getFirmDocumentSqlitePath(input.ownerEmail);
  const db = getFirmDocumentDatabase(dbPath);

  const transaction = db.transaction(
    (transactionInput: CanonicalSqliteWriteInput): CanonicalSqliteWriteResult => {
      const now = new Date().toISOString();
      const ownerEmail = transactionInput.ownerEmail.trim().toLowerCase();
      const sourceFileId = resolveSourceFileId(transactionInput.canonical);
      const documentId = stableId("doc", ownerEmail, sourceFileId);
      const preferredDocumentDate =
        transactionInput.canonical.normalized.primaryFacts.documentDate ??
        resolveFirstDateValue(
          transactionInput.canonical.normalized.dates,
          "document_date",
        ) ??
        resolveFirstDateValue(
          transactionInput.canonical.normalized.dates,
          "issue_date",
        );

      upsertDocument(db, {
        documentId,
        ownerEmail,
        sourceFileId,
        canonical: transactionInput.canonical,
        analysisProfile: transactionInput.analysisProfile,
        analysisVersion: transactionInput.analysisVersion,
        analysisRanAt: transactionInput.analysisRanAt,
        now,
        documentDate: preferredDocumentDate,
      });
      upsertCanonicalPayload(db, {
        documentId,
        canonical: transactionInput.canonical,
        now,
      });

      const stablePartyIdByCanonicalId = new Map<string, string>();
      const stableAccountIdByCanonicalId = new Map<string, string>();
      const stableInstitutionIdByCanonicalId = new Map<string, string>();

      const documentPartyRows = buildDocumentParties({
        ownerEmail,
        documentId,
        canonical: transactionInput.canonical,
        stablePartyIdByCanonicalId,
        now,
      });
      for (const row of documentPartyRows) {
        upsertParty(db, row.stableUpsert);
      }

      replaceDocumentScopedRows(db, documentId);

      const documentPartyIdByCanonicalId = new Map<string, string>();
      const stablePartyIdByNormalizedName = new Map<string, string>();
      for (const row of documentPartyRows) {
        insertDocumentParty(db, row.documentInsert);
        for (const key of row.canonicalReferenceIds) {
          documentPartyIdByCanonicalId.set(key, row.documentInsert.documentPartyId);
        }
        if (row.documentInsert.normalizedDisplayName && row.documentInsert.partyId) {
          stablePartyIdByNormalizedName.set(
            normalizeResolverValue(row.documentInsert.normalizedDisplayName),
            row.documentInsert.partyId,
          );
        }
      }

      const documentPartyFactRows = buildDocumentPartyFacts({
        documentId,
        canonical: transactionInput.canonical,
        documentPartyIdByCanonicalId,
        stablePartyIdByCanonicalId,
      });
      for (const row of documentPartyFactRows) {
        insertDocumentPartyFact(db, row);
      }

      upsertDocumentPrimaryFacts(db, {
        documentId,
        ownerEmail,
        canonical: transactionInput.canonical,
        stablePartyIdByNormalizedName,
        stableAccountIdByCanonicalId,
        stableInstitutionIdByCanonicalId,
        analysisVersion: transactionInput.analysisVersion,
        updatedAt: now,
      });

      return {
        dbPath,
        documentId,
        ownerEmail,
      };
    },
  );

  return transaction(input);
}

function getFirmDocumentDatabase(dbPath: string) {
  const cached = connectionCache.get(dbPath);
  if (cached) {
    return cached;
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  ensureFirmDocumentSchema(db);
  connectionCache.set(dbPath, db);
  return db;
}

function ensureFirmDocumentSchema(db: SqliteConnection) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      document_id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      source_file_id TEXT NOT NULL,
      source_name TEXT,
      mime_type TEXT,
      modified_time TEXT,
      download_sha1 TEXT,
      download_byte_length INTEGER,
      content_source TEXT,
      analysis_profile TEXT NOT NULL,
      analysis_version TEXT NOT NULL,
      parser_version TEXT,
      normalized_document_type_id TEXT,
      normalized_document_subtype TEXT,
      extracted_document_type_id TEXT,
      extracted_document_subtype TEXT,
      document_date TEXT,
      parser_conflict_summary TEXT,
      ai_used INTEGER NOT NULL DEFAULT 0,
      ai_model TEXT,
      ai_prompt_version TEXT,
      analyzed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(owner_email, source_file_id)
    );

    CREATE TABLE IF NOT EXISTS document_canonical_payloads (
      document_id TEXT PRIMARY KEY REFERENCES documents(document_id) ON DELETE CASCADE,
      canonical_schema_version TEXT NOT NULL,
      canonical_json TEXT NOT NULL,
      stored_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS institutions (
      institution_id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      resolver_key TEXT NOT NULL,
      canonical_name TEXT,
      resolution_basis TEXT,
      first_seen_document_id TEXT REFERENCES documents(document_id),
      last_seen_document_id TEXT REFERENCES documents(document_id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(owner_email, resolver_key)
    );

    CREATE TABLE IF NOT EXISTS parties (
      party_id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      resolver_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      canonical_display_name TEXT,
      address_signature TEXT,
      resolution_basis TEXT,
      first_seen_document_id TEXT REFERENCES documents(document_id),
      last_seen_document_id TEXT REFERENCES documents(document_id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(owner_email, resolver_key)
    );

    CREATE TABLE IF NOT EXISTS accounts (
      account_id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      resolver_key TEXT NOT NULL,
      primary_institution_id TEXT REFERENCES institutions(institution_id),
      account_number_hash TEXT,
      masked_account_number TEXT,
      account_last4 TEXT,
      canonical_account_type TEXT,
      resolution_basis TEXT,
      is_provisional INTEGER NOT NULL DEFAULT 1,
      first_seen_document_id TEXT REFERENCES documents(document_id),
      last_seen_document_id TEXT REFERENCES documents(document_id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(owner_email, resolver_key)
    );

    CREATE TABLE IF NOT EXISTS account_parties (
      account_party_id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      account_id TEXT NOT NULL REFERENCES accounts(account_id),
      party_id TEXT NOT NULL REFERENCES parties(party_id),
      role TEXT NOT NULL,
      relationship_label TEXT,
      first_seen_document_id TEXT REFERENCES documents(document_id),
      last_seen_document_id TEXT REFERENCES documents(document_id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(owner_email, account_id, party_id, role)
    );

    CREATE TABLE IF NOT EXISTS document_institutions (
      document_institution_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
      institution_id TEXT REFERENCES institutions(institution_id),
      source_index INTEGER NOT NULL,
      raw_name TEXT,
      normalized_name TEXT,
      address_json TEXT,
      is_primary INTEGER NOT NULL DEFAULT 0,
      UNIQUE(document_id, source_index)
    );

    CREATE TABLE IF NOT EXISTS document_parties (
      document_party_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
      party_id TEXT REFERENCES parties(party_id),
      source_index INTEGER NOT NULL,
      kind TEXT,
      raw_name TEXT,
      normalized_display_name TEXT,
      address_json TEXT,
      UNIQUE(document_id, source_index)
    );

    CREATE TABLE IF NOT EXISTS document_party_facts (
      document_party_fact_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
      document_party_id TEXT REFERENCES document_parties(document_party_id) ON DELETE CASCADE,
      party_id TEXT REFERENCES parties(party_id),
      source_index INTEGER NOT NULL,
      id_kind TEXT,
      id_type TEXT,
      raw_id_value TEXT,
      masked_id_value TEXT,
      issuing_authority TEXT,
      birth_date TEXT,
      issue_date TEXT,
      expiration_date TEXT,
      UNIQUE(document_id, source_index)
    );

    CREATE TABLE IF NOT EXISTS document_account_snapshots (
      document_account_snapshot_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
      account_id TEXT REFERENCES accounts(account_id),
      document_institution_id TEXT REFERENCES document_institutions(document_institution_id),
      source_index INTEGER NOT NULL,
      observed_account_number TEXT,
      observed_masked_account_number TEXT,
      observed_account_last4 TEXT,
      observed_account_type_raw TEXT,
      normalized_account_type TEXT,
      registration_type TEXT,
      statement_start_date TEXT,
      statement_end_date TEXT,
      opened_date TEXT,
      closed_date TEXT,
      is_primary_account INTEGER NOT NULL DEFAULT 0,
      resolver_basis TEXT,
      UNIQUE(document_id, source_index)
    );

    CREATE TABLE IF NOT EXISTS document_account_parties (
      document_account_party_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
      document_account_snapshot_id TEXT NOT NULL REFERENCES document_account_snapshots(document_account_snapshot_id) ON DELETE CASCADE,
      account_party_id TEXT REFERENCES account_parties(account_party_id),
      account_id TEXT REFERENCES accounts(account_id),
      document_party_id TEXT REFERENCES document_parties(document_party_id),
      party_id TEXT REFERENCES parties(party_id),
      source_index INTEGER NOT NULL,
      role TEXT NOT NULL,
      relationship_label TEXT,
      allocation_percent TEXT,
      UNIQUE(document_id, source_index)
    );

    CREATE TABLE IF NOT EXISTS document_contacts (
      document_contact_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
      document_account_snapshot_id TEXT REFERENCES document_account_snapshots(document_account_snapshot_id) ON DELETE CASCADE,
      document_institution_id TEXT REFERENCES document_institutions(document_institution_id),
      institution_id TEXT REFERENCES institutions(institution_id),
      document_party_id TEXT REFERENCES document_parties(document_party_id),
      party_id TEXT REFERENCES parties(party_id),
      source_index INTEGER NOT NULL,
      method TEXT NOT NULL,
      purpose TEXT NOT NULL,
      label TEXT,
      raw_value TEXT,
      normalized_value TEXT,
      hours_text TEXT,
      UNIQUE(document_id, source_index)
    );

    CREATE TABLE IF NOT EXISTS account_values (
      account_value_id TEXT PRIMARY KEY,
      document_account_snapshot_id TEXT NOT NULL REFERENCES document_account_snapshots(document_account_snapshot_id) ON DELETE CASCADE,
      account_id TEXT REFERENCES accounts(account_id),
      source_index INTEGER NOT NULL,
      kind TEXT NOT NULL,
      label TEXT,
      amount TEXT,
      currency TEXT,
      UNIQUE(document_account_snapshot_id, source_index)
    );

    CREATE TABLE IF NOT EXISTS document_primary_facts (
      document_id TEXT PRIMARY KEY REFERENCES documents(document_id) ON DELETE CASCADE,
      owner_email TEXT NOT NULL,
      primary_party_id TEXT REFERENCES parties(party_id),
      secondary_party_id TEXT REFERENCES parties(party_id),
      detected_client TEXT,
      detected_client2 TEXT,
      ownership_type TEXT,
      primary_account_id TEXT REFERENCES accounts(account_id),
      account_last4 TEXT,
      account_type TEXT,
      custodian_institution_id TEXT REFERENCES institutions(institution_id),
      custodian_name TEXT,
      document_date TEXT,
      entity_name TEXT,
      id_type TEXT,
      tax_year TEXT,
      derived_from_version TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_documents_owner_source_file
      ON documents(owner_email, source_file_id);
    CREATE INDEX IF NOT EXISTS idx_documents_type_date
      ON documents(normalized_document_type_id, document_date DESC);
    CREATE INDEX IF NOT EXISTS idx_parties_owner_name
      ON parties(owner_email, canonical_display_name);
    CREATE INDEX IF NOT EXISTS idx_document_party_facts_party
      ON document_party_facts(party_id, expiration_date);
    CREATE INDEX IF NOT EXISTS idx_institutions_owner_name
      ON institutions(owner_email, canonical_name);
    CREATE INDEX IF NOT EXISTS idx_accounts_owner_last4
      ON accounts(owner_email, primary_institution_id, account_last4);
    CREATE INDEX IF NOT EXISTS idx_account_parties_party
      ON account_parties(party_id, account_id);
    CREATE INDEX IF NOT EXISTS idx_document_account_snapshots_account_latest
      ON document_account_snapshots(account_id, statement_end_date DESC, document_id);
    CREATE INDEX IF NOT EXISTS idx_document_contacts_purpose_method
      ON document_contacts(institution_id, purpose, method);
    CREATE INDEX IF NOT EXISTS idx_account_values_account_kind
      ON account_values(account_id, kind);
  `);

  db.exec(`
    DROP VIEW IF EXISTS latest_account_snapshot_v;
    CREATE VIEW latest_account_snapshot_v AS
    WITH ranked AS (
      SELECT
        snapshots.document_account_snapshot_id,
        snapshots.document_id,
        snapshots.account_id,
        snapshots.document_institution_id,
        snapshots.source_index,
        snapshots.observed_account_number,
        snapshots.observed_masked_account_number,
        snapshots.observed_account_last4,
        snapshots.observed_account_type_raw,
        snapshots.normalized_account_type,
        snapshots.registration_type,
        snapshots.statement_start_date,
        snapshots.statement_end_date,
        snapshots.opened_date,
        snapshots.closed_date,
        snapshots.is_primary_account,
        snapshots.resolver_basis,
        documents.owner_email,
        documents.source_file_id,
        documents.source_name,
        documents.document_date,
        documents.analyzed_at,
        ROW_NUMBER() OVER (
          PARTITION BY snapshots.account_id
          ORDER BY
            COALESCE(snapshots.statement_end_date, documents.document_date, documents.analyzed_at) DESC,
            documents.analyzed_at DESC,
            documents.updated_at DESC,
            documents.document_id DESC
        ) AS row_num
      FROM document_account_snapshots AS snapshots
      INNER JOIN documents
        ON documents.document_id = snapshots.document_id
      WHERE snapshots.account_id IS NOT NULL
    )
    SELECT
      document_account_snapshot_id,
      document_id,
      account_id,
      document_institution_id,
      source_index,
      observed_account_number,
      observed_masked_account_number,
      observed_account_last4,
      observed_account_type_raw,
      normalized_account_type,
      registration_type,
      statement_start_date,
      statement_end_date,
      opened_date,
      closed_date,
      is_primary_account,
      resolver_basis,
      owner_email,
      source_file_id,
      source_name,
      document_date,
      analyzed_at
    FROM ranked
    WHERE row_num = 1;

    DROP VIEW IF EXISTS latest_account_document_v;
    CREATE VIEW latest_account_document_v AS
    SELECT
      latest.account_id,
      latest.document_account_snapshot_id,
      latest.document_id,
      latest.owner_email,
      latest.source_file_id,
      latest.source_name,
      latest.document_date,
      latest.analyzed_at,
      latest.statement_start_date,
      latest.statement_end_date,
      latest.normalized_account_type,
      latest.observed_account_last4
    FROM latest_account_snapshot_v AS latest;
  `);
}

function upsertDocument(
  db: SqliteConnection,
  input: {
    documentId: string;
    ownerEmail: string;
    sourceFileId: string;
    canonical: CanonicalExtractedDocument;
    analysisProfile: AnalysisProfile;
    analysisVersion: string;
    analysisRanAt: string;
    now: string;
    documentDate: string | null;
  },
) {
  db.prepare(`
    INSERT INTO documents (
      document_id,
      owner_email,
      source_file_id,
      source_name,
      mime_type,
      modified_time,
      download_sha1,
      download_byte_length,
      content_source,
      analysis_profile,
      analysis_version,
      parser_version,
      normalized_document_type_id,
      normalized_document_subtype,
      extracted_document_type_id,
      extracted_document_subtype,
      document_date,
      parser_conflict_summary,
      ai_used,
      ai_model,
      ai_prompt_version,
      analyzed_at,
      created_at,
      updated_at
    ) VALUES (
      @documentId,
      @ownerEmail,
      @sourceFileId,
      @sourceName,
      @mimeType,
      @modifiedTime,
      @downloadSha1,
      @downloadByteLength,
      @contentSource,
      @analysisProfile,
      @analysisVersion,
      @parserVersion,
      @normalizedDocumentTypeId,
      @normalizedDocumentSubtype,
      @extractedDocumentTypeId,
      @extractedDocumentSubtype,
      @documentDate,
      @parserConflictSummary,
      @aiUsed,
      @aiModel,
      @aiPromptVersion,
      @analyzedAt,
      @createdAt,
      @updatedAt
    )
    ON CONFLICT(document_id) DO UPDATE SET
      source_name = excluded.source_name,
      mime_type = excluded.mime_type,
      modified_time = excluded.modified_time,
      download_sha1 = excluded.download_sha1,
      download_byte_length = excluded.download_byte_length,
      content_source = excluded.content_source,
      analysis_profile = excluded.analysis_profile,
      analysis_version = excluded.analysis_version,
      parser_version = excluded.parser_version,
      normalized_document_type_id = excluded.normalized_document_type_id,
      normalized_document_subtype = excluded.normalized_document_subtype,
      extracted_document_type_id = excluded.extracted_document_type_id,
      extracted_document_subtype = excluded.extracted_document_subtype,
      document_date = excluded.document_date,
      parser_conflict_summary = excluded.parser_conflict_summary,
      ai_used = excluded.ai_used,
      ai_model = excluded.ai_model,
      ai_prompt_version = excluded.ai_prompt_version,
      analyzed_at = excluded.analyzed_at,
      updated_at = excluded.updated_at
  `).run({
    documentId: input.documentId,
    ownerEmail: input.ownerEmail,
    sourceFileId: input.sourceFileId,
    sourceName: input.canonical.source.file.sourceName,
    mimeType: input.canonical.source.file.mimeType,
    modifiedTime: input.canonical.source.file.modifiedTime,
    downloadSha1: input.canonical.source.file.downloadSha1,
    downloadByteLength: input.canonical.source.file.downloadByteLength,
    contentSource: input.canonical.source.extraction.contentSource,
    analysisProfile: input.analysisProfile,
    analysisVersion: input.analysisVersion,
    parserVersion: input.canonical.diagnostics.parserVersion,
    normalizedDocumentTypeId: input.canonical.classification.normalized.documentTypeId,
    normalizedDocumentSubtype: input.canonical.classification.normalized.documentSubtype,
    extractedDocumentTypeId: input.canonical.classification.extracted.documentTypeId,
    extractedDocumentSubtype: input.canonical.classification.extracted.documentSubtype,
    documentDate: input.documentDate,
    parserConflictSummary: input.canonical.diagnostics.parserConflictSummary,
    aiUsed: input.canonical.diagnostics.ai.used ? 1 : 0,
    aiModel: input.canonical.diagnostics.ai.model,
    aiPromptVersion: input.canonical.diagnostics.ai.promptVersion,
    analyzedAt: input.analysisRanAt,
    createdAt: input.now,
    updatedAt: input.now,
  });
}

function upsertCanonicalPayload(
  db: SqliteConnection,
  input: {
    documentId: string;
    canonical: CanonicalExtractedDocument;
    now: string;
  },
) {
  db.prepare(`
    INSERT INTO document_canonical_payloads (
      document_id,
      canonical_schema_version,
      canonical_json,
      stored_at
    ) VALUES (
      @documentId,
      @schemaVersion,
      @canonicalJson,
      @storedAt
    )
    ON CONFLICT(document_id) DO UPDATE SET
      canonical_schema_version = excluded.canonical_schema_version,
      canonical_json = excluded.canonical_json,
      stored_at = excluded.stored_at
  `).run({
    documentId: input.documentId,
    schemaVersion: resolveCanonicalPayloadSchemaVersion(input.canonical),
    canonicalJson: JSON.stringify(input.canonical),
    storedAt: input.now,
  });
}

function upsertInstitution(
  db: SqliteConnection,
  input: {
    institutionId: string;
    ownerEmail: string;
    resolverKey: string;
    canonicalName: string | null;
    resolutionBasis: string;
    documentId: string;
    now: string;
  },
) {
  db.prepare(`
    INSERT INTO institutions (
      institution_id,
      owner_email,
      resolver_key,
      canonical_name,
      resolution_basis,
      first_seen_document_id,
      last_seen_document_id,
      created_at,
      updated_at
    ) VALUES (
      @institutionId,
      @ownerEmail,
      @resolverKey,
      @canonicalName,
      @resolutionBasis,
      @documentId,
      @documentId,
      @now,
      @now
    )
    ON CONFLICT(institution_id) DO UPDATE SET
      canonical_name = COALESCE(excluded.canonical_name, institutions.canonical_name),
      resolution_basis = excluded.resolution_basis,
      last_seen_document_id = excluded.last_seen_document_id,
      updated_at = excluded.updated_at
  `).run(input);
}

function upsertParty(
  db: SqliteConnection,
  input: {
    partyId: string;
    ownerEmail: string;
    resolverKey: string;
    kind: string;
    canonicalDisplayName: string | null;
    addressSignature: string | null;
    resolutionBasis: string;
    documentId: string;
    now: string;
  },
) {
  db.prepare(`
    INSERT INTO parties (
      party_id,
      owner_email,
      resolver_key,
      kind,
      canonical_display_name,
      address_signature,
      resolution_basis,
      first_seen_document_id,
      last_seen_document_id,
      created_at,
      updated_at
    ) VALUES (
      @partyId,
      @ownerEmail,
      @resolverKey,
      @kind,
      @canonicalDisplayName,
      @addressSignature,
      @resolutionBasis,
      @documentId,
      @documentId,
      @now,
      @now
    )
    ON CONFLICT(party_id) DO UPDATE SET
      canonical_display_name = COALESCE(excluded.canonical_display_name, parties.canonical_display_name),
      address_signature = COALESCE(excluded.address_signature, parties.address_signature),
      resolution_basis = excluded.resolution_basis,
      last_seen_document_id = excluded.last_seen_document_id,
      updated_at = excluded.updated_at
  `).run(input);
}

function upsertAccount(
  db: SqliteConnection,
  input: {
    accountId: string;
    ownerEmail: string;
    resolverKey: string;
    primaryInstitutionId: string | null;
    accountNumberHash: string | null;
    maskedAccountNumber: string | null;
    accountLast4: string | null;
    canonicalAccountType: string | null;
    resolutionBasis: string;
    isProvisional: number;
    documentId: string;
    now: string;
  },
) {
  db.prepare(`
    INSERT INTO accounts (
      account_id,
      owner_email,
      resolver_key,
      primary_institution_id,
      account_number_hash,
      masked_account_number,
      account_last4,
      canonical_account_type,
      resolution_basis,
      is_provisional,
      first_seen_document_id,
      last_seen_document_id,
      created_at,
      updated_at
    ) VALUES (
      @accountId,
      @ownerEmail,
      @resolverKey,
      @primaryInstitutionId,
      @accountNumberHash,
      @maskedAccountNumber,
      @accountLast4,
      @canonicalAccountType,
      @resolutionBasis,
      @isProvisional,
      @documentId,
      @documentId,
      @now,
      @now
    )
    ON CONFLICT(account_id) DO UPDATE SET
      primary_institution_id = COALESCE(excluded.primary_institution_id, accounts.primary_institution_id),
      account_number_hash = COALESCE(excluded.account_number_hash, accounts.account_number_hash),
      masked_account_number = COALESCE(excluded.masked_account_number, accounts.masked_account_number),
      account_last4 = COALESCE(excluded.account_last4, accounts.account_last4),
      canonical_account_type = COALESCE(excluded.canonical_account_type, accounts.canonical_account_type),
      resolution_basis = excluded.resolution_basis,
      is_provisional = MIN(accounts.is_provisional, excluded.is_provisional),
      last_seen_document_id = excluded.last_seen_document_id,
      updated_at = excluded.updated_at
  `).run(input);
}

function upsertAccountParty(
  db: SqliteConnection,
  input: {
    accountPartyId: string;
    ownerEmail: string;
    accountId: string;
    partyId: string;
    role: CanonicalAccountPartyRole;
    relationshipLabel: string | null;
    documentId: string;
    now: string;
  },
) {
  db.prepare(`
    INSERT INTO account_parties (
      account_party_id,
      owner_email,
      account_id,
      party_id,
      role,
      relationship_label,
      first_seen_document_id,
      last_seen_document_id,
      created_at,
      updated_at
    ) VALUES (
      @accountPartyId,
      @ownerEmail,
      @accountId,
      @partyId,
      @role,
      @relationshipLabel,
      @documentId,
      @documentId,
      @now,
      @now
    )
    ON CONFLICT(account_party_id) DO UPDATE SET
      relationship_label = COALESCE(excluded.relationship_label, account_parties.relationship_label),
      last_seen_document_id = excluded.last_seen_document_id,
      updated_at = excluded.updated_at
  `).run(input);
}

function insertDocumentInstitution(
  db: SqliteConnection,
  input: {
    documentInstitutionId: string;
    documentId: string;
    institutionId: string | null;
    sourceIndex: number;
    rawName: string | null;
    normalizedName: string | null;
    addressJson: string | null;
    isPrimary: number;
  },
) {
  db.prepare(`
    INSERT INTO document_institutions (
      document_institution_id,
      document_id,
      institution_id,
      source_index,
      raw_name,
      normalized_name,
      address_json,
      is_primary
    ) VALUES (
      @documentInstitutionId,
      @documentId,
      @institutionId,
      @sourceIndex,
      @rawName,
      @normalizedName,
      @addressJson,
      @isPrimary
    )
  `).run(input);
}

function insertDocumentParty(
  db: SqliteConnection,
  input: {
    documentPartyId: string;
    documentId: string;
    partyId: string | null;
    sourceIndex: number;
    kind: string | null;
    rawName: string | null;
    normalizedDisplayName: string | null;
    addressJson: string | null;
  },
) {
  db.prepare(`
    INSERT INTO document_parties (
      document_party_id,
      document_id,
      party_id,
      source_index,
      kind,
      raw_name,
      normalized_display_name,
      address_json
    ) VALUES (
      @documentPartyId,
      @documentId,
      @partyId,
      @sourceIndex,
      @kind,
      @rawName,
      @normalizedDisplayName,
      @addressJson
    )
  `).run(input);
}

function insertDocumentPartyFact(
  db: SqliteConnection,
  input: {
    documentPartyFactId: string;
    documentId: string;
    documentPartyId: string | null;
    partyId: string | null;
    sourceIndex: number;
    idKind: string | null;
    idType: string | null;
    rawIdValue: string | null;
    maskedIdValue: string | null;
    issuingAuthority: string | null;
    birthDate: string | null;
    issueDate: string | null;
    expirationDate: string | null;
  },
) {
  db.prepare(`
    INSERT INTO document_party_facts (
      document_party_fact_id,
      document_id,
      document_party_id,
      party_id,
      source_index,
      id_kind,
      id_type,
      raw_id_value,
      masked_id_value,
      issuing_authority,
      birth_date,
      issue_date,
      expiration_date
    ) VALUES (
      @documentPartyFactId,
      @documentId,
      @documentPartyId,
      @partyId,
      @sourceIndex,
      @idKind,
      @idType,
      @rawIdValue,
      @maskedIdValue,
      @issuingAuthority,
      @birthDate,
      @issueDate,
      @expirationDate
    )
  `).run(input);
}

function insertDocumentAccountSnapshot(
  db: SqliteConnection,
  input: {
    documentAccountSnapshotId: string;
    documentId: string;
    accountId: string | null;
    documentInstitutionId: string | null;
    sourceIndex: number;
    observedAccountNumber: string | null;
    observedMaskedAccountNumber: string | null;
    observedAccountLast4: string | null;
    observedAccountTypeRaw: string | null;
    normalizedAccountType: string | null;
    registrationType: string | null;
    statementStartDate: string | null;
    statementEndDate: string | null;
    openedDate: string | null;
    closedDate: string | null;
    isPrimaryAccount: number;
    resolverBasis: string;
  },
) {
  db.prepare(`
    INSERT INTO document_account_snapshots (
      document_account_snapshot_id,
      document_id,
      account_id,
      document_institution_id,
      source_index,
      observed_account_number,
      observed_masked_account_number,
      observed_account_last4,
      observed_account_type_raw,
      normalized_account_type,
      registration_type,
      statement_start_date,
      statement_end_date,
      opened_date,
      closed_date,
      is_primary_account,
      resolver_basis
    ) VALUES (
      @documentAccountSnapshotId,
      @documentId,
      @accountId,
      @documentInstitutionId,
      @sourceIndex,
      @observedAccountNumber,
      @observedMaskedAccountNumber,
      @observedAccountLast4,
      @observedAccountTypeRaw,
      @normalizedAccountType,
      @registrationType,
      @statementStartDate,
      @statementEndDate,
      @openedDate,
      @closedDate,
      @isPrimaryAccount,
      @resolverBasis
    )
  `).run(input);
}

function insertDocumentAccountParty(
  db: SqliteConnection,
  input: {
    documentAccountPartyId: string;
    documentId: string;
    documentAccountSnapshotId: string;
    accountPartyId: string | null;
    accountId: string | null;
    documentPartyId: string | null;
    partyId: string | null;
    sourceIndex: number;
    role: string;
    relationshipLabel: string | null;
    allocationPercent: string | null;
  },
) {
  db.prepare(`
    INSERT INTO document_account_parties (
      document_account_party_id,
      document_id,
      document_account_snapshot_id,
      account_party_id,
      account_id,
      document_party_id,
      party_id,
      source_index,
      role,
      relationship_label,
      allocation_percent
    ) VALUES (
      @documentAccountPartyId,
      @documentId,
      @documentAccountSnapshotId,
      @accountPartyId,
      @accountId,
      @documentPartyId,
      @partyId,
      @sourceIndex,
      @role,
      @relationshipLabel,
      @allocationPercent
    )
  `).run(input);
}

function insertDocumentContact(
  db: SqliteConnection,
  input: {
    documentContactId: string;
    documentId: string;
    documentAccountSnapshotId: string | null;
    documentInstitutionId: string | null;
    institutionId: string | null;
    documentPartyId: string | null;
    partyId: string | null;
    sourceIndex: number;
    method: string;
    purpose: string;
    label: string | null;
    rawValue: string | null;
    normalizedValue: string | null;
    hoursText: string | null;
  },
) {
  db.prepare(`
    INSERT INTO document_contacts (
      document_contact_id,
      document_id,
      document_account_snapshot_id,
      document_institution_id,
      institution_id,
      document_party_id,
      party_id,
      source_index,
      method,
      purpose,
      label,
      raw_value,
      normalized_value,
      hours_text
    ) VALUES (
      @documentContactId,
      @documentId,
      @documentAccountSnapshotId,
      @documentInstitutionId,
      @institutionId,
      @documentPartyId,
      @partyId,
      @sourceIndex,
      @method,
      @purpose,
      @label,
      @rawValue,
      @normalizedValue,
      @hoursText
    )
  `).run(input);
}

function insertAccountValue(
  db: SqliteConnection,
  input: {
    accountValueId: string;
    documentAccountSnapshotId: string;
    accountId: string | null;
    sourceIndex: number;
    kind: string;
    label: string | null;
    amount: string | null;
    currency: string | null;
  },
) {
  db.prepare(`
    INSERT INTO account_values (
      account_value_id,
      document_account_snapshot_id,
      account_id,
      source_index,
      kind,
      label,
      amount,
      currency
    ) VALUES (
      @accountValueId,
      @documentAccountSnapshotId,
      @accountId,
      @sourceIndex,
      @kind,
      @label,
      @amount,
      @currency
    )
  `).run(input);
}

function upsertDocumentPrimaryFacts(
  db: SqliteConnection,
  input: {
    documentId: string;
    ownerEmail: string;
    canonical: CanonicalExtractedDocument;
    stablePartyIdByNormalizedName: Map<string, string>;
    stableAccountIdByCanonicalId: Map<string, string>;
    stableInstitutionIdByCanonicalId: Map<string, string>;
    analysisVersion: string;
    updatedAt: string;
  },
) {
  const primaryFacts = input.canonical.normalized.primaryFacts;
  const primaryPartyId = resolveStablePartyIdForPrimaryFact(
    primaryFacts.detectedClient,
    input.stablePartyIdByNormalizedName,
  );
  const secondaryPartyId = resolveStablePartyIdForPrimaryFact(
    primaryFacts.detectedClient2,
    input.stablePartyIdByNormalizedName,
  );
  const primaryAccountId =
    input.canonical.normalized.accounts.length === 1
      ? resolveStableIdForCanonicalReference(
          collectCanonicalReferenceIds(
            input.canonical.normalized.accounts[0]?.id ?? null,
            input.canonical.extracted.accounts[0]?.id ?? null,
            "__index__0",
          ),
          input.stableAccountIdByCanonicalId,
        )
      : null;
  const custodianInstitutionId =
    input.canonical.normalized.institutions.length === 1
      ? resolveStableIdForCanonicalReference(
          collectCanonicalReferenceIds(
            input.canonical.normalized.institutions[0]?.id ?? null,
            input.canonical.extracted.institutions[0]?.id ?? null,
            "__index__0",
          ),
          input.stableInstitutionIdByCanonicalId,
        )
      : null;

  db.prepare(`
    INSERT INTO document_primary_facts (
      document_id,
      owner_email,
      primary_party_id,
      secondary_party_id,
      detected_client,
      detected_client2,
      ownership_type,
      primary_account_id,
      account_last4,
      account_type,
      custodian_institution_id,
      custodian_name,
      document_date,
      entity_name,
      id_type,
      tax_year,
      derived_from_version,
      updated_at
    ) VALUES (
      @documentId,
      @ownerEmail,
      @primaryPartyId,
      @secondaryPartyId,
      @detectedClient,
      @detectedClient2,
      @ownershipType,
      @primaryAccountId,
      @accountLast4,
      @accountType,
      @custodianInstitutionId,
      @custodianName,
      @documentDate,
      @entityName,
      @idType,
      @taxYear,
      @derivedFromVersion,
      @updatedAt
    )
    ON CONFLICT(document_id) DO UPDATE SET
      primary_party_id = excluded.primary_party_id,
      secondary_party_id = excluded.secondary_party_id,
      detected_client = excluded.detected_client,
      detected_client2 = excluded.detected_client2,
      ownership_type = excluded.ownership_type,
      primary_account_id = excluded.primary_account_id,
      account_last4 = excluded.account_last4,
      account_type = excluded.account_type,
      custodian_institution_id = excluded.custodian_institution_id,
      custodian_name = excluded.custodian_name,
      document_date = excluded.document_date,
      entity_name = excluded.entity_name,
      id_type = excluded.id_type,
      tax_year = excluded.tax_year,
      derived_from_version = excluded.derived_from_version,
      updated_at = excluded.updated_at
  `).run({
    documentId: input.documentId,
    ownerEmail: input.ownerEmail,
    primaryPartyId,
    secondaryPartyId,
    detectedClient: primaryFacts.detectedClient,
    detectedClient2: primaryFacts.detectedClient2,
    ownershipType: primaryFacts.ownershipType,
    primaryAccountId,
    accountLast4: primaryFacts.accountLast4,
    accountType: primaryFacts.accountType,
    custodianInstitutionId,
    custodianName: primaryFacts.custodian,
    documentDate: primaryFacts.documentDate,
    entityName: primaryFacts.entityName,
    idType: primaryFacts.idType,
    taxYear: primaryFacts.taxYear,
    derivedFromVersion: input.analysisVersion,
    updatedAt: input.updatedAt,
  });
}

function replaceDocumentScopedRows(db: SqliteConnection, documentId: string) {
  db.prepare(`DELETE FROM document_primary_facts WHERE document_id = ?`).run(documentId);
  db.prepare(`DELETE FROM document_contacts WHERE document_id = ?`).run(documentId);
  db.prepare(`DELETE FROM document_account_parties WHERE document_id = ?`).run(documentId);
  db.prepare(`DELETE FROM document_party_facts WHERE document_id = ?`).run(documentId);
  db.prepare(`
    DELETE FROM account_values
    WHERE document_account_snapshot_id IN (
      SELECT document_account_snapshot_id
      FROM document_account_snapshots
      WHERE document_id = ?
    )
  `).run(documentId);
  db.prepare(`DELETE FROM document_account_snapshots WHERE document_id = ?`).run(documentId);
  db.prepare(`DELETE FROM document_parties WHERE document_id = ?`).run(documentId);
  db.prepare(`DELETE FROM document_institutions WHERE document_id = ?`).run(documentId);
}

function buildDocumentInstitutions(input: {
  ownerEmail: string;
  documentId: string;
  canonical: CanonicalExtractedDocument;
  stableInstitutionIdByCanonicalId: Map<string, string>;
  now: string;
}) {
  const rows: Array<{
    canonicalReferenceIds: string[];
    stableUpsert: {
      institutionId: string;
      ownerEmail: string;
      resolverKey: string;
      canonicalName: string | null;
      resolutionBasis: string;
      documentId: string;
      now: string;
    };
    documentInsert: {
      documentInstitutionId: string;
      documentId: string;
      institutionId: string | null;
      sourceIndex: number;
      rawName: string | null;
      normalizedName: string | null;
      addressJson: string | null;
      isPrimary: number;
    };
  }> = [];

  const count = Math.max(
    input.canonical.extracted.institutions.length,
    input.canonical.normalized.institutions.length,
  );

  for (let index = 0; index < count; index += 1) {
    const extracted = input.canonical.extracted.institutions[index] ?? null;
    const normalized = input.canonical.normalized.institutions[index] ?? null;
    const canonicalReferenceIds = collectCanonicalReferenceIds(
      normalized?.id ?? null,
      extracted?.id ?? null,
      `__index__${index}`,
    );
    const normalizedName = normalized?.name ?? extracted?.name ?? extracted?.rawName ?? null;
    const resolutionBasis = normalizedName
      ? "normalized_name"
      : "provisional_document_scoped";
    const resolverKey = normalizedName
      ? `normalized:${normalizeResolverValue(normalizedName)}`
      : `provisional:${input.documentId}:institution:${index}`;
    const institutionId = stableId("inst", input.ownerEmail, resolverKey);
    const rawName = extracted?.rawName ?? extracted?.name ?? normalized?.rawName ?? null;

    for (const key of canonicalReferenceIds) {
      input.stableInstitutionIdByCanonicalId.set(key, institutionId);
    }

    rows.push({
      canonicalReferenceIds,
      stableUpsert: {
        institutionId,
        ownerEmail: input.ownerEmail,
        resolverKey,
        canonicalName: normalized?.name ?? extracted?.name ?? extracted?.rawName ?? null,
        resolutionBasis,
        documentId: input.documentId,
        now: input.now,
      },
      documentInsert: {
        documentInstitutionId: stableId("docinst", input.documentId, String(index)),
        documentId: input.documentId,
        institutionId,
        sourceIndex: index,
        rawName,
        normalizedName: normalized?.name ?? null,
        addressJson: serializeAddresses(
          normalized?.addresses?.length ? normalized.addresses : extracted?.addresses ?? [],
        ),
        isPrimary:
          index === 0 &&
          Boolean(input.canonical.normalized.primaryFacts.custodian ?? normalized?.name)
            ? 1
            : 0,
      },
    });
  }

  return rows;
}

function buildDocumentParties(input: {
  ownerEmail: string;
  documentId: string;
  canonical: CanonicalExtractedDocument;
  stablePartyIdByCanonicalId: Map<string, string>;
  now: string;
}) {
  const rows: Array<{
    canonicalReferenceIds: string[];
    stableUpsert: {
      partyId: string;
      ownerEmail: string;
      resolverKey: string;
      kind: string;
      canonicalDisplayName: string | null;
      addressSignature: string | null;
      resolutionBasis: string;
      documentId: string;
      now: string;
    };
    documentInsert: {
      documentPartyId: string;
      documentId: string;
      partyId: string | null;
      sourceIndex: number;
      kind: string | null;
      rawName: string | null;
      normalizedDisplayName: string | null;
      addressJson: string | null;
    };
  }> = [];

  const count = Math.max(
    input.canonical.extracted.parties.length,
    input.canonical.normalized.parties.length,
  );
  const normalizedDatesById = new Map(
    input.canonical.normalized.dates.map((date) => [date.id, date]),
  );

  for (let index = 0; index < count; index += 1) {
    const extracted = input.canonical.extracted.parties[index] ?? null;
    const normalized = input.canonical.normalized.parties[index] ?? null;
    const canonicalReferenceIds = collectCanonicalReferenceIds(
      normalized?.id ?? null,
      extracted?.id ?? null,
      `__index__${index}`,
    );
    const displayName =
      normalized?.displayName ?? extracted?.displayName ?? extracted?.rawName ?? null;
    const addressSignature = buildAddressSignature(
      normalized?.addresses?.length ? normalized.addresses : extracted?.addresses ?? [],
    );
    const governmentIdValue =
      normalized?.governmentIds[0]?.value ?? extracted?.governmentIds[0]?.value ?? null;
    const birthDateValue = resolveNormalizedDateValue(
      normalizedDatesById,
      normalized?.birthDateId ?? extracted?.birthDateId ?? null,
    );
    const resolutionBasis = displayName
      ? birthDateValue
        ? "normalized_name_with_birth_date"
        : governmentIdValue
          ? "normalized_name_with_government_id"
          : addressSignature
            ? "normalized_name_with_address_signature"
            : "provisional_document_scoped"
      : "provisional_document_scoped";
    const resolverKey = displayName
      ? birthDateValue
        ? `normalized:${normalizeResolverValue(displayName)}::birth:${birthDateValue}`
        : governmentIdValue
          ? `normalized:${normalizeResolverValue(displayName)}::govid:${sha1(
              governmentIdValue,
            )}`
          : addressSignature
            ? `normalized:${normalizeResolverValue(displayName)}::address:${addressSignature}`
            : `provisional:${input.documentId}:party:${index}`
      : `provisional:${input.documentId}:party:${index}`;
    const partyId = stableId("party", input.ownerEmail, resolverKey);

    for (const key of canonicalReferenceIds) {
      input.stablePartyIdByCanonicalId.set(key, partyId);
    }

    rows.push({
      canonicalReferenceIds,
      stableUpsert: {
        partyId,
        ownerEmail: input.ownerEmail,
        resolverKey,
        kind: normalized?.kind ?? extracted?.kind ?? "person",
        canonicalDisplayName: displayName,
        addressSignature,
        resolutionBasis,
        documentId: input.documentId,
        now: input.now,
      },
      documentInsert: {
        documentPartyId: stableId("docparty", input.documentId, String(index)),
        documentId: input.documentId,
        partyId,
        sourceIndex: index,
        kind: normalized?.kind ?? extracted?.kind ?? null,
        rawName: extracted?.rawName ?? extracted?.displayName ?? null,
        normalizedDisplayName: normalized?.displayName ?? null,
        addressJson: serializeAddresses(
          normalized?.addresses?.length ? normalized.addresses : extracted?.addresses ?? [],
        ),
      },
    });
  }

  return rows;
}

function buildDocumentPartyFacts(input: {
  documentId: string;
  canonical: CanonicalExtractedDocument;
  documentPartyIdByCanonicalId: Map<string, string>;
  stablePartyIdByCanonicalId: Map<string, string>;
}) {
  const rows: Array<{
    documentPartyFactId: string;
    documentId: string;
    documentPartyId: string | null;
    partyId: string | null;
    sourceIndex: number;
    idKind: string | null;
    idType: string | null;
    rawIdValue: string | null;
    maskedIdValue: string | null;
    issuingAuthority: string | null;
    birthDate: string | null;
    issueDate: string | null;
    expirationDate: string | null;
  }> = [];

  const count = Math.max(
    input.canonical.extracted.parties.length,
    input.canonical.normalized.parties.length,
  );
  const normalizedDatesById = new Map(
    input.canonical.normalized.dates.map((date) => [date.id, date]),
  );

  for (let index = 0; index < count; index += 1) {
    const extracted = input.canonical.extracted.parties[index] ?? null;
    const normalized = input.canonical.normalized.parties[index] ?? null;
    const canonicalReferenceIds = collectCanonicalReferenceIds(
      normalized?.id ?? null,
      extracted?.id ?? null,
      `__index__${index}`,
    );
    const documentPartyId = resolveStableIdForCanonicalReference(
      canonicalReferenceIds,
      input.documentPartyIdByCanonicalId,
    );
    const partyId = resolveStableIdForCanonicalReference(
      canonicalReferenceIds,
      input.stablePartyIdByCanonicalId,
    );
    const normalizedGovernmentId = normalized?.governmentIds[0] ?? null;
    const extractedGovernmentId = extracted?.governmentIds[0] ?? null;
    const partyCanonicalId = normalized?.id ?? extracted?.id ?? null;
    const expirationDateValue =
      resolveNormalizedDateValue(
        normalizedDatesById,
        normalizedGovernmentId?.expirationDateId ?? extractedGovernmentId?.expirationDateId ?? null,
      ) ??
      resolveNormalizedPartyDateValue(
        input.canonical.normalized.dates,
        partyCanonicalId,
        "expiration_date",
      );

    rows.push({
      documentPartyFactId: stableId("docpartyfact", input.documentId, String(index)),
      documentId: input.documentId,
      documentPartyId,
      partyId,
      sourceIndex: index,
      idKind: normalizedGovernmentId?.kind ?? extractedGovernmentId?.kind ?? null,
      idType:
        input.canonical.normalized.documentFacts.idType ??
        input.canonical.extracted.documentFacts.idType ??
        null,
      rawIdValue: extractedGovernmentId?.value ?? normalizedGovernmentId?.value ?? null,
      maskedIdValue:
        normalizedGovernmentId?.maskedValue ??
        extractedGovernmentId?.maskedValue ??
        null,
      issuingAuthority:
        normalizedGovernmentId?.issuingAuthority ??
        extractedGovernmentId?.issuingAuthority ??
        null,
      birthDate: resolveNormalizedDateValue(
        normalizedDatesById,
        normalized?.birthDateId ?? extracted?.birthDateId ?? null,
      ),
      issueDate: resolveNormalizedPartyDateValue(
        input.canonical.normalized.dates,
        partyCanonicalId,
        "issue_date",
      ),
      expirationDate: expirationDateValue,
    });
  }

  return rows;
}

function buildDocumentAccountSnapshots(input: {
  ownerEmail: string;
  documentId: string;
  canonical: CanonicalExtractedDocument;
  stableInstitutionIdByCanonicalId: Map<string, string>;
  stablePartyIdByCanonicalId: Map<string, string>;
  stableAccountIdByCanonicalId: Map<string, string>;
  normalizedAccountPartyRoles: Array<{
    relationshipIndex: number;
    accountId: string | null;
    partyId: string | null;
    role: CanonicalAccountPartyRole;
    relationshipLabel: string | null;
    allocationPercent: string | null;
  }>;
  now: string;
}) {
  const rows: Array<{
    canonicalReferenceIds: string[];
    normalizedAccount: NormalizedAccount | null;
    extractedAccount: ExtractedAccount | null;
    stableUpsert: {
      accountId: string;
      ownerEmail: string;
      resolverKey: string;
      primaryInstitutionId: string | null;
      accountNumberHash: string | null;
      maskedAccountNumber: string | null;
      accountLast4: string | null;
      canonicalAccountType: string | null;
      resolutionBasis: string;
      isProvisional: number;
      documentId: string;
      now: string;
    };
  }> = [];

  const count = Math.max(
    input.canonical.extracted.accounts.length,
    input.canonical.normalized.accounts.length,
  );

  for (let index = 0; index < count; index += 1) {
    const extracted = input.canonical.extracted.accounts[index] ?? null;
    const normalized = input.canonical.normalized.accounts[index] ?? null;
    const canonicalReferenceIds = collectCanonicalReferenceIds(
      normalized?.id ?? null,
      extracted?.id ?? null,
      `__index__${index}`,
    );
    const primaryInstitutionId = resolveStableIdForCanonicalReference(
      collectCanonicalReferenceIds(
        ...(normalized?.institutionIds ?? []),
        ...(extracted?.institutionIds ?? []),
      ),
      input.stableInstitutionIdByCanonicalId,
    );
    const ownerPartyIds = collectOwnerPartyIdsForAccount({
      canonicalReferenceIds,
      stablePartyIdByCanonicalId: input.stablePartyIdByCanonicalId,
      normalizedAccountPartyRoles: input.normalizedAccountPartyRoles,
    });
    const resolver = resolveAccountIdentity({
      ownerEmail: input.ownerEmail,
      documentId: input.documentId,
      sourceIndex: index,
      normalized,
      extracted,
      primaryInstitutionId,
      ownerPartyIds,
    });

    for (const key of canonicalReferenceIds) {
      input.stableAccountIdByCanonicalId.set(key, resolver.accountId);
    }

    rows.push({
      canonicalReferenceIds,
      normalizedAccount: normalized,
      extractedAccount: extracted,
      stableUpsert: {
        accountId: resolver.accountId,
        ownerEmail: input.ownerEmail,
        resolverKey: resolver.resolverKey,
        primaryInstitutionId: resolver.primaryInstitutionId,
        accountNumberHash: normalized?.accountNumber
          ? sha1(normalized.accountNumber)
          : extracted?.accountNumber
            ? sha1(extracted.accountNumber)
            : null,
        maskedAccountNumber:
          normalized?.maskedAccountNumber ?? extracted?.maskedAccountNumber ?? null,
        accountLast4: normalized?.accountLast4 ?? extracted?.accountLast4 ?? null,
        canonicalAccountType:
          normalized?.accountType ?? extracted?.accountType ?? null,
        resolutionBasis: resolver.resolutionBasis,
        isProvisional: resolver.resolutionBasis.startsWith("provisional") ? 1 : 0,
        documentId: input.documentId,
        now: input.now,
      },
    });
  }

  return rows;
}

function createDocumentAccountSnapshotInsert(input: {
  documentId: string;
  row: {
    canonicalReferenceIds: string[];
    normalizedAccount: NormalizedAccount | null;
    extractedAccount: ExtractedAccount | null;
    stableUpsert: {
      accountId: string;
      resolutionBasis: string;
      primaryInstitutionId: string | null;
    };
  };
  index: number;
  canonical: CanonicalExtractedDocument;
  documentInstitutionIdByStableInstitutionId: Map<string, string>;
  primaryFacts: CanonicalExtractedDocument["normalized"]["primaryFacts"];
}) {
  const normalizedDatesById = new Map(
    input.canonical.normalized.dates.map((date) => [date.id, date]),
  );
  const normalizedAccount = input.row.normalizedAccount;
  const extractedAccount = input.row.extractedAccount;
  const documentInstitutionId = input.row.stableUpsert.primaryInstitutionId
    ? input.documentInstitutionIdByStableInstitutionId.get(
        input.row.stableUpsert.primaryInstitutionId,
      ) ?? null
    : null;
  const statementStartDate = resolveNormalizedDateValue(
    normalizedDatesById,
    normalizedAccount?.statementStartDateId ?? null,
  );
  const statementEndDate = resolveNormalizedDateValue(
    normalizedDatesById,
    normalizedAccount?.statementEndDateId ?? null,
  );
  const openedDate = resolveNormalizedDateValue(
    normalizedDatesById,
    normalizedAccount?.openedDateId ?? null,
  );
  const closedDate = resolveNormalizedDateValue(
    normalizedDatesById,
    normalizedAccount?.closedDateId ?? null,
  );
  const isPrimaryAccount =
    input.canonical.normalized.accounts.length === 1
      ? input.index === 0
      : Boolean(
          input.primaryFacts.accountLast4 &&
            normalizedAccount?.accountLast4 === input.primaryFacts.accountLast4 &&
            (!input.primaryFacts.accountType ||
              normalizedAccount?.accountType === input.primaryFacts.accountType),
        );

  return {
    canonicalReferenceIds: input.row.canonicalReferenceIds,
    documentInsert: {
      documentAccountSnapshotId: stableId(
        "docsnap",
        input.documentId,
        String(input.index),
      ),
      documentId: input.documentId,
      accountId: input.row.stableUpsert.accountId,
      documentInstitutionId,
      sourceIndex: input.index,
      observedAccountNumber:
        input.row.normalizedAccount?.accountNumber ??
        input.row.extractedAccount?.accountNumber ??
        null,
      observedMaskedAccountNumber:
        input.row.normalizedAccount?.maskedAccountNumber ??
        input.row.extractedAccount?.maskedAccountNumber ??
        null,
      observedAccountLast4:
        input.row.normalizedAccount?.accountLast4 ??
        input.row.extractedAccount?.accountLast4 ??
        null,
      observedAccountTypeRaw: input.row.extractedAccount?.accountType ?? null,
      normalizedAccountType: input.row.normalizedAccount?.accountType ?? null,
      registrationType: input.row.normalizedAccount?.registrationType ?? null,
      statementStartDate,
      statementEndDate,
      openedDate,
      closedDate,
      isPrimaryAccount: isPrimaryAccount ? 1 : 0,
      resolverBasis: input.row.stableUpsert.resolutionBasis,
    },
  };
}

function buildStableAccountParties(input: {
  ownerEmail: string;
  documentId: string;
  stableAccountIdByCanonicalId: Map<string, string>;
  stablePartyIdByCanonicalId: Map<string, string>;
  normalizedAccountPartyRoles: Array<{
    relationshipIndex: number;
    accountId: string | null;
    partyId: string | null;
    role: CanonicalAccountPartyRole;
    relationshipLabel: string | null;
    allocationPercent: string | null;
  }>;
  normalizedAccountParties: NormalizedAccountParty[];
  now: string;
}) {
  return input.normalizedAccountPartyRoles.flatMap((relationshipRole) => {
    const stableAccountId = relationshipRole.accountId
      ? input.stableAccountIdByCanonicalId.get(relationshipRole.accountId) ?? null
      : null;
    const stablePartyId = relationshipRole.partyId
      ? input.stablePartyIdByCanonicalId.get(relationshipRole.partyId) ?? null
      : null;
    if (!stableAccountId || !stablePartyId) {
      return [];
    }

    return [
      {
        accountPartyId: stableId(
          "acctparty",
          input.ownerEmail,
          stableAccountId,
          stablePartyId,
          relationshipRole.role,
        ),
        ownerEmail: input.ownerEmail,
        accountId: stableAccountId,
        partyId: stablePartyId,
        role: relationshipRole.role,
        relationshipLabel:
          relationshipRole.relationshipLabel ??
          input.normalizedAccountParties[relationshipRole.relationshipIndex]?.relationshipLabel ??
          null,
        documentId: input.documentId,
        now: input.now,
      },
    ];
  });
}

function buildDocumentAccountParties(input: {
  ownerEmail: string;
  documentId: string;
  canonical: CanonicalExtractedDocument;
  documentAccountSnapshotIdByCanonicalId: Map<string, string>;
  documentPartyIdByCanonicalId: Map<string, string>;
  stableAccountIdByCanonicalId: Map<string, string>;
  stablePartyIdByCanonicalId: Map<string, string>;
  now: string;
}) {
  const normalizedRoles = expandNormalizedAccountPartyRoles(
    input.canonical.normalized.accountParties,
  );
  const rows: Array<{
    documentAccountPartyId: string;
    documentId: string;
    documentAccountSnapshotId: string;
    accountPartyId: string | null;
    accountId: string | null;
    documentPartyId: string | null;
    partyId: string | null;
    sourceIndex: number;
    role: string;
    relationshipLabel: string | null;
    allocationPercent: string | null;
  }> = [];

  let sourceIndex = 0;
  for (const relationship of normalizedRoles) {
    const documentAccountSnapshotId = relationship.accountId
      ? input.documentAccountSnapshotIdByCanonicalId.get(relationship.accountId) ?? null
      : null;
    const documentPartyId = relationship.partyId
      ? input.documentPartyIdByCanonicalId.get(relationship.partyId) ?? null
      : null;
    const accountId = relationship.accountId
      ? input.stableAccountIdByCanonicalId.get(relationship.accountId) ?? null
      : null;
    const partyId = relationship.partyId
      ? input.stablePartyIdByCanonicalId.get(relationship.partyId) ?? null
      : null;

    if (!documentAccountSnapshotId) {
      sourceIndex += 1;
      continue;
    }

    const accountPartyId =
      accountId && partyId
        ? stableId("acctparty", input.ownerEmail, accountId, partyId, relationship.role)
        : null;

    rows.push({
      documentAccountPartyId: stableId(
        "docacctparty",
        input.documentId,
        String(sourceIndex),
      ),
      documentId: input.documentId,
      documentAccountSnapshotId,
      accountPartyId,
      accountId,
      documentPartyId,
      partyId,
      sourceIndex,
      role: relationship.role,
      relationshipLabel: relationship.relationshipLabel,
      allocationPercent: relationship.allocationPercent,
    });
    sourceIndex += 1;
  }

  return rows;
}

function buildDocumentContacts(input: {
  ownerEmail: string;
  documentId: string;
  extractedContacts: ExtractedContact[];
  normalizedContacts: NormalizedContact[];
  stableInstitutionIdByCanonicalId: Map<string, string>;
  documentInstitutionIdByCanonicalId: Map<string, string>;
  documentInstitutionIdByStableInstitutionId: Map<string, string>;
  documentSnapshotRows: Array<{
    canonicalReferenceIds: string[];
    documentInsert: {
      documentAccountSnapshotId: string;
      accountId: string | null;
      documentInstitutionId: string | null;
    };
  }>;
}) {
  const rows: Array<{
    documentContactId: string;
    documentId: string;
    documentAccountSnapshotId: string | null;
    documentInstitutionId: string | null;
    institutionId: string | null;
    documentPartyId: string | null;
    partyId: string | null;
    sourceIndex: number;
    method: string;
    purpose: string;
    label: string | null;
    rawValue: string | null;
    normalizedValue: string | null;
    hoursText: string | null;
  }> = [];

  const count = Math.max(input.extractedContacts.length, input.normalizedContacts.length);
  for (let index = 0; index < count; index += 1) {
    const extracted = input.extractedContacts[index] ?? null;
    const normalized = input.normalizedContacts[index] ?? null;
    const institutionCanonicalIds = collectCanonicalReferenceIds(
      normalized?.institutionId ?? null,
      extracted?.institutionId ?? null,
    );
    const institutionId = resolveStableIdForCanonicalReference(
      institutionCanonicalIds,
      input.stableInstitutionIdByCanonicalId,
    );
    const documentInstitutionId =
      resolveStableIdForCanonicalReference(
        institutionCanonicalIds,
        input.documentInstitutionIdByCanonicalId,
      ) ??
      (institutionId
        ? input.documentInstitutionIdByStableInstitutionId.get(institutionId) ?? null
        : null);
    const candidateSnapshots = input.documentSnapshotRows.filter((row) => {
      if (!documentInstitutionId) {
        return false;
      }
      return row.documentInsert.documentInstitutionId === documentInstitutionId;
    });
    const documentAccountSnapshotId =
      input.documentSnapshotRows.length === 1
        ? input.documentSnapshotRows[0]?.documentInsert.documentAccountSnapshotId ?? null
        : candidateSnapshots.length === 1
          ? candidateSnapshots[0]?.documentInsert.documentAccountSnapshotId ?? null
          : null;

    rows.push({
      documentContactId: stableId("doccontact", input.documentId, String(index)),
      documentId: input.documentId,
      documentAccountSnapshotId,
      documentInstitutionId,
      institutionId,
      documentPartyId: null,
      partyId: null,
      sourceIndex: index,
      method: normalized?.method ?? extracted?.method ?? "other",
      purpose: normalized?.purpose ?? extracted?.purpose ?? "other",
      label: normalized?.label ?? extracted?.label ?? null,
      rawValue: extracted?.value ?? null,
      normalizedValue: normalized?.value ?? null,
      hoursText: normalized?.hoursText ?? extracted?.hoursText ?? null,
    });
  }

  return rows;
}

function buildAccountValues(input: {
  ownerEmail: string;
  canonical: CanonicalExtractedDocument;
  documentSnapshotRows: Array<{
    canonicalReferenceIds: string[];
    documentInsert: {
      documentAccountSnapshotId: string;
      accountId: string | null;
    };
  }>;
}) {
  const rows: Array<{
    accountValueId: string;
    documentAccountSnapshotId: string;
    accountId: string | null;
    sourceIndex: number;
    kind: string;
    label: string | null;
    amount: string | null;
    currency: string | null;
  }> = [];

  input.documentSnapshotRows.forEach((snapshot, accountIndex) => {
    const normalizedValues =
      input.canonical.normalized.accounts[accountIndex]?.values ?? [];
    const extractedValues =
      input.canonical.extracted.accounts[accountIndex]?.values ?? [];
    normalizedValues.forEach((value, valueIndex) => {
      rows.push({
        accountValueId: stableId(
          "acctvalue",
          snapshot.documentInsert.documentAccountSnapshotId,
          String(valueIndex),
        ),
        documentAccountSnapshotId: snapshot.documentInsert.documentAccountSnapshotId,
        accountId: snapshot.documentInsert.accountId,
        sourceIndex: valueIndex,
        kind: value.kind,
        label: extractedValues[valueIndex]?.label ?? value.label ?? null,
        amount: value.money?.amount ?? null,
        currency: value.money?.currency ?? null,
      });
    });
  });

  return rows;
}

function resolveSourceFileId(canonical: CanonicalExtractedDocument) {
  return (
    canonical.source.file.fileId ??
    `sha1:${canonical.source.file.downloadSha1 ?? sha1(JSON.stringify(canonical.source.file))}`
  );
}

function resolveNormalizedDateValue(
  datesById: Map<string, NormalizedDate>,
  dateId: string | null,
) {
  if (!dateId) {
    return null;
  }

  return datesById.get(dateId)?.value ?? null;
}

function resolveFirstDateValue(
  dates: NormalizedDate[],
  kind: NormalizedDate["kind"],
) {
  return dates.find((date) => date.kind === kind)?.value ?? null;
}

function resolveNormalizedPartyDateValue(
  dates: NormalizedDate[],
  partyCanonicalId: string | null,
  kind: NormalizedDate["kind"],
) {
  if (!partyCanonicalId) {
    return null;
  }

  return (
    dates.find(
      (date) =>
        date.kind === kind &&
        date.entityType === "party" &&
        date.entityId === partyCanonicalId,
    )?.value ?? null
  );
}

function buildAddressSignature(addresses: CanonicalAddress[]) {
  if (!addresses.length) {
    return null;
  }

  const address = addresses[0]!;
  const parts = [
    ...address.lines,
    address.city,
    address.state,
    address.postalCode,
    address.country,
  ]
    .map((value) => normalizeResolverValue(value))
    .filter(Boolean);

  return parts.length ? parts.join("|") : null;
}

function serializeAddresses(addresses: CanonicalAddress[]) {
  return addresses.length ? JSON.stringify(addresses) : null;
}

function normalizeResolverValue(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized || "";
}

function resolveCanonicalPayloadSchemaVersion(canonical: CanonicalExtractedDocument) {
  switch (canonical.classification.normalized.documentTypeId) {
    case "identity_document":
      return IDENTITY_DOCUMENT_CANONICAL_PAYLOAD_SCHEMA_VERSION;
    case "account_statement":
    default:
      return ACCOUNT_STATEMENT_CANONICAL_PAYLOAD_SCHEMA_VERSION;
  }
}

function sha1(value: string) {
  return crypto.createHash("sha1").update(value).digest("hex");
}

function stableId(prefix: string, ...parts: string[]) {
  return `${prefix}_${sha1(parts.join("|"))}`;
}

function collectCanonicalReferenceIds(...values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())))];
}

function resolveStableIdForCanonicalReference(
  canonicalReferenceIds: string[],
  idByCanonicalReference: Map<string, string>,
) {
  for (const referenceId of canonicalReferenceIds) {
    const resolved = idByCanonicalReference.get(referenceId);
    if (resolved) {
      return resolved;
    }
  }
  return null;
}

function expandNormalizedAccountPartyRoles(relationships: NormalizedAccountParty[]) {
  return relationships.flatMap((relationship, relationshipIndex) => {
    const roles = relationship.roles.length
      ? relationship.roles
      : (["other"] satisfies CanonicalAccountPartyRole[]);
    return roles.map((role) => ({
      relationshipIndex,
      accountId: relationship.accountId,
      partyId: relationship.partyId,
      role,
      relationshipLabel: relationship.relationshipLabel,
      allocationPercent: relationship.allocationPercent,
    }));
  });
}

function collectOwnerPartyIdsForAccount(input: {
  canonicalReferenceIds: string[];
  stablePartyIdByCanonicalId: Map<string, string>;
  normalizedAccountPartyRoles: Array<{
    relationshipIndex: number;
    accountId: string | null;
    partyId: string | null;
    role: CanonicalAccountPartyRole;
    relationshipLabel: string | null;
    allocationPercent: string | null;
  }>;
}) {
  const accountReferenceIdSet = new Set(input.canonicalReferenceIds);
  const ownerPartyIds = new Set<string>();

  for (const relationship of input.normalizedAccountPartyRoles) {
    if (!relationship.accountId || !accountReferenceIdSet.has(relationship.accountId)) {
      continue;
    }
    if (relationship.role !== "owner" && relationship.role !== "joint_owner") {
      continue;
    }
    if (!relationship.partyId) {
      continue;
    }
    const stablePartyId = input.stablePartyIdByCanonicalId.get(relationship.partyId);
    if (stablePartyId) {
      ownerPartyIds.add(stablePartyId);
    }
  }

  return [...ownerPartyIds].sort();
}

function resolveAccountIdentity(input: {
  ownerEmail: string;
  documentId: string;
  sourceIndex: number;
  normalized: NormalizedAccount | null;
  extracted: ExtractedAccount | null;
  primaryInstitutionId: string | null;
  ownerPartyIds: string[];
}): AccountResolverResult {
  const fullAccountNumber =
    input.normalized?.accountNumber ?? input.extracted?.accountNumber ?? null;
  const maskedAccountNumber =
    input.normalized?.maskedAccountNumber ??
    input.extracted?.maskedAccountNumber ??
    null;
  const accountLast4 =
    input.normalized?.accountLast4 ?? input.extracted?.accountLast4 ?? null;
  const accountType =
    input.normalized?.accountType ?? input.extracted?.accountType ?? null;
  const institutionKey = input.primaryInstitutionId ?? "unknown-institution";

  if (fullAccountNumber) {
    const resolverKey = `full:${institutionKey}:${sha1(fullAccountNumber)}`;
    return {
      accountId: stableId("acct", input.ownerEmail, resolverKey),
      resolutionBasis: "full_account_number_hash",
      resolverKey,
      primaryInstitutionId: input.primaryInstitutionId,
    };
  }

  if (maskedAccountNumber) {
    const resolverKey = `masked:${institutionKey}:${normalizeResolverValue(maskedAccountNumber)}`;
    return {
      accountId: stableId("acct", input.ownerEmail, resolverKey),
      resolutionBasis: "masked_account_number",
      resolverKey,
      primaryInstitutionId: input.primaryInstitutionId,
    };
  }

  if (accountLast4 && accountType && input.ownerPartyIds.length > 0) {
    const resolverKey = `weak:${institutionKey}:${normalizeResolverValue(accountType)}:${accountLast4}:${input.ownerPartyIds.join(",")}`;
    return {
      accountId: stableId("acct", input.ownerEmail, resolverKey),
      resolutionBasis: "institution_last4_type_owners",
      resolverKey,
      primaryInstitutionId: input.primaryInstitutionId,
    };
  }

  const resolverKey = `provisional:${input.documentId}:account:${input.sourceIndex}`;
  return {
    accountId: stableId("acct", input.ownerEmail, resolverKey),
    resolutionBasis: "provisional_document_scoped",
    resolverKey,
    primaryInstitutionId: input.primaryInstitutionId,
  };
}

function resolveStablePartyIdForPrimaryFact(
  displayName: string | null,
  stablePartyIdByNormalizedName: Map<string, string>,
) {
  if (!displayName) {
    return null;
  }

  return stablePartyIdByNormalizedName.get(normalizeResolverValue(displayName)) ?? null;
}
