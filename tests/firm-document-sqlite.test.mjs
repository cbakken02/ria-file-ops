import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { setAIPrimaryCompletionAdapterForTests } from "../lib/ai-primary-parser.ts";
import { DOCUMENT_ANALYSIS_VERSION } from "../lib/document-intelligence.ts";
import {
  getFirmDocumentSqlitePath,
  writeCanonicalAccountStatementToSqlite,
  writeCanonicalIdentityDocumentToSqlite,
} from "../lib/firm-document-sqlite.ts";
import {
  findLatestDriverLicenseStatusForParty,
  findLatestIdentityAddressForParty,
  findLatestIdentityDobForParty,
  findLatestIdentityDocumentForParty,
  findLatestIdentityExpirationForParty,
  findLatestIdentityFactsForParty,
  resolveFirmDocumentPartyByName,
} from "../lib/firm-document-sqlite-query.ts";
import { buildProcessingPreview } from "../lib/processing-preview.ts";
import { clearPreviewAnalysisCacheForOwner } from "../lib/preview-analysis-cache.ts";
import {
  buildIdentityCanonicalFixture,
  buildStatementCanonicalFixture,
  makeTempDbEnv,
  openDb,
  withEnv,
} from "./helpers/firm-document-sqlite-fixtures.mjs";

test("first SQLite canonical write creates the schema and persists a single account statement", () => {
  const tempDb = makeTempDbEnv();
  const ownerEmail = "sqlite-schema-test@example.com";

  try {
    const canonical = buildStatementCanonicalFixture();
    const result = writeCanonicalAccountStatementToSqlite({
      ownerEmail,
      analysisProfile: "preview_ai_primary",
      analysisVersion: DOCUMENT_ANALYSIS_VERSION,
      analysisRanAt: "2026-04-21T19:30:00.000Z",
      canonical,
    });

    assert.ok(result);
    assert.equal(result.dbPath, getFirmDocumentSqlitePath(ownerEmail));

    const db = openDb(tempDb.dbPath);
    try {
      const objects = db
        .prepare(`
          SELECT name, type
          FROM sqlite_master
          WHERE name IN (
            'documents',
            'document_canonical_payloads',
            'institutions',
            'parties',
            'accounts',
            'account_parties',
            'document_institutions',
            'document_parties',
            'document_party_facts',
            'document_account_snapshots',
            'document_account_parties',
            'document_contacts',
            'account_values',
            'document_primary_facts',
            'latest_account_snapshot_v',
            'latest_account_document_v'
          )
          ORDER BY name
        `)
        .all();

      assert.equal(objects.length, 16);
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM documents").get().count,
        1,
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM accounts").get().count,
        1,
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM document_account_snapshots").get()
          .count,
        1,
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM document_primary_facts").get().count,
        1,
      );
      assert.equal(
        db.prepare(
          "SELECT custodian_name FROM document_primary_facts WHERE document_id = ?",
        ).get(result.documentId).custodian_name,
        "U.S. Bank",
      );
    } finally {
      db.close();
    }
  } finally {
    tempDb.cleanup();
  }
});

test("clean driver license write persists document_parties, document_party_facts, and document_primary_facts", () => {
  const tempDb = makeTempDbEnv("firm-document-identity-driver-");
  const ownerEmail = "sqlite-identity-driver@example.com";

  try {
    const canonical = buildIdentityCanonicalFixture({
      fileId: "identity-driver-1",
      sourceName: "case-01-wi-driver-license-clean.pdf",
      subtype: "driver_license",
      displayName: "Melissa A Rivera",
      rawName: "MELISSA A RIVERA",
      governmentIdValue: "RIVRM910714WI",
      maskedGovernmentIdValue: "xxxxxxxxx14WI",
      issuingAuthority: "WI",
      birthDate: "1991-07-14",
      issueDate: "2024-05-09",
      documentDate: "2024-05-09",
      expirationDate: "2032-07-14",
      address: {
        kind: "identity",
        rawText: "4478 MAPLE TRACE DR, MIDDLETON WI 53562-1940",
        lines: ["4478 MAPLE TRACE DR", "MIDDLETON WI 53562-1940"],
        city: "MIDDLETON",
        state: "WI",
        postalCode: "53562-1940",
        country: "US",
      },
    });

    const result = writeCanonicalIdentityDocumentToSqlite({
      ownerEmail,
      analysisProfile: "legacy",
      analysisVersion: DOCUMENT_ANALYSIS_VERSION,
      analysisRanAt: "2026-04-22T00:30:00.000Z",
      canonical,
    });

    assert.ok(result);

    const db = openDb(tempDb.dbPath);
    try {
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM documents").get().count,
        1,
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM parties").get().count,
        1,
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM document_parties").get().count,
        1,
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM document_party_facts").get().count,
        1,
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM document_primary_facts").get().count,
        1,
      );

      const factRow = db
        .prepare(`
          SELECT id_kind, id_type, raw_id_value, masked_id_value, issuing_authority, birth_date, issue_date, expiration_date
          FROM document_party_facts
          WHERE document_id = ?
        `)
        .get(result.documentId);

      assert.deepEqual(factRow, {
        id_kind: "driver_license",
        id_type: "Driver License",
        raw_id_value: "RIVRM910714WI",
        masked_id_value: "xxxxxxxxx14WI",
        issuing_authority: "WI",
        birth_date: "1991-07-14",
        issue_date: "2024-05-09",
        expiration_date: "2032-07-14",
      });

      const primaryFacts = db
        .prepare(`
          SELECT detected_client, ownership_type, id_type, document_date, account_last4, account_type, custodian_name
          FROM document_primary_facts
          WHERE document_id = ?
        `)
        .get(result.documentId);

      assert.deepEqual(primaryFacts, {
        detected_client: "Melissa A Rivera",
        ownership_type: "single",
        id_type: "Driver License",
        document_date: "2024-05-09",
        account_last4: null,
        account_type: null,
        custodian_name: null,
      });
    } finally {
      db.close();
    }
  } finally {
    tempDb.cleanup();
  }
});

