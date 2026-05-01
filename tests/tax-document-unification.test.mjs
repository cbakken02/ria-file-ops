import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

import { analyzeTextContentWithEnvelope } from "../lib/document-intelligence.ts";
import {
  closeFirmDocumentSqliteConnection,
  writeCanonicalIdentityDocumentToSqlite,
  writeCanonicalTaxDocumentToSqlite,
} from "../lib/firm-document-sqlite.ts";
import {
  findTaxFactsForDocument,
  findTaxDocumentsForParty,
  inspectFirmDocumentBySourceFileId,
  resolveFirmDocumentPartyByName,
} from "../lib/firm-document-sqlite-query.ts";
import {
  buildDocumentFilenamePlan,
  getDefaultNamingRules,
} from "../lib/naming-rules.ts";
import { buildIdentityCanonicalFixture } from "./helpers/firm-document-sqlite-fixtures.mjs";

async function analyzeTaxText(name, text) {
  const envelope = await analyzeTaxEnvelope(name, text);
  return envelope.legacyInsight;
}

async function analyzeTaxEnvelope(name, text) {
  return analyzeTextContentWithEnvelope(
    {
      id: name,
      name,
      mimeType: "application/pdf",
      modifiedTime: "2026-04-27T12:00:00.000Z",
    },
    text,
    {},
    "pdf_text",
    undefined,
    [],
    undefined,
    null,
    { analysisProfile: "legacy" },
  );
}

test("tax return and tax form text classify as tax_document with stable subtypes", async () => {
  const cases = [
    {
      name: "2025-form-1040.pdf",
      text: "Form 1040 U.S. Individual Income Tax Return Tax year 2025 Christopher Bakken",
      subtype: "individual_return",
      filenameLabel: "1040 Return",
    },
    {
      name: "2025-form-1040x.pdf",
      text: "Form 1040-X Amended U.S. Individual Income Tax Return Tax year 2025",
      subtype: "amended_individual_return",
      filenameLabel: "1040X Amended Return",
    },
    {
      name: "2025-state-return.pdf",
      text: "Minnesota State Return Tax year 2025 Christopher Bakken",
      subtype: "state_return",
      filenameLabel: "State Return",
    },
    {
      name: "2025-form-1099-div.pdf",
      text: "Form 1099-DIV Qualified dividends Taxpayer copy Tax year 2025",
      subtype: "form_1099_div",
      filenameLabel: "1099-DIV",
    },
    {
      name: "2025-form-1099-r.pdf",
      text: "Form 1099-R Distributions from pensions annuities retirement Tax year 2025",
      subtype: "form_1099_r",
      filenameLabel: "1099-R",
    },
    {
      name: "2025-w2.pdf",
      text: "Form W-2 Wage and Tax Statement Tax year 2025",
      subtype: "form_w2",
      filenameLabel: "W-2",
    },
    {
      name: "irs-cp2000-notice.pdf",
      text: "Internal Revenue Service CP2000 Notice Tax year 2025",
      subtype: "tax_notice",
      filenameLabel: "Tax Notice",
    },
  ];

  for (const expected of cases) {
    const insight = await analyzeTaxText(expected.name, expected.text);

    assert.equal(insight.documentTypeId, "tax_document", expected.name);
    assert.equal(insight.documentLabel, "Tax document", expected.name);
    assert.equal(insight.documentSubtype, expected.subtype, expected.name);
    assert.equal(insight.filenameLabel, expected.filenameLabel, expected.name);
  }
});

test("tax document naming handles returns and forms under one document family", () => {
  const rules = getDefaultNamingRules();
  const commonInput = {
    clientName: "Christopher Bakken",
    documentTypeId: "tax_document",
    extension: ".pdf",
    ownershipType: "single",
    rules,
    taxYear: "2025",
  };

  assert.equal(
    buildDocumentFilenamePlan({
      ...commonInput,
      documentTypeLabel: "individual_return",
    }),
    "Bakken_Christopher_1040_Return_2025.pdf",
  );
  assert.equal(
    buildDocumentFilenamePlan({
      ...commonInput,
      custodian: "Fidelity",
      documentTypeLabel: "form_1099_r",
    }),
    "Bakken_Christopher_Fidelity_1099-R_2025.pdf",
  );
});

