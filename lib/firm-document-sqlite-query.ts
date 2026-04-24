import fs from "node:fs";
import Database from "better-sqlite3";
import { getFirmDocumentSqlitePath } from "@/lib/firm-document-sqlite";

type SqliteConnection = InstanceType<typeof Database>;

type ReadInput = {
  ownerEmail: string;
  dbPath?: string | null;
};

export type FirmDocumentPartyMatch = {
  partyId: string;
  canonicalDisplayName: string | null;
  kind: string;
  addressSignature: string | null;
  firstSeenDocumentId: string | null;
  lastSeenDocumentId: string | null;
  matchType: "exact_normalized";
};

export type FirmDocumentAccountValue = {
  accountValueId: string;
  accountId: string | null;
  documentAccountSnapshotId: string;
  kind: string;
  label: string | null;
  amount: string | null;
  currency: string | null;
};

export type FirmDocumentLatestAccountSnapshot = {
  accountId: string;
  documentAccountSnapshotId: string;
  partyId: string;
  partyDisplayName: string | null;
  partyRole: string;
  institutionId: string | null;
  institutionName: string | null;
  sourceFileId: string | null;
  sourceName: string | null;
  documentId: string;
  documentDate: string | null;
  statementStartDate: string | null;
  statementEndDate: string | null;
  analyzedAt: string | null;
  normalizedAccountType: string | null;
  observedAccountTypeRaw: string | null;
  accountLast4: string | null;
  maskedAccountNumber: string | null;
  registrationType: string | null;
  resolverBasis: string | null;
};

export type FirmDocumentLatestAccountDocument = {
  accountId: string;
  documentAccountSnapshotId: string;
  institutionId: string | null;
  institutionName: string | null;
  sourceFileId: string | null;
  sourceName: string | null;
  documentId: string;
  documentDate: string | null;
  statementStartDate: string | null;
  statementEndDate: string | null;
  analyzedAt: string | null;
  normalizedAccountType: string | null;
  accountLast4: string | null;
};

export type FirmDocumentLatestAccountIdentifier = {
  accountId: string;
  documentAccountSnapshotId: string;
  institutionId: string | null;
  institutionName: string | null;
  sourceFileId: string | null;
  sourceName: string | null;
  documentId: string;
  documentDate: string | null;
  statementStartDate: string | null;
  statementEndDate: string | null;
  analyzedAt: string | null;
  normalizedAccountType: string | null;
  accountNumber: string | null;
  maskedAccountNumber: string | null;
  accountLast4: string | null;
};

export type FirmDocumentLatestContact = {
  documentContactId: string;
  accountId: string;
  documentAccountSnapshotId: string | null;
  institutionId: string | null;
  institutionName: string | null;
  sourceFileId: string | null;
  sourceName: string | null;
  documentId: string;
  documentDate: string | null;
  statementEndDate: string | null;
  method: string;
  purpose: string;
  label: string | null;
  rawValue: string | null;
  normalizedValue: string | null;
  hoursText: string | null;
};

export type FirmDocumentIdentityAddress = {
  rawText: string | null;
  lines: string[] | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
};

export type FirmDocumentLatestIdentityFacts = {
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
  addressRawText: string | null;
  address: FirmDocumentIdentityAddress | null;
  idKind: string | null;
  idType: string | null;
  rawIdValue: string | null;
  maskedIdValue: string | null;
  issuingAuthority: string | null;
  birthDate: string | null;
  issueDate: string | null;
  expirationDate: string | null;
};

export type FirmDocumentLatestIdentityDocument = FirmDocumentLatestIdentityFacts;

export type FirmDocumentLatestIdentityDob = {
  partyId: string;
  partyDisplayName: string | null;
  documentId: string;
  sourceFileId: string | null;
  sourceName: string | null;
  documentDate: string | null;
  idKind: string | null;
  idType: string | null;
  birthDate: string;
};

