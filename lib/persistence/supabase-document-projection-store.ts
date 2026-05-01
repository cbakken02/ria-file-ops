import "server-only";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { encryptServerValue } from "@/lib/crypto/server-encryption";
import { projectCanonicalToRedactedDebugShape } from "@/lib/canonical-persistence";
import type { CanonicalSqliteWriteInput, CanonicalSqliteWriteResult } from "@/lib/firm-document-sqlite";
import {
  closeFirmDocumentSqliteConnection,
  writeCanonicalAccountStatementToSqlite,
  writeCanonicalIdentityDocumentToSqlite,
  writeCanonicalTaxDocumentToSqlite,
} from "@/lib/firm-document-sqlite";
import {
  inspectFirmDocumentBySourceFileId,
  type FirmDocumentInspection,
} from "@/lib/firm-document-sqlite-query";
import { withPostgresClient } from "@/lib/postgres/server";

type PersistMode = "insert" | "upsert";

const JSONB_COLUMNS_BY_TABLE = new Map<string, Set<string>>([
  ["document_canonical_payloads", new Set(["canonical_json"])],
  ["document_institutions", new Set(["address_json"])],
  ["document_parties", new Set(["address_json"])],
]);

export async function writeCanonicalAccountStatementToSupabase(
  input: CanonicalSqliteWriteInput,
): Promise<CanonicalSqliteWriteResult | null> {
  if (
    input.canonical.classification.normalized.documentTypeId !== "account_statement"
  ) {
    return null;
  }

  return writeCanonicalProjectionViaSqliteBridge(
    input,
    writeCanonicalAccountStatementToSqlite,
  );
}

export async function writeCanonicalIdentityDocumentToSupabase(
  input: CanonicalSqliteWriteInput,
): Promise<CanonicalSqliteWriteResult | null> {
  if (input.canonical.classification.normalized.documentTypeId !== "identity_document") {
    return null;
  }

  return writeCanonicalProjectionViaSqliteBridge(
    input,
    writeCanonicalIdentityDocumentToSqlite,
  );
}

export async function writeCanonicalTaxDocumentToSupabase(
  input: CanonicalSqliteWriteInput,
): Promise<CanonicalSqliteWriteResult | null> {
  if (input.canonical.classification.normalized.documentTypeId !== "tax_document") {
    return null;
  }

  return writeCanonicalProjectionViaSqliteBridge(
    input,
    writeCanonicalTaxDocumentToSqlite,
  );
}