test("clean state ID write persists state-id facts without affecting account tables", () => {
  const tempDb = makeTempDbEnv("firm-document-identity-stateid-");
  const ownerEmail = "sqlite-identity-stateid@example.com";

  try {
    const canonical = buildIdentityCanonicalFixture({
      fileId: "identity-state-id-1",
      sourceName: "case-02-co-state-id-clean.pdf",
      subtype: "state_id",
      displayName: "Jordan P Ellis",
      rawName: "JORDAN P ELLIS",
      governmentIdValue: "COID-882211-547",
      maskedGovernmentIdValue: "xxxxxxxxxxx-547",
      issuingAuthority: "CO",
      birthDate: "1988-11-22",
      issueDate: "2023-08-18",
      documentDate: "2023-08-18",
      expirationDate: "2031-11-22",
      address: {
        kind: "identity",
        rawText: "1187 CEDAR POINT AVE, LAKEWOOD CO 80228",
        lines: ["1187 CEDAR POINT AVE", "LAKEWOOD CO 80228"],
        city: "LAKEWOOD",
        state: "CO",
        postalCode: "80228",
        country: "US",
      },
    });

    const result = writeCanonicalIdentityDocumentToSqlite({
      ownerEmail,
      analysisProfile: "legacy",
      analysisVersion: DOCUMENT_ANALYSIS_VERSION,
      analysisRanAt: "2026-04-22T00:31:00.000Z",
      canonical,
    });

    assert.ok(result);

    const db = openDb(tempDb.dbPath);
    try {
      assert.equal(
        db.prepare("SELECT normalized_document_type_id FROM documents LIMIT 1").get()
          .normalized_document_type_id,
        "identity_document",
      );
      assert.equal(
        db.prepare("SELECT normalized_document_subtype FROM documents LIMIT 1").get()
          .normalized_document_subtype,
        "state_id",
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM accounts").get().count,
        0,
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM document_account_snapshots").get()
          .count,
        0,
      );

      const factRow = db
        .prepare(`
          SELECT id_kind, id_type, raw_id_value, masked_id_value, issuing_authority
          FROM document_party_facts
          WHERE document_id = ?
        `)
        .get(result.documentId);

      assert.deepEqual(factRow, {
        id_kind: "state_id",
        id_type: "State ID",
        raw_id_value: "COID-882211-547",
        masked_id_value: "xxxxxxxxxxx-547",
        issuing_authority: "CO",
      });
    } finally {
      db.close();
    }
  } finally {
    tempDb.cleanup();
  }
});