export type FirmDocumentLatestIdentityAddressRecord = {
  partyId: string;
  partyDisplayName: string | null;
  documentId: string;
  sourceFileId: string | null;
  sourceName: string | null;
  documentDate: string | null;
  idKind: string | null;
  idType: string | null;
  addressRawText: string;
  address: FirmDocumentIdentityAddress;
};

export type FirmDocumentLatestIdentityExpiration = {
  partyId: string;
  partyDisplayName: string | null;
  documentId: string;
  sourceFileId: string | null;
  sourceName: string | null;
  documentDate: string | null;
  idKind: string | null;
  idType: string | null;
  issueDate: string | null;
  expirationDate: string;
};

export type FirmDocumentLatestDriverLicenseStatus = {
  partyId: string;
  partyDisplayName: string | null;
  status: "unexpired" | "expired" | "missing_expiration" | "not_found";
  isUnexpired: boolean | null;
  asOfDate: string;
  documentId: string | null;
  sourceFileId: string | null;
  sourceName: string | null;
  documentDate: string | null;
  idKind: string | null;
  idType: string | null;
  issueDate: string | null;
  expirationDate: string | null;
};

export type FirmDocumentResolvedParty = {
  status: "resolved" | "not_found" | "ambiguous";
  party: FirmDocumentPartyMatch | null;
  matches: FirmDocumentPartyMatch[];
};

export type FirmDocumentInspection = {
  document: Record<string, unknown> | null;
  documentCanonicalPayload: Record<string, unknown> | null;
  documentPrimaryFacts: Record<string, unknown> | null;
  documentParties: Array<Record<string, unknown>>;
  documentPartyFacts: Array<Record<string, unknown>>;
  documentInstitutions: Array<Record<string, unknown>>;
  documentAccountSnapshots: Array<Record<string, unknown>>;
  documentAccountParties: Array<Record<string, unknown>>;
  documentContacts: Array<Record<string, unknown>>;
  accountValues: Array<Record<string, unknown>>;
  stableParties: Array<Record<string, unknown>>;
  stableInstitutions: Array<Record<string, unknown>>;
  stableAccounts: Array<Record<string, unknown>>;
  stableAccountParties: Array<Record<string, unknown>>;
  latestAccountSnapshots: Array<Record<string, unknown>>;
};

export function findFirmDocumentPartiesByName(
  input: ReadInput & { name: string },
): FirmDocumentPartyMatch[] {
  const normalizedQuery = normalizeLookupValue(input.name);
  if (!normalizedQuery) {
    return [];
  }

  return withReadOnlyFirmDocumentDb(input, [], (db) => {
    return selectAllFirmDocumentParties(db, normalizeOwnerEmail(input.ownerEmail))
      .filter(
        (row) =>
          normalizeLookupValue(row.canonicalDisplayName ?? "") === normalizedQuery,
      )
      ;
  });
}

export function listFirmDocumentParties(
  input: ReadInput,
): FirmDocumentPartyMatch[] {
  return withReadOnlyFirmDocumentDb(input, [], (db) =>
    selectAllFirmDocumentParties(db, normalizeOwnerEmail(input.ownerEmail)),
  );
}

