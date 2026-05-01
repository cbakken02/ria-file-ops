import test from "node:test";
import assert from "node:assert/strict";

import { analyzeSyntheticDocument } from "./specialized-regression-helpers.mjs";

test("ACH bank-linking forms prefer bank account type and bank account last4", async () => {
  const { insight, filename } = await analyzeSyntheticDocument({
    id: "ach-linking-1",
    name: "bank-linking-form.pdf",
    mimeType: "application/pdf",
    text: `
Electronic Funds Transfer Authorization
ACH Authorization
Account Owner: Christopher Bakken
Bank Name: First National Bank
Routing Number: 021000021
Account Number: 000123450456
Account Type: Checking
Check No. 1025
`,
  });

  assert.equal(insight.documentTypeId, "money_movement_form");
  assert.equal(insight.detectedClient, "Christopher Bakken");
  assert.equal(insight.metadata.custodian, "First National Bank");
  assert.equal(insight.metadata.accountType, "Checking");
  assert.equal(insight.metadata.accountLast4, "0456");
  assert.notEqual(insight.metadata.accountLast4, "0021");
  assert.notEqual(insight.metadata.accountLast4, "1025");

  assert.equal(filename, "Bakken_Christopher_Money_Movement_Checking_x0456.pdf");
});

test("voided-check ACH packets use MICR fallback for bank account last4", async () => {
  const { insight, filename } = await analyzeSyntheticDocument({
    id: "ach-voided-check-1",
    name: "voided-check-linking.pdf",
    mimeType: "application/pdf",
    text: `
ACH Authorization
Voided Check
Account Owner: Christopher Bakken
First National Bank
Checking
021000021 000123450456 1025
`,
  });

  assert.equal(insight.documentTypeId, "money_movement_form");
  assert.equal(insight.detectedClient, "Christopher Bakken");
  assert.equal(insight.metadata.accountType, "Checking");
  assert.equal(insight.metadata.accountLast4, "0456");
  assert.notEqual(insight.metadata.accountLast4, "0021");
  assert.notEqual(insight.metadata.accountLast4, "1025");

  assert.equal(filename, "Bakken_Christopher_Money_Movement_Checking_x0456.pdf");
});