test("old and renewed Christopher Bakken IDs preserve stable party identity while keeping document history", () => {
  const tempDb = makeTempDbEnv("firm-document-identity-history-");
  const ownerEmail = "sqlite-identity-history@example.com";

  try {
    const oldCanonical = buildIdentityCanonicalFixture({
      fileId: "christopher-bakken-old-id",
      sourceName: "case-05-old-license.pdf",
      subtype: "driver_license",
      displayName: "Christopher T Bakken",
      rawName: "CHRISTOPHER T BAKKEN",
      governmentIdValue: "BAKKC85020316",
      maskedGovernmentIdValue: "xxxxxxxxx0316",
      issuingAuthority: "WI",
      birthDate: "1985-02-03",
      issueDate: "2016-01-15",
      documentDate: "2016-01-15",
      expirationDate: "2020-02-03",
      address: {
        kind: "identity",
        rawText: "N1345 MAPLE HILLS DR, FONTANA WI 53125-1921",
        lines: ["N1345 MAPLE HILLS DR", "FONTANA WI 53125-1921"],
        city: "FONTANA",
        state: "WI",
        postalCode: "53125-1921",
        country: "US",
      },
    });
    const renewedCanonical = buildIdentityCanonicalFixture({
      fileId: "christopher-bakken-renewed-id",
      sourceName: "case-06-renewed-license.pdf",
      subtype: "driver_license",
      displayName: "Christopher T Bakken",
      rawName: "CHRISTOPHER T BAKKEN",
      governmentIdValue: "BAKKC85020324",
      maskedGovernmentIdValue: "xxxxxxxxx0324",
      issuingAuthority: "WI",
      birthDate: "1985-02-03",
      issueDate: "2024-03-01",
      documentDate: "2024-03-01",
      expirationDate: "2032-02-03",
      address: {
        kind: "identity",
        rawText: "1841 LAKE SHORE CT, WALWORTH WI 53184",
        lines: ["1841 LAKE SHORE CT", "WALWORTH WI 53184"],
        city: "WALWORTH",
        state: "WI",
        postalCode: "53184",
        country: "US",
      },
    });

    const first = writeCanonicalIdentityDocumentToSqlite({
      ownerEmail,
      analysisProfile: "legacy",
      analysisVersion: DOCUMENT_ANALYSIS_VERSION,
      analysisRanAt: "2026-04-22T00:32:00.000Z",
      canonical: oldCanonical,
    });
    const second = writeCanonicalIdentityDocumentToSqlite({
      ownerEmail,
      analysisProfile: "legacy",
      analysisVersion: DOCUMENT_ANALYSIS_VERSION,
      analysisRanAt: "2026-04-22T00:33:00.000Z",
      canonical: renewedCanonical,
    });

    assert.ok(first);
    assert.ok(second);

    const db = openDb(tempDb.dbPath);
    try {
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM documents").get().count,
        2,
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM parties").get().count,
        1,
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM document_parties").get().count,
        2,
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM document_party_facts").get().count,
        2,
      );

      const stablePartyRows = db
        .prepare(`
          SELECT canonical_display_name, resolution_basis, first_seen_document_id, last_seen_document_id
          FROM parties
        `)
        .all();

      assert.equal(stablePartyRows.length, 1);
      assert.equal(stablePartyRows[0].canonical_display_name, "Christopher T Bakken");
      assert.equal(stablePartyRows[0].resolution_basis, "normalized_name_with_birth_date");
      assert.equal(stablePartyRows[0].first_seen_document_id, first.documentId);
      assert.equal(stablePartyRows[0].last_seen_document_id, second.documentId);

      const factRows = db
        .prepare(`
          SELECT raw_id_value, expiration_date
          FROM document_party_facts
          ORDER BY expiration_date ASC
        `)
        .all();

      assert.deepEqual(factRows, [
        {
          raw_id_value: "BAKKC85020316",
          expiration_date: "2020-02-03",
        },
        {
          raw_id_value: "BAKKC85020324",
          expiration_date: "2032-02-03",
        },
      ]);
    } finally {
      db.close();
    }
  } finally {
    tempDb.cleanup();
  }
});

test("re-analysis of the same document_id replaces document-scoped child rows instead of duplicating them", () => {
  const tempDb = makeTempDbEnv();
  const ownerEmail = "sqlite-reanalysis-test@example.com";

  try {
    const firstCanonical = buildStatementCanonicalFixture({
      fileId: "reanalysis-file",
      extractedContacts: [
        {
          id: "contact-1",
          institutionId: "institution-1",
          method: "phone",
          purpose: "customer_service",
          label: "Customer Service",
          value: "800-111-1111",
          address: null,
          hoursText: null,
        },
      ],
      normalizedContacts: [
        {
          id: "contact-1",
          institutionId: "institution-1",
          method: "phone",
          purpose: "customer_service",
          label: "Customer Service",
          value: "800-111-1111",
          address: null,
          hoursText: null,
        },
      ],
      extractedValues: [
        {
          kind: "ending_balance",
          label: "Ending balance",
          money: {
            amount: "5000.00",
            currency: "USD",
          },
          dateId: "date-end",
        },
      ],
      normalizedValues: [
        {
          kind: "ending_balance",
          label: "Ending balance",
          money: {
            amount: "5000.00",
            currency: "USD",
          },
          dateId: "date-end",
        },
      ],
    });
    const secondCanonical = buildStatementCanonicalFixture({
      fileId: "reanalysis-file",
      extractedContacts: [
        {
          id: "contact-1",
          institutionId: "institution-1",
          method: "phone",
          purpose: "customer_service",
          label: "Customer Service",
          value: "800-222-2222",
          address: null,
          hoursText: null,
        },
        {
          id: "contact-2",
          institutionId: "institution-1",
          method: "website",
          purpose: "general_support",
          label: "Website",
          value: "www.usbank.com",
          address: null,
          hoursText: null,
        },
      ],
      normalizedContacts: [
        {
          id: "contact-1",
          institutionId: "institution-1",
          method: "phone",
          purpose: "customer_service",
          label: "Customer Service",
          value: "800-222-2222",
          address: null,
          hoursText: null,
        },
        {
          id: "contact-2",
          institutionId: "institution-1",
          method: "website",
          purpose: "general_support",
          label: "Website",
          value: "www.usbank.com",
          address: null,
          hoursText: null,
        },
      ],
      extractedValues: [
        {
          kind: "ending_balance",
          label: "Ending balance",
          money: {
            amount: "5100.00",
            currency: "USD",
          },
          dateId: "date-end",
        },
        {
          kind: "available_balance",
          label: "Available balance",
          money: {
            amount: "5050.00",
            currency: "USD",
          },
          dateId: "date-end",
        },
      ],
      normalizedValues: [
        {
          kind: "ending_balance",
          label: "Ending balance",
          money: {
            amount: "5100.00",
            currency: "USD",
          },
          dateId: "date-end",
        },
        {
          kind: "available_balance",
          label: "Available balance",
          money: {
            amount: "5050.00",
            currency: "USD",
          },
          dateId: "date-end",
        },
      ],
    });

    const firstResult = writeCanonicalAccountStatementToSqlite({
      ownerEmail,
      analysisProfile: "preview_ai_primary",
      analysisVersion: DOCUMENT_ANALYSIS_VERSION,
      analysisRanAt: "2026-04-21T19:31:00.000Z",
      canonical: firstCanonical,
    });
    const secondResult = writeCanonicalAccountStatementToSqlite({
      ownerEmail,
      analysisProfile: "preview_ai_primary",
      analysisVersion: DOCUMENT_ANALYSIS_VERSION,
      analysisRanAt: "2026-04-21T19:32:00.000Z",
      canonical: secondCanonical,
    });

    assert.equal(firstResult.documentId, secondResult.documentId);

    const db = openDb(tempDb.dbPath);
    try {
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM documents").get().count,
        1,
      );
      assert.equal(
        db.prepare(
          "SELECT COUNT(*) AS count FROM document_contacts WHERE document_id = ?",
        ).get(firstResult.documentId).count,
        2,
      );
      assert.equal(
        db.prepare(`
          SELECT COUNT(*) AS count
          FROM account_values
          WHERE document_account_snapshot_id IN (
            SELECT document_account_snapshot_id
            FROM document_account_snapshots
            WHERE document_id = ?
          )
        `).get(firstResult.documentId).count,
        2,
      );
      assert.equal(
        db.prepare(`
          SELECT raw_value
          FROM document_contacts
          WHERE document_id = ? AND method = 'phone'
        `).get(firstResult.documentId).raw_value,
        "800-222-2222",
      );
    } finally {
      db.close();
    }
  } finally {
    tempDb.cleanup();
  }
});