export function resolveFirmDocumentPartyByName(
  input: ReadInput & { name: string },
): FirmDocumentResolvedParty {
  const matches = findFirmDocumentPartiesByName(input);
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
  const normalizedAccountType = normalizeNullableQueryValue(
    input.normalizedAccountType ?? null,
  );
  const limit = clampPositiveInt(input.limit, 25);

  return withReadOnlyFirmDocumentDb(input, [], (db) => {
    return db
      .prepare<
        {
          ownerEmail: string;
          partyId: string;
          normalizedAccountType: string | null;
          limit: number;
        },
        {
          accountId: string;
          documentAccountSnapshotId: string;
          partyId: string;
          partyDisplayName: string | null;
          partyRole: string;
          institutionId: string | null;
          institutionName: string | null;
          sourceFileId: string | null;
          sourceName: string | null;
          documentId: string;
          documentDate: string | null;
          statementStartDate: string | null;
          statementEndDate: string | null;
          analyzedAt: string | null;
          normalizedAccountType: string | null;
          observedAccountTypeRaw: string | null;
          accountLast4: string | null;
          maskedAccountNumber: string | null;
          registrationType: string | null;
          resolverBasis: string | null;
        }
      >(`
        SELECT DISTINCT
          latest.account_id AS accountId,
          latest.document_account_snapshot_id AS documentAccountSnapshotId,
          parties.party_id AS partyId,
          parties.canonical_display_name AS partyDisplayName,
          account_parties.role AS partyRole,
          accounts.primary_institution_id AS institutionId,
          institutions.canonical_name AS institutionName,
          latest.source_file_id AS sourceFileId,
          latest.source_name AS sourceName,
          latest.document_id AS documentId,
          latest.document_date AS documentDate,
          latest.statement_start_date AS statementStartDate,
          latest.statement_end_date AS statementEndDate,
          latest.analyzed_at AS analyzedAt,
          COALESCE(latest.normalized_account_type, accounts.canonical_account_type) AS normalizedAccountType,
          latest.observed_account_type_raw AS observedAccountTypeRaw,
          COALESCE(accounts.account_last4, latest.observed_account_last4) AS accountLast4,
          accounts.masked_account_number AS maskedAccountNumber,
          latest.registration_type AS registrationType,
          latest.resolver_basis AS resolverBasis
        FROM latest_account_snapshot_v AS latest
        INNER JOIN account_parties
          ON account_parties.account_id = latest.account_id
        INNER JOIN parties
          ON parties.party_id = account_parties.party_id
        LEFT JOIN accounts
          ON accounts.account_id = latest.account_id
        LEFT JOIN institutions
          ON institutions.institution_id = accounts.primary_institution_id
        WHERE latest.owner_email = @ownerEmail
          AND parties.party_id = @partyId
          AND (
            @normalizedAccountType IS NULL OR
            LOWER(COALESCE(latest.normalized_account_type, accounts.canonical_account_type, '')) = @normalizedAccountType
          )
        ORDER BY
          COALESCE(latest.statement_end_date, latest.document_date, latest.analyzed_at) DESC,
          latest.analyzed_at DESC,
          latest.document_id DESC
        LIMIT @limit
      `)
      .all({
        ownerEmail: normalizeOwnerEmail(input.ownerEmail),
        partyId: input.partyId,
        normalizedAccountType,
        limit,
      });
  });
}

export function findLatestDocumentForAccount(
  input: ReadInput & { accountId: string },
): FirmDocumentLatestAccountDocument | null {
  return withReadOnlyFirmDocumentDb(input, null, (db) => {
    return db
      .prepare<
        { ownerEmail: string; accountId: string },
        FirmDocumentLatestAccountDocument
      >(`
        SELECT
          latest.account_id AS accountId,
          latest.document_account_snapshot_id AS documentAccountSnapshotId,
          accounts.primary_institution_id AS institutionId,
          institutions.canonical_name AS institutionName,
          latest.source_file_id AS sourceFileId,
          latest.source_name AS sourceName,
          latest.document_id AS documentId,
          latest.document_date AS documentDate,
          latest.statement_start_date AS statementStartDate,
          latest.statement_end_date AS statementEndDate,
          latest.analyzed_at AS analyzedAt,
          latest.normalized_account_type AS normalizedAccountType,
          latest.observed_account_last4 AS accountLast4
        FROM latest_account_document_v AS latest
        LEFT JOIN accounts
          ON accounts.account_id = latest.account_id
        LEFT JOIN institutions
          ON institutions.institution_id = accounts.primary_institution_id
        WHERE latest.owner_email = @ownerEmail
          AND latest.account_id = @accountId
        LIMIT 1
      `)
      .get({
        ownerEmail: normalizeOwnerEmail(input.ownerEmail),
        accountId: input.accountId,
      }) ?? null;
  });
}

