import assert from "node:assert/strict";
import test from "node:test";

import {
  findFirmDocumentPartiesByName,
  findLatestAccountSnapshotsForParty,
  findLatestContactsForAccount,
  findLatestDocumentForAccount,
} from "../lib/firm-document-sqlite-query.ts";
import { writeCanonicalAccountStatementToSqlite } from "../lib/firm-document-sqlite.ts";
import {
  buildStatementCanonicalFixture,
  makeTempDbEnv,
} from "./helpers/firm-document-sqlite-fixtures.mjs";

function seedChristopherBakkenAccountHistory(ownerEmail, dbPath) {
  const olderStatement = buildStatementCanonicalFixture({
    ownerName: "Christopher Bakken",
    rawInstitutionName: "Empower Retirement, LLC",
    normalizedInstitutionName: "Empower",
    rawAccountType: "401(k) Plan",
    normalizedAccountType: "401(k)",
    accountNumber: "4010001234567890",
    maskedAccountNumber: "XXXXXXXX7890",
    accountLast4: "7890",
    fileId: "christopher-401k-2025",
    sourceName: "christopher-401k-2025.pdf",
    documentDate: "2025-12-31",
    statementStartDate: "2025-10-01",
    statementEndDate: "2025-12-31",
    extractedContacts: [
      {
        id: "contact-1",
        institutionId: "institution-1",
        method: "phone",
        purpose: "customer_service",
        label: "Customer Service",
        value: "800-111-0000",
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
        value: "800-111-0000",
        address: null,
        hoursText: null,
      },
    ],
  });

  const newerStatement = buildStatementCanonicalFixture({
    ownerName: "Christopher Bakken",
    rawInstitutionName: "Empower Retirement, LLC",
    normalizedInstitutionName: "Empower",
    rawAccountType: "Employer-Sponsored Plan",
    normalizedAccountType: "401(k)",
    accountNumber: "4010001234567890",
    maskedAccountNumber: "XXXXXXXX7890",
    accountLast4: "7890",
    fileId: "christopher-401k-2026",
    sourceName: "christopher-401k-2026.pdf",
    documentDate: "2026-03-31",
    statementStartDate: "2026-01-01",
    statementEndDate: "2026-03-31",
    extractedContacts: [
      {
        id: "contact-1",
        institutionId: "institution-1",
        method: "phone",
        purpose: "rollover_support",
        label: "Rollover Support",
        value: "800-777-1212",
        address: null,
        hoursText: null,
      },
      {
        id: "contact-2",
        institutionId: "institution-1",
        method: "website",
        purpose: "general_support",
        label: "Website",
        value: "www.empower.com",
        address: null,
        hoursText: null,
      },
    ],
    normalizedContacts: [
      {
        id: "contact-1",
        institutionId: "institution-1",
        method: "phone",
        purpose: "rollover_support",
        label: "Rollover Support",
        value: "800-777-1212",
        address: null,
        hoursText: null,
      },
      {
        id: "contact-2",
        institutionId: "institution-1",
        method: "website",
        purpose: "general_support",
        label: "Website",
        value: "www.empower.com",
        address: null,
        hoursText: null,
      },
    ],
  });

  const unrelatedStatement = buildStatementCanonicalFixture({
    ownerName: "Christopher Allen",
    rawInstitutionName: "U.S. Bank National Association",
    normalizedInstitutionName: "U.S. Bank",
    rawAccountType: "Smartly Checking",
    normalizedAccountType: "Checking",
    accountNumber: "9876543210001111",
    maskedAccountNumber: "XXXXXXXX1111",
    accountLast4: "1111",
    fileId: "christopher-allen-checking",
    sourceName: "christopher-allen-checking.pdf",
    documentDate: "2026-01-31",
    statementStartDate: "2026-01-01",
    statementEndDate: "2026-01-31",
  });

  for (const canonical of [olderStatement, newerStatement, unrelatedStatement]) {
    writeCanonicalAccountStatementToSqlite({
      ownerEmail,
      analysisProfile: "preview_ai_primary",
      analysisVersion: "query-test-version",
      analysisRanAt: "2026-04-21T21:00:00.000Z",
      canonical,
    });
  }

  return dbPath;
}