test("newer statements for the same stable account preserve account identity and latest_account_snapshot_v resolves the newest row", () => {
  const tempDb = makeTempDbEnv();
  const ownerEmail = "sqlite-latest-snapshot-test@example.com";

  try {
    const firstCanonical = buildStatementCanonicalFixture({
      fileId: "statement-2025",
      sourceName: "statement-2025.pdf",
      documentDate: "2025-12-31",
      statementStartDate: "2025-10-01",
      statementEndDate: "2025-12-31",
      accountNumber: "9999000011112222",
      maskedAccountNumber: "XXXXXXXX2222",
      accountLast4: "2222",
    });
    const secondCanonical = buildStatementCanonicalFixture({
      fileId: "statement-2026",
      sourceName: "statement-2026.pdf",
      documentDate: "2026-12-31",
      statementStartDate: "2026-10-01",
      statementEndDate: "2026-12-31",
      accountNumber: "9999000011112222",
      maskedAccountNumber: "XXXXXXXX2222",
      accountLast4: "2222",
      extractedValues: [
        {
          kind: "ending_balance",
          label: "Ending balance",
          money: {
            amount: "7890.12",
            currency: "USD",
          },
          dateId: "date-end",
        },
      ],
      normalizedValues: [
        {
          kind: "ending_balance",
          label: "Ending balance",
          money: {
            amount: "7890.12",
            currency: "USD",
          },
          dateId: "date-end",
        },
      ],
    });

    writeCanonicalAccountStatementToSqlite({
      ownerEmail,
      analysisProfile: "preview_ai_primary",
      analysisVersion: DOCUMENT_ANALYSIS_VERSION,
      analysisRanAt: "2026-04-21T19:33:00.000Z",
      canonical: firstCanonical,
    });
    writeCanonicalAccountStatementToSqlite({
      ownerEmail,
      analysisProfile: "preview_ai_primary",
      analysisVersion: DOCUMENT_ANALYSIS_VERSION,
      analysisRanAt: "2026-04-21T19:34:00.000Z",
      canonical: secondCanonical,
    });

    const db = openDb(tempDb.dbPath);
    try {
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM documents").get().count,
        2,
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM document_account_snapshots").get()
          .count,
        2,
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM accounts").get().count,
        1,
      );

      const latestSnapshot = db
        .prepare(`
          SELECT source_name, statement_end_date, observed_account_last4
          FROM latest_account_snapshot_v
        `)
        .get();

      assert.equal(latestSnapshot.source_name, "statement-2026.pdf");
      assert.equal(latestSnapshot.statement_end_date, "2026-12-31");
      assert.equal(latestSnapshot.observed_account_last4, "2222");
    } finally {
      db.close();
    }
  } finally {
    tempDb.cleanup();
  }
});