export function findLatestAccountIdentifierForAccount(
  input: ReadInput & { accountId: string },
): FirmDocumentLatestAccountIdentifier | null {
  return withReadOnlyFirmDocumentDb(input, null, (db) => {
    return db
      .prepare<
        { ownerEmail: string; accountId: string },
        FirmDocumentLatestAccountIdentifier
      >(`
        SELECT
          latest.account_id AS accountId,
          latest.document_account_snapshot_id AS documentAccountSnapshotId,
          accounts.primary_institution_id AS institutionId,
          institutions.canonical_name AS institutionName,
          latest.source_file_id AS sourceFileId,
          latest.source_name AS sourceName,
          latest.document_id AS documentId,
          latest.document_date AS documentDate,
          latest.statement_start_date AS statementStartDate,
          latest.statement_end_date AS statementEndDate,
          latest.analyzed_at AS analyzedAt,
          COALESCE(latest.normalized_account_type, accounts.canonical_account_type) AS normalizedAccountType,
          latest.observed_account_number AS accountNumber,
          COALESCE(latest.observed_masked_account_number, accounts.masked_account_number) AS maskedAccountNumber,
          COALESCE(accounts.account_last4, latest.observed_account_last4) AS accountLast4
        FROM latest_account_snapshot_v AS latest
        LEFT JOIN accounts
          ON accounts.account_id = latest.account_id
        LEFT JOIN institutions
          ON institutions.institution_id = accounts.primary_institution_id
        WHERE latest.owner_email = @ownerEmail
          AND latest.account_id = @accountId
        LIMIT 1
      `)
      .get({
        ownerEmail: normalizeOwnerEmail(input.ownerEmail),
        accountId: input.accountId,
      }) ?? null;
  });
}

export function findLatestContactsForAccount(
  input: ReadInput & {
    accountId: string;
    purpose?: string | null;
    method?: string | null;
    limit?: number;
  },
): FirmDocumentLatestContact[] {
  const limit = clampPositiveInt(input.limit, 25);
  const purpose = normalizeNullableQueryValue(input.purpose ?? null);
  const method = normalizeNullableQueryValue(input.method ?? null);

  return withReadOnlyFirmDocumentDb(input, [], (db) => {
    return db
      .prepare<
        {
          ownerEmail: string;
          accountId: string;
          purpose: string | null;
          method: string | null;
          limit: number;
        },
        FirmDocumentLatestContact
      >(`
        WITH candidate_contacts AS (
          SELECT
            contacts.document_contact_id AS documentContactId,
            snapshots.account_id AS accountId,
            contacts.document_account_snapshot_id AS documentAccountSnapshotId,
            COALESCE(contacts.institution_id, accounts.primary_institution_id) AS institutionId,
            COALESCE(institutions.canonical_name, document_institutions.normalized_name) AS institutionName,
            documents.source_file_id AS sourceFileId,
            documents.source_name AS sourceName,
            documents.document_id AS documentId,
            documents.document_date AS documentDate,
            snapshots.statement_end_date AS statementEndDate,
            contacts.method AS method,
            contacts.purpose AS purpose,
            contacts.label AS label,
            contacts.raw_value AS rawValue,
            contacts.normalized_value AS normalizedValue,
            contacts.hours_text AS hoursText,
            DENSE_RANK() OVER (
              ORDER BY
                COALESCE(snapshots.statement_end_date, documents.document_date, documents.analyzed_at) DESC,
                documents.analyzed_at DESC,
                documents.document_id DESC
            ) AS documentRank,
            CASE
              WHEN contacts.document_account_snapshot_id = snapshots.document_account_snapshot_id THEN 0
              ELSE 1
            END AS linkageRank,
            contacts.source_index AS sourceIndex
          FROM document_account_snapshots AS snapshots
          INNER JOIN documents
            ON documents.document_id = snapshots.document_id
          LEFT JOIN accounts
            ON accounts.account_id = snapshots.account_id
          INNER JOIN document_contacts AS contacts
            ON contacts.document_id = snapshots.document_id
          LEFT JOIN institutions
            ON institutions.institution_id = COALESCE(contacts.institution_id, accounts.primary_institution_id)
          LEFT JOIN document_institutions
            ON document_institutions.document_institution_id = contacts.document_institution_id
          WHERE documents.owner_email = @ownerEmail
            AND snapshots.account_id = @accountId
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
            AND (@purpose IS NULL OR LOWER(contacts.purpose) = @purpose)
            AND (@method IS NULL OR LOWER(contacts.method) = @method)
        )
        SELECT
          documentContactId,
          accountId,
          documentAccountSnapshotId,
          institutionId,
          institutionName,
          sourceFileId,
          sourceName,
          documentId,
          documentDate,
          statementEndDate,
          method,
          purpose,
          label,
          rawValue,
          normalizedValue,
          hoursText
        FROM candidate_contacts
        WHERE documentRank = 1
        ORDER BY linkageRank ASC, sourceIndex ASC
        LIMIT @limit
      `)
      .all({
        ownerEmail: normalizeOwnerEmail(input.ownerEmail),
        accountId: input.accountId,
        purpose,
        method,
        limit,
      });
  });
}

