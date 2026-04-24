import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAccountStatementAICompletionRequest,
  parseAccountStatementWithAI,
  parseAccountStatementPayload,
  setAIPrimaryCompletionAdapterForTests,
} from "../lib/ai-primary-parser.ts";
import { normalizeAccountStatementCustodian } from "../lib/account-statement-ai-normalization.ts";
import { finalizeCanonicalExtractedDocument } from "../lib/canonical-extracted-document.ts";
import { analyzeTextContentWithEnvelope } from "../lib/document-intelligence.ts";
import { analyzeSyntheticDocument } from "./specialized-regression-helpers.mjs";

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

test("AI completion request includes richer raw entity schema alongside current Phase 1 fields", () => {
  const request = buildAccountStatementAICompletionRequest({
    contentSource: "pdf_text",
    diagnosticText:
      "U.S. Bank Smartly Checking Account Summary CHRISTOPHER T BAKKEN Account Number ending in 6642",
    file: {
      id: "request-schema-statement",
      mimeType: "application/pdf",
      name: "statement.pdf",
    },
    normalizedText:
      "U.S. Bank Smartly Checking Account Summary CHRISTOPHER T BAKKEN Account Number ending in 6642",
  });
  const userPrompt = JSON.parse(request.userPrompt);

  assert.match(request.systemPrompt, /structured data from likely account statements/i);
  assert.match(
    request.systemPrompt,
    /Preserve the current flat Phase 1 fields and also return richer raw entities/i,
  );
  assert.equal(request.promptVersion, "2026-04-14-account-statement-phase1-v1");
  assert.equal(userPrompt.file.id, "request-schema-statement");
  assert.equal(userPrompt.contentSource, "pdf_text");
  assert.equal(
    userPrompt.schema.documentTypeId,
    "account_statement | null",
  );
  assert.equal(userPrompt.schema.metadata.custodian, "string | null");
  assert.ok(Array.isArray(userPrompt.schema.parties));
  assert.equal(userPrompt.schema.parties[0].name, "string | null");
  assert.deepEqual(userPrompt.schema.parties[0].roles, [
    "owner | joint_owner | other",
  ]);
  assert.ok(Array.isArray(userPrompt.schema.institutions));
  assert.equal(userPrompt.schema.institutions[0].name, "string | null");
  assert.ok(Array.isArray(userPrompt.schema.contacts));
  assert.equal(
    userPrompt.schema.contacts[0].purpose,
    "customer_service | general_support | rollover_support | beneficiary_services | other | null",
  );
  assert.ok(Array.isArray(userPrompt.schema.accounts));
  assert.equal(
    userPrompt.schema.accounts[0].maskedAccountNumber,
    "string | null",
  );
  assert.ok(Array.isArray(userPrompt.schema.accountParties));
  assert.ok(Array.isArray(userPrompt.schema.dates));
  assert.equal(
    userPrompt.schema.dates[0].scope,
    "document | account | party | institution | accountParty | null",
  );
  assert.deepEqual(userPrompt.schema.documentFacts, {
    entityName: "string | null",
    idType: "string | null",
    taxYear: "string | null",
  });
});