async function writeCanonicalProjectionViaSqliteBridge(
  input: CanonicalSqliteWriteInput,
  writer: (
    writeInput: CanonicalSqliteWriteInput,
  ) => CanonicalSqliteWriteResult | null,
) {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "ria-file-ops-supabase-projection-"),
  );
  const tempDbPath = path.join(tempDir, "projection.sqlite");
  const sourceFileId = resolveSourceFileId(input);

  try {
    const sqliteResult = writer({
      ...input,
      dbPath: tempDbPath,
    });

    if (!sqliteResult) {
      return null;
    }

    const inspection = inspectFirmDocumentBySourceFileId({
      ownerEmail: input.ownerEmail,
      dbPath: tempDbPath,
      sourceFileId,
    });

    if (!inspection?.document || typeof inspection.document.document_id !== "string") {
      throw new Error(
        `SQLite bridge could not inspect canonical projection rows for source file ${sourceFileId}.`,
      );
    }

    await persistInspectionToSupabase({
      inspection,
      input,
      documentId: inspection.document.document_id,
    });

    return {
      documentId: inspection.document.document_id,
      ownerEmail: input.ownerEmail,
      dbPath: tempDbPath,
    };
  } finally {
    closeFirmDocumentSqliteConnection(tempDbPath);
    await Promise.all([
      fs.rm(tempDbPath, { force: true }),
      fs.rm(`${tempDbPath}-wal`, { force: true }),
      fs.rm(`${tempDbPath}-shm`, { force: true }),
    ]).catch(() => {});
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function persistInspectionToSupabase(input: {
  inspection: FirmDocumentInspection;
  input: CanonicalSqliteWriteInput;
  documentId: string;
}) {
  const documentRow = requireRecord(input.inspection.document, "document");
  const primaryFactsRow = input.inspection.documentPrimaryFacts;
  const redactedCanonical = projectCanonicalToRedactedDebugShape(input.input.canonical);
  const canonicalPayloadRow = {
    document_id: input.documentId,
    canonical_schema_version: resolveCanonicalSchemaVersion(
      input.inspection.documentCanonicalPayload,
      input.input.canonical.classification.normalized.documentTypeId,
    ),
    canonical_json: redactedCanonical,
    stored_at: new Date().toISOString(),
  };

  const stableTables = [
    {
      table: "institutions",
      rows: input.inspection.stableInstitutions.map((row) =>
        normalizeProjectionRow("institutions", row),
      ),
      conflictColumns: ["institution_id"],
    },
    {
      table: "parties",
      rows: input.inspection.stableParties.map((row) =>
        normalizeProjectionRow("parties", row),
      ),
      conflictColumns: ["party_id"],
    },
    {
      table: "accounts",
      rows: input.inspection.stableAccounts.map((row) =>
        normalizeProjectionRow("accounts", row),
      ),
      conflictColumns: ["account_id"],
    },
    {
      table: "account_parties",
      rows: input.inspection.stableAccountParties.map((row) =>
        normalizeProjectionRow("account_parties", row),
      ),
      conflictColumns: ["account_party_id"],
    },
  ] as const;

  const documentScopedTables = [
    {
      table: "document_institutions",
      rows: input.inspection.documentInstitutions.map((row) =>
        normalizeProjectionRow("document_institutions", row),
      ),
    },
    {
      table: "document_parties",
      rows: input.inspection.documentParties.map((row) =>
        normalizeProjectionRow("document_parties", row),
      ),
    },
    {
      table: "document_party_facts",
      rows: input.inspection.documentPartyFacts.map((row) =>
        normalizeProjectionRow("document_party_facts", row),
      ),
    },
    {
      table: "document_tax_facts",
      rows: input.inspection.documentTaxFacts.map((row) =>
        normalizeProjectionRow("document_tax_facts", row),
      ),
    },
    {
      table: "document_account_snapshots",
      rows: input.inspection.documentAccountSnapshots.map((row) =>
        normalizeProjectionRow("document_account_snapshots", row),
      ),
    },
    {
      table: "document_account_parties",
      rows: input.inspection.documentAccountParties.map((row) =>
        normalizeProjectionRow("document_account_parties", row),
      ),
    },
    {
      table: "document_contacts",
      rows: input.inspection.documentContacts.map((row) =>
        normalizeProjectionRow("document_contacts", row),
      ),
    },
    {
      table: "account_values",
      rows: input.inspection.accountValues.map((row) =>
        normalizeProjectionRow("account_values", row),
      ),
    },
  ] as const;

  await withPostgresClient(async (client) => {
    await client.query("BEGIN");

    try {
      await upsertRow(client, "documents", normalizeProjectionRow("documents", documentRow), [
        "document_id",
      ]);

      for (const table of stableTables) {
        for (const row of table.rows) {
          await upsertRow(client, table.table, row, table.conflictColumns);
        }
      }

      await deleteDocumentScopedRows(client, input.documentId);

      await upsertRow(
        client,
        "document_canonical_payloads",
        canonicalPayloadRow,
        ["document_id"],
      );

      if (primaryFactsRow) {
        await upsertRow(
          client,
          "document_primary_facts",
          normalizeProjectionRow("document_primary_facts", primaryFactsRow),
          ["document_id"],
        );
      }

      for (const table of documentScopedTables) {
        for (const row of table.rows) {
          await persistRow(client, table.table, row, "insert");
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

async function deleteDocumentScopedRows(
  client: { query: (text: string, params?: unknown[]) => Promise<unknown> },
  documentId: string,
) {
  await client.query(
    `
      DELETE FROM public.account_values
      WHERE document_account_snapshot_id IN (
        SELECT document_account_snapshot_id
        FROM public.document_account_snapshots
        WHERE document_id = $1
      )
    `,
    [documentId],
  );
  await client.query(`DELETE FROM public.document_contacts WHERE document_id = $1`, [
    documentId,
  ]);
  await client.query(
    `DELETE FROM public.document_account_parties WHERE document_id = $1`,
    [documentId],
  );
  await client.query(
    `DELETE FROM public.document_account_snapshots WHERE document_id = $1`,
    [documentId],
  );
  await client.query(`DELETE FROM public.document_party_facts WHERE document_id = $1`, [
    documentId,
  ]);
  await client.query(`DELETE FROM public.document_tax_facts WHERE document_id = $1`, [
    documentId,
  ]);
  await client.query(`DELETE FROM public.document_parties WHERE document_id = $1`, [
    documentId,
  ]);
  await client.query(
    `DELETE FROM public.document_institutions WHERE document_id = $1`,
    [documentId],
  );
  await client.query(
    `DELETE FROM public.document_primary_facts WHERE document_id = $1`,
    [documentId],
  );
  await client.query(
    `DELETE FROM public.document_canonical_payloads WHERE document_id = $1`,
    [documentId],
  );
}

async function upsertRow(
  client: { query: (text: string, params?: unknown[]) => Promise<unknown> },
  table: string,
  row: Record<string, unknown>,
  conflictColumns: readonly string[],
) {
  await persistRow(client, table, row, "upsert", conflictColumns);
}

async function persistRow(
  client: { query: (text: string, params?: unknown[]) => Promise<unknown> },
  table: string,
  row: Record<string, unknown>,
  mode: PersistMode,
  conflictColumns: readonly string[] = [],
) {
  const columns = Object.keys(row);
  if (columns.length === 0) {
    return;
  }

  const jsonColumns = JSONB_COLUMNS_BY_TABLE.get(table) ?? new Set<string>();
  const placeholders = columns.map((column, index) =>
    jsonColumns.has(column) ? `$${index + 1}::jsonb` : `$${index + 1}`,
  );
  const values = columns.map((column) => normalizeValueForInsert(row[column]));
  const quotedColumns = columns.map((column) => `"${column}"`).join(", ");

  let text = `
    INSERT INTO public.${table} (${quotedColumns})
    VALUES (${placeholders.join(", ")})
  `;

  if (mode === "upsert") {
    const updateColumns = columns.filter(
      (column) => !conflictColumns.includes(column),
    );
    const updateClause =
      updateColumns.length > 0
        ? updateColumns
            .map((column) => `"${column}" = EXCLUDED."${column}"`)
            .join(", ")
        : `"${conflictColumns[0]}" = EXCLUDED."${conflictColumns[0]}"`;

    text += `
      ON CONFLICT (${conflictColumns.map((column) => `"${column}"`).join(", ")})
      DO UPDATE SET ${updateClause}
    `;
  }

  await client.query(text, values);
}

function normalizeProjectionRow(
  table: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = { ...row };

  if (table === "document_party_facts") {
    const rawIdValue = asStringOrNull(normalized.raw_id_value);
    delete normalized.raw_id_value;
    normalized.raw_id_value_ciphertext = rawIdValue
      ? encryptServerValue(rawIdValue)
      : null;
  }

  if (table === "document_account_snapshots") {
    const observedAccountNumber = asStringOrNull(normalized.observed_account_number);
    delete normalized.observed_account_number;
    normalized.observed_account_number_ciphertext = observedAccountNumber
      ? encryptServerValue(observedAccountNumber)
      : null;
  }

  return normalized;
}

function normalizeValueForInsert(value: unknown) {
  if (value === undefined) {
    return null;
  }

  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }

  return value;
}

function resolveSourceFileId(input: CanonicalSqliteWriteInput) {
  return (
    input.canonical.source.file.fileId ??
    `sha1:${input.canonical.source.file.downloadSha1 ?? hashSourceFileMetadata(input)}`
  );
}

function hashSourceFileMetadata(input: CanonicalSqliteWriteInput) {
  return createHash("sha1")
    .update(JSON.stringify(input.canonical.source.file))
    .digest("hex");
}

function requireRecord(
  value: Record<string, unknown> | null,
  label: string,
): Record<string, unknown> {
  if (!value) {
    throw new Error(`Canonical SQLite bridge did not produce ${label} rows.`);
  }

  return value;
}

function resolveCanonicalSchemaVersion(
  payload: Record<string, unknown> | null,
  normalizedDocumentTypeId: string | null,
) {
  const schemaVersion = asStringOrNull(payload?.canonical_schema_version);
  if (schemaVersion) {
    return schemaVersion;
  }

  if (normalizedDocumentTypeId === "identity_document") {
    return "canonical-identity-document-v1";
  }

  if (normalizedDocumentTypeId === "tax_document") {
    return "canonical-tax-document-v2";
  }

  return "canonical-account-statement-v1";
}

function asStringOrNull(value: unknown) {
  return typeof value === "string" ? value : null;
}