export function findAccountValuesForDocumentSnapshot(
  input: ReadInput & {
    documentAccountSnapshotId: string;
  },
): FirmDocumentAccountValue[] {
  return withReadOnlyFirmDocumentDb(input, [], (db) => {
    return db
      .prepare<
        {
          ownerEmail: string;
          documentAccountSnapshotId: string;
        },
        FirmDocumentAccountValue
      >(`
        SELECT
          account_values.account_value_id AS accountValueId,
          account_values.account_id AS accountId,
          account_values.document_account_snapshot_id AS documentAccountSnapshotId,
          account_values.kind AS kind,
          account_values.label AS label,
          account_values.amount AS amount,
          account_values.currency AS currency
        FROM account_values
        INNER JOIN document_account_snapshots
          ON document_account_snapshots.document_account_snapshot_id = account_values.document_account_snapshot_id
        INNER JOIN documents
          ON documents.document_id = document_account_snapshots.document_id
        WHERE documents.owner_email = @ownerEmail
          AND account_values.document_account_snapshot_id = @documentAccountSnapshotId
        ORDER BY account_values.source_index ASC
      `)
      .all({
        ownerEmail: normalizeOwnerEmail(input.ownerEmail),
        documentAccountSnapshotId: input.documentAccountSnapshotId,
      });
  });
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
  input: ReadInput & { sourceFileId: string },
): FirmDocumentInspection | null {
  return withReadOnlyFirmDocumentDb(input, null, (db) => {
    const document = db
      .prepare<
        { ownerEmail: string; sourceFileId: string },
        Record<string, unknown>
      >(`
        SELECT *
        FROM documents
        WHERE owner_email = @ownerEmail
          AND source_file_id = @sourceFileId
        LIMIT 1
      `)
      .get({
        ownerEmail: normalizeOwnerEmail(input.ownerEmail),
        sourceFileId: input.sourceFileId,
      });

    if (!document || typeof document.document_id !== "string") {
      return null;
    }

    const documentId = document.document_id;
    const documentCanonicalPayload = db
      .prepare<{ documentId: string }, { canonical_json: string | null }>(`
        SELECT canonical_json
        FROM document_canonical_payloads
        WHERE document_id = @documentId
      `)
      .get({ documentId });
    const documentPrimaryFacts = db
      .prepare<{ documentId: string }, Record<string, unknown>>(`
        SELECT *
        FROM document_primary_facts
        WHERE document_id = @documentId
      `)
      .get({ documentId });
    const documentParties = db
      .prepare<{ documentId: string }, Record<string, unknown>>(`
        SELECT *
        FROM document_parties
        WHERE document_id = @documentId
        ORDER BY source_index ASC
      `)
      .all({ documentId });
    const documentPartyFacts = db
      .prepare<{ documentId: string }, Record<string, unknown>>(`
        SELECT *
        FROM document_party_facts
        WHERE document_id = @documentId
        ORDER BY source_index ASC
      `)
      .all({ documentId });
    const documentInstitutions = db
      .prepare<{ documentId: string }, Record<string, unknown>>(`
        SELECT *
        FROM document_institutions
        WHERE document_id = @documentId
        ORDER BY source_index ASC
      `)
      .all({ documentId });
    const documentAccountSnapshots = db
      .prepare<{ documentId: string }, Record<string, unknown>>(`
        SELECT *
        FROM document_account_snapshots
        WHERE document_id = @documentId
        ORDER BY source_index ASC
      `)
      .all({ documentId });
    const documentAccountParties = db
      .prepare<{ documentId: string }, Record<string, unknown>>(`
        SELECT *
        FROM document_account_parties
        WHERE document_id = @documentId
        ORDER BY source_index ASC
      `)
      .all({ documentId });
    const documentContacts = db
      .prepare<{ documentId: string }, Record<string, unknown>>(`
        SELECT *
        FROM document_contacts
        WHERE document_id = @documentId
        ORDER BY source_index ASC
      `)
      .all({ documentId });

    const snapshotIds = documentAccountSnapshots
      .map((row) =>
        typeof row.document_account_snapshot_id === "string"
          ? row.document_account_snapshot_id
          : null,
      )
      .filter((value): value is string => Boolean(value));
    const accountIds = documentAccountSnapshots
      .map((row) => (typeof row.account_id === "string" ? row.account_id : null))
      .filter((value): value is string => Boolean(value));
    const institutionIds = Array.from(
      new Set(
        [
          ...documentInstitutions.map((row) =>
            typeof row.institution_id === "string" ? row.institution_id : null,
          ),
          ...documentContacts.map((row) =>
            typeof row.institution_id === "string" ? row.institution_id : null,
          ),
        ].filter((value): value is string => Boolean(value)),
      ),
    );
    const partyIds = Array.from(
      new Set(
        [
          ...documentParties.map((row) =>
            typeof row.party_id === "string" ? row.party_id : null,
          ),
          ...documentAccountParties.map((row) =>
            typeof row.party_id === "string" ? row.party_id : null,
          ),
        ].filter((value): value is string => Boolean(value)),
      ),
    );

    const accountValues = selectRowsByIds(
      db,
      "SELECT * FROM account_values WHERE document_account_snapshot_id IN",
      "document_account_snapshot_id",
      snapshotIds,
      "source_index ASC",
    );
    const stableParties = selectRowsByIds(
      db,
      "SELECT * FROM parties WHERE party_id IN",
      "party_id",
      partyIds,
      "canonical_display_name ASC, party_id ASC",
    );
    const stableInstitutions = selectRowsByIds(
      db,
      "SELECT * FROM institutions WHERE institution_id IN",
      "institution_id",
      institutionIds,
      "canonical_name ASC, institution_id ASC",
    );
    const stableAccounts = selectRowsByIds(
      db,
      "SELECT * FROM accounts WHERE account_id IN",
      "account_id",
      accountIds,
      "account_id ASC",
    );
    const stableAccountParties = selectRowsByIds(
      db,
      "SELECT * FROM account_parties WHERE account_id IN",
      "account_id",
      accountIds,
      "account_id ASC, party_id ASC, role ASC",
    );
    const latestAccountSnapshots = selectRowsByIds(
      db,
      "SELECT * FROM latest_account_snapshot_v WHERE account_id IN",
      "account_id",
      accountIds,
      "account_id ASC",
    );

    return {
      document,
      documentCanonicalPayload:
        typeof documentCanonicalPayload?.canonical_json === "string"
          ? safeParseJson(documentCanonicalPayload.canonical_json)
          : null,
      documentPrimaryFacts: documentPrimaryFacts ?? null,
      documentParties,
      documentPartyFacts,
      documentInstitutions,
      documentAccountSnapshots,
      documentAccountParties,
      documentContacts,
      accountValues,
      stableParties,
      stableInstitutions,
      stableAccounts,
      stableAccountParties,
      latestAccountSnapshots,
    };
  });
}

