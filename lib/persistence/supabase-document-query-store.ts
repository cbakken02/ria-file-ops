import "server-only";
import { decryptServerValue } from "@/lib/crypto/server-encryption";
import { queryPostgresSync } from "@/lib/postgres/server";
import type {
  FirmDocumentAccountValue,
  FirmDocumentIdentityAddress,
  FirmDocumentInspection,
  FirmDocumentLatestAccountDocument,
  FirmDocumentLatestAccountIdentifier,
  FirmDocumentLatestAccountSnapshot,
  FirmDocumentLatestContact,
  FirmDocumentLatestDriverLicenseStatus,
  FirmDocumentLatestIdentityAddressRecord,
  FirmDocumentLatestIdentityDob,
  FirmDocumentLatestIdentityDocument,
  FirmDocumentLatestIdentityExpiration,
  FirmDocumentLatestIdentityFacts,
  FirmDocumentPartyMatch,
  FirmDocumentResolvedParty,
} from "@/lib/firm-document-sqlite-query";

type ReadInput = {
  ownerEmail: string;
  dbPath?: string | null;
};

type PostgresIdentityRow = {
  partyId: string;
  partyDisplayName: string | null;
  sourceFileId: string | null;
  sourceName: string | null;
  documentId: string;
  documentDate: string | null;
  analyzedAt: string | null;
  documentSubtype: string | null;
  rawName: string | null;
  normalizedDisplayName: string | null;
  addressJson: unknown;
  idKind: string | null;
  idType: string | null;
  rawIdValueCiphertext: string | null;
  maskedIdValue: string | null;
  issuingAuthority: string | null;
  birthDate: string | null;
  issueDate: string | null;
  expirationDate: string | null;
};

type PostgresAccountIdentifierRow = Omit<
  FirmDocumentLatestAccountIdentifier,
  "accountNumber"
> & {
  accountNumberCiphertext: string | null;
};

function normalizeOwnerEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalizeLookupValue(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNullableQueryValue(value: string | null) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized || null;
}

function clampPositiveInt(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(250, Math.trunc(value ?? fallback)));
}

function currentIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeIsoDate(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

export function listFirmDocumentParties(
  input: ReadInput,
): FirmDocumentPartyMatch[] {
  const ownerEmail = normalizeOwnerEmail(input.ownerEmail);
  if (!ownerEmail) {
    return [];
  }

  const result = queryPostgresSync<{
    party_id: string;
    canonical_display_name: string | null;
    kind: string;
    address_signature: string | null;
    first_seen_document_id: string | null;
    last_seen_document_id: string | null;
  }>(
    `
      SELECT
        party_id,
        canonical_display_name,
        kind,
        address_signature,
        first_seen_document_id,
        last_seen_document_id
      FROM public.parties
      WHERE owner_email = $1
        AND canonical_display_name IS NOT NULL
      ORDER BY canonical_display_name ASC, party_id ASC
    `,
    [ownerEmail],
  );

  return result.rows.map((row) => ({
    partyId: row.party_id,
    canonicalDisplayName: row.canonical_display_name,
    kind: row.kind,
    addressSignature: row.address_signature,
    firstSeenDocumentId: row.first_seen_document_id,
    lastSeenDocumentId: row.last_seen_document_id,
    matchType: "exact_normalized",
  }));
}

export function resolveFirmDocumentPartyByName(
  input: ReadInput & { name: string },
): FirmDocumentResolvedParty {
  const normalizedQuery = normalizeLookupValue(input.name);
  if (!normalizedQuery) {
    return {
      status: "not_found",
      party: null,
      matches: [],
    };
  }

  const matches = listFirmDocumentParties(input).filter(
    (row) =>
      normalizeLookupValue(row.canonicalDisplayName ?? "") === normalizedQuery,
  );

  if (matches.length === 0) {
    return {
      status: "not_found",
      party: null,
      matches: [],
    };
  }

  if (matches.length > 1) {
    return {
      status: "ambiguous",
      party: null,
      matches,
    };
  }

  return {
    status: "resolved",
    party: matches[0] ?? null,
    matches,
  };
}

export function findLatestAccountSnapshotsForParty(
  input: ReadInput & {
    partyId: string;
    normalizedAccountType?: string | null;
    limit?: number;
  },
): FirmDocumentLatestAccountSnapshot[] {
  const ownerEmail = normalizeOwnerEmail(input.ownerEmail);
  if (!ownerEmail) {
    return [];
  }

  const normalizedAccountType = normalizeNullableQueryValue(
    input.normalizedAccountType ?? null,
  );
  const limit = clampPositiveInt(input.limit, 25);

  const result = queryPostgresSync<FirmDocumentLatestAccountSnapshot>(
    `
      SELECT DISTINCT
        latest.account_id AS "accountId",
        latest.document_account_snapshot_id AS "documentAccountSnapshotId",
        parties.party_id AS "partyId",
        parties.canonical_display_name AS "partyDisplayName",
        account_parties.role AS "partyRole",
        accounts.primary_institution_id AS "institutionId",
        institutions.canonical_name AS "institutionName",
        latest.source_file_id AS "sourceFileId",
        latest.source_name AS "sourceName",
        latest.document_id AS "documentId",
        latest.document_date AS "documentDate",
        latest.statement_start_date AS "statementStartDate",
        latest.statement_end_date AS "statementEndDate",
        latest.analyzed_at AS "analyzedAt",
        COALESCE(latest.normalized_account_type, accounts.canonical_account_type) AS "normalizedAccountType",
        latest.observed_account_type_raw AS "observedAccountTypeRaw",
        COALESCE(accounts.account_last4, latest.observed_account_last4) AS "accountLast4",
        accounts.masked_account_number AS "maskedAccountNumber",
        latest.registration_type AS "registrationType",
        latest.resolver_basis AS "resolverBasis"
      FROM public.latest_account_snapshot_v AS latest
      INNER JOIN public.account_parties
        ON account_parties.account_id = latest.account_id
      INNER JOIN public.parties
        ON parties.party_id = account_parties.party_id
      LEFT JOIN public.accounts
        ON accounts.account_id = latest.account_id
      LEFT JOIN public.institutions
        ON institutions.institution_id = accounts.primary_institution_id
      WHERE latest.owner_email = $1
        AND parties.party_id = $2
        AND (
          $3::text IS NULL OR
          LOWER(COALESCE(latest.normalized_account_type, accounts.canonical_account_type, '')) = $3
        )
      ORDER BY
        COALESCE(latest.statement_end_date, latest.document_date, latest.analyzed_at) DESC,
        latest.analyzed_at DESC,
        latest.document_id DESC
      LIMIT $4
    `,
    [ownerEmail, input.partyId, normalizedAccountType, limit],
  );

  return result.rows;
}

export function findLatestDocumentForAccount(
  input: ReadInput & { accountId: string },
): FirmDocumentLatestAccountDocument | null {
  const ownerEmail = normalizeOwnerEmail(input.ownerEmail);
  if (!ownerEmail) {
    return null;
  }

  const result = queryPostgresSync<FirmDocumentLatestAccountDocument>(
    `
      SELECT
        latest.account_id AS "accountId",
        latest.document_account_snapshot_id AS "documentAccountSnapshotId",
        accounts.primary_institution_id AS "institutionId",
        institutions.canonical_name AS "institutionName",
        latest.source_file_id AS "sourceFileId",
        latest.source_name AS "sourceName",
        latest.document_id AS "documentId",
        latest.document_date AS "documentDate",
        latest.statement_start_date AS "statementStartDate",
        latest.statement_end_date AS "statementEndDate",
        latest.analyzed_at AS "analyzedAt",
        latest.normalized_account_type AS "normalizedAccountType",
        latest.observed_account_last4 AS "accountLast4"
      FROM public.latest_account_document_v AS latest
      LEFT JOIN public.accounts
        ON accounts.account_id = latest.account_id
      LEFT JOIN public.institutions
        ON institutions.institution_id = accounts.primary_institution_id
      WHERE latest.owner_email = $1
        AND latest.account_id = $2
      LIMIT 1
    `,
    [ownerEmail, input.accountId],
  );

  return result.rows[0] ?? null;
}

export function findLatestAccountIdentifierForAccount(
  input: ReadInput & { accountId: string },
): FirmDocumentLatestAccountIdentifier | null {
  const ownerEmail = normalizeOwnerEmail(input.ownerEmail);
  if (!ownerEmail) {
    return null;
  }

  const result = queryPostgresSync<PostgresAccountIdentifierRow>(
    `
      SELECT
        latest.account_id AS "accountId",
        latest.document_account_snapshot_id AS "documentAccountSnapshotId",
        accounts.primary_institution_id AS "institutionId",
        institutions.canonical_name AS "institutionName",
        latest.source_file_id AS "sourceFileId",
        latest.source_name AS "sourceName",
        latest.document_id AS "documentId",
        latest.document_date AS "documentDate",
        latest.statement_start_date AS "statementStartDate",
        latest.statement_end_date AS "statementEndDate",
        latest.analyzed_at AS "analyzedAt",
        COALESCE(latest.normalized_account_type, accounts.canonical_account_type) AS "normalizedAccountType",
        latest.observed_account_number_ciphertext AS "accountNumberCiphertext",
        COALESCE(latest.observed_masked_account_number, accounts.masked_account_number) AS "maskedAccountNumber",
        COALESCE(accounts.account_last4, latest.observed_account_last4) AS "accountLast4"
      FROM public.latest_account_snapshot_v AS latest
      LEFT JOIN public.accounts
        ON accounts.account_id = latest.account_id
      LEFT JOIN public.institutions
        ON institutions.institution_id = accounts.primary_institution_id
      WHERE latest.owner_email = $1
        AND latest.account_id = $2
      LIMIT 1
    `,
    [ownerEmail, input.accountId],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    ...row,
    accountNumber: row.accountNumberCiphertext
      ? decryptServerValue(row.accountNumberCiphertext)
      : null,
  };
}

export function findLatestContactsForAccount(
  input: ReadInput & {
    accountId: string;
    purpose?: string | null;
    method?: string | null;
    limit?: number;
  },
): FirmDocumentLatestContact[] {
  const ownerEmail = normalizeOwnerEmail(input.ownerEmail);
  if (!ownerEmail) {
    return [];
  }

  const limit = clampPositiveInt(input.limit, 25);
  const purpose = normalizeNullableQueryValue(input.purpose ?? null);
  const method = normalizeNullableQueryValue(input.method ?? null);

  const result = queryPostgresSync<FirmDocumentLatestContact>(
    `
      WITH candidate_contacts AS (
        SELECT
          contacts.document_contact_id AS "documentContactId",
          snapshots.account_id AS "accountId",
          contacts.document_account_snapshot_id AS "documentAccountSnapshotId",
          COALESCE(contacts.institution_id, accounts.primary_institution_id) AS "institutionId",
          COALESCE(institutions.canonical_name, document_institutions.normalized_name) AS "institutionName",
          documents.source_file_id AS "sourceFileId",
          documents.source_name AS "sourceName",
          documents.document_id AS "documentId",
          documents.document_date AS "documentDate",
          snapshots.statement_end_date AS "statementEndDate",
          contacts.method AS method,
          contacts.purpose AS purpose,
          contacts.label AS label,
          contacts.raw_value AS "rawValue",
          contacts.normalized_value AS "normalizedValue",
          contacts.hours_text AS "hoursText",
          DENSE_RANK() OVER (
            ORDER BY
              COALESCE(snapshots.statement_end_date, documents.document_date, documents.analyzed_at) DESC,
              documents.analyzed_at DESC,
              documents.document_id DESC
          ) AS "documentRank",
          CASE
            WHEN contacts.document_account_snapshot_id = snapshots.document_account_snapshot_id THEN 0
            ELSE 1
          END AS "linkageRank",
          contacts.source_index AS "sourceIndex"
        FROM public.document_account_snapshots AS snapshots
        INNER JOIN public.documents
          ON documents.document_id = snapshots.document_id
        LEFT JOIN public.accounts
          ON accounts.account_id = snapshots.account_id
        INNER JOIN public.document_contacts AS contacts
          ON contacts.document_id = snapshots.document_id
        LEFT JOIN public.institutions
          ON institutions.institution_id = COALESCE(contacts.institution_id, accounts.primary_institution_id)
        LEFT JOIN public.document_institutions
          ON document_institutions.document_institution_id = contacts.document_institution_id
        WHERE documents.owner_email = $1
          AND snapshots.account_id = $2
          AND (
            contacts.document_account_snapshot_id = snapshots.document_account_snapshot_id
            OR (
              contacts.document_account_snapshot_id IS NULL
              AND (
                (
                  contacts.document_institution_id IS NOT NULL
                  AND contacts.document_institution_id = snapshots.document_institution_id
                )
                OR (
                  contacts.institution_id IS NOT NULL
                  AND contacts.institution_id = accounts.primary_institution_id
                )
              )
            )
          )
          AND ($3::text IS NULL OR LOWER(contacts.purpose) = $3)
          AND ($4::text IS NULL OR LOWER(contacts.method) = $4)
      )
      SELECT
        "documentContactId",
        "accountId",
        "documentAccountSnapshotId",
        "institutionId",
        "institutionName",
        "sourceFileId",
        "sourceName",
        "documentId",
        "documentDate",
        "statementEndDate",
        method,
        purpose,
        label,
        "rawValue",
        "normalizedValue",
        "hoursText"
      FROM candidate_contacts
      WHERE "documentRank" = 1
      ORDER BY "linkageRank" ASC, "sourceIndex" ASC
      LIMIT $5
    `,
    [ownerEmail, input.accountId, purpose, method, limit],
  );

  return result.rows;
}

export function findAccountValuesForDocumentSnapshot(
  input: ReadInput & {
    documentAccountSnapshotId: string;
  },
): FirmDocumentAccountValue[] {
  const ownerEmail = normalizeOwnerEmail(input.ownerEmail);
  if (!ownerEmail) {
    return [];
  }

  const result = queryPostgresSync<FirmDocumentAccountValue>(
    `
      SELECT
        account_values.account_value_id AS "accountValueId",
        account_values.account_id AS "accountId",
        account_values.document_account_snapshot_id AS "documentAccountSnapshotId",
        account_values.kind AS kind,
        account_values.label AS label,
        account_values.amount AS amount,
        account_values.currency AS currency
      FROM public.account_values
      INNER JOIN public.document_account_snapshots
        ON document_account_snapshots.document_account_snapshot_id = account_values.document_account_snapshot_id
      INNER JOIN public.documents
        ON documents.document_id = document_account_snapshots.document_id
      WHERE documents.owner_email = $1
        AND account_values.document_account_snapshot_id = $2
      ORDER BY account_values.source_index ASC
    `,
    [ownerEmail, input.documentAccountSnapshotId],
  );

  return result.rows;
}

export function findLatestIdentityDocumentForParty(
  input: ReadInput & {
    partyId: string;
    idKind?: string | null;
    idType?: string | null;
  },
): FirmDocumentLatestIdentityDocument | null {
  return findLatestIdentityFactsForParty(input);
}

export function findLatestIdentityFactsForParty(
  input: ReadInput & {
    partyId: string;
    idKind?: string | null;
    idType?: string | null;
  },
): FirmDocumentLatestIdentityFacts | null {
  return selectLatestIdentityRecord(input, {});
}

export function findLatestIdentityDobForParty(
  input: ReadInput & { partyId: string },
): FirmDocumentLatestIdentityDob | null {
  const latest = selectLatestIdentityRecord(input, {
    requireBirthDate: true,
  });

  if (!latest?.birthDate) {
    return null;
  }

  return {
    partyId: latest.partyId,
    partyDisplayName: latest.partyDisplayName,
    documentId: latest.documentId,
    sourceFileId: latest.sourceFileId,
    sourceName: latest.sourceName,
    documentDate: latest.documentDate,
    idKind: latest.idKind,
    idType: latest.idType,
    birthDate: latest.birthDate,
  };
}

export function findLatestIdentityAddressForParty(
  input: ReadInput & { partyId: string },
): FirmDocumentLatestIdentityAddressRecord | null {
  const latest = selectLatestIdentityRecord(input, {
    requireAddress: true,
  });

  if (!latest?.address || !latest.addressRawText) {
    return null;
  }

  return {
    partyId: latest.partyId,
    partyDisplayName: latest.partyDisplayName,
    documentId: latest.documentId,
    sourceFileId: latest.sourceFileId,
    sourceName: latest.sourceName,
    documentDate: latest.documentDate,
    idKind: latest.idKind,
    idType: latest.idType,
    addressRawText: latest.addressRawText,
    address: latest.address,
  };
}

export function findLatestIdentityExpirationForParty(
  input: ReadInput & {
    partyId: string;
    idKind?: string | null;
    idType?: string | null;
  },
): FirmDocumentLatestIdentityExpiration | null {
  const latest = selectLatestIdentityRecord(input, {
    requireExpirationDate: true,
  });

  if (!latest?.expirationDate) {
    return null;
  }

  return {
    partyId: latest.partyId,
    partyDisplayName: latest.partyDisplayName,
    documentId: latest.documentId,
    sourceFileId: latest.sourceFileId,
    sourceName: latest.sourceName,
    documentDate: latest.documentDate,
    idKind: latest.idKind,
    idType: latest.idType,
    issueDate: latest.issueDate,
    expirationDate: latest.expirationDate,
  };
}

export function findLatestDriverLicenseStatusForParty(
  input: ReadInput & {
    partyId: string;
    asOfDate?: string | null;
  },
): FirmDocumentLatestDriverLicenseStatus {
  const asOfDate = normalizeIsoDate(input.asOfDate) ?? currentIsoDate();
  const latest = selectLatestIdentityRecord(
    {
      ...input,
      idKind: "driver_license",
    },
    {},
  );

  if (!latest) {
    return {
      partyId: input.partyId,
      partyDisplayName: null,
      status: "not_found",
      isUnexpired: null,
      asOfDate,
      documentId: null,
      sourceFileId: null,
      sourceName: null,
      documentDate: null,
      idKind: null,
      idType: null,
      issueDate: null,
      expirationDate: null,
    };
  }

  if (!latest.expirationDate) {
    return {
      partyId: latest.partyId,
      partyDisplayName: latest.partyDisplayName,
      status: "missing_expiration",
      isUnexpired: null,
      asOfDate,
      documentId: latest.documentId,
      sourceFileId: latest.sourceFileId,
      sourceName: latest.sourceName,
      documentDate: latest.documentDate,
      idKind: latest.idKind,
      idType: latest.idType,
      issueDate: latest.issueDate,
      expirationDate: null,
    };
  }

  const isUnexpired = latest.expirationDate >= asOfDate;

  return {
    partyId: latest.partyId,
    partyDisplayName: latest.partyDisplayName,
    status: isUnexpired ? "unexpired" : "expired",
    isUnexpired,
    asOfDate,
    documentId: latest.documentId,
    sourceFileId: latest.sourceFileId,
    sourceName: latest.sourceName,
    documentDate: latest.documentDate,
    idKind: latest.idKind,
    idType: latest.idType,
    issueDate: latest.issueDate,
    expirationDate: latest.expirationDate,
  };
}

export function inspectFirmDocumentBySourceFileId(
  _input: ReadInput & { sourceFileId: string },
): FirmDocumentInspection | null {
  throw new Error(
    "inspectFirmDocumentBySourceFileId is not supported yet with PERSISTENCE_BACKEND=supabase.",
  );
}

function selectLatestIdentityRecord(
  input: ReadInput & {
    partyId: string;
    idKind?: string | null;
    idType?: string | null;
  },
  options: {
    requireBirthDate?: boolean;
    requireAddress?: boolean;
    requireExpirationDate?: boolean;
  },
): FirmDocumentLatestIdentityFacts | null {
  const ownerEmail = normalizeOwnerEmail(input.ownerEmail);
  if (!ownerEmail) {
    return null;
  }

  const idKind = normalizeNullableQueryValue(input.idKind ?? null);
  const idType = normalizeNullableQueryValue(input.idType ?? null);
  const additionalPredicates: string[] = [];

  if (options.requireBirthDate) {
    additionalPredicates.push("document_party_facts.birth_date IS NOT NULL");
  }
  if (options.requireAddress) {
    additionalPredicates.push("document_parties.address_json IS NOT NULL");
  }
  if (options.requireExpirationDate) {
    additionalPredicates.push("document_party_facts.expiration_date IS NOT NULL");
  }

  const additionalWhere =
    additionalPredicates.length > 0
      ? ` AND ${additionalPredicates.join(" AND ")}`
      : "";

  const result = queryPostgresSync<PostgresIdentityRow>(
    `
      SELECT
        parties.party_id AS "partyId",
        parties.canonical_display_name AS "partyDisplayName",
        documents.source_file_id AS "sourceFileId",
        documents.source_name AS "sourceName",
        documents.document_id AS "documentId",
        documents.document_date AS "documentDate",
        documents.analyzed_at AS "analyzedAt",
        documents.normalized_document_subtype AS "documentSubtype",
        document_parties.raw_name AS "rawName",
        document_parties.normalized_display_name AS "normalizedDisplayName",
        document_parties.address_json AS "addressJson",
        document_party_facts.id_kind AS "idKind",
        document_party_facts.id_type AS "idType",
        document_party_facts.raw_id_value_ciphertext AS "rawIdValueCiphertext",
        document_party_facts.masked_id_value AS "maskedIdValue",
        document_party_facts.issuing_authority AS "issuingAuthority",
        document_party_facts.birth_date AS "birthDate",
        document_party_facts.issue_date AS "issueDate",
        document_party_facts.expiration_date AS "expirationDate"
      FROM public.documents
      INNER JOIN public.document_parties
        ON document_parties.document_id = documents.document_id
      INNER JOIN public.parties
        ON parties.party_id = document_parties.party_id
      LEFT JOIN public.document_party_facts
        ON document_party_facts.document_id = document_parties.document_id
        AND (
          document_party_facts.document_party_id = document_parties.document_party_id
          OR (
            document_party_facts.document_party_id IS NULL
            AND document_party_facts.source_index = document_parties.source_index
          )
        )
      WHERE documents.owner_email = $1
        AND documents.normalized_document_type_id = 'identity_document'
        AND parties.party_id = $2
        AND ($3::text IS NULL OR LOWER(COALESCE(document_party_facts.id_kind, '')) = $3)
        AND ($4::text IS NULL OR LOWER(COALESCE(document_party_facts.id_type, '')) = $4)
        ${additionalWhere}
      ORDER BY
        COALESCE(documents.document_date, document_party_facts.issue_date, documents.analyzed_at) DESC,
        documents.analyzed_at DESC,
        documents.document_id DESC
      LIMIT 1
    `,
    [ownerEmail, input.partyId, idKind, idType],
  );

  return result.rows[0] ? mapIdentityRow(result.rows[0]) : null;
}

function mapIdentityRow(row: PostgresIdentityRow): FirmDocumentLatestIdentityFacts {
  const address = parseIdentityAddress(row.addressJson);

  return {
    partyId: row.partyId,
    partyDisplayName: row.partyDisplayName,
    sourceFileId: row.sourceFileId,
    sourceName: row.sourceName,
    documentId: row.documentId,
    documentDate: row.documentDate,
    analyzedAt: row.analyzedAt,
    documentSubtype: row.documentSubtype,
    rawName: row.rawName,
    normalizedDisplayName: row.normalizedDisplayName,
    addressRawText: address?.rawText ?? null,
    address,
    idKind: row.idKind,
    idType: row.idType,
    rawIdValue: row.rawIdValueCiphertext
      ? decryptServerValue(row.rawIdValueCiphertext)
      : null,
    maskedIdValue: row.maskedIdValue,
    issuingAuthority: row.issuingAuthority,
    birthDate: row.birthDate,
    issueDate: row.issueDate,
    expirationDate: row.expirationDate,
  };
}

function parseIdentityAddress(value: unknown): FirmDocumentIdentityAddress | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const linesValue = (value as { lines?: unknown }).lines;
  const lines =
    Array.isArray(linesValue) &&
    linesValue.every((entry) => typeof entry === "string")
      ? linesValue
      : null;

  return {
    rawText: asNullableString((value as { rawText?: unknown }).rawText),
    lines,
    city: asNullableString((value as { city?: unknown }).city),
    state: asNullableString((value as { state?: unknown }).state),
    postalCode: asNullableString((value as { postalCode?: unknown }).postalCode),
    country: asNullableString((value as { country?: unknown }).country),
  };
}

function asNullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}