test("identity query helpers return the latest Christopher Bakken ID, DOB, address, and expiration with source context", () => {
  const tempDb = makeTempDbEnv("firm-document-identity-query-latest-");
  const ownerEmail = "sqlite-identity-query-latest@example.com";

  try {
    const oldCanonical = buildIdentityCanonicalFixture({
      fileId: "christopher-bakken-old-id",
      sourceName: "case-05-old-license.pdf",
      subtype: "driver_license",
      displayName: "Christopher T Bakken",
      rawName: "CHRISTOPHER T BAKKEN",
      governmentIdValue: "BAKKC85020316",
      maskedGovernmentIdValue: "xxxxxxxxx0316",
      issuingAuthority: "WI",
      birthDate: "1985-02-03",
      issueDate: "2016-01-15",
      documentDate: "2016-01-15",
      expirationDate: "2020-02-03",
      address: {
        kind: "identity",
        rawText: "N1345 MAPLE HILLS DR, FONTANA WI 53125-1921",
        lines: ["N1345 MAPLE HILLS DR", "FONTANA WI 53125-1921"],
        city: "FONTANA",
        state: "WI",
        postalCode: "53125-1921",
        country: "US",
      },
    });
    const renewedCanonical = buildIdentityCanonicalFixture({
      fileId: "christopher-bakken-renewed-id",
      sourceName: "case-06-renewed-license.pdf",
      subtype: "driver_license",
      displayName: "Christopher T Bakken",
      rawName: "CHRISTOPHER T BAKKEN",
      governmentIdValue: "BAKKC85020324",
      maskedGovernmentIdValue: "xxxxxxxxx0324",
      issuingAuthority: "WI",
      birthDate: "1985-02-03",
      issueDate: "2024-03-01",
      documentDate: "2024-03-01",
      expirationDate: "2032-02-03",
      address: {
        kind: "identity",
        rawText: "1841 LAKE SHORE CT, WALWORTH WI 53184",
        lines: ["1841 LAKE SHORE CT", "WALWORTH WI 53184"],
        city: "WALWORTH",
        state: "WI",
        postalCode: "53184",
        country: "US",
      },
    });

    writeCanonicalIdentityDocumentToSqlite({
      ownerEmail,
      analysisProfile: "legacy",
      analysisVersion: DOCUMENT_ANALYSIS_VERSION,
      analysisRanAt: "2026-04-22T01:10:00.000Z",
      canonical: oldCanonical,
    });
    writeCanonicalIdentityDocumentToSqlite({
      ownerEmail,
      analysisProfile: "legacy",
      analysisVersion: DOCUMENT_ANALYSIS_VERSION,
      analysisRanAt: "2026-04-22T01:11:00.000Z",
      canonical: renewedCanonical,
    });

    const resolution = resolveFirmDocumentPartyByName({
      ownerEmail,
      dbPath: tempDb.dbPath,
      name: "Christopher T Bakken",
    });

    assert.equal(resolution.status, "resolved");
    const partyId = resolution.party?.partyId ?? null;
    assert.ok(partyId);

    const latestDocument = findLatestIdentityDocumentForParty({
      ownerEmail,
      dbPath: tempDb.dbPath,
      partyId,
    });
    const latestFacts = findLatestIdentityFactsForParty({
      ownerEmail,
      dbPath: tempDb.dbPath,
      partyId,
      idKind: "driver_license",
    });
    const latestDob = findLatestIdentityDobForParty({
      ownerEmail,
      dbPath: tempDb.dbPath,
      partyId,
    });
    const latestAddress = findLatestIdentityAddressForParty({
      ownerEmail,
      dbPath: tempDb.dbPath,
      partyId,
    });
    const latestExpiration = findLatestIdentityExpirationForParty({
      ownerEmail,
      dbPath: tempDb.dbPath,
      partyId,
    });

    assert.equal(latestDocument?.sourceName, "case-06-renewed-license.pdf");
    assert.equal(latestDocument?.documentDate, "2024-03-01");
    assert.equal(latestDocument?.idKind, "driver_license");
    assert.equal(latestDocument?.expirationDate, "2032-02-03");

    assert.equal(latestFacts?.sourceName, "case-06-renewed-license.pdf");
    assert.equal(latestFacts?.rawIdValue, "BAKKC85020324");
    assert.equal(latestFacts?.issuingAuthority, "WI");

    assert.deepEqual(latestDob, {
      partyId,
      partyDisplayName: "Christopher T Bakken",
      documentId: latestDocument?.documentId ?? null,
      sourceFileId: "christopher-bakken-renewed-id",
      sourceName: "case-06-renewed-license.pdf",
      documentDate: "2024-03-01",
      idKind: "driver_license",
      idType: "Driver License",
      birthDate: "1985-02-03",
    });

    assert.equal(latestAddress?.sourceName, "case-06-renewed-license.pdf");
    assert.equal(latestAddress?.addressRawText, "1841 LAKE SHORE CT, WALWORTH WI 53184");
    assert.equal(latestAddress?.address.city, "WALWORTH");
    assert.equal(latestAddress?.address.state, "WI");

    assert.deepEqual(latestExpiration, {
      partyId,
      partyDisplayName: "Christopher T Bakken",
      documentId: latestDocument?.documentId ?? null,
      sourceFileId: "christopher-bakken-renewed-id",
      sourceName: "case-06-renewed-license.pdf",
      documentDate: "2024-03-01",
      idKind: "driver_license",
      idType: "Driver License",
      issueDate: "2024-03-01",
      expirationDate: "2032-02-03",
    });
  } finally {
    tempDb.cleanup();
  }
});