test("tax document canonical path extracts and persists v1 primary facts", async () => {
  const envelope = await analyzeTaxEnvelope(
    "christopher-bakken-2025-1099-div.pdf",
    [
      "2025 Form 1099-DIV Dividends and Distributions",
      "PAYER'S name",
      "Fidelity Brokerage Services LLC",
      "RECIPIENT'S name",
      "CHRISTOPHER BAKKEN",
      "Recipient's TIN XXX-XX-1234",
      "Tax year 2025",
      "Date issued February 3, 2026",
      "1a Total ordinary dividends $1,234.56",
      "1b Qualified dividends $900.00",
      "2a Total capital gain distributions $120.00",
      "4 Federal income tax withheld $80.00",
      "7 Foreign tax paid $12.34",
    ].join("\n"),
  );
  const canonical = envelope.canonical;

  assert.ok(canonical, "tax document should produce canonical output");
  assert.equal(canonical.classification.normalized.documentTypeId, "tax_document");
  assert.equal(canonical.classification.normalized.documentSubtype, "form_1099_div");
  assert.equal(canonical.normalized.primaryFacts.detectedClient, "Christopher Bakken");
  assert.equal(canonical.normalized.primaryFacts.custodian, "Fidelity");
  assert.equal(canonical.normalized.primaryFacts.taxYear, "2025");
  assert.equal(canonical.normalized.primaryFacts.documentDate, "2026-02-03");
  assert.equal(canonical.normalized.primaryFacts.idType, "1099-DIV");
  assertTaxFactAmount(
    canonical.normalized.taxFacts,
    "form_1099_div.total_ordinary_dividends",
    "1234.56",
  );
  assertTaxFactAmount(
    canonical.normalized.taxFacts,
    "form_1099_div.qualified_dividends",
    "900.00",
  );
  assertTaxFactAmount(
    canonical.normalized.taxFacts,
    "form_1099_div.federal_income_tax_withheld",
    "80.00",
  );

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tax-canonical-db-"));
  const dbPath = path.join(tempDir, "firm-documents.sqlite");
  const ownerEmail = "tax-canonical@example.com";

  try {
    const writeResult = writeCanonicalTaxDocumentToSqlite({
      ownerEmail,
      dbPath,
      analysisProfile: "legacy",
      analysisVersion: "test",
      analysisRanAt: "2026-04-27T12:00:00.000Z",
      canonical,
    });

    assert.ok(writeResult);

    const inspection = inspectFirmDocumentBySourceFileId({
      ownerEmail,
      dbPath,
      sourceFileId: "christopher-bakken-2025-1099-div.pdf",
    });
    assert.equal(
      inspection?.document?.normalized_document_type_id,
      "tax_document",
    );
    assert.equal(
      inspection?.document?.normalized_document_subtype,
      "form_1099_div",
    );
    assert.equal(inspection?.documentPrimaryFacts?.detected_client, "Christopher Bakken");
    assert.equal(inspection?.documentPrimaryFacts?.custodian_name, "Fidelity");
    assert.equal(inspection?.documentPrimaryFacts?.tax_year, "2025");
    assert.equal(inspection?.documentPrimaryFacts?.id_type, "1099-DIV");
    assert.equal(inspection?.documentParties.length, 1);
    assert.equal(inspection?.documentInstitutions.length, 1);
    assert.equal(inspection?.documentTaxFacts.length, 5);
    assert.equal(
      inspection?.documentTaxFacts.find(
        (row) => row.field_id === "form_1099_div.total_ordinary_dividends",
      )?.amount,
      "1234.56",
    );

    const party = resolveFirmDocumentPartyByName({
      ownerEmail,
      dbPath,
      name: "Christopher Bakken",
    });
    assert.equal(party.status, "resolved");

    const matches = findTaxDocumentsForParty({
      ownerEmail,
      dbPath,
      partyId: party.party.partyId,
      taxYear: "2025",
      documentSubtype: "form_1099_div",
    });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].idType, "1099-DIV");
    assert.equal(matches[0].institutionName, "Fidelity");

    const taxFacts = findTaxFactsForDocument({
      ownerEmail,
      dbPath,
      documentId: writeResult.documentId,
      fieldId: "form_1099_div.qualified_dividends",
    });
    assert.equal(taxFacts.length, 1);
    assert.equal(taxFacts[0].amount, "900.00");
    assert.equal(taxFacts[0].box, "1b");

  } finally {
    closeFirmDocumentSqliteConnection(dbPath);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("tax document v2 extracts 1040, W-2, and 1099-R line and box facts", async () => {
  const federalReturn = await analyzeTaxEnvelope(
    "christopher-bakken-2025-1040.pdf",
    [
      "Form 1040 U.S. Individual Income Tax Return",
      "Tax year 2025",
      "CHRISTOPHER BAKKEN",
      "11 Adjusted gross income 125,000",
      "15 Taxable income 98,500",
      "24 Total tax 18,400",
      "34 Refund 1,250",
      "37 Amount you owe 0",
    ].join("\n"),
  );
  assert.equal(
    federalReturn.canonical?.classification.normalized.documentSubtype,
    "individual_return",
  );
  assertTaxFactAmount(
    federalReturn.canonical?.normalized.taxFacts,
    "form_1040.adjusted_gross_income",
    "125000.00",
  );
  assertTaxFactAmount(
    federalReturn.canonical?.normalized.taxFacts,
    "form_1040.taxable_income",
    "98500.00",
  );
  assertTaxFactAmount(
    federalReturn.canonical?.normalized.taxFacts,
    "form_1040.total_tax",
    "18400.00",
  );
  assertTaxFactAmount(
    federalReturn.canonical?.normalized.taxFacts,
    "form_1040.refund",
    "1250.00",
  );
  assertTaxFactAmount(
    federalReturn.canonical?.normalized.taxFacts,
    "form_1040.amount_owed",
    "0.00",
  );

  const w2 = await analyzeTaxEnvelope(
    "christopher-bakken-2025-w2.pdf",
    [
      "Form W-2 Wage and Tax Statement",
      "Tax year 2025",
      "Employee's name CHRISTOPHER BAKKEN",
      "1 Wages, tips, other compensation $88,000.00",
      "2 Federal income tax withheld $12,345.67",
      "3 Social security wages $88,000.00",
      "4 Social security tax withheld $5,456.00",
      "5 Medicare wages and tips $88,000.00",
      "6 Medicare tax withheld $1,276.00",
      "16 State wages, tips, etc. $88,000.00",
      "17 State income tax $4,321.00",
    ].join("\n"),
  );
  assert.equal(w2.canonical?.classification.normalized.documentSubtype, "form_w2");
  assertTaxFactAmount(
    w2.canonical?.normalized.taxFacts,
    "form_w2.wages_tips_other_compensation",
    "88000.00",
  );
  assertTaxFactAmount(
    w2.canonical?.normalized.taxFacts,
    "form_w2.federal_income_tax_withheld",
    "12345.67",
  );
  assertTaxFactAmount(
    w2.canonical?.normalized.taxFacts,
    "form_w2.state_income_tax",
    "4321.00",
  );

  const form1099r = await analyzeTaxEnvelope(
    "christopher-bakken-2025-1099-r.pdf",
    [
      "Form 1099-R Distributions From Pensions, Annuities, Retirement",
      "Tax year 2025",
      "Recipient's name CHRISTOPHER BAKKEN",
      "1 Gross distribution $42,000.00",
      "2a Taxable amount $40,500.00",
      "4 Federal income tax withheld $8,100.00",
      "7 Distribution code(s) G",
      "14 State tax withheld $2,000.00",
      "16 State distribution $40,500.00",
    ].join("\n"),
  );
  assert.equal(
    form1099r.canonical?.classification.normalized.documentSubtype,
    "form_1099_r",
  );
  assertTaxFactAmount(
    form1099r.canonical?.normalized.taxFacts,
    "form_1099_r.gross_distribution",
    "42000.00",
  );
  assertTaxFactAmount(
    form1099r.canonical?.normalized.taxFacts,
    "form_1099_r.taxable_amount",
    "40500.00",
  );
  assertTaxFactValue(
    form1099r.canonical?.normalized.taxFacts,
    "form_1099_r.distribution_codes",
    "G",
  );
});

test("firm document SQLite backfill rewrites legacy tax_return rows", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tax-unification-db-"));
  const dbPath = path.join(tempDir, "firm-documents.sqlite");
  const ownerEmail = "tax-unification@example.com";

  try {
    writeCanonicalIdentityDocumentToSqlite({
      ownerEmail,
      dbPath,
      analysisProfile: "legacy",
      analysisVersion: "test",
      analysisRanAt: "2026-04-27T12:00:00.000Z",
      canonical: buildIdentityCanonicalFixture({ fileId: "identity-before-backfill" }),
    });
    closeFirmDocumentSqliteConnection(dbPath);

    const db = new Database(dbPath);
    db.prepare(`
      INSERT INTO documents (
        document_id,
        owner_email,
        source_file_id,
        source_name,
        analysis_profile,
        analysis_version,
        normalized_document_type_id,
        extracted_document_type_id,
        ai_used,
        analyzed_at,
        created_at,
        updated_at
      ) VALUES (
        'legacy-tax-doc',
        @ownerEmail,
        'legacy-tax-source',
        '2025-state-return.pdf',
        'legacy',
        'test',
        'tax_return',
        'tax_return',
        0,
        '2026-04-27T12:00:00.000Z',
        '2026-04-27T12:00:00.000Z',
        '2026-04-27T12:00:00.000Z'
      )
    `).run({ ownerEmail });
    db.close();

    writeCanonicalIdentityDocumentToSqlite({
      ownerEmail,
      dbPath,
      analysisProfile: "legacy",
      analysisVersion: "test",
      analysisRanAt: "2026-04-27T12:01:00.000Z",
      canonical: buildIdentityCanonicalFixture({ fileId: "identity-after-backfill" }),
    });
    closeFirmDocumentSqliteConnection(dbPath);

    const verifiedDb = new Database(dbPath);
    const row = verifiedDb
      .prepare(`
        SELECT
          normalized_document_type_id AS normalizedDocumentTypeId,
          normalized_document_subtype AS normalizedDocumentSubtype,
          extracted_document_type_id AS extractedDocumentTypeId,
          extracted_document_subtype AS extractedDocumentSubtype
        FROM documents
        WHERE document_id = 'legacy-tax-doc'
      `)
      .get();
    verifiedDb.close();

    assert.equal(row.normalizedDocumentTypeId, "tax_document");
    assert.equal(row.extractedDocumentTypeId, "tax_document");
    assert.equal(row.normalizedDocumentSubtype, "state_return");
    assert.equal(row.extractedDocumentSubtype, "state_return");
  } finally {
    closeFirmDocumentSqliteConnection(dbPath);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function assertTaxFactAmount(facts, fieldId, amount) {
  const fact = facts?.find((candidate) => candidate.fieldId === fieldId);
  assert.ok(fact, `expected tax fact ${fieldId}`);
  assert.equal(fact.money?.amount, amount, fieldId);
}

function assertTaxFactValue(facts, fieldId, value) {
  const fact = facts?.find((candidate) => candidate.fieldId === fieldId);
  assert.ok(fact, `expected tax fact ${fieldId}`);
  assert.equal(fact.value, value, fieldId);
}