function withReadOnlyFirmDocumentDb<T>(
  input: ReadInput,
  emptyValue: T,
  callback: (db: SqliteConnection) => T,
): T {
  const ownerEmail = normalizeOwnerEmail(input.ownerEmail);
  if (!ownerEmail) {
    return emptyValue;
  }

  const dbPath = input.dbPath?.trim() || getFirmDocumentSqlitePath(ownerEmail);
  if (!dbPath || !fs.existsSync(dbPath)) {
    return emptyValue;
  }

  const db = new Database(dbPath, {
    readonly: true,
    fileMustExist: true,
  });

  try {
    db.pragma("query_only = ON");
    return callback(db);
  } finally {
    db.close();
  }
}

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

function selectRowsByIds(
  db: SqliteConnection,
  sqlPrefix: string,
  idLabel: string,
  ids: string[],
  orderBy: string,
) {
  if (ids.length === 0) {
    return [];
  }

  const placeholders = ids
    .map((_, index) => `@${idLabel}${index}`)
    .join(", ");
  const params = ids.reduce<Record<string, string>>((accumulator, id, index) => {
    accumulator[`${idLabel}${index}`] = id;
    return accumulator;
  }, {});

  return db
    .prepare<Record<string, string>, Record<string, unknown>>(`
      ${sqlPrefix} (${placeholders})
      ORDER BY ${orderBy}
    `)
    .all(params);
}