test("identity query helper reports the latest driver license as unexpired using the newest Christopher Bakken document", () => {
  const tempDb = makeTempDbEnv("firm-document-identity-query-status-");
  const ownerEmail = "sqlite-identity-query-status@example.com";

  try {
    writeCanonicalIdentityDocumentToSqlite({
      ownerEmail,
      analysisProfile: "legacy",
      analysisVersion: DOCUMENT_ANALYSIS_VERSION,
      analysisRanAt: "2026-04-22T01:12:00.000Z",
      canonical: buildIdentityCanonicalFixture({
        fileId: "christopher-bakken-old-id",
        sourceName: "case-05-old-license.pdf",
        subtype: "driver_license",
        displayName: "Christopher T Bakken",
        rawName: "CHRISTOPHER T BAKKEN",
        governmentIdValue: "BAKKC85020316",
        maskedGovernmentIdValue: "xxxxxxxxx0316",
        issuingAuthority: "WI",
        birthDate: "1985-02-03",
        issueDate: "2016-01-15",
        documentDate: "2016-01-15",
        expirationDate: "2020-02-03",
      }),
    });
    writeCanonicalIdentityDocumentToSqlite({
      ownerEmail,
      analysisProfile: "legacy",
      analysisVersion: DOCUMENT_ANALYSIS_VERSION,
      analysisRanAt: "2026-04-22T01:13:00.000Z",
      canonical: buildIdentityCanonicalFixture({
        fileId: "christopher-bakken-renewed-id",
        sourceName: "case-06-renewed-license.pdf",
        subtype: "driver_license",
        displayName: "Christopher T Bakken",
        rawName: "CHRISTOPHER T BAKKEN",
        governmentIdValue: "BAKKC85020324",
        maskedGovernmentIdValue: "xxxxxxxxx0324",
        issuingAuthority: "WI",
        birthDate: "1985-02-03",
        issueDate: "2024-03-01",
        documentDate: "2024-03-01",
        expirationDate: "2032-02-03",
      }),
    });

    const resolution = resolveFirmDocumentPartyByName({
      ownerEmail,
      dbPath: tempDb.dbPath,
      name: "Christopher T Bakken",
    });
    assert.equal(resolution.status, "resolved");

    const status = findLatestDriverLicenseStatusForParty({
      ownerEmail,
      dbPath: tempDb.dbPath,
      partyId: resolution.party.partyId,
      asOfDate: "2026-04-21",
    });

    assert.deepEqual(status, {
      partyId: resolution.party.partyId,
      partyDisplayName: "Christopher T Bakken",
      status: "unexpired",
      isUnexpired: true,
      asOfDate: "2026-04-21",
      documentId: status.documentId,
      sourceFileId: "christopher-bakken-renewed-id",
      sourceName: "case-06-renewed-license.pdf",
      documentDate: "2024-03-01",
      idKind: "driver_license",
      idType: "Driver License",
      issueDate: "2024-03-01",
      expirationDate: "2032-02-03",
    });
    assert.ok(status.documentId);
  } finally {
    tempDb.cleanup();
  }
});

