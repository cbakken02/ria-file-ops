import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { setAIPrimaryCompletionAdapterForTests } from "../lib/ai-primary-parser.ts";
import {
  finalizeCanonicalExtractedDocument,
} from "../lib/canonical-extracted-document.ts";
import {
  projectCanonicalToPreviewSafePersistedShape,
  projectCanonicalToRedactedDebugShape,
} from "../lib/canonical-persistence.ts";
import { analyzeTextContentWithEnvelope } from "../lib/document-intelligence.ts";
import {
  clearPreviewAnalysisCacheForOwner,
  readPreviewAnalysisCache,
  writePreviewAnalysisCache,
} from "../lib/preview-analysis-cache.ts";

function withEnv(overrides) {
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

function makeTempPreviewCacheEnv(prefix = "canonical-preview-cache-") {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const restoreEnv = withEnv({
    RIA_PREVIEW_ANALYSIS_CACHE_DIR: tempDir,
  });

  return {
    cleanup() {
      restoreEnv();
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

test("preview analysis cache persists canonical plus redacted canonical debug for AI statement path", async () => {
  const ownerEmail = "canonical-cache-test@example.com";
  const tempCache = makeTempPreviewCacheEnv();
  const restoreEnv = withEnv({
    AI_PRIMARY_PARSER: "true",
    AI_PRIMARY_ACCOUNT_STATEMENT_ONLY: "true",
  });
  const file = {
    id: "canonical-cache-statement",
    name: "canonical-cache-statement.pdf",
    mimeType: "application/pdf",
    modifiedTime: "2026-04-19T12:00:00.000Z",
  };

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
        detectedClient: 0.96,
        detectedClient2: null,
        ownershipType: 0.88,
        custodian: 0.95,
        accountType: 0.97,
        accountLast4: 0.93,
        documentDate: 0.94,
      },
      rawEvidenceSummary:
        "Owner block shows Christopher T Bakken; statement header shows U.S. Bank Smartly Checking ending in 6642.",
    }),
  }));

  await clearPreviewAnalysisCacheForOwner(ownerEmail);

  try {
    const envelope = await analyzeTextContentWithEnvelope(
      file,
      `
U.S. BANK SMARTLY CHECKING
Account Summary
CHRISTOPHER T BAKKEN
N1345 MAPLE HILLS DR
FONTANA WI 53125-1921
Account Number ending in ...6642
Statement Period Sep 13, 2025 through Oct 14, 2025
`,
      {},
      "pdf_text",
      undefined,
      [],
      undefined,
      null,
      { analysisProfile: "preview_ai_primary" },
    );

    assert.ok(envelope.canonical);

    await writePreviewAnalysisCache({
      analysisProfile: "preview_ai_primary",
      ownerEmail,
      file,
      insight: envelope.legacyInsight,
      canonical: envelope.canonical,
      previewSnapshotId: null,
      analysisRanAt: "2026-04-19T12:01:00.000Z",
    });

    const cachedEntry = await readPreviewAnalysisCache({
      analysisProfile: "preview_ai_primary",
      ownerEmail,
      file,
    });

    assert.ok(cachedEntry);
    assert.ok(cachedEntry.canonical);
    assert.equal(
      cachedEntry.canonical.normalized.primaryFacts.detectedClient,
      "Christopher T Bakken",
    );
    assert.equal(
      cachedEntry.canonical.normalized.primaryFacts.accountType,
      "Checking",
    );
    assert.equal(cachedEntry.insight.metadata.custodian, "U.S. Bank");
    assert.equal(cachedEntry.insight.metadata.accountLast4, "6642");
    assert.ok(cachedEntry.canonicalDebug);
    assert.equal(
      cachedEntry.canonicalDebug.normalized.primaryFacts.custodian,
      "U.S. Bank",
    );
    assert.equal(
      cachedEntry.canonicalDebug.extracted.accounts[0]?.accountNumber,
      null,
    );
    assert.equal(
      cachedEntry.canonicalDebug.extracted.accounts[0]?.beneficiaryText,
      null,
    );
  } finally {
    setAIPrimaryCompletionAdapterForTests(null);
    restoreEnv();
    await clearPreviewAnalysisCacheForOwner(ownerEmail);
    tempCache.cleanup();
  }
});