test("party name lookup stays conservative and exact-normalized", () => {
  const tempDb = makeTempDbEnv("firm-document-query-party-");
  const ownerEmail = "sqlite-query-party@example.com";

  try {
    seedChristopherBakkenAccountHistory(ownerEmail, tempDb.dbPath);

    const exactMatches = findFirmDocumentPartiesByName({
      ownerEmail,
      dbPath: tempDb.dbPath,
      name: "christopher bakken",
    });
    const broadMatches = findFirmDocumentPartiesByName({
      ownerEmail,
      dbPath: tempDb.dbPath,
      name: "Christopher",
    });

    assert.equal(exactMatches.length, 1);
    assert.equal(exactMatches[0]?.canonicalDisplayName, "Christopher Bakken");
    assert.equal(broadMatches.length, 0);
  } finally {
    tempDb.cleanup();
  }
});

test("latest account snapshot lookup selects the newest repeated upload for a party and account type", () => {
  const tempDb = makeTempDbEnv("firm-document-query-snapshot-");
  const ownerEmail = "sqlite-query-snapshot@example.com";

  try {
    seedChristopherBakkenAccountHistory(ownerEmail, tempDb.dbPath);

    const [party] = findFirmDocumentPartiesByName({
      ownerEmail,
      dbPath: tempDb.dbPath,
      name: "Christopher Bakken",
    });

    assert.ok(party);

    const snapshots = findLatestAccountSnapshotsForParty({
      ownerEmail,
      dbPath: tempDb.dbPath,
      partyId: party.partyId,
      normalizedAccountType: "401(k)",
    });

    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0]?.sourceName, "christopher-401k-2026.pdf");
    assert.equal(snapshots[0]?.statementEndDate, "2026-03-31");
    assert.equal(snapshots[0]?.institutionName, "Empower");
    assert.equal(snapshots[0]?.accountLast4, "7890");
  } finally {
    tempDb.cleanup();
  }
});

test("latest document lookup returns the newest statement document for an account", () => {
  const tempDb = makeTempDbEnv("firm-document-query-document-");
  const ownerEmail = "sqlite-query-document@example.com";

  try {
    seedChristopherBakkenAccountHistory(ownerEmail, tempDb.dbPath);

    const [party] = findFirmDocumentPartiesByName({
      ownerEmail,
      dbPath: tempDb.dbPath,
      name: "Christopher Bakken",
    });
    const [snapshot] = findLatestAccountSnapshotsForParty({
      ownerEmail,
      dbPath: tempDb.dbPath,
      partyId: party.partyId,
      normalizedAccountType: "401(k)",
    });

    const latestDocument = findLatestDocumentForAccount({
      ownerEmail,
      dbPath: tempDb.dbPath,
      accountId: snapshot.accountId,
    });

    assert.ok(latestDocument);
    assert.equal(latestDocument.sourceName, "christopher-401k-2026.pdf");
    assert.equal(latestDocument.statementEndDate, "2026-03-31");
    assert.equal(latestDocument.normalizedAccountType, "401(k)");
  } finally {
    tempDb.cleanup();
  }
});

test("latest contact lookup returns purpose/method-filtered contacts from the newest matching account document", () => {
  const tempDb = makeTempDbEnv("firm-document-query-contact-");
  const ownerEmail = "sqlite-query-contact@example.com";

  try {
    seedChristopherBakkenAccountHistory(ownerEmail, tempDb.dbPath);

    const [party] = findFirmDocumentPartiesByName({
      ownerEmail,
      dbPath: tempDb.dbPath,
      name: "Christopher Bakken",
    });
    const [snapshot] = findLatestAccountSnapshotsForParty({
      ownerEmail,
      dbPath: tempDb.dbPath,
      partyId: party.partyId,
      normalizedAccountType: "401(k)",
    });

    const contacts = findLatestContactsForAccount({
      ownerEmail,
      dbPath: tempDb.dbPath,
      accountId: snapshot.accountId,
      purpose: "rollover_support",
      method: "phone",
    });

    assert.equal(contacts.length, 1);
    assert.equal(contacts[0]?.normalizedValue, "800-777-1212");
    assert.equal(contacts[0]?.sourceName, "christopher-401k-2026.pdf");
    assert.equal(contacts[0]?.purpose, "rollover_support");
    assert.equal(contacts[0]?.method, "phone");
  } finally {
    tempDb.cleanup();
  }
});