test("identity query helpers stay conservative when facts are missing or the party lookup is ambiguous", () => {
  const tempDb = makeTempDbEnv("firm-document-identity-query-conservative-");
  const ownerEmail = "sqlite-identity-query-conservative@example.com";

  try {
    writeCanonicalIdentityDocumentToSqlite({
      ownerEmail,
      analysisProfile: "legacy",
      analysisVersion: DOCUMENT_ANALYSIS_VERSION,
      analysisRanAt: "2026-04-22T01:14:00.000Z",
      canonical: buildIdentityCanonicalFixture({
        fileId: "missing-expiration-state-id",
        sourceName: "case-08-missing-expiration.pdf",
        subtype: "state_id",
        displayName: "Jamie L Carter",
        rawName: "JAMIE L CARTER",
        governmentIdValue: "STATE-9988",
        maskedGovernmentIdValue: "xxxx-9988",
        issuingAuthority: "CO",
        birthDate: "1992-11-08",
        issueDate: "2023-06-01",
        documentDate: "2023-06-01",
        expirationDate: null,
        address: null,
      }),
    });
    writeCanonicalIdentityDocumentToSqlite({
      ownerEmail,
      analysisProfile: "legacy",
      analysisVersion: DOCUMENT_ANALYSIS_VERSION,
      analysisRanAt: "2026-04-22T01:15:00.000Z",
      canonical: buildIdentityCanonicalFixture({
        fileId: "alex-kim-wi",
        sourceName: "alex-kim-wi.pdf",
        subtype: "driver_license",
        displayName: "Alex Kim",
        rawName: "ALEX KIM",
        governmentIdValue: "ALEXKIM-WI-1",
        maskedGovernmentIdValue: "xxxxxxxxx-WI-1",
        issuingAuthority: "WI",
        birthDate: "1990-01-01",
        issueDate: "2024-01-01",
        documentDate: "2024-01-01",
        expirationDate: "2030-01-01",
      }),
    });
    writeCanonicalIdentityDocumentToSqlite({
      ownerEmail,
      analysisProfile: "legacy",
      analysisVersion: DOCUMENT_ANALYSIS_VERSION,
      analysisRanAt: "2026-04-22T01:16:00.000Z",
      canonical: buildIdentityCanonicalFixture({
        fileId: "alex-kim-co",
        sourceName: "alex-kim-co.pdf",
        subtype: "state_id",
        displayName: "Alex Kim",
        rawName: "ALEX KIM",
        governmentIdValue: "ALEXKIM-CO-2",
        maskedGovernmentIdValue: "xxxxxxxxx-CO-2",
        issuingAuthority: "CO",
        birthDate: "1994-04-04",
        issueDate: "2025-02-02",
        documentDate: "2025-02-02",
        expirationDate: "2033-04-04",
      }),
    });

    const jamieResolution = resolveFirmDocumentPartyByName({
      ownerEmail,
      dbPath: tempDb.dbPath,
      name: "Jamie L Carter",
    });
    assert.equal(jamieResolution.status, "resolved");

    const missingAddress = findLatestIdentityAddressForParty({
      ownerEmail,
      dbPath: tempDb.dbPath,
      partyId: jamieResolution.party.partyId,
    });
    const missingExpiration = findLatestIdentityExpirationForParty({
      ownerEmail,
      dbPath: tempDb.dbPath,
      partyId: jamieResolution.party.partyId,
    });
    const noLicense = findLatestDriverLicenseStatusForParty({
      ownerEmail,
      dbPath: tempDb.dbPath,
      partyId: jamieResolution.party.partyId,
      asOfDate: "2026-04-21",
    });

    assert.equal(missingAddress, null);
    assert.equal(missingExpiration, null);
    assert.deepEqual(noLicense, {
      partyId: jamieResolution.party.partyId,
      partyDisplayName: null,
      status: "not_found",
      isUnexpired: null,
      asOfDate: "2026-04-21",
      documentId: null,
      sourceFileId: null,
      sourceName: null,
      documentDate: null,
      idKind: null,
      idType: null,
      issueDate: null,
      expirationDate: null,
    });

    const alexResolution = resolveFirmDocumentPartyByName({
      ownerEmail,
      dbPath: tempDb.dbPath,
      name: "Alex Kim",
    });

    assert.equal(alexResolution.status, "ambiguous");
    assert.equal(alexResolution.matches.length, 2);
  } finally {
    tempDb.cleanup();
  }
});

test("fresh preview identity-document analysis writes canonical SQLite rows without changing preview output", async () => {
  const tempDb = makeTempDbEnv("firm-document-identity-preview-");
  const ownerEmail = "sqlite-identity-preview@example.com";
  const file = {
    id: "case-01-wi-driver-license-clean",
    name: "document.pdf",
    mimeType: "application/pdf",
    modifiedTime: "2026-04-22T00:00:00.000Z",
    size: "64000",
  };

  try {
    await clearPreviewAnalysisCacheForOwner(ownerEmail);

    const pdfPath = path.join(
      process.cwd(),
      "tests",
      "synthetic-id-corpus",
      "cases",
      "case-01-wi-driver-license-clean",
      "document.pdf",
    );
    const settings = {
      id: "identity-preview-settings",
      ownerEmail,
      firmName: "Test RIA",
      storageProvider: "google_drive",
      sourceFolderId: "source",
      sourceFolderName: "Source",
      destinationFolderId: "destination",
      destinationFolderName: "Destination",
      namingConvention: "Last_First_DocType_Date",
      namingRulesJson: null,
      folderTemplate: "Client Info\nAccounts\nMoney Movement\nPlanning\nReview",
      reviewInstruction: "Manual review",
      createdAt: "2026-04-22T00:00:00.000Z",
      updatedAt: "2026-04-22T00:00:00.000Z",
    };

    const preview = await buildProcessingPreview(
      [file],
      settings,
      async () => fs.readFileSync(pdfPath),
      [],
      [],
      { analysisMode: "default" },
    );

    assert.equal(preview.items.length, 1);
    assert.equal(preview.items[0].documentTypeId, "identity_document");
    assert.equal(preview.items[0].detectedClient, "Melissa A Rivera");
    assert.equal(preview.items[0].extractedIdType, "Driver License");
    assert.equal(preview.items[0].analysisSource, "fresh_analysis");

    const db = openDb(tempDb.dbPath);
    try {
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM documents").get().count,
        1,
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM document_party_facts").get().count,
        1,
      );
      assert.equal(
        db.prepare("SELECT detected_client FROM document_primary_facts LIMIT 1").get()
          .detected_client,
        "Melissa A Rivera",
      );
    } finally {
      db.close();
    }
  } finally {
    await clearPreviewAnalysisCacheForOwner(ownerEmail);
    tempDb.cleanup();
  }
});