test("preview-safe and redacted canonical projections enforce the sensitive-field boundary", () => {
  const canonical = finalizeCanonicalExtractedDocument({
    source: {
      file: {
        fileId: "redaction-boundary",
        sourceName: "redaction-boundary.pdf",
        mimeType: "application/pdf",
        modifiedTime: null,
        driveSize: null,
        downloadByteLength: null,
        downloadSha1: null,
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
      parties: [
        {
          id: "party-raw-1",
          kind: "person",
          displayName: "Christopher T Bakken",
          rawName: "Christopher T Bakken",
          addresses: [
            {
              kind: "identity",
              rawText: "N1345 Maple Hills Dr, Fontana WI 53125-1921",
              lines: ["N1345 Maple Hills Dr", "Fontana WI 53125-1921"],
              city: "Fontana",
              state: "WI",
              postalCode: "53125-1921",
              country: "US",
            },
          ],
          birthDateId: "birth-date-1",
          taxIdentifiers: [{ kind: "ssn", value: "123-45-6789" }],
          governmentIds: [
            {
              kind: "driver_license",
              value: "B1234567",
              issuingAuthority: "WI",
              expirationDateId: null,
            },
          ],
        },
      ],
      accounts: [
        {
          id: "account-raw-1",
          institutionIds: ["institution-raw-1"],
          accountNumber: "123456789012",
          maskedAccountNumber: "xxxxxx9012",
          accountLast4: "9012",
          accountType: "Checking",
          registrationType: null,
          openedDateId: null,
          closedDateId: null,
          statementStartDateId: null,
          statementEndDateId: "date-raw-1",
          values: [
            {
              kind: "ending_balance",
              label: "Ending balance",
              money: { amount: "1000.00", currency: "USD" },
              dateId: "date-raw-1",
            },
          ],
          beneficiaryText: "Primary beneficiary Jane Doe 100%",
        },
      ],
      accountParties: [
        {
          id: "account-raw-1-party-1",
          accountId: "account-raw-1",
          partyId: "party-raw-1",
          roles: ["owner"],
          relationshipLabel: "Owner",
          allocationPercent: null,
        },
      ],
      institutions: [
        {
          id: "institution-raw-1",
          name: "U.S. Bank National Association",
          rawName: "U.S. Bank National Association",
          addresses: [
            {
              kind: "business",
              rawText: "123 Bank Plaza",
              lines: ["123 Bank Plaza"],
              city: "Milwaukee",
              state: "WI",
              postalCode: "53202",
              country: "US",
            },
          ],
        },
      ],
      contacts: [
        {
          id: "contact-1",
          institutionId: "institution-raw-1",
          method: "phone",
          purpose: "customer_service",
          label: "Customer service",
          value: "800-555-1212",
          address: {
            kind: "service",
            rawText: "PO Box 123",
            lines: ["PO Box 123"],
            city: "Milwaukee",
            state: "WI",
            postalCode: "53201",
            country: "US",
          },
          hoursText: "24/7",
        },
      ],
      dates: [
        {
          id: "date-raw-1",
          kind: "statement_end",
          value: "2025-10-14",
          rawValue: "2025-10-14",
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
      parties: [
        {
          id: "party-1",
          kind: "person",
          displayName: "Christopher T Bakken",
          rawName: "Christopher T Bakken",
          addresses: [
            {
              kind: "identity",
              rawText: "N1345 Maple Hills Dr, Fontana WI 53125-1921",
              lines: ["N1345 Maple Hills Dr", "Fontana WI 53125-1921"],
              city: "Fontana",
              state: "WI",
              postalCode: "53125-1921",
              country: "US",
            },
          ],
          birthDateId: "birth-date-1",
          taxIdentifiers: [{ kind: "ssn", value: "123-45-6789" }],
          governmentIds: [
            {
              kind: "driver_license",
              value: "B1234567",
              issuingAuthority: "WI",
              expirationDateId: null,
            },
          ],
        },
      ],
      accounts: [
        {
          id: "account-1",
          institutionIds: ["institution-1"],
          accountNumber: "123456789012",
          maskedAccountNumber: "xxxxxx9012",
          accountLast4: "9012",
          accountType: "Checking",
          registrationType: null,
          openedDateId: null,
          closedDateId: null,
          statementStartDateId: null,
          statementEndDateId: "date-1",
          values: [
            {
              kind: "ending_balance",
              label: "Ending balance",
              money: { amount: "1000.00", currency: "USD" },
              dateId: "date-1",
            },
          ],
          beneficiaryText: "Primary beneficiary Jane Doe 100%",
        },
      ],
      accountParties: [
        {
          id: "account-1-party-1",
          accountId: "account-1",
          partyId: "party-1",
          roles: ["owner"],
          relationshipLabel: "Owner",
          allocationPercent: null,
        },
      ],
      institutions: [
        {
          id: "institution-1",
          name: "U.S. Bank",
          rawName: "U.S. Bank",
          addresses: [
            {
              kind: "business",
              rawText: "123 Bank Plaza",
              lines: ["123 Bank Plaza"],
              city: "Milwaukee",
              state: "WI",
              postalCode: "53202",
              country: "US",
            },
          ],
        },
      ],
      contacts: [
        {
          id: "contact-1",
          institutionId: "institution-1",
          method: "phone",
          purpose: "customer_service",
          label: "Customer service",
          value: "800-555-1212",
          address: {
            kind: "service",
            rawText: "PO Box 123",
            lines: ["PO Box 123"],
            city: "Milwaukee",
            state: "WI",
            postalCode: "53201",
            country: "US",
          },
          hoursText: "24/7",
        },
      ],
      dates: [
        {
          id: "date-1",
          kind: "statement_end",
          value: "2025-10-14",
          rawValue: "2025-10-14",
          entityType: "document",
          entityId: null,
        },
      ],
      documentFacts: {
        entityName: null,
        idType: null,
        taxYear: null,
      },
      primaryFacts: {
        detectedClient: null,
        detectedClient2: null,
        ownershipType: null,
        accountLast4: null,
        accountType: null,
        custodian: null,
        documentDate: null,
        entityName: null,
        idType: null,
        taxYear: null,
      },
    },
    provenance: {
      fields: {
        "normalized.accounts[0].accountNumber": {
          owner: "ai",
          source: "test",
          confidence: 0.9,
          raw: "123456789012",
          sourceRefIds: ["source-ref-1"],
        },
      },
      normalization: [
        {
          fieldPath: "normalized.accounts[0].accountNumber",
          source: "test",
          ruleId: "mask_account_number",
          rawValue: "123456789012",
          finalValue: "xxxxxx9012",
          sourceRefId: "source-ref-1",
        },
      ],
      sourceRefs: [
        {
          id: "source-ref-1",
          kind: "ai_field",
          fieldPath: "normalized.accounts[0].accountNumber",
          label: "AI account number",
          value: "123456789012",
        },
        {
          id: "source-ref-2",
          kind: "ai_summary",
          fieldPath: null,
          label: "AI raw summary",
          value: "Account number 123456789012 for Christopher T Bakken at N1345 Maple Hills Dr",
        },
      ],
    },
    diagnostics: {
      parserVersion: "test",
      parserConflictSummary: null,
      documentSignal: "test",
      reasons: [],
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
        enabled: true,
        attempted: true,
        used: true,
        model: "test-model",
        promptVersion: "test-prompt",
        failureReason: null,
        rawSummary: "test raw summary",
      },
    },
  });

  const previewSafe = projectCanonicalToPreviewSafePersistedShape(canonical);
  const debugShape = projectCanonicalToRedactedDebugShape(canonical);

  assert.ok(previewSafe);
  assert.ok(debugShape);
  assert.equal(previewSafe.normalized.primaryFacts.detectedClient, "Christopher T Bakken");
  assert.equal("accountNumber" in previewSafe.normalized.accounts[0], false);
  assert.equal("addresses" in previewSafe.normalized.parties[0], false);
  assert.equal("provenance" in previewSafe, false);
  assert.equal(debugShape.extracted.accounts[0].accountNumber, null);
  assert.equal(debugShape.extracted.accounts[0].beneficiaryText, null);
  assert.equal(
    debugShape.provenance.sourceRefs.find((entry) => entry.id === "source-ref-1")?.value,
    "[REDACTED]",
  );
  assert.equal(
    debugShape.provenance.sourceRefs.find((entry) => entry.id === "source-ref-2")?.value,
    "[REDACTED]",
  );
});

test("legacy-only cache entries remain stable and do not persist canonical", async () => {
  const ownerEmail = "canonical-cache-legacy@example.com";
  const tempCache = makeTempPreviewCacheEnv("canonical-preview-cache-legacy-");
  const file = {
    id: "canonical-cache-legacy",
    name: "canonical-cache-legacy.pdf",
    mimeType: "application/pdf",
    modifiedTime: "2026-04-19T12:00:00.000Z",
  };

  await clearPreviewAnalysisCacheForOwner(ownerEmail);

  try {
    const envelope = await analyzeTextContentWithEnvelope(
      file,
      `
Form 1099-DIV
Qualified dividends
Taxpayer copy
Christopher Bakken
Tax year 2025
`,
      {},
      "pdf_text",
      undefined,
      [],
      undefined,
      null,
      { analysisProfile: "legacy" },
    );

    assert.equal(envelope.canonical, null);

    await writePreviewAnalysisCache({
      analysisProfile: "legacy",
      ownerEmail,
      file,
      insight: envelope.legacyInsight,
      canonical: envelope.canonical,
      previewSnapshotId: null,
      analysisRanAt: "2026-04-19T12:01:00.000Z",
    });

    const cachedEntry = await readPreviewAnalysisCache({
      analysisProfile: "legacy",
      ownerEmail,
      file,
    });

    assert.ok(cachedEntry);
    assert.equal(cachedEntry.canonical, null);
    assert.equal(cachedEntry.canonicalDebug, null);
    assert.equal(cachedEntry.insight.documentTypeId, "tax_document");
    assert.ok(cachedEntry.insight.detectedClient);
  } finally {
    await clearPreviewAnalysisCacheForOwner(ownerEmail);
    tempCache.cleanup();
  }
});
