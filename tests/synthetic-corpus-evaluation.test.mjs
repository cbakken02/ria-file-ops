import assert from "node:assert/strict";
import test from "node:test";

import { compareSyntheticCorpusCase } from "../lib/synthetic-corpus-evaluation.ts";

test("synthetic corpus comparison skips declared ambiguities and scores focused mismatches", () => {
  const answerKey = {
    schemaVersion: "synthetic-answer-key-v1",
    caseId: "case-test",
    title: "Synthetic comparison test",
    documentTypeId: "account_statement",
    documentSubtype: "multi_account_summary",
    parties: [
      { id: "party-1", displayName: "Alex Rivera" },
      { id: "party-2", displayName: "Jordan Rivera" },
    ],
    institutions: [
      {
        id: "institution-1",
        name: "Fidelity",
        rawName: "Fidelity Investments",
      },
    ],
    contacts: [
      {
        id: "contact-1",
        method: "phone",
        purpose: "customer_service",
        value: "800-555-1000",
      },
    ],
    accounts: [
      {
        id: "account-1",
        accountNumber: "111122223333",
        accountLast4: "3333",
        accountType: "Brokerage",
        values: [
          {
            kind: "market_value",
            money: { amount: "100.00", currency: "USD" },
          },
        ],
      },
    ],
    dates: [
      { id: "date-document", kind: "document_date", value: "2026-03-31" },
      { id: "date-period-start", kind: "statement_period_start", value: "2026-01-01" },
      { id: "date-period-end", kind: "statement_period_end", value: "2026-03-31" },
    ],
    normalized: {
      primaryFacts: {
        detectedClient: "Alex Rivera",
        detectedClient2: "Jordan Rivera",
        ownershipType: "joint",
        accountLast4: null,
        accountType: null,
        custodian: "Fidelity",
        documentDate: "2026-03-31",
        entityName: null,
        idType: null,
        taxYear: null,
      },
    },
    expectedAmbiguities: [
      {
        fieldPath: "normalized.primaryFacts.accountLast4",
        reason: "Multi-account summary should not force a primary account.",
        expected: "null",
      },
    ],
  };

  const actual = {
    documentTypeId: "account_statement",
    documentSubtype: null,
    parties: [
      { displayName: "Alex Rivera" },
      { displayName: "Jordan Rivera" },
    ],
    extractedInstitutions: [{ rawName: "Fidelity Investments" }],
    normalizedInstitutions: [{ name: "Fidelity" }],
    contacts: [
      {
        method: "phone",
        purpose: "general_support",
        value: "800-555-1000",
      },
    ],
    accounts: [
      {
        id: "account-1",
        accountNumber: "111122223333",
        accountLast4: "3333",
        accountType: "Brokerage",
        values: [{ kind: "market_value", amount: "95.00" }],
      },
    ],
    dates: [
      { kind: "document_date", value: "2026-03-31" },
      { kind: "statement_period_start", value: "2026-01-01" },
      { kind: "statement_period_end", value: "2026-03-31" },
    ],
    normalizedPrimaryFacts: {
      detectedClient: "Alex Rivera",
      detectedClient2: "Jordan Rivera",
      ownershipType: "joint",
      accountLast4: "3333",
      accountType: null,
      custodian: "Fidelity",
      documentDate: "2026-03-31",
      entityName: null,
      idType: null,
      taxYear: null,
    },
  };

  const result = compareSyntheticCorpusCase(answerKey, actual);

  assert.equal(result.score.ambiguousSkipped, 1);
  assert.equal(result.score.mismatched, 2);
  assert.deepEqual(
    result.mismatches.map((entry) => entry.path).sort(),
    [
      "accounts[account-1].values[market_value].money.amount",
      "contacts[phone:800-555-1000].purpose",
    ],
  );
});