test("AI payload parser accepts richer raw statement entities without dropping current flat fields", () => {
  const payload = parseAccountStatementPayload(
    JSON.stringify({
      documentTypeId: "account_statement",
      detectedClient: "Christopher T Bakken",
      detectedClient2: "Mary A Bakken",
      ownershipType: "joint",
      metadata: {
        custodian: "U.S. Bank National Association",
        accountType: "U.S. Bank Smartly Checking",
        accountLast4: "6642",
        documentDate: "2025-10-14",
      },
      confidence: {
        documentTypeId: 0.98,
        detectedClient: 0.96,
        detectedClient2: 0.93,
        ownershipType: 0.91,
        custodian: 0.95,
        accountType: 0.97,
        accountLast4: 0.92,
        documentDate: 0.94,
      },
      rawEvidenceSummary:
        "Joint owner block, account details, and statement dates are visible.",
      parties: [
        {
          id: "party-1",
          name: "Christopher T Bakken",
          roles: ["owner"],
          address: "N1345 Maple Hills Dr, Fontana WI 53125-1921",
        },
        {
          id: "party-2",
          name: "Mary A Bakken",
          roles: ["joint_owner"],
          address: null,
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
          value: "800-555-1212",
        },
      ],
      accounts: [
        {
          id: "account-1",
          institutionIds: ["institution-1"],
          accountNumber: "123456789012",
          maskedAccountNumber: "xxxxxxxx9012",
          accountLast4: "9012",
          accountType: "Checking",
          registrationType: "Joint",
          values: [
            {
              kind: "ending_balance",
              label: "Ending balance",
              money: {
                amount: "4321.09",
                currency: "USD",
              },
              dateId: "date-2",
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
        {
          id: "account-party-2",
          accountId: "account-1",
          partyId: "party-2",
          roles: ["joint_owner"],
        },
      ],
      dates: [
        {
          id: "date-1",
          kind: "statement_period_start",
          value: "2025-09-13",
          scope: "document",
          entityId: null,
        },
        {
          id: "date-2",
          kind: "statement_period_end",
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
  );

  assert.equal(payload.documentTypeId, "account_statement");
  assert.equal(payload.detectedClient, "Christopher T Bakken");
  assert.equal(payload.detectedClient2, "Mary A Bakken");
  assert.equal(payload.ownershipType, "joint");
  assert.equal(payload.metadata.accountType, "U.S. Bank Smartly Checking");
  assert.equal(payload.parties.length, 2);
  assert.deepEqual(payload.parties[1].roles, ["joint_owner"]);
  assert.equal(payload.institutions[0].name, "U.S. Bank National Association");
  assert.equal(payload.contacts[0].purpose, "customer_service");
  assert.equal(payload.accounts[0].maskedAccountNumber, "xxxxxxxx9012");
  assert.equal(payload.accounts[0].values[0].money.amount, "4321.09");
  assert.equal(payload.accountParties[1].partyId, "party-2");
  assert.equal(payload.dates[0].kind, "statement_period_start");
  assert.equal(payload.dates[1].value, "2025-10-14");
  assert.deepEqual(payload.documentFacts, {
    entityName: null,
    idType: null,
    taxYear: null,
  });
});

test("AI payload parser remains backward-compatible with the current narrow Phase 1 payload shape", () => {
  const payload = parseAccountStatementPayload(
    JSON.stringify({
      documentTypeId: "account_statement",
      detectedClient: "Christopher Bakken",
      detectedClient2: null,
      ownershipType: "single",
      metadata: {
        custodian: "Fidelity Investments",
        accountType: "Brokerage",
        accountLast4: "0456",
        documentDate: "2026-03-31",
      },
      confidence: {
        documentTypeId: 0.95,
        detectedClient: 0.92,
        detectedClient2: null,
        ownershipType: 0.88,
        custodian: 0.9,
        accountType: 0.89,
        accountLast4: 0.91,
        documentDate: 0.94,
      },
      rawEvidenceSummary: "Summary statement header and owner block are visible.",
    }),
  );

  assert.equal(payload.documentTypeId, "account_statement");
  assert.equal(payload.detectedClient, "Christopher Bakken");
  assert.equal(payload.metadata.custodian, "Fidelity Investments");
  assert.equal(payload.metadata.accountType, "Brokerage");
  assert.equal(payload.metadata.accountLast4, "0456");
  assert.equal(payload.metadata.documentDate, "2026-03-31");
  assert.deepEqual(payload.parties, []);
  assert.deepEqual(payload.institutions, []);
  assert.deepEqual(payload.contacts, []);
  assert.deepEqual(payload.accounts, []);
  assert.deepEqual(payload.accountParties, []);
  assert.deepEqual(payload.dates, []);
  assert.deepEqual(payload.documentFacts, {
    entityName: null,
    idType: null,
    taxYear: null,
  });
});

test("account-statement custodian normalization covers current canonical shortening rules and leaves unknown institutions unchanged", () => {
  assert.deepEqual(normalizeAccountStatementCustodian("The Vanguard Group, Inc."), {
    rawValue: "The Vanguard Group, Inc.",
    finalValue: "Vanguard",
    changed: true,
    ruleId: "vanguard_group",
  });
  assert.deepEqual(normalizeAccountStatementCustodian("Empower Retirement, LLC"), {
    rawValue: "Empower Retirement, LLC",
    finalValue: "Empower",
    changed: true,
    ruleId: "empower_retirement",
  });
  assert.deepEqual(
    normalizeAccountStatementCustodian("Jackson National Life Insurance Company"),
    {
      rawValue: "Jackson National Life Insurance Company",
      finalValue: "Jackson",
      changed: true,
      ruleId: "jackson_national_life",
    },
  );
  assert.deepEqual(normalizeAccountStatementCustodian("Charles Schwab & Co., Inc."), {
    rawValue: "Charles Schwab & Co., Inc.",
    finalValue: "Charles Schwab",
    changed: true,
    ruleId: "charles_schwab",
  });
  assert.deepEqual(normalizeAccountStatementCustodian("Harbor State Bank & Trust"), {
    rawValue: "Harbor State Bank & Trust",
    finalValue: "Harbor State Bank & Trust",
    changed: false,
    ruleId: null,
  });
});

test("internal parsed AI result carries richer parsed parties, contacts, accounts, dates, and document facts", async () => {
  setAIPrimaryCompletionAdapterForTests(async () => ({
    model: "test-model",
    rawText: JSON.stringify({
      documentTypeId: "account_statement",
      detectedClient: "Christopher T Bakken",
      detectedClient2: "Mary A Bakken",
      ownershipType: "joint",
      metadata: {
        custodian: "U.S. Bank National Association",
        accountType: "U.S. Bank Smartly Checking",
        accountLast4: "6642",
        documentDate: "2025-10-14",
      },
      confidence: {
        documentTypeId: 0.98,
        detectedClient: 0.96,
        detectedClient2: 0.91,
        ownershipType: 0.88,
        custodian: 0.95,
        accountType: 0.97,
        accountLast4: 0.93,
        documentDate: 0.94,
      },
      rawEvidenceSummary:
        "Owner block, service contacts, account details, and statement period are visible.",
      parties: [
        {
          id: "party-1",
          name: "Christopher T Bakken",
          roles: ["owner"],
          address: "N1345 Maple Hills Dr, Fontana WI 53125-1921",
        },
        {
          id: "party-2",
          name: "Mary A Bakken",
          roles: ["joint_owner"],
          address: null,
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
          value: "800-555-1212",
        },
        {
          id: "contact-2",
          institutionId: "institution-1",
          method: "website",
          purpose: "general_support",
          value: "www.usbank.com",
        },
      ],
      accounts: [
        {
          id: "account-1",
          institutionIds: ["institution-1"],
          accountNumber: "123456789012",
          maskedAccountNumber: "xxxxxxxx9012",
          accountLast4: "9012",
          accountType: "Checking",
          registrationType: "Joint",
          values: [
            {
              kind: "ending_balance",
              label: "Ending balance",
              money: {
                amount: "4321.09",
                currency: "USD",
              },
              dateId: "date-2",
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
        {
          id: "account-party-2",
          accountId: "account-1",
          partyId: "party-2",
          roles: ["joint_owner"],
        },
      ],
      dates: [
        {
          id: "date-1",
          kind: "statement_period_start",
          value: "2025-09-13",
          scope: "document",
          entityId: null,
        },
        {
          id: "date-2",
          kind: "statement_period_end",
          value: "2025-10-14",
          scope: "document",
          entityId: null,
        },
      ],
      documentFacts: {
        entityName: "The Bakken Household",
        idType: null,
        taxYear: "2025",
      },
    }),
  }));

  try {
    const attempt = await parseAccountStatementWithAI({
      contentSource: "pdf_text",
      diagnosticText:
        "U.S. Bank Smartly Checking Account Summary CHRISTOPHER T BAKKEN",
      file: {
        id: "rich-result-statement",
        mimeType: "application/pdf",
        name: "statement.pdf",
      },
      normalizedText:
        "U.S. Bank Smartly Checking Account Summary CHRISTOPHER T BAKKEN",
    });

    assert.ok(attempt.parsedResult);
    assert.equal(attempt.parsedResult.values.documentTypeId, "account_statement");
    assert.equal(attempt.parsedResult.extracted.parties.length, 2);
    assert.deepEqual(attempt.parsedResult.extracted.parties[1].roles, [
      "joint_owner",
    ]);
    assert.equal(attempt.parsedResult.extracted.contacts[0].purpose, "customer_service");
    assert.equal(
      attempt.parsedResult.extracted.accounts[0].maskedAccountNumber,
      "xxxxxxxx9012",
    );
    assert.equal(
      attempt.parsedResult.extracted.accounts[0].values[0].money.amount,
      "4321.09",
    );
    assert.equal(
      attempt.parsedResult.extracted.accountParties[1].partyId,
      "party-2",
    );
    assert.equal(
      attempt.parsedResult.extracted.dates[0].kind,
      "statement_period_start",
    );
    assert.deepEqual(attempt.parsedResult.extracted.documentFacts, {
      entityName: "The Bakken Household",
      idType: null,
      taxYear: "2025",
    });
  } finally {
    setAIPrimaryCompletionAdapterForTests(null);
  }
});

test("internal parsed AI result drops malformed richer fields safely", async () => {
  setAIPrimaryCompletionAdapterForTests(async () => ({
    model: "test-model",
    rawText: JSON.stringify({
      documentTypeId: "account_statement",
      detectedClient: "Christopher Bakken",
      detectedClient2: null,
      ownershipType: "single",
      metadata: {
        custodian: "Fidelity Investments",
        accountType: "Brokerage",
        accountLast4: "0456",
        documentDate: "2026-03-31",
      },
      confidence: {
        documentTypeId: 0.95,
        detectedClient: 0.92,
        detectedClient2: null,
        ownershipType: 0.88,
        custodian: 0.9,
        accountType: 0.89,
        accountLast4: 0.91,
        documentDate: 0.94,
      },
      rawEvidenceSummary: "Header and account summary are visible.",
      parties: [
        null,
        {
          id: "party-1",
          name: "Christopher Bakken",
          roles: ["owner", "bogus_role"],
          address: "  ",
        },
        {
          id: null,
          name: "   ",
          roles: [],
          address: null,
        },
      ],
      contacts: [
        {
          id: "contact-1",
          institutionId: null,
          method: "fax",
          purpose: "strange_purpose",
          value: " ",
        },
        {
          id: null,
          institutionId: null,
          method: null,
          purpose: null,
          value: null,
        },
      ],
      accounts: [
        {
          id: "account-1",
          institutionIds: ["institution-1", 9, null],
          accountNumber: "  ",
          maskedAccountNumber: "xxxxxxxx0456",
          accountLast4: "0456",
          accountType: "Brokerage",
          registrationType: null,
          values: [
            {
              kind: "market_value",
              label: "Market Value",
              money: {
                amount: "50000.00",
                currency: "USD",
              },
              dateId: "date-2",
            },
            {
              kind: null,
              label: null,
              money: null,
              dateId: null,
            },
          ],
        },
        {
          id: null,
          institutionIds: [],
          accountNumber: null,
          maskedAccountNumber: null,
          accountLast4: null,
          accountType: null,
          registrationType: null,
          values: [],
        },
      ],
      accountParties: [
        {
          id: "account-party-1",
          accountId: "account-1",
          partyId: "party-1",
          roles: ["owner", "wrong"],
        },
        {
          id: null,
          accountId: null,
          partyId: null,
          roles: [],
        },
      ],
      dates: [
        {
          id: "date-1",
          kind: "statement_period_start",
          value: "2026-02-30",
          scope: "document",
          entityId: null,
        },
        {
          id: "date-2",
          kind: "document_date",
          value: "2026-03-31",
          scope: "document",
          entityId: null,
        },
        {
          id: null,
          kind: "weird_kind",
          value: "not-a-date",
          scope: "strange_scope",
          entityId: null,
        },
      ],
      documentFacts: {
        entityName: "  ",
        idType: 99,
        taxYear: "20A6",
      },
    }),
  }));

  try {
    const attempt = await parseAccountStatementWithAI({
      contentSource: "pdf_text",
      diagnosticText: "Fidelity Investments Account Summary Christopher Bakken",
      file: {
        id: "malformed-rich-result-statement",
        mimeType: "application/pdf",
        name: "statement.pdf",
      },
      normalizedText: "Fidelity Investments Account Summary Christopher Bakken",
    });

    assert.ok(attempt.parsedResult);
    assert.equal(attempt.parsedResult.values.documentTypeId, "account_statement");
    assert.equal(attempt.parsedResult.extracted.parties.length, 1);
    assert.deepEqual(attempt.parsedResult.extracted.parties[0].roles, ["owner"]);
    assert.equal(attempt.parsedResult.extracted.contacts.length, 1);
    assert.equal(attempt.parsedResult.extracted.contacts[0].method, null);
    assert.equal(attempt.parsedResult.extracted.contacts[0].purpose, null);
    assert.equal(attempt.parsedResult.extracted.accounts.length, 1);
    assert.deepEqual(
      attempt.parsedResult.extracted.accounts[0].institutionIds,
      ["institution-1"],
    );
    assert.equal(attempt.parsedResult.extracted.accounts[0].values.length, 1);
    assert.equal(attempt.parsedResult.extracted.accountParties.length, 1);
    assert.deepEqual(attempt.parsedResult.extracted.accountParties[0].roles, [
      "owner",
    ]);
    assert.equal(attempt.parsedResult.extracted.dates.length, 2);
    assert.equal(attempt.parsedResult.extracted.dates[0].value, null);
    assert.equal(attempt.parsedResult.extracted.dates[1].value, "2026-03-31");
    assert.deepEqual(attempt.parsedResult.extracted.documentFacts, {
      entityName: null,
      idType: null,
      taxYear: null,
    });
  } finally {
    setAIPrimaryCompletionAdapterForTests(null);
  }
});

test("AI mode off preserves legacy account-statement behavior", async () => {
  const restoreEnv = withEnv({
    AI_PRIMARY_PARSER: "false",
    AI_PRIMARY_ACCOUNT_STATEMENT_ONLY: "true",
  });
  let adapterCalls = 0;
  setAIPrimaryCompletionAdapterForTests(async () => {
    adapterCalls += 1;
    return {
      model: "test-model",
      rawText: "{}",
    };
  });

  try {
    const { insight } = await analyzeSyntheticDocument({
      id: "ai-off-statement",
      name: "legacy-statement.pdf",
      mimeType: "application/pdf",
      analysisMode: "preview",
      text: `
Fidelity
Account Summary
Christopher Bakken
Account Number ending in x0456
Statement Period January 1, 2026 to March 31, 2026
Roth IRA
`,
    });

    assert.equal(adapterCalls, 0);
    assert.equal(insight.documentTypeId, "account_statement");
    assert.equal(insight.detectedClient, "Christopher Bakken");
    assert.equal(insight.metadata.accountLast4, "0456");
    assert.equal(insight.debug.aiEnabled, false);
    assert.equal(insight.debug.aiAttempted, false);
    assert.equal(insight.debug.aiUsed, false);
  } finally {
    setAIPrimaryCompletionAdapterForTests(null);
    restoreEnv();
  }
});

test("AI mode on keeps legacy client naming authority and normalizes AI statement fields", async () => {
  const restoreEnv = withEnv({
    AI_PRIMARY_PARSER: "true",
    AI_PRIMARY_ACCOUNT_STATEMENT_ONLY: "true",
  });
  setAIPrimaryCompletionAdapterForTests(async () => ({
    model: "test-model",
    rawText: JSON.stringify({
      documentTypeId: "account_statement",
      detectedClient: "Christopher Theodore Bakken",
      detectedClient2: "Mary Bakken",
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
        detectedClient2: 0.91,
        ownershipType: 0.88,
        custodian: 0.95,
        accountType: 0.97,
        accountLast4: 0.93,
        documentDate: 0.94,
      },
      rawEvidenceSummary:
        "Owner block shows Christopher T Bakken; statement header shows U.S. Bank Smartly Checking ending in 6642.",
      parties: [
        {
          id: "party-1",
          name: "Christopher Theodore Bakken",
          roles: ["owner"],
          address: "N1345 MAPLE HILLS DR, FONTANA WI 53125-1921",
        },
        {
          id: "party-2",
          name: "Mary Bakken",
          roles: ["other"],
          address: null,
        },
      ],
      institutions: [
        {
          id: "institution-1",
          name: "U.S. Bank National Association",
        },
      ],
      accounts: [
        {
          id: "account-1",
          institutionIds: ["institution-1"],
          accountNumber: "123450006642",
          maskedAccountNumber: "xxxxxxxx6642",
          accountLast4: "6642",
          accountType: "U.S. Bank Smartly Checking",
          registrationType: "Individual",
          values: [],
        },
      ],
      accountParties: [
        {
          id: "account-1-party-1",
          accountId: "account-1",
          partyId: "party-1",
          roles: ["owner"],
        },
      ],
      dates: [
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

  try {
    const { insight, filename } = await analyzeSyntheticDocument({
      id: "ai-on-statement",
      name: "ai-statement.pdf",
      mimeType: "application/pdf",
      analysisMode: "preview",
      text: `
U.S. BANK SMARTLY CHECKING
Account Summary
CHRISTOPHER T BAKKEN
N1345 MAPLE HILLS DR
FONTANA WI 53125-1921
Account Number ending in ...6642
Statement Period Sep 13, 2025 through Oct 14, 2025
`,
    });

    assert.equal(insight.documentTypeId, "account_statement");
    assert.equal(insight.detectedClient, "Christopher T Bakken");
    assert.equal(insight.detectedClient2, null);
    assert.equal(insight.ownershipType, "single");
    assert.equal(insight.metadata.custodian, "U.S. Bank");
    assert.equal(insight.metadata.accountType, "Checking");
    assert.equal(insight.metadata.accountLast4, "6642");
    assert.equal(insight.metadata.documentDate, "2025-10-14");
    assert.equal(insight.debug.aiRawDetectedClient, "Christopher Theodore Bakken");
    assert.equal(insight.debug.aiRawDetectedClient2, "Mary Bakken");
    assert.equal(
      insight.debug.aiRawCustodian,
      "U.S. Bank National Association",
    );
    assert.equal(
      insight.debug.aiRawAccountType,
      "U.S. Bank Smartly Checking",
    );
    assert.equal(insight.debug.custodianWasNormalized, true);
    assert.equal(insight.debug.accountTypeWasNormalized, true);
    assert.equal(insight.debug.aiEnabled, true);
    assert.equal(insight.debug.aiAttempted, true);
    assert.equal(insight.debug.aiUsed, true);
    assert.equal(insight.debug.aiModel, "test-model");
    assert.equal(insight.debug.fieldOwnership.documentTypeId?.owner, "ai");
    assert.equal(insight.debug.fieldOwnership.detectedClient?.owner, "logic");
    assert.equal(insight.debug.fieldOwnership.custodian?.owner, "logic");
    assert.equal(insight.debug.fieldOwnership.accountType?.owner, "logic");
    assert.equal(filename, "Bakken_Christopher_Statement_Checking_x6642.pdf");
  } finally {
    setAIPrimaryCompletionAdapterForTests(null);
    restoreEnv();
  }
});

test("AI mode falls back safely when the AI response is malformed", async () => {
  const restoreEnv = withEnv({
    AI_PRIMARY_PARSER: "true",
    AI_PRIMARY_ACCOUNT_STATEMENT_ONLY: "true",
  });
  setAIPrimaryCompletionAdapterForTests(async () => ({
    model: "test-model",
    rawText: "{not valid json",
  }));

  try {
    const { insight } = await analyzeSyntheticDocument({
      id: "ai-malformed-statement",
      name: "malformed-statement.pdf",
      mimeType: "application/pdf",
      analysisMode: "preview",
      text: `
Fidelity
Account Summary
Christopher Bakken
Account Number ending in x0456
Statement Period January 1, 2026 to March 31, 2026
Roth IRA
`,
    });

    assert.equal(insight.documentTypeId, "account_statement");
    assert.equal(insight.detectedClient, "Christopher Bakken");
    assert.equal(insight.metadata.accountLast4, "0456");
    assert.equal(insight.metadata.documentDate, "2026-03-31");
    assert.equal(insight.debug.aiEnabled, true);
    assert.equal(insight.debug.aiAttempted, true);
    assert.equal(insight.debug.aiUsed, false);
    assert.ok(insight.debug.aiFailureReason);
  } finally {
    setAIPrimaryCompletionAdapterForTests(null);
    restoreEnv();
  }
});

test("AI provider transport errors retry once and can still succeed", async () => {
  const restoreEnv = withEnv({
    AI_PRIMARY_PARSER: "true",
    AI_PRIMARY_ACCOUNT_STATEMENT_ONLY: "true",
    OPENAI_API_KEY: "test-key",
    AI_PRIMARY_PARSER_MODEL: "gpt-4.1-mini",
  });
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    if (fetchCalls === 1) {
      throw new TypeError("fetch failed", {
        cause: {
          code: "ECONNRESET",
          message: "socket hang up",
        },
      });
    }

    return new Response(
      JSON.stringify({
        model: "test-model",
        choices: [
          {
            message: {
              content: JSON.stringify({
                documentTypeId: "account_statement",
                detectedClient: "Christopher Bakken",
                detectedClient2: null,
                ownershipType: "single",
                metadata: {
                  custodian: "Fidelity Investments",
                  accountType: "Roth IRA",
                  accountLast4: "0456",
                  documentDate: "2026-03-31",
                },
                confidence: {
                  documentTypeId: 0.95,
                  detectedClient: 0.92,
                  detectedClient2: null,
                  ownershipType: 0.88,
                  custodian: 0.91,
                  accountType: 0.89,
                  accountLast4: 0.9,
                  documentDate: 0.93,
                },
                rawEvidenceSummary: "Header and owner block match a Fidelity statement.",
              }),
            },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  };

  try {
    const { insight } = await analyzeSyntheticDocument({
      id: "ai-retry-statement",
      name: "retry-statement.pdf",
      mimeType: "application/pdf",
      analysisMode: "preview",
      text: `
Fidelity Investments
Account Summary
Christopher Bakken
Account Number ending in x0456
Statement Period January 1, 2026 to March 31, 2026
Roth IRA
`,
    });

    assert.equal(fetchCalls, 2);
    assert.equal(insight.documentTypeId, "account_statement");
    assert.equal(insight.metadata.custodian, "Fidelity");
    assert.equal(insight.metadata.accountType, "Roth IRA");
    assert.equal(insight.metadata.accountLast4, "0456");
    assert.equal(insight.debug.aiAttempted, true);
    assert.equal(insight.debug.aiUsed, true);
    assert.equal(insight.debug.aiFailureReason, null);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("AI provider failures now expose transport diagnostics", async () => {
  const restoreEnv = withEnv({
    AI_PRIMARY_PARSER: "true",
    AI_PRIMARY_ACCOUNT_STATEMENT_ONLY: "true",
    OPENAI_API_KEY: "test-key",
    AI_PRIMARY_PARSER_MODEL: "gpt-4.1-mini",
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed", {
      cause: {
        code: "ENOTFOUND",
        message: "getaddrinfo ENOTFOUND api.openai.com",
      },
    });
  };

  try {
    const { insight } = await analyzeSyntheticDocument({
      id: "ai-network-failure-statement",
      name: "network-failure-statement.pdf",
      mimeType: "application/pdf",
      analysisMode: "preview",
      text: `
Fidelity Investments
Account Summary
Christopher Bakken
Account Number ending in x0456
Statement Period January 1, 2026 to March 31, 2026
Roth IRA
`,
    });

    assert.equal(insight.documentTypeId, "account_statement");
    assert.equal(insight.detectedClient, "Christopher Bakken");
    assert.equal(insight.debug.aiAttempted, true);
    assert.equal(insight.debug.aiUsed, false);
    assert.match(
      insight.debug.aiFailureReason ?? "",
      /attempt 2\/2 .*api\.openai\.com.*ENOTFOUND.*getaddrinfo/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("AI mode skips non-statement documents", async () => {
  const restoreEnv = withEnv({
    AI_PRIMARY_PARSER: "true",
    AI_PRIMARY_ACCOUNT_STATEMENT_ONLY: "true",
  });
  let adapterCalls = 0;
  setAIPrimaryCompletionAdapterForTests(async () => {
    adapterCalls += 1;
    return {
      model: "test-model",
      rawText: "{}",
    };
  });

  try {
    const { insight } = await analyzeSyntheticDocument({
      id: "ai-skip-tax-doc",
      name: "tax-form.pdf",
      mimeType: "application/pdf",
      analysisMode: "preview",
      text: `
Form 1099-DIV
Qualified dividends
Taxpayer copy
Christopher Bakken
Tax year 2025
`,
    });

    assert.equal(adapterCalls, 0);
    assert.equal(insight.documentTypeId, "tax_document");
    assert.equal(insight.debug.aiEnabled, true);
    assert.equal(insight.debug.aiAttempted, false);
    assert.equal(insight.debug.aiUsed, false);
    assert.match(
      insight.debug.aiFailureReason ?? "",
      /Phase 1 AI parser only runs for likely account statements/i,
    );
  } finally {
    setAIPrimaryCompletionAdapterForTests(null);
    restoreEnv();
  }
});

test("AI validation repairs bad last4 and nulls invalid dates conservatively", async () => {
  const restoreEnv = withEnv({
    AI_PRIMARY_PARSER: "true",
    AI_PRIMARY_ACCOUNT_STATEMENT_ONLY: "true",
  });
  setAIPrimaryCompletionAdapterForTests(async () => ({
    model: "test-model",
    rawText: JSON.stringify({
      documentTypeId: "account_statement",
      detectedClient: "Christopher Bakken",
      detectedClient2: null,
      ownershipType: "single",
      metadata: {
        custodian: "Fidelity",
        accountType: "Brokerage",
        accountLast4: "Account number 12345678",
        documentDate: "not-a-date",
      },
      confidence: {
        documentTypeId: 0.9,
        detectedClient: 0.92,
        detectedClient2: null,
        ownershipType: 0.88,
        custodian: 0.91,
        accountType: 0.84,
        accountLast4: 0.75,
        documentDate: 0.62,
      },
      rawEvidenceSummary: "Statement header and account ending are visible.",
    }),
  }));

  try {
    const { insight } = await analyzeSyntheticDocument({
      id: "ai-validated-statement",
      name: "validated-statement.pdf",
      mimeType: "application/pdf",
      analysisMode: "preview",
      text: `
Monthly Statement
Account Summary
Christopher Bakken
Brokerage Account
`,
    });

    assert.equal(insight.documentTypeId, "account_statement");
    assert.equal(insight.metadata.accountLast4, "5678");
    assert.equal(insight.metadata.documentDate, null);
    assert.equal(insight.debug.fieldOwnership.accountLast4?.owner, "logic");
    assert.equal(insight.debug.fieldOwnership.documentDate?.owner, "logic");
  } finally {
    setAIPrimaryCompletionAdapterForTests(null);
    restoreEnv();
  }
});

test("preview AI statement path produces canonical first and preserves legacy compatibility output", async () => {
  const restoreEnv = withEnv({
    AI_PRIMARY_PARSER: "true",
    AI_PRIMARY_ACCOUNT_STATEMENT_ONLY: "true",
  });
  setAIPrimaryCompletionAdapterForTests(async () => ({
    model: "test-model",
    rawText: JSON.stringify({
      documentTypeId: "account_statement",
      detectedClient: "Christopher Theodore Bakken",
      detectedClient2: "Mary Bakken",
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
        detectedClient2: 0.91,
        ownershipType: 0.88,
        custodian: 0.95,
        accountType: 0.97,
        accountLast4: 0.93,
        documentDate: 0.94,
      },
      rawEvidenceSummary:
        "Owner block shows Christopher T Bakken; statement header shows U.S. Bank Smartly Checking ending in 6642.",
      parties: [
        {
          id: "party-1",
          name: "Christopher Theodore Bakken",
          roles: ["owner"],
          address: "N1345 MAPLE HILLS DR, FONTANA WI 53125-1921",
        },
        {
          id: "party-2",
          name: "Mary Bakken",
          roles: ["other"],
          address: null,
        },
      ],
      institutions: [
        {
          id: "institution-1",
          name: "U.S. Bank National Association",
        },
      ],
      accounts: [
        {
          id: "account-1",
          institutionIds: ["institution-1"],
          accountNumber: "123450006642",
          maskedAccountNumber: "xxxxxxxx6642",
          accountLast4: "6642",
          accountType: "U.S. Bank Smartly Checking",
          registrationType: "Individual",
          values: [],
        },
      ],
      accountParties: [
        {
          id: "account-1-party-1",
          accountId: "account-1",
          partyId: "party-1",
          roles: ["owner"],
        },
      ],
      dates: [
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

  try {
    const file = {
      id: "canonical-ai-statement",
      name: "canonical-ai-statement.pdf",
      mimeType: "application/pdf",
      modifiedTime: "2026-04-12T10:00:00.000Z",
    };
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
    assert.equal(
      envelope.canonical.classification.normalized.documentTypeId,
      "account_statement",
    );
    assert.equal(
      envelope.canonical.extracted.parties[0]?.displayName,
      "Christopher Theodore Bakken",
    );
    assert.equal(
      envelope.canonical.extracted.institutions[0]?.name,
      "U.S. Bank National Association",
    );
    assert.equal(
      envelope.canonical.extracted.accounts[0]?.accountNumber,
      "123450006642",
    );
    assert.equal(
      envelope.canonical.extracted.accountParties[0]?.partyId,
      "party-1",
    );
    assert.equal(
      envelope.canonical.normalized.primaryFacts.detectedClient,
      "Christopher T Bakken",
    );
    assert.equal(
      envelope.canonical.normalized.accounts[0]?.accountType,
      "Checking",
    );
    assert.equal(
      envelope.canonical.normalized.institutions[0]?.name,
      "U.S. Bank",
    );
    assert.ok(
      envelope.canonical.provenance.normalization.some(
        (entry) =>
          entry.fieldPath === "normalized.institutions[0].name" &&
          entry.finalValue === "U.S. Bank",
      ),
    );
    assert.ok(
      envelope.canonical.provenance.normalization.some(
        (entry) =>
          entry.fieldPath === "normalized.accounts[0].accountType" &&
          entry.finalValue === "Checking",
      ),
    );
    assert.ok(envelope.canonical.provenance.sourceRefs.length >= 5);
    assert.equal(envelope.legacyInsight.documentTypeId, "account_statement");
    assert.equal(envelope.legacyInsight.detectedClient, "Christopher T Bakken");
    assert.equal(envelope.legacyInsight.metadata.custodian, "U.S. Bank");
    assert.equal(envelope.legacyInsight.metadata.accountType, "Checking");
    assert.equal(envelope.legacyInsight.metadata.accountLast4, "6642");
  } finally {
    setAIPrimaryCompletionAdapterForTests(null);
    restoreEnv();
  }
});

test("preview AI statement canonical path preserves full raw U.S. Bank institution name from the statement header when AI returns a shortened name", async () => {
  const restoreEnv = withEnv({
    AI_PRIMARY_PARSER: "true",
    AI_PRIMARY_ACCOUNT_STATEMENT_ONLY: "true",
  });
  setAIPrimaryCompletionAdapterForTests(async () => ({
    model: "test-model",
    rawText: JSON.stringify({
      documentTypeId: "account_statement",
      detectedClient: "Christopher T Bakken",
      detectedClient2: null,
      ownershipType: "single",
      metadata: {
        custodian: "U.S. Bank",
        accountType: "Checking",
        accountLast4: "6642",
        documentDate: "2025-10-14",
      },
      confidence: {
        documentTypeId: 0.97,
        detectedClient: 0.95,
        detectedClient2: null,
        ownershipType: 0.9,
        custodian: 0.93,
        accountType: 0.94,
        accountLast4: 0.91,
        documentDate: 0.92,
      },
      rawEvidenceSummary:
        "Retail bank statement header identifies U.S. Bank and the owner block.",
      parties: [
        {
          id: "party-1",
          name: "Christopher T Bakken",
          roles: ["owner"],
          address: "N1345 MAPLE HILLS DR, FONTANA WI 53125-1921",
        },
      ],
      institutions: [
        {
          id: "institution-1",
          name: "U.S. Bank",
        },
      ],
      accounts: [
        {
          id: "account-1",
          institutionIds: ["institution-1"],
          accountNumber: "123450006642",
          maskedAccountNumber: "xxxxxxxx6642",
          accountLast4: "6642",
          accountType: "Checking",
          registrationType: "Individual",
          values: [],
        },
      ],
      accountParties: [
        {
          id: "account-1-party-1",
          accountId: "account-1",
          partyId: "party-1",
          roles: ["owner"],
        },
      ],
      dates: [
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

  try {
    const envelope = await analyzeTextContentWithEnvelope(
      {
        id: "canonical-ai-us-bank-raw-institution",
        name: "canonical-ai-us-bank-raw-institution.pdf",
        mimeType: "application/pdf",
        modifiedTime: "2026-04-20T16:00:00.000Z",
      },
      `
U.S. Bank National Association
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
    assert.equal(
      envelope.canonical.extracted.institutions[0]?.rawName,
      "U.S. Bank National Association",
    );
    assert.equal(
      envelope.canonical.normalized.institutions[0]?.name,
      "U.S. Bank",
    );
    assert.equal(
      envelope.canonical.normalized.primaryFacts.custodian,
      "U.S. Bank",
    );
  } finally {
    setAIPrimaryCompletionAdapterForTests(null);
    restoreEnv();
  }
});

test("preview AI statement canonical path preserves full raw Fidelity institution name from the statement header while deriving normalized custodian from normalized institutions", async () => {
  const restoreEnv = withEnv({
    AI_PRIMARY_PARSER: "true",
    AI_PRIMARY_ACCOUNT_STATEMENT_ONLY: "true",
  });
  setAIPrimaryCompletionAdapterForTests(async () => ({
    model: "test-model",
    rawText: JSON.stringify({
      documentTypeId: "account_statement",
      detectedClient: "Samuel J Lee",
      detectedClient2: null,
      ownershipType: "single",
      metadata: {
        custodian: "Fidelity",
        accountType: null,
        accountLast4: null,
        documentDate: "2026-03-31",
      },
      confidence: {
        documentTypeId: 0.98,
        detectedClient: 0.96,
        detectedClient2: null,
        ownershipType: 0.9,
        custodian: 0.94,
        accountType: null,
        accountLast4: null,
        documentDate: 0.93,
      },
      rawEvidenceSummary:
        "Portfolio summary header identifies Fidelity and a single owner.",
      parties: [
        {
          id: "party-1",
          name: "Samuel J Lee",
          roles: ["owner"],
          address: "2410 JUNIPER RIDGE AVE, MADISON WI 53705",
        },
      ],
      institutions: [
        {
          id: "institution-1",
          name: "Fidelity",
        },
      ],
      accounts: [
        {
          id: "account-1",
          institutionIds: ["institution-1"],
          accountNumber: "321654987788",
          maskedAccountNumber: "xxxxxxxx7788",
          accountLast4: "7788",
          accountType: "Roth IRA",
          registrationType: "Individual retirement account",
          values: [],
        },
      ],
      accountParties: [
        {
          id: "account-1-party-1",
          accountId: "account-1",
          partyId: "party-1",
          roles: ["owner"],
        },
      ],
      dates: [
        {
          id: "date-document",
          kind: "document_date",
          value: "2026-03-31",
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

  try {
    const envelope = await analyzeTextContentWithEnvelope(
      {
        id: "canonical-ai-fidelity-raw-institution",
        name: "canonical-ai-fidelity-raw-institution.pdf",
        mimeType: "application/pdf",
        modifiedTime: "2026-04-20T16:05:00.000Z",
      },
      `
Fidelity Investments
Portfolio Summary
SAMUEL J LEE
2410 JUNIPER RIDGE AVE
MADISON WI 53705
Statement Period January 1, 2026 to March 31, 2026
Roth IRA
Account Number 321654987788
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
    assert.equal(
      envelope.canonical.extracted.institutions[0]?.rawName,
      "Fidelity Investments",
    );
    assert.equal(
      envelope.canonical.normalized.institutions[0]?.name,
      "Fidelity",
    );
    assert.equal(
      envelope.canonical.normalized.primaryFacts.custodian,
      "Fidelity",
    );
    assert.equal(envelope.legacyInsight.metadata.custodian, "Fidelity");
  } finally {
    setAIPrimaryCompletionAdapterForTests(null);
    restoreEnv();
  }
});

test("preview AI statement canonical path backfills extracted and normalized parties from the deterministic statement owner when AI omits party names", async () => {
  const restoreEnv = withEnv({
    AI_PRIMARY_PARSER: "true",
    AI_PRIMARY_ACCOUNT_STATEMENT_ONLY: "true",
  });
  setAIPrimaryCompletionAdapterForTests(async () => ({
    model: "test-model",
    rawText: JSON.stringify({
      documentTypeId: "account_statement",
      detectedClient: null,
      detectedClient2: null,
      ownershipType: "single",
      metadata: {
        custodian: "Fidelity Investments",
        accountType: null,
        accountLast4: null,
        documentDate: "2026-03-31",
      },
      confidence: {
        documentTypeId: 0.97,
        detectedClient: null,
        detectedClient2: null,
        ownershipType: 0.89,
        custodian: 0.93,
        accountType: null,
        accountLast4: null,
        documentDate: 0.91,
      },
      rawEvidenceSummary:
        "Fidelity portfolio summary with a visible single-owner header and statement period.",
      parties: [],
      institutions: [
        {
          id: "institution-1",
          name: "Fidelity Investments",
        },
      ],
      accounts: [
        {
          id: "account-1",
          institutionIds: ["institution-1"],
          accountNumber: "321654987788",
          maskedAccountNumber: "xxxxxxxx7788",
          accountLast4: "7788",
          accountType: "Brokerage",
          registrationType: "Individual",
          values: [],
        },
        {
          id: "account-2",
          institutionIds: ["institution-1"],
          accountNumber: "321654987799",
          maskedAccountNumber: "xxxxxxxx7799",
          accountLast4: "7799",
          accountType: "Roth IRA",
          registrationType: "Individual retirement account",
          values: [],
        },
      ],
      accountParties: [],
      dates: [
        {
          id: "date-document",
          kind: "document_date",
          value: "2026-03-31",
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

  try {
    const envelope = await analyzeTextContentWithEnvelope(
      {
        id: "canonical-ai-fidelity-owner-fallback",
        name: "canonical-ai-fidelity-owner-fallback.pdf",
        mimeType: "application/pdf",
        modifiedTime: "2026-04-20T19:05:00.000Z",
      },
      `
Fidelity Investments
Portfolio Summary
Account owner Samuel J Lee
2410 JUNIPER RIDGE AVE
MADISON WI 53705
Statement Period January 1, 2026 to March 31, 2026
Brokerage
Roth IRA
Synthetic statement for parser testing only. Fidelity multi-account summary | Brokerage and Roth IRA.
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
    assert.deepEqual(
      envelope.canonical.extracted.parties.map((party) => party.rawName),
      ["Samuel J Lee"],
    );
    assert.deepEqual(
      envelope.canonical.normalized.parties.map((party) => party.displayName),
      ["Samuel J Lee"],
    );
    assert.equal(
      envelope.canonical.normalized.primaryFacts.detectedClient,
      "Samuel J Lee",
    );
    assert.equal(envelope.legacyInsight.detectedClient, "Samuel J Lee");
    assert.notEqual(
      envelope.canonical.normalized.primaryFacts.detectedClient,
      "Parser Testing Only Fidelity",
    );
  } finally {
    setAIPrimaryCompletionAdapterForTests(null);
    restoreEnv();
  }
});

test("preview AI statement canonical path keeps richer statement documentFacts while leaving primaryFacts entityName and taxYear null", async () => {
  const restoreEnv = withEnv({
    AI_PRIMARY_PARSER: "true",
    AI_PRIMARY_ACCOUNT_STATEMENT_ONLY: "true",
  });
  setAIPrimaryCompletionAdapterForTests(async () => ({
    model: "test-model",
    rawText: JSON.stringify({
      documentTypeId: "account_statement",
      detectedClient: "Marcus D Holloway",
      detectedClient2: null,
      ownershipType: "single",
      metadata: {
        custodian: "Empower Retirement, LLC",
        accountType: "401(k)",
        accountLast4: "4455",
        documentDate: "2026-03-31",
      },
      confidence: {
        documentTypeId: 0.98,
        detectedClient: 0.95,
        detectedClient2: null,
        ownershipType: 0.91,
        custodian: 0.94,
        accountType: 0.93,
        accountLast4: 0.92,
        documentDate: 0.94,
      },
      rawEvidenceSummary:
        "Retirement statement header includes the institution legal name and a plan-year reference.",
      parties: [
        {
          id: "party-1",
          name: "Marcus D Holloway",
          roles: ["owner"],
          address: "3901 PRAIRIE STONE RD, OMAHA NE 68144",
        },
      ],
      institutions: [
        {
          id: "institution-1",
          name: "Empower Retirement, LLC",
        },
      ],
      accounts: [
        {
          id: "account-1",
          institutionIds: ["institution-1"],
          accountNumber: "661122334455",
          maskedAccountNumber: "xxxxxxxx4455",
          accountLast4: "4455",
          accountType: "401(k)",
          registrationType: "Employer-sponsored retirement plan",
          values: [],
        },
      ],
      accountParties: [
        {
          id: "account-1-party-1",
          accountId: "account-1",
          partyId: "party-1",
          roles: ["owner"],
        },
      ],
      dates: [
        {
          id: "date-document",
          kind: "document_date",
          value: "2026-03-31",
          scope: "document",
          entityId: null,
        },
      ],
      documentFacts: {
        entityName: "Empower Retirement, LLC",
        idType: null,
        taxYear: "2025",
      },
    }),
  }));

  try {
    const envelope = await analyzeTextContentWithEnvelope(
      {
        id: "canonical-ai-statement-primaryfacts-leakage",
        name: "canonical-ai-statement-primaryfacts-leakage.pdf",
        mimeType: "application/pdf",
        modifiedTime: "2026-04-21T01:05:00.000Z",
      },
      `
EMPOWER RETIREMENT, LLC
Marcus D Holloway
3901 PRAIRIE STONE RD
OMAHA NE 68144
Statement Period January 1, 2026 to March 31, 2026
Plan year 2025
401(k)
Account Number ending in x4455
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
    assert.equal(
      envelope.canonical.normalized.documentFacts.entityName,
      "Empower Retirement, LLC",
    );
    assert.equal(envelope.canonical.normalized.documentFacts.taxYear, "2025");
    assert.equal(envelope.canonical.normalized.primaryFacts.entityName, null);
    assert.equal(envelope.canonical.normalized.primaryFacts.taxYear, null);
    assert.equal(envelope.legacyInsight.metadata.entityName, null);
    assert.equal(envelope.legacyInsight.metadata.taxYear, null);
  } finally {
    setAIPrimaryCompletionAdapterForTests(null);
    restoreEnv();
  }
});

test("preview AI statement canonical path enriches addresses, contacts, dates, values, and full account number safely", async () => {
  const restoreEnv = withEnv({
    AI_PRIMARY_PARSER: "true",
    AI_PRIMARY_ACCOUNT_STATEMENT_ONLY: "true",
  });
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
        accountLast4: "9012",
        documentDate: "2025-10-14",
      },
      confidence: {
        documentTypeId: 0.98,
        detectedClient: 0.96,
        detectedClient2: null,
        ownershipType: 0.9,
        custodian: 0.95,
        accountType: 0.97,
        accountLast4: 0.93,
        documentDate: 0.94,
      },
      rawEvidenceSummary:
        "Owner block and full account number are visible on the statement header.",
      parties: [
        {
          id: "party-1",
          name: "Christopher Theodore Bakken",
          roles: ["owner"],
          address: "N1345 MAPLE HILLS DR, FONTANA WI 53125-1921",
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
          value: "800-555-1212",
        },
        {
          id: "contact-2",
          institutionId: "institution-1",
          method: "website",
          purpose: "customer_service",
          value: "www.usbank.com",
        },
      ],
      accounts: [
        {
          id: "account-1",
          institutionIds: ["institution-1"],
          accountNumber: "123456789012",
          maskedAccountNumber: "xxxxxxxx9012",
          accountLast4: "9012",
          accountType: "U.S. Bank Smartly Checking",
          registrationType: "Individual",
          values: [
            {
              kind: "ending_balance",
              label: "Ending balance",
              money: {
                amount: "4321.09",
                currency: "USD",
              },
              dateId: "date-document",
            },
            {
              kind: "current_balance",
              label: "Current balance",
              money: {
                amount: "4555.10",
                currency: "USD",
              },
              dateId: "date-document",
            },
          ],
        },
      ],
      accountParties: [
        {
          id: "account-1-party-1",
          accountId: "account-1",
          partyId: "party-1",
          roles: ["owner"],
        },
      ],
      dates: [
        {
          id: "date-document",
          kind: "document_date",
          value: "2025-10-14",
          scope: "document",
          entityId: null,
        },
        {
          id: "date-period-start",
          kind: "statement_period_start",
          value: "2025-09-13",
          scope: "document",
          entityId: null,
        },
        {
          id: "date-period-end",
          kind: "statement_period_end",
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

  try {
    const file = {
      id: "canonical-ai-statement-enriched",
      name: "canonical-ai-statement-enriched.pdf",
      mimeType: "application/pdf",
      modifiedTime: "2026-04-19T13:00:00.000Z",
    };
    const envelope = await analyzeTextContentWithEnvelope(
      file,
      `
U.S. BANK SMARTLY CHECKING
Account Summary
CHRISTOPHER T BAKKEN
N1345 MAPLE HILLS DR
FONTANA WI 53125-1921
Customer Service
800-555-1212
Customer service website
www.usbank.com
Account Number 123456789012
Statement Period Sep 13, 2025 through Oct 14, 2025
Ending Balance $4,321.09
Current Balance $4,555.10
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
    assert.deepEqual(envelope.canonical.normalized.parties[0]?.addresses[0], {
      kind: "identity",
      rawText: "N1345 Maple Hills Dr, Fontana WI 53125-1921",
      lines: ["N1345 Maple Hills Dr", "Fontana WI 53125-1921"],
      city: "Fontana",
      state: "WI",
      postalCode: "53125-1921",
      country: "US",
    });
    assert.equal(
      envelope.canonical.extracted.accounts[0]?.accountNumber,
      "123456789012",
    );
    assert.deepEqual(
      envelope.canonical.extracted.contacts.map((contact) => ({
        method: contact.method,
        purpose: contact.purpose,
        value: contact.value,
      })),
      [
        {
          method: "phone",
          purpose: "customer_service",
          value: "800-555-1212",
        },
        {
          method: "website",
          purpose: "customer_service",
          value: "www.usbank.com",
        },
      ],
    );
    assert.deepEqual(
      envelope.canonical.extracted.dates.map((date) => ({
        kind: date.kind,
        value: date.value,
      })),
      [
        {
          kind: "document_date",
          value: "2025-10-14",
        },
        {
          kind: "statement_period_start",
          value: "2025-09-13",
        },
        {
          kind: "statement_period_end",
          value: "2025-10-14",
        },
      ],
    );
    assert.equal(
      envelope.canonical.normalized.accounts[0]?.maskedAccountNumber,
      "xxxxxxxx9012",
    );
    assert.deepEqual(
      envelope.canonical.normalized.contacts.map((contact) => ({
        method: contact.method,
        purpose: contact.purpose,
        value: contact.value,
      })),
      [
        {
          method: "phone",
          purpose: "customer_service",
          value: "800-555-1212",
        },
        {
          method: "website",
          purpose: "customer_service",
          value: "www.usbank.com",
        },
      ],
    );
    assert.deepEqual(
      envelope.canonical.normalized.dates.map((date) => ({
        kind: date.kind,
        value: date.value,
      })),
      [
        {
          kind: "document_date",
          value: "2025-10-14",
        },
        {
          kind: "statement_period_start",
          value: "2025-09-13",
        },
        {
          kind: "statement_period_end",
          value: "2025-10-14",
        },
      ],
    );
    assert.deepEqual(
      envelope.canonical.normalized.accounts[0]?.values.map((value) => ({
        kind: value.kind,
        amount: value.money?.amount ?? null,
      })),
      [
        {
          kind: "ending_balance",
          amount: "4321.09",
        },
        {
          kind: "current_balance",
          amount: "4555.10",
        },
      ],
    );

    assert.equal(envelope.legacyInsight.metadata.accountLast4, "9012");
    assert.equal(envelope.legacyInsight.metadata.accountType, "Checking");
    assert.equal(envelope.legacyInsight.metadata.custodian, "U.S. Bank");
  } finally {
    setAIPrimaryCompletionAdapterForTests(null);
    restoreEnv();
  }
});

test("preview AI statement canonical path deterministically normalizes value kinds from raw AI labels", async () => {
  const restoreEnv = withEnv({
    AI_PRIMARY_PARSER: "true",
    AI_PRIMARY_ACCOUNT_STATEMENT_ONLY: "true",
  });
  setAIPrimaryCompletionAdapterForTests(async () => ({
    model: "test-model",
    rawText: JSON.stringify({
      documentTypeId: "account_statement",
      detectedClient: "Christopher Bakken",
      detectedClient2: null,
      ownershipType: "single",
      metadata: {
        custodian: "Jackson National Life Insurance Company",
        accountType: "Fixed Indexed Annuity",
        accountLast4: "9876",
        documentDate: "2026-01-31",
      },
      confidence: {
        documentTypeId: 0.98,
        detectedClient: 0.95,
        detectedClient2: null,
        ownershipType: 0.92,
        custodian: 0.93,
        accountType: 0.94,
        accountLast4: 0.9,
        documentDate: 0.91,
      },
      rawEvidenceSummary:
        "Statement values include beginning, ending, market, surrender, vested, loan, and contribution labels.",
      parties: [
        {
          id: "party-1",
          name: "Christopher Bakken",
          roles: ["owner"],
          address: "123 Main St, Madison WI 53703",
        },
      ],
      institutions: [
        {
          id: "institution-1",
          name: "Jackson National Life Insurance Company",
        },
      ],
      accounts: [
        {
          id: "account-1",
          institutionIds: ["institution-1"],
          accountNumber: "440012349876",
          maskedAccountNumber: "xxxxxxxx9876",
          accountLast4: "9876",
          accountType: "Fixed Indexed Annuity",
          registrationType: "Individual",
          values: [
            {
              kind: "other",
              label: "Ending balance",
              money: { amount: "100.00", currency: "USD" },
              dateId: "date-document",
            },
            {
              kind: null,
              label: "Beginning balance",
              money: { amount: "90.00", currency: "USD" },
              dateId: "date-document",
            },
            {
              kind: "other",
              label: "Available balance",
              money: { amount: "80.00", currency: "USD" },
              dateId: "date-document",
            },
            {
              kind: "other",
              label: "Current balance",
              money: { amount: "110.00", currency: "USD" },
              dateId: "date-document",
            },
            {
              kind: "other",
              label: "Market value",
              money: { amount: "120.00", currency: "USD" },
              dateId: "date-document",
            },
            {
              kind: "other",
              label: "Cash value",
              money: { amount: "130.00", currency: "USD" },
              dateId: "date-document",
            },
            {
              kind: "other",
              label: "Cash surrender value",
              money: { amount: "140.00", currency: "USD" },
              dateId: "date-document",
            },
            {
              kind: "other",
              label: "Vested balance",
              money: { amount: "150.00", currency: "USD" },
              dateId: "date-document",
            },
            {
              kind: "other",
              label: "Loan balance",
              money: { amount: "160.00", currency: "USD" },
              dateId: "date-document",
            },
            {
              kind: "other",
              label: "Employee contributions total",
              money: { amount: "170.00", currency: "USD" },
              dateId: "date-document",
            },
            {
              kind: "other",
              label: "Death benefit",
              money: { amount: "180.00", currency: "USD" },
              dateId: "date-document",
            },
            {
              kind: null,
              label: "Unclassified reserve",
              money: { amount: "190.00", currency: "USD" },
              dateId: "date-document",
            },
          ],
        },
      ],
      accountParties: [
        {
          id: "account-1-party-1",
          accountId: "account-1",
          partyId: "party-1",
          roles: ["owner"],
        },
      ],
      dates: [
        {
          id: "date-period-start",
          kind: "statement_period_start",
          value: "2026-01-01",
          scope: "document",
          entityId: null,
        },
        {
          id: "date-period-end",
          kind: "statement_period_end",
          value: "2026-01-31",
          scope: "document",
          entityId: null,
        },
        {
          id: "date-document",
          kind: "document_date",
          value: "2026-01-31",
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

  try {
    const file = {
      id: "canonical-ai-statement-value-kind-normalization",
      name: "canonical-ai-statement-value-kind-normalization.pdf",
      mimeType: "application/pdf",
      modifiedTime: "2026-04-20T10:00:00.000Z",
    };
    const envelope = await analyzeTextContentWithEnvelope(
      file,
      `
ACCOUNT STATEMENT
CHRISTOPHER BAKKEN
Account Number 440012349876
Statement Period Jan 1, 2026 through Jan 31, 2026
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
    assert.deepEqual(
      envelope.canonical.normalized.accounts[0]?.values.map((value) => ({
        kind: value.kind,
        amount: value.money?.amount ?? null,
      })),
      [
        { kind: "ending_balance", amount: "100.00" },
        { kind: "beginning_balance", amount: "90.00" },
        { kind: "available_balance", amount: "80.00" },
        { kind: "current_balance", amount: "110.00" },
        { kind: "market_value", amount: "120.00" },
        { kind: "cash_value", amount: "130.00" },
        { kind: "surrender_value", amount: "140.00" },
        { kind: "vested_balance", amount: "150.00" },
        { kind: "loan_balance", amount: "160.00" },
        { kind: "contribution_balance", amount: "170.00" },
        { kind: "death_benefit", amount: "180.00" },
        { kind: "other", amount: "190.00" },
      ],
    );
  } finally {
    setAIPrimaryCompletionAdapterForTests(null);
    restoreEnv();
  }
});

test("preview AI statement canonical path supports multiple accounts and keeps primaryFacts conservative", async () => {
  const restoreEnv = withEnv({
    AI_PRIMARY_PARSER: "true",
    AI_PRIMARY_ACCOUNT_STATEMENT_ONLY: "true",
  });
  setAIPrimaryCompletionAdapterForTests(async () => ({
    model: "test-model",
    rawText: JSON.stringify({
      documentTypeId: "account_statement",
      detectedClient: "Christopher Bakken",
      detectedClient2: null,
      ownershipType: "single",
      metadata: {
        custodian: "Fidelity Investments",
        accountType: null,
        accountLast4: null,
        documentDate: "2026-03-31",
      },
      confidence: {
        documentTypeId: 0.98,
        detectedClient: 0.96,
        detectedClient2: null,
        ownershipType: 0.9,
        custodian: 0.95,
        accountType: null,
        accountLast4: null,
        documentDate: 0.94,
      },
      rawEvidenceSummary:
        "Portfolio summary includes a Roth IRA and a brokerage account for Christopher Bakken.",
      parties: [
        {
          id: "party-1",
          name: "Christopher Bakken",
          roles: ["owner"],
          address: "123 MAIN ST, MADISON WI 53703",
        },
      ],
      institutions: [
        {
          id: "institution-1",
          name: "Fidelity Investments",
        },
      ],
      contacts: [
        {
          id: "contact-1",
          institutionId: "institution-1",
          method: "phone",
          purpose: "customer_service",
          value: "800-343-3548",
        },
        {
          id: "contact-2",
          institutionId: "institution-1",
          method: "website",
          purpose: "general_support",
          value: "fidelity.com",
        },
      ],
      accounts: [
        {
          id: "account-1",
          institutionIds: ["institution-1"],
          accountNumber: "111122223333",
          maskedAccountNumber: "xxxxxxxx3333",
          accountLast4: "3333",
          accountType: "Roth IRA",
          registrationType: "IRA",
          values: [
            {
              kind: "ending_balance",
              label: "Ending balance",
              money: {
                amount: "10000.00",
                currency: "USD",
              },
              dateId: "date-document",
            },
          ],
        },
        {
          id: "account-2",
          institutionIds: ["institution-1"],
          accountNumber: "444455556666",
          maskedAccountNumber: "xxxxxxxx6666",
          accountLast4: "6666",
          accountType: "Brokerage Account",
          registrationType: "Individual",
          values: [
            {
              kind: "current_balance",
              label: "Current balance",
              money: {
                amount: "20000.00",
                currency: "USD",
              },
              dateId: "date-document",
            },
          ],
        },
      ],
      accountParties: [
        {
          id: "account-1-party-1",
          accountId: "account-1",
          partyId: "party-1",
          roles: ["owner"],
        },
        {
          id: "account-2-party-1",
          accountId: "account-2",
          partyId: "party-1",
          roles: ["owner"],
        },
      ],
      dates: [
        {
          id: "date-period-start",
          kind: "statement_period_start",
          value: "2026-01-01",
          scope: "document",
          entityId: null,
        },
        {
          id: "date-period-end",
          kind: "statement_period_end",
          value: "2026-03-31",
          scope: "document",
          entityId: null,
        },
        {
          id: "date-document",
          kind: "document_date",
          value: "2026-03-31",
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

  try {
    const file = {
      id: "canonical-ai-multi-account-statement",
      name: "canonical-ai-multi-account-statement.pdf",
      mimeType: "application/pdf",
      modifiedTime: "2026-04-19T13:05:00.000Z",
    };
    const envelope = await analyzeTextContentWithEnvelope(
      file,
      `
FIDELITY INVESTMENTS
Portfolio Summary
CHRISTOPHER BAKKEN
123 MAIN ST
MADISON WI 53703
Customer Service 800-343-3548
fidelity.com
Statement Period January 1, 2026 to March 31, 2026
Roth IRA
Account Number 111122223333
Ending Balance $10,000.00
Brokerage Account
Account Number 444455556666
Current Balance $20,000.00
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
    assert.equal(envelope.canonical.extracted.accounts.length, 2);
    assert.equal(envelope.canonical.normalized.accounts.length, 2);
    assert.deepEqual(
      envelope.canonical.normalized.accounts.map((account) => ({
        number: account.accountNumber,
        last4: account.accountLast4,
        type: account.accountType,
      })),
      [
        {
          number: "111122223333",
          last4: "3333",
          type: "Roth IRA",
        },
        {
          number: "444455556666",
          last4: "6666",
          type: "Brokerage",
        },
      ],
    );
    assert.equal(
      envelope.canonical.normalized.primaryFacts.accountLast4,
      null,
    );
    assert.equal(
      envelope.canonical.normalized.primaryFacts.accountType,
      null,
    );
    assert.equal(
      envelope.canonical.normalized.primaryFacts.custodian,
      "Fidelity",
    );
    assert.equal(envelope.canonical.normalized.accountParties.length, 2);
    assert.equal(envelope.legacyInsight.metadata.accountLast4, null);
    assert.equal(envelope.legacyInsight.metadata.accountType, null);
    assert.equal(envelope.legacyInsight.metadata.custodian, "Fidelity");
  } finally {
    setAIPrimaryCompletionAdapterForTests(null);
    restoreEnv();
  }
});

test("canonical statement contact extraction keeps generic institution homepages as general_support while preserving phone customer_service", async () => {
  const restoreEnv = withEnv({
    AI_PRIMARY_PARSER: "true",
    AI_PRIMARY_ACCOUNT_STATEMENT_ONLY: "true",
  });
  setAIPrimaryCompletionAdapterForTests(async () => ({
    model: "test-model",
    rawText: JSON.stringify({
      documentTypeId: "account_statement",
      detectedClient: "Samuel J Lee",
      detectedClient2: null,
      ownershipType: "single",
      metadata: {
        custodian: "Fidelity Investments",
        accountType: "Roth IRA",
        accountLast4: "7788",
        documentDate: "2026-03-31",
      },
      confidence: {
        documentTypeId: 0.98,
        detectedClient: 0.96,
        detectedClient2: null,
        ownershipType: 0.9,
        custodian: 0.95,
        accountType: 0.9,
        accountLast4: 0.92,
        documentDate: 0.94,
      },
      rawEvidenceSummary:
        "Customer service phone and a separate portfolio website appear in distinct statement contact blocks.",
      parties: [
        {
          id: "party-1",
          name: "Samuel J Lee",
          roles: ["owner"],
          address: "2410 JUNIPER RIDGE AVE, MADISON WI 53705",
        },
      ],
      institutions: [
        {
          id: "institution-1",
          name: "Fidelity Investments",
        },
      ],
      contacts: [
        {
          id: "contact-1",
          institutionId: "institution-1",
          method: "phone",
          purpose: "customer_service",
          value: "800-555-3438",
        },
        {
          id: "contact-2",
          institutionId: "institution-1",
          method: "website",
          purpose: "general_support",
          value: "www.fidelity.com",
        },
      ],
      accounts: [
        {
          id: "account-1",
          institutionIds: ["institution-1"],
          accountNumber: "321654987788",
          maskedAccountNumber: "xxxxxxxx7788",
          accountLast4: "7788",
          accountType: "Roth IRA",
          registrationType: "Individual retirement account",
          values: [],
        },
      ],
      accountParties: [
        {
          id: "account-1-party-1",
          accountId: "account-1",
          partyId: "party-1",
          roles: ["owner"],
        },
      ],
      dates: [
        {
          id: "date-document",
          kind: "document_date",
          value: "2026-03-31",
          scope: "document",
          entityId: null,
        },
        {
          id: "date-period-start",
          kind: "statement_period_start",
          value: "2026-01-01",
          scope: "document",
          entityId: null,
        },
        {
          id: "date-period-end",
          kind: "statement_period_end",
          value: "2026-03-31",
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

  try {
    const envelope = await analyzeTextContentWithEnvelope(
      {
        id: "canonical-ai-generic-website-statement",
        name: "canonical-ai-generic-website-statement.pdf",
        mimeType: "application/pdf",
        modifiedTime: "2026-04-21T08:10:00.000Z",
      },
      `
FIDELITY INVESTMENTS
Portfolio Summary
SAMUEL J LEE
2410 JUNIPER RIDGE AVE
MADISON WI 53705
Customer service
800-555-3438
Portfolio access
Portfolio website
www.fidelity.com
Statement Period January 1, 2026 to March 31, 2026
Roth IRA
Account Number 321654987788
Market value $125,441.23
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
    assert.deepEqual(
      envelope.canonical.normalized.contacts.map((contact) => ({
        method: contact.method,
        purpose: contact.purpose,
        value: contact.value,
      })),
      [
        {
          method: "phone",
          purpose: "customer_service",
          value: "800-555-3438",
        },
        {
          method: "website",
          purpose: "general_support",
          value: "www.fidelity.com",
        },
      ],
    );
  } finally {
    setAIPrimaryCompletionAdapterForTests(null);
    restoreEnv();
  }
});

test("preview AI statement canonical path keeps joint owner account relationships when the richer AI entities are explicit", async () => {
  const restoreEnv = withEnv({
    AI_PRIMARY_PARSER: "true",
    AI_PRIMARY_ACCOUNT_STATEMENT_ONLY: "true",
  });
  setAIPrimaryCompletionAdapterForTests(async () => ({
    model: "test-model",
    rawText: JSON.stringify({
      documentTypeId: "account_statement",
      detectedClient: "Christopher Bakken",
      detectedClient2: "Mary Bakken",
      ownershipType: "joint",
      metadata: {
        custodian: "Fidelity Investments",
        accountType: "Roth IRA",
        accountLast4: "0456",
        documentDate: "2026-03-31",
      },
      confidence: {
        documentTypeId: 0.98,
        detectedClient: 0.96,
        detectedClient2: 0.94,
        ownershipType: 0.91,
        custodian: 0.95,
        accountType: 0.9,
        accountLast4: 0.92,
        documentDate: 0.94,
      },
      rawEvidenceSummary:
        "Joint account owners and linked account-party relationships are explicit in the statement header.",
      parties: [
        {
          id: "party-1",
          name: "Christopher Bakken",
          roles: ["owner"],
          address: "123 MAIN ST, MADISON WI 53703",
        },
        {
          id: "party-2",
          name: "Mary Bakken",
          roles: ["joint_owner"],
          address: null,
        },
      ],
      institutions: [
        {
          id: "institution-1",
          name: "Fidelity Investments",
        },
      ],
      accounts: [
        {
          id: "account-1",
          institutionIds: ["institution-1"],
          accountNumber: "123450000456",
          maskedAccountNumber: "xxxxxxxx0456",
          accountLast4: "0456",
          accountType: "Roth IRA",
          registrationType: "JTWROS",
          values: [],
        },
      ],
      accountParties: [
        {
          id: "account-1-party-1",
          accountId: "account-1",
          partyId: "party-1",
          roles: ["owner"],
        },
        {
          id: "account-1-party-2",
          accountId: "account-1",
          partyId: "party-2",
          roles: ["joint_owner"],
        },
      ],
      dates: [
        {
          id: "date-document",
          kind: "document_date",
          value: "2026-03-31",
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

  try {
    const envelope = await analyzeTextContentWithEnvelope(
      {
        id: "canonical-ai-joint-account-statement",
        name: "canonical-ai-joint-account-statement.pdf",
        mimeType: "application/pdf",
        modifiedTime: "2026-04-19T13:07:00.000Z",
      },
      `
FIDELITY INVESTMENTS
Account Summary
CHRISTOPHER BAKKEN & MARY BAKKEN - JTWROS
Account Number ending in x0456
Statement Period January 1, 2026 to March 31, 2026
Roth IRA
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
    assert.deepEqual(
      envelope.canonical.extracted.accountParties.map((relationship) => ({
        accountId: relationship.accountId,
        partyId: relationship.partyId,
        roles: relationship.roles,
      })),
      [
        {
          accountId: "account-1",
          partyId: "party-1",
          roles: ["owner"],
        },
        {
          accountId: "account-1",
          partyId: "party-2",
          roles: ["joint_owner"],
        },
      ],
    );
    assert.equal(envelope.canonical.normalized.primaryFacts.detectedClient, "Christopher Bakken");
    assert.equal(envelope.canonical.normalized.primaryFacts.detectedClient2, "Mary Bakken");
    assert.equal(envelope.canonical.normalized.primaryFacts.ownershipType, "joint");
    assert.equal(envelope.legacyInsight.detectedClient2, "Mary Bakken");
    assert.equal(envelope.legacyInsight.ownershipType, "joint");
  } finally {
    setAIPrimaryCompletionAdapterForTests(null);
    restoreEnv();
  }
});

test("preview AI statement canonical path derives joint summary parties and account relationships when AI omits party entities", async () => {
  const restoreEnv = withEnv({
    AI_PRIMARY_PARSER: "true",
    AI_PRIMARY_ACCOUNT_STATEMENT_ONLY: "true",
  });
  setAIPrimaryCompletionAdapterForTests(async () => ({
    model: "test-model",
    rawText: JSON.stringify({
      documentTypeId: "account_statement",
      detectedClient: null,
      detectedClient2: null,
      ownershipType: null,
      metadata: {
        custodian: "Charles Schwab & Co., Inc.",
        accountType: null,
        accountLast4: null,
        documentDate: "2026-03-31",
      },
      confidence: {
        documentTypeId: 0.98,
        detectedClient: null,
        detectedClient2: null,
        ownershipType: null,
        custodian: 0.94,
        accountType: null,
        accountLast4: null,
        documentDate: 0.93,
      },
      rawEvidenceSummary:
        "Joint ownership is visible in the registration and owners lines across a household summary.",
      parties: [],
      institutions: [
        {
          id: "institution-1",
          name: "Charles Schwab & Co., Inc.",
        },
      ],
      accounts: [
        {
          id: "account-1",
          institutionIds: ["institution-1"],
          accountNumber: "456780001122",
          maskedAccountNumber: "xxxxxxxx1122",
          accountLast4: "1122",
          accountType: "Brokerage",
          registrationType: "Joint tenants with rights of survivorship",
          values: [],
        },
        {
          id: "account-2",
          institutionIds: ["institution-1"],
          accountNumber: "456780003344",
          maskedAccountNumber: "xxxxxxxx3344",
          accountLast4: "3344",
          accountType: "Checking",
          registrationType: "Joint tenants with rights of survivorship",
          values: [],
        },
      ],
      accountParties: [],
      dates: [
        {
          id: "date-document",
          kind: "document_date",
          value: "2026-03-31",
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

  try {
    const envelope = await analyzeTextContentWithEnvelope(
      {
        id: "canonical-ai-schwab-joint-fallback",
        name: "canonical-ai-schwab-joint-fallback.pdf",
        mimeType: "application/pdf",
        modifiedTime: "2026-04-20T19:10:00.000Z",
      },
      `
CHARLES SCHWAB & CO., INC.
Household Summary
Account owner Ava R Martin
18 CEDAR HILL RD
MADISON WI 53717
Registration Joint tenants with rights of survivorship
Owners Ava R Martin / Noah E Martin
Account Number ending in x1122
Brokerage
Account Number ending in x3344
Checking
Statement Period January 1, 2026 to March 31, 2026
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
    assert.deepEqual(
      envelope.canonical.normalized.parties.map((party) => party.displayName),
      ["Ava R Martin", "Noah E Martin"],
    );
    assert.equal(envelope.canonical.normalized.accountParties.length, 4);
    assert.equal(
      envelope.canonical.normalized.primaryFacts.detectedClient,
      "Ava R Martin",
    );
    assert.equal(
      envelope.canonical.normalized.primaryFacts.detectedClient2,
      "Noah E Martin",
    );
    assert.equal(
      envelope.canonical.normalized.primaryFacts.ownershipType,
      "joint",
    );
    assert.equal(envelope.legacyInsight.detectedClient, "Ava R Martin");
    assert.equal(envelope.legacyInsight.detectedClient2, "Noah E Martin");
    assert.equal(envelope.legacyInsight.ownershipType, "joint");
  } finally {
    setAIPrimaryCompletionAdapterForTests(null);
    restoreEnv();
  }
});

test("canonical primaryFacts are always derived from normalized entities", () => {
  const canonical = finalizeCanonicalExtractedDocument({
    source: {
      file: {
        fileId: "derived-primary-facts",
        sourceName: "derived-primary-facts.pdf",
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
      parties: [],
      accounts: [],
      accountParties: [],
      institutions: [],
      contacts: [],
      dates: [],
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
          addresses: [],
          birthDateId: null,
          taxIdentifiers: [],
          governmentIds: [],
        },
      ],
      accounts: [
        {
          id: "account-1",
          institutionIds: ["institution-1"],
          accountNumber: null,
          maskedAccountNumber: null,
          accountLast4: "6642",
          accountType: "Checking",
          registrationType: null,
          openedDateId: null,
          closedDateId: null,
          statementStartDateId: null,
          statementEndDateId: "date-1",
          values: [],
          beneficiaryText: null,
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
          addresses: [],
        },
      ],
      contacts: [],
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
        entityName: "Jackson National Life Insurance Company",
        idType: null,
        taxYear: "2025",
      },
      primaryFacts: {
        detectedClient: "Wrong Value",
        detectedClient2: "Should Be Ignored",
        ownershipType: "joint",
        accountLast4: "9999",
        accountType: "Wrong Type",
        custodian: "Wrong Custodian",
        documentDate: "2000-01-01",
        entityName: "Wrong Entity",
        idType: "Wrong ID",
        taxYear: "2001",
      },
    },
    provenance: {
      fields: {},
      normalization: [],
      sourceRefs: [],
    },
    diagnostics: {
      parserVersion: "test",
      parserConflictSummary: null,
      documentSignal: null,
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
        rawSummary: null,
      },
    },
  });

  assert.deepEqual(canonical.normalized.primaryFacts, {
    detectedClient: "Christopher T Bakken",
    detectedClient2: null,
    ownershipType: "single",
    accountLast4: "6642",
    accountType: "Checking",
    custodian: "U.S. Bank",
    documentDate: "2025-10-14",
    entityName: null,
    idType: null,
    taxYear: null,
  });
  assert.deepEqual(canonical.normalized.documentFacts, {
    entityName: "Jackson National Life Insurance Company",
    idType: null,
    taxYear: "2025",
  });
});

test("legacy-only paths return no canonical record", async () => {
  const restoreEnv = withEnv({
    AI_PRIMARY_PARSER: "false",
    AI_PRIMARY_ACCOUNT_STATEMENT_ONLY: "true",
  });

  try {
    const file = {
      id: "canonical-disabled",
      name: "legacy-tax-form.pdf",
      mimeType: "application/pdf",
      modifiedTime: "2026-04-12T10:00:00.000Z",
    };
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
    assert.equal(envelope.legacyInsight.documentTypeId, "tax_document");
    assert.equal(envelope.legacyInsight.debug.aiEnabled, false);
  } finally {
    restoreEnv();
  }
});
