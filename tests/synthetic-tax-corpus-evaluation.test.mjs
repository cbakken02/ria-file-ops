import assert from "node:assert/strict";
import test from "node:test";

import {
  compareSyntheticTaxCorpusCase,
} from "../lib/synthetic-tax-corpus-evaluation.ts";

test("synthetic tax corpus comparison reports field-level fact mismatches", () => {
  const answerKey = {
    schemaVersion: "synthetic-tax-answer-key-v1",
    caseId: "case-test",
    title: "Synthetic tax comparison test",
    documentTypeId: "tax_document",
    documentSubtype: "form_1099_div",
    normalized: {
      primaryFacts: {
        detectedClient: "Alex Morgan",
        custodian: "Fidelity",
        documentDate: "2026-02-03",
        idType: "1099-DIV",
        taxYear: "2025",
      },
    },
    taxFacts: [
      {
        fieldId: "form_1099_div.total_ordinary_dividends",
        form: "1099-DIV",
        label: "Total ordinary dividends",
        line: null,
        box: "1a",
        valueType: "money",
        value: "1234.56",
        amount: "1234.56",
        currency: "USD",
      },
    ],
    expectedAmbiguities: [
      {
        fieldPath: "normalized.primaryFacts.custodian",
        reason: "Payer normalization is not the focus of this comparison unit test.",
        expected: "Fidelity",
      },
    ],
  };

  const actual = {
    documentTypeId: "tax_document",
    documentSubtype: "form_1099_div",
    normalizedPrimaryFacts: {
      detectedClient: "Alex Morgan",
      custodian: "Fidelity Brokerage Services LLC",
      documentDate: "2026-02-03",
      idType: "1099-DIV",
      taxYear: "2025",
    },
    taxFacts: [
      {
        fieldId: "form_1099_div.total_ordinary_dividends",
        form: "1099-DIV",
        label: "Total ordinary dividends",
        line: null,
        box: "1a",
        valueType: "money",
        value: "1200.00",
        amount: "1200.00",
        currency: "USD",
      },
    ],
  };

  const result = compareSyntheticTaxCorpusCase(answerKey, actual);

  assert.equal(result.score.ambiguousSkipped, 1);
  assert.equal(result.score.mismatched, 2);
  assert.deepEqual(
    result.mismatches.map((entry) => entry.path).sort(),
    [
      "taxFacts[form_1099_div.total_ordinary_dividends].amount",
      "taxFacts[form_1099_div.total_ordinary_dividends].value",
    ],
  );
});
