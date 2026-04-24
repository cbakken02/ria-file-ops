import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

import { finalizeCanonicalExtractedDocument } from "../../lib/canonical-extracted-document.ts";
import { DOCUMENT_ANALYSIS_VERSION } from "../../lib/document-intelligence.ts";
import { closeFirmDocumentSqliteConnectionsForTests } from "../../lib/firm-document-sqlite.ts";

export function withEnv(overrides) {
  const previous = new Map();

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

export function makeTempDbEnv(prefix = "firm-document-sqlite-") {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dbPath = path.join(tempDir, ".firm-owned-documents.sqlite");
  const restoreEnv = withEnv({
    RIA_FIRM_DOCUMENT_DB_PATH: dbPath,
  });

  return {
    dbPath,
    cleanup() {
      restoreEnv();
      closeFirmDocumentSqliteConnectionsForTests();
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

export function openDb(dbPath) {
  return new Database(dbPath, { readonly: true });
}

export function buildStatementCanonicalFixture(options = {}) {
  const ownerName = options.ownerName ?? "Christopher T Bakken";
  const jointOwnerName = options.jointOwnerName ?? null;
  const rawInstitutionName =
    options.rawInstitutionName ?? "U.S. Bank National Association";
  const normalizedInstitutionName = options.normalizedInstitutionName ?? "U.S. Bank";
  const accountNumber = options.accountNumber ?? "123456789012";
  const maskedAccountNumber = options.maskedAccountNumber ?? "XXXXXXXX9012";
  const accountLast4 = options.accountLast4 ?? "9012";
  const rawAccountType = options.rawAccountType ?? "U.S. Bank Smartly Checking";
  const normalizedAccountType = options.normalizedAccountType ?? "Checking";
  const documentDate = options.documentDate ?? "2026-03-31";
  const statementStartDate = options.statementStartDate ?? "2026-01-01";
  const statementEndDate = options.statementEndDate ?? "2026-03-31";
  const fileId = options.fileId ?? "statement-file-1";
  const sourceName = options.sourceName ?? `${fileId}.pdf`;
  const modifiedTime = options.modifiedTime ?? "2026-04-21T12:00:00.000Z";
  const partyAddresses =
    options.partyAddresses ?? [
      {
        kind: "identity",
        rawText: "N1345 Maple Hills Dr, Fontana WI 53125-1921",
        lines: ["N1345 Maple Hills Dr", "Fontana WI 53125-1921"],
        city: "Fontana",
        state: "WI",
        postalCode: "53125-1921",
        country: "US",
      },
    ];
  const extractedContacts =
    options.extractedContacts ?? [
      {
        id: "contact-1",
        institutionId: "institution-1",
        method: "phone",
        purpose: "customer_service",
        label: "Customer Service",
        value: "800-555-1212",
        address: null,
        hoursText: null,
      },
    ];
  const normalizedContacts = options.normalizedContacts ?? extractedContacts;
  const extractedValues =
    options.extractedValues ?? [
      {
        kind: "ending_balance",
        label: "Ending balance",
        money: {
          amount: "4321.09",
          currency: "USD",
        },
        dateId: "date-end",
      },
    ];
  const normalizedValues = options.normalizedValues ?? extractedValues;

  const extractedParties = [
    {
      id: "party-1",
      kind: "person",
      displayName: ownerName,
      rawName: ownerName,
      addresses: partyAddresses,
      birthDateId: null,
      taxIdentifiers: [],
      governmentIds: [],
    },
  ];
  const normalizedParties = [
    {
      id: "party-1",
      kind: "person",
      displayName: ownerName,
      rawName: ownerName,
      addresses: partyAddresses,
      birthDateId: null,
      taxIdentifiers: [],
      governmentIds: [],
    },
  ];
  const extractedAccountParties = [
    {
      id: "account-party-1",
      accountId: "account-1",
      partyId: "party-1",
      roles: ["owner"],
      relationshipLabel: null,
      allocationPercent: null,
    },
  ];
  const normalizedAccountParties = [
    {
      id: "account-party-1",
      accountId: "account-1",
      partyId: "party-1",
      roles: ["owner"],
      relationshipLabel: null,
      allocationPercent: null,
    },
  ];

  if (jointOwnerName) {
    extractedParties.push({
      id: "party-2",
      kind: "person",
      displayName: jointOwnerName,
      rawName: jointOwnerName,
      addresses: [],
      birthDateId: null,
      taxIdentifiers: [],
      governmentIds: [],
    });
    normalizedParties.push({
      id: "party-2",
      kind: "person",
      displayName: jointOwnerName,
      rawName: jointOwnerName,
      addresses: [],
      birthDateId: null,
      taxIdentifiers: [],
      governmentIds: [],
    });
    extractedAccountParties.push({
      id: "account-party-2",
      accountId: "account-1",
      partyId: "party-2",
      roles: ["joint_owner"],
      relationshipLabel: null,
      allocationPercent: null,
    });
    normalizedAccountParties.push({
      id: "account-party-2",
      accountId: "account-1",
      partyId: "party-2",
      roles: ["joint_owner"],
      relationshipLabel: null,
      allocationPercent: null,
    });
  }

  return finalizeCanonicalExtractedDocument({
    source: {
      file: {
        fileId,
        sourceName,
        mimeType: "application/pdf",
        modifiedTime,
        driveSize: null,
        downloadByteLength: 1024,
        downloadSha1: options.downloadSha1 ?? `${fileId}-sha1`,
      },
      extraction: {
        contentSource: "pdf_text",
        pdfFields: [],
        pdfFieldReaders: [],
      },
    },
    classification: {
      extracted: {
        documentTypeId: "account_statement",
        documentSubtype: null,
      },
      normalized: {
        documentTypeId: "account_statement",
        documentSubtype: null,
      },
    },
    extracted: {
      parties: extractedParties,
      accounts: [
        {
          id: "account-1",
          institutionIds: ["institution-1"],
          accountNumber,
          maskedAccountNumber,
          accountLast4,
          accountType: rawAccountType,
          registrationType: jointOwnerName ? "Joint" : "Individual",
          openedDateId: null,
          closedDateId: null,
          statementStartDateId: "date-start",
          statementEndDateId: "date-end",
          values: extractedValues,
          beneficiaryText: null,
        },
      ],
      accountParties: extractedAccountParties,
      institutions: [
        {
          id: "institution-1",
          name: rawInstitutionName,
          rawName: rawInstitutionName,
          addresses: [],
        },
      ],
      contacts: extractedContacts,
      dates: [
        {
          id: "date-start",
          kind: "statement_period_start",
          value: statementStartDate,
          rawValue: statementStartDate,
          entityType: "document",
          entityId: null,
        },
        {
          id: "date-end",
          kind: "statement_period_end",
          value: statementEndDate,
          rawValue: statementEndDate,
          entityType: "document",
          entityId: null,
        },
        {
          id: "date-document",
          kind: "document_date",
          value: documentDate,
          rawValue: documentDate,
          entityType: "document",
          entityId: null,
        },
      ],
      documentFacts: {
        entityName: null,
        idType: null,
        taxYear: null,
      },
    },
    normalized: {
      parties: normalizedParties,
      accounts: [
        {
          id: "account-1",
          institutionIds: ["institution-1"],
          accountNumber,
          maskedAccountNumber,
          accountLast4,
          accountType: normalizedAccountType,
          registrationType: jointOwnerName ? "Joint" : "Individual",
          openedDateId: null,
          closedDateId: null,
          statementStartDateId: "date-start",
          statementEndDateId: "date-end",
          values: normalizedValues,
          beneficiaryText: null,
        },
      ],
      accountParties: normalizedAccountParties,
      institutions: [
        {
          id: "institution-1",
          name: normalizedInstitutionName,
          rawName: rawInstitutionName,
          addresses: [],
        },
      ],
      contacts: normalizedContacts,
      dates: [
        {
          id: "date-start",
          kind: "statement_period_start",
          value: statementStartDate,
          rawValue: statementStartDate,
          entityType: "document",
          entityId: null,
        },
        {
          id: "date-end",
          kind: "statement_period_end",
          value: statementEndDate,
          rawValue: statementEndDate,
          entityType: "document",
          entityId: null,
        },
        {
          id: "date-document",
          kind: "document_date",
          value: documentDate,
          rawValue: documentDate,
          entityType: "document",
          entityId: null,
        },
      ],
      documentFacts: {
        entityName: null,
        idType: null,
        taxYear: null,
      },
    },
    provenance: {
      fields: {},
      normalization: [],
      sourceRefs: [],
    },
    diagnostics: {
      parserVersion: options.parserVersion ?? DOCUMENT_ANALYSIS_VERSION,
      ai: {
        enabled: true,
        attempted: true,
        used: true,
        model: "test-model",
        promptVersion: "test-prompt-version",
        rawSummary: null,
        failureReason: null,
      },
    },
  });
}

export function buildIdentityCanonicalFixture(options = {}) {
  const subtype = options.subtype ?? "driver_license";
  const idType = subtype === "state_id" ? "State ID" : "Driver License";
  const displayName = options.displayName ?? "Christopher T Bakken";
  const rawName = options.rawName ?? displayName.toUpperCase();
  const fileId = options.fileId ?? "identity-file-1";
  const sourceName = options.sourceName ?? `${fileId}.pdf`;
  const modifiedTime = options.modifiedTime ?? "2026-04-21T12:00:00.000Z";
  const documentDate = options.documentDate ?? "2024-03-01";
  const birthDate = options.birthDate ?? "1985-02-03";
  const issueDate = options.issueDate ?? documentDate;
  const expirationDate =
    Object.prototype.hasOwnProperty.call(options, "expirationDate")
      ? options.expirationDate
      : "2032-02-03";
  const governmentIdValue =
    Object.prototype.hasOwnProperty.call(options, "governmentIdValue")
      ? options.governmentIdValue
      : "BAKKC85020324";
  const maskedGovernmentIdValue =
    Object.prototype.hasOwnProperty.call(options, "maskedGovernmentIdValue")
      ? options.maskedGovernmentIdValue
      : governmentIdValue
        ? `${"x".repeat(Math.max(0, governmentIdValue.length - 4))}${governmentIdValue.slice(-4)}`
        : null;
  const issuingAuthority = options.issuingAuthority ?? "WI";
  const address =
    Object.prototype.hasOwnProperty.call(options, "address")
      ? options.address
      : {
          kind: "identity",
          rawText: "1841 LAKE SHORE CT, WALWORTH WI 53184",
          lines: ["1841 LAKE SHORE CT", "WALWORTH WI 53184"],
          city: "WALWORTH",
          state: "WI",
          postalCode: "53184",
          country: "US",
        };

  return finalizeCanonicalExtractedDocument({
    source: {
      file: {
        fileId,
        sourceName,
        mimeType: "application/pdf",
        modifiedTime,
        driveSize: null,
        downloadByteLength: 512,
        downloadSha1: options.downloadSha1 ?? `${fileId}-sha1`,
      },
      extraction: {
        contentSource: "pdf_text",
        pdfFields: [],
        pdfFieldReaders: [],
      },
    },
    classification: {
      extracted: {
        documentTypeId: "identity_document",
        documentSubtype: subtype,
      },
      normalized: {
        documentTypeId: "identity_document",
        documentSubtype: subtype,
      },
    },
    extracted: {
      parties: [
        {
          id: "party-1",
          kind: "person",
          displayName: rawName,
          rawName,
          addresses: address ? [address] : [],
          birthDateId: "date-birth",
          taxIdentifiers: [],
          governmentIds: [
            {
              kind: subtype,
              value: governmentIdValue,
              maskedValue: maskedGovernmentIdValue,
              issuingAuthority,
              expirationDateId: "date-expiration",
            },
          ],
        },
      ],
      accounts: [],
      accountParties: [],
      institutions: [],
      contacts: [],
      dates: [
        {
          id: "date-document",
          kind: "document_date",
          value: documentDate,
          rawValue: documentDate,
          entityType: "document",
          entityId: null,
        },
        {
          id: "date-birth",
          kind: "birth_date",
          value: birthDate,
          rawValue: birthDate,
          entityType: "party",
          entityId: "party-1",
        },
        {
          id: "date-issue",
          kind: "issue_date",
          value: issueDate,
          rawValue: issueDate,
          entityType: "party",
          entityId: "party-1",
        },
        {
          id: "date-expiration",
          kind: "expiration_date",
          value: expirationDate,
          rawValue: expirationDate,
          entityType: "party",
          entityId: "party-1",
        },
      ],
      documentFacts: {
        entityName: null,
        idType,
        taxYear: null,
      },
    },
    normalized: {
      parties: [
        {
          id: "party-1",
          kind: "person",
          displayName,
          rawName,
          addresses: address ? [address] : [],
          birthDateId: "date-birth",
          taxIdentifiers: [],
          governmentIds: [
            {
              kind: subtype,
              value: governmentIdValue,
              maskedValue: maskedGovernmentIdValue,
              issuingAuthority,
              expirationDateId: "date-expiration",
            },
          ],
        },
      ],
      accounts: [],
      accountParties: [],
      institutions: [],
      contacts: [],
      dates: [
        {
          id: "date-document",
          kind: "document_date",
          value: documentDate,
          rawValue: documentDate,
          entityType: "document",
          entityId: null,
        },
        {
          id: "date-birth",
          kind: "birth_date",
          value: birthDate,
          rawValue: birthDate,
          entityType: "party",
          entityId: "party-1",
        },
        {
          id: "date-issue",
          kind: "issue_date",
          value: issueDate,
          rawValue: issueDate,
          entityType: "party",
          entityId: "party-1",
        },
        {
          id: "date-expiration",
          kind: "expiration_date",
          value: expirationDate,
          rawValue: expirationDate,
          entityType: "party",
          entityId: "party-1",
        },
      ],
      documentFacts: {
        entityName: null,
        idType,
        taxYear: null,
      },
    },
    provenance: {
      fields: {},
      normalization: [],
      sourceRefs: [],
    },
    diagnostics: {
      parserVersion: options.parserVersion ?? DOCUMENT_ANALYSIS_VERSION,
      parserConflictSummary: null,
      documentSignal: "Identity canonical fixture",
      reasons: ["Identity canonical fixture"],
      textExcerpt: null,
      diagnosticText: null,
      statementClientSource: null,
      statementClientCandidate: null,
      ownershipClientCandidate: null,
      accountContextCandidate: null,
      accountLooseCandidate: null,
      taxKeywordDetected: false,
      yearCandidates: [],
      ai: {
        enabled: false,
        attempted: false,
        used: false,
        model: null,
        promptVersion: null,
        rawSummary: null,
        failureReason: null,
      },
    },
  });
}