function safeParseJson(value: string) {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {
      raw: value,
    };
  }
}

function selectAllFirmDocumentParties(
  db: SqliteConnection,
  ownerEmail: string,
): FirmDocumentPartyMatch[] {
  const rows = db
    .prepare<
      {
        ownerEmail: string;
      },
      {
        party_id: string;
        canonical_display_name: string | null;
        kind: string;
        address_signature: string | null;
        first_seen_document_id: string | null;
        last_seen_document_id: string | null;
      }
    >(`
      SELECT
        party_id,
        canonical_display_name,
        kind,
        address_signature,
        first_seen_document_id,
        last_seen_document_id
      FROM parties
      WHERE owner_email = @ownerEmail
        AND canonical_display_name IS NOT NULL
      ORDER BY canonical_display_name ASC, party_id ASC
    `)
    .all({
      ownerEmail,
    });

  return rows.map((row) => ({
    partyId: row.party_id,
    canonicalDisplayName: row.canonical_display_name,
    kind: row.kind,
    addressSignature: row.address_signature,
    firstSeenDocumentId: row.first_seen_document_id,
    lastSeenDocumentId: row.last_seen_document_id,
    matchType: "exact_normalized" as const,
  }));
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
    additionalPredicates.length > 0 ? `\n          AND ${additionalPredicates.join("\n          AND ")}` : "";

  return withReadOnlyFirmDocumentDb(input, null, (db) => {
    const row = db
      .prepare<
        {
          ownerEmail: string;
          partyId: string;
          idKind: string | null;
          idType: string | null;
        },
        {
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
          addressJson: string | null;
          idKind: string | null;
          idType: string | null;
          rawIdValue: string | null;
          maskedIdValue: string | null;
          issuingAuthority: string | null;
          birthDate: string | null;
          issueDate: string | null;
          expirationDate: string | null;
        }
      >(`
        SELECT
          parties.party_id AS partyId,
          parties.canonical_display_name AS partyDisplayName,
          documents.source_file_id AS sourceFileId,
          documents.source_name AS sourceName,
          documents.document_id AS documentId,
          documents.document_date AS documentDate,
          documents.analyzed_at AS analyzedAt,
          documents.normalized_document_subtype AS documentSubtype,
          document_parties.raw_name AS rawName,
          document_parties.normalized_display_name AS normalizedDisplayName,
          document_parties.address_json AS addressJson,
          document_party_facts.id_kind AS idKind,
          document_party_facts.id_type AS idType,
          document_party_facts.raw_id_value AS rawIdValue,
          document_party_facts.masked_id_value AS maskedIdValue,
          document_party_facts.issuing_authority AS issuingAuthority,
          document_party_facts.birth_date AS birthDate,
          document_party_facts.issue_date AS issueDate,
          document_party_facts.expiration_date AS expirationDate
        FROM documents
        INNER JOIN document_parties
          ON document_parties.document_id = documents.document_id
        INNER JOIN parties
          ON parties.party_id = document_parties.party_id
        LEFT JOIN document_party_facts
          ON document_party_facts.document_id = document_parties.document_id
          AND (
            document_party_facts.document_party_id = document_parties.document_party_id
            OR (
              document_party_facts.document_party_id IS NULL
              AND document_party_facts.source_index = document_parties.source_index
            )
          )
        WHERE documents.owner_email = @ownerEmail
          AND documents.normalized_document_type_id = 'identity_document'
          AND parties.party_id = @partyId
          AND (@idKind IS NULL OR LOWER(COALESCE(document_party_facts.id_kind, '')) = @idKind)
          AND (@idType IS NULL OR LOWER(COALESCE(document_party_facts.id_type, '')) = @idType)${additionalWhere}
        ORDER BY
          COALESCE(documents.document_date, document_party_facts.issue_date, documents.analyzed_at) DESC,
          documents.analyzed_at DESC,
          documents.document_id DESC
        LIMIT 1
      `)
      .get({
        ownerEmail: normalizeOwnerEmail(input.ownerEmail),
        partyId: input.partyId,
        idKind,
        idType,
      });

    return row ? mapIdentityRow(row) : null;
  });
}