test("fresh preview AI account-statement analysis writes canonical SQLite rows without changing preview output", async () => {
  const tempDb = makeTempDbEnv();
  const ownerEmail = "sqlite-preview-seam@example.com";
  const restoreEnv = withEnv({
    AI_PRIMARY_PARSER: "true",
    AI_PRIMARY_ACCOUNT_STATEMENT_ONLY: "true",
  });
  const file = {
    id: "preview-seam-statement",
    name: "preview-seam-statement.pdf",
    mimeType: "application/pdf",
    modifiedTime: "2026-04-21T18:00:00.000Z",
    size: "162264",
  };

  try {
    await clearPreviewAnalysisCacheForOwner(ownerEmail);

    setAIPrimaryCompletionAdapterForTests(async () => ({
      model: "test-model",
      rawText: JSON.stringify({
        documentTypeId: "account_statement",
        detectedClient: "Christopher Theodore Bakken",
        detectedClient2: null,
        ownershipType: "single",
        metadata: {
          custodian: "U.S. Bank National Association",
          accountType: "U.S. Bank Smartly Checking",
          accountLast4: "6642",
          documentDate: "2025-10-14",
        },
        confidence: {
          documentTypeId: 0.98,
          detectedClient: 0.95,
          detectedClient2: null,
          ownershipType: 0.87,
          custodian: 0.96,
          accountType: 0.97,
          accountLast4: 0.94,
          documentDate: 0.93,
        },
        rawEvidenceSummary:
          "Owner block shows Christopher T Bakken and statement header shows U.S. Bank Smartly Checking ending in 6642.",
        parties: [
          {
            id: "party-1",
            name: "Christopher Theodore Bakken",
            roles: ["owner"],
            address: "N1345 Maple Hills Dr, Fontana WI 53125-1921",
          },
        ],
        institutions: [
          {
            id: "institution-1",
            name: "U.S. Bank National Association",
          },
        ],
        contacts: [
          {
            id: "contact-1",
            institutionId: "institution-1",
            method: "phone",
            purpose: "customer_service",
            value: "800-872-2657",
          },
        ],
        accounts: [
          {
            id: "account-1",
            institutionIds: ["institution-1"],
            accountNumber: "1234567890126642",
            maskedAccountNumber: "XXXXXXXXXXXX6642",
            accountLast4: "6642",
            accountType: "U.S. Bank Smartly Checking",
            registrationType: "Individual",
            values: [
              {
                kind: "ending_balance",
                label: "Ending balance",
                money: {
                  amount: "2450.20",
                  currency: "USD",
                },
                dateId: "date-end",
              },
            ],
          },
        ],
        accountParties: [
          {
            id: "account-party-1",
            accountId: "account-1",
            partyId: "party-1",
            roles: ["owner"],
          },
        ],
        dates: [
          {
            id: "date-start",
            kind: "statement_period_start",
            value: "2025-09-13",
            scope: "document",
            entityId: null,
          },
          {
            id: "date-end",
            kind: "statement_period_end",
            value: "2025-10-14",
            scope: "document",
            entityId: null,
          },
          {
            id: "date-document",
            kind: "document_date",
            value: "2025-10-14",
            scope: "document",
            entityId: null,
          },
        ],
        documentFacts: {
          entityName: null,
          idType: null,
          taxYear: null,
        },
      }),
    }));

    const pdfPath = path.join(
      process.cwd(),
      "tests",
      "synthetic-corpus",
      "cases",
      "case-01-us-bank-smartly-checking-single",
      "statement.pdf",
    );
    const settings = {
      id: "preview-settings",
      ownerEmail,
      firmName: "Test RIA",
      storageProvider: "google_drive",
      sourceFolderId: "source",
      sourceFolderName: "Source",
      destinationFolderId: "destination",
      destinationFolderName: "Destination",
      namingConvention: "Last_First_DocType_Date",
      namingRulesJson: null,
      folderTemplate: "Client Info\nAccounts\nMoney Movement\nPlanning\nReview",
      reviewInstruction: "manual_only",
      createdAt: "2026-04-21T18:00:00.000Z",
      updatedAt: "2026-04-21T18:00:00.000Z",
    };

    const preview = await buildProcessingPreview(
      [file],
      settings,
      async () => fs.readFileSync(pdfPath),
      ["Bakken_Christopher"],
      [],
      { analysisMode: "preview" },
    );

    assert.equal(preview.reviewRule.value, "manual_only");
    assert.equal(preview.items.length, 1);
    assert.equal(preview.items[0].status, "Ready to stage");
    assert.equal(preview.items[0].documentTypeId, "account_statement");
    assert.equal(preview.items[0].detectedClient, "Christopher T Bakken");
    assert.equal(preview.items[0].extractedAccountType, "Checking");
    assert.equal(preview.items[0].extractedCustodian, "U.S. Bank");
    assert.equal(preview.items[0].analysisSource, "fresh_analysis");

    const db = openDb(tempDb.dbPath);
    try {
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM documents").get().count,
        1,
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM document_primary_facts").get().count,
        1,
      );
      assert.equal(
        db.prepare(
          "SELECT detected_client FROM document_primary_facts LIMIT 1",
        ).get().detected_client,
        "Christopher T Bakken",
      );
    } finally {
      db.close();
    }
  } finally {
    setAIPrimaryCompletionAdapterForTests(null);
    restoreEnv();
    await clearPreviewAnalysisCacheForOwner(ownerEmail);
    tempDb.cleanup();
  }
});
