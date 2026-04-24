import test from "node:test";
import assert from "node:assert/strict";

import { analyzeSyntheticDocument } from "./specialized-regression-helpers.mjs";

test("joint account statements keep secondary client ownership through filename generation", async () => {
  const { insight, filename } = await analyzeSyntheticDocument({
    id: "statement-1",
    name: "joint-statement.pdf",
    mimeType: "application/pdf",
    text: `
Fidelity
Account Summary
Christopher Bakken & Mary Bakken - JTWROS
Account Number ending in x0456
Statement Period 01/01/2026 to 03/31/2026
Roth IRA
`,
  });

  assert.equal(insight.documentTypeId, "account_statement");
  assert.equal(insight.detectedClient, "Christopher Bakken");
  assert.equal(insight.detectedClient2, "Mary Bakken");
  assert.equal(insight.ownershipType, "joint");
  assert.equal(insight.metadata.accountType, "Roth IRA");
  assert.equal(insight.metadata.accountLast4, "0456");
  assert.equal(insight.metadata.documentDate, "2026-03-31");

  assert.equal(filename, "Bakken_Christopher_Mary_Statement_Roth_IRA_x0456.pdf");
});

test("duplicate secondary owner values do not flip account statements to joint ownership", async () => {
  const { insight, filename } = await analyzeSyntheticDocument({
    id: "statement-duplicate-owner",
    name: "duplicate-owner-statement.pdf",
    mimeType: "application/pdf",
    text: `
Fidelity
Account Summary
Account Number ending in x0456
Statement Period 01/01/2026 to 03/31/2026
Roth IRA
`,
    fields: {
      "Account Owner": "Christopher Bakken & Christopher Bakken",
    },
  });

  assert.equal(insight.documentTypeId, "account_statement");
  assert.equal(insight.detectedClient, "Christopher Bakken");
  assert.equal(insight.detectedClient2, "Christopher Bakken");
  assert.equal(insight.ownershipType, "single");

  assert.equal(filename, "Bakken_Christopher_Statement_Roth_IRA_x0456.pdf");
});

test("account statements prefer statement period end date over generated dates", async () => {
  const { insight } = await analyzeSyntheticDocument({
    id: "statement-date-priority",
    name: "statement-date-priority.pdf",
    mimeType: "application/pdf",
    text: `
Fidelity
Account Summary
Christopher Bakken
Generated on April 5, 2026
Statement Period January 1, 2026 to March 31, 2026
Account Number ending in x0456
Roth IRA
`,
  });

  assert.equal(insight.documentTypeId, "account_statement");
  assert.equal(insight.metadata.documentDate, "2026-03-31");
  assert.notEqual(insight.metadata.documentDate, "2026-04-05");
});

test("summary statements prefer the real account owner over parser-testing footer text", async () => {
  const { insight, filename } = await analyzeSyntheticDocument({
    id: "statement-fidelity-summary-owner",
    name: "fidelity-summary-owner.pdf",
    mimeType: "application/pdf",
    text: `
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
  });

  assert.equal(insight.documentTypeId, "account_statement");
  assert.equal(insight.detectedClient, "Samuel J Lee");
  assert.equal(insight.detectedClient2, null);
  assert.equal(insight.ownershipType, "single");
  assert.notEqual(insight.detectedClient, "Parser Testing Only Fidelity");
  assert.match(filename, /^Lee_Samuel_/);
});

test("summary statements propagate owners lines with middle initials into joint ownership", async () => {
  const { insight, filename } = await analyzeSyntheticDocument({
    id: "statement-schwab-summary-joint",
    name: "schwab-summary-joint.pdf",
    mimeType: "application/pdf",
    text: `
Charles Schwab & Co., Inc.
Household Summary
Account owner Ava R Martin
18 CEDAR HILL RD
MADISON WI 53717
Registration Joint tenants with rights of survivorship
Owners Ava R Martin / Noah E Martin
Account Number ending in x7788
Statement Period January 1, 2026 to March 31, 2026
Brokerage
`,
  });

  assert.equal(insight.documentTypeId, "account_statement");
  assert.equal(insight.detectedClient, "Ava R Martin");
  assert.equal(insight.detectedClient2, "Noah E Martin");
  assert.equal(insight.ownershipType, "joint");
  assert.match(filename, /^Martin_Ava_Noah_Statement_/);
  assert.match(filename, /x7788\.pdf$/);
});

test("retail bank statements prefer header owner, bank, checking type, and ignore social security disclosures", async () => {
  const { insight, filename } = await analyzeSyntheticDocument({
    id: "statement-us-bank-checking",
    name: "us-bank-checking-statement.pdf",
    mimeType: "application/pdf",
    text: `
U.S. BANK SMARTLY CHECKING
U.S. Bank National Association
Account Summary
CHRISTOPHER T BAKKEN
N1345 MAPLE HILLS DR
FONTANA WI 53125-1921
Account Number ending in ...6642
Statement Period Sep 13, 2025 through Oct 14, 2025
Tell us your name and account number.
Describe the error or the transfer you are unsure about, and explain as clearly as you can why you believe there is an error.
Any other Federal benefit or Social Security payment may be affected.
`,
  });

  assert.equal(insight.documentTypeId, "account_statement");
  assert.equal(insight.detectedClient, "Christopher T Bakken");
  assert.equal(insight.metadata.custodian, "U.S. Bank");
  assert.equal(insight.metadata.accountType, "Checking");
  assert.equal(insight.metadata.accountLast4, "6642");
  assert.equal(insight.metadata.documentDate, "2025-10-14");
  assert.equal(insight.metadata.idType, null);
  assert.notEqual(insight.metadata.idType, "Driver License");
  assert.notEqual(insight.metadata.idType, "Social Security Card");

  assert.equal(filename, "Bakken_Christopher_Statement_Checking_x6642.pdf");
});