function mapIdentityRow(row: {
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
  addressJson: string | null;
  idKind: string | null;
  idType: string | null;
  rawIdValue: string | null;
  maskedIdValue: string | null;
  issuingAuthority: string | null;
  birthDate: string | null;
  issueDate: string | null;
  expirationDate: string | null;
}): FirmDocumentLatestIdentityFacts {
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
    rawIdValue: row.rawIdValue,
    maskedIdValue: row.maskedIdValue,
    issuingAuthority: row.issuingAuthority,
    birthDate: row.birthDate,
    issueDate: row.issueDate,
    expirationDate: row.expirationDate,
  };
}

function parseIdentityAddress(value: string | null): FirmDocumentIdentityAddress | null {
  if (!value) {
    return null;
  }

  const parsed = safeParseJson(value);
  if (!parsed) {
    return null;
  }

  const candidate = Array.isArray(parsed)
    ? parsed.find((entry) => entry && typeof entry === "object")
    : parsed;

  if (!candidate || Array.isArray(candidate) || typeof candidate !== "object") {
    return null;
  }

  const rawText = asNullableString(candidate.rawText);
  const linesValue = candidate.lines;
  const lines =
    Array.isArray(linesValue) &&
    linesValue.every((entry) => typeof entry === "string")
      ? linesValue
      : null;

  return {
    rawText,
    lines,
    city: asNullableString(candidate.city),
    state: asNullableString(candidate.state),
    postalCode: asNullableString(candidate.postalCode),
    country: asNullableString(candidate.country),
  };
}

function asNullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeIsoDate(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function currentIsoDate() {
  return new Date().toISOString().slice(0, 10);
}
