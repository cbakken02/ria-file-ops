import assert from "node:assert/strict";
import test from "node:test";

import { answerDataIntelligenceQuestion } from "../lib/data-intelligence-assistant.ts";
import {
  askFirmDocumentAssistant,
  buildQueryAssistantRetrievalPlan,
} from "../lib/query-assistant.ts";
import {
  writeCanonicalAccountStatementToSqlite,
  writeCanonicalIdentityDocumentToSqlite,
} from "../lib/firm-document-sqlite.ts";
import {
  buildIdentityCanonicalFixture,
  buildStatementCanonicalFixture,
  makeTempDbEnv,
  withEnv,
} from "./helpers/firm-document-sqlite-fixtures.mjs";

function seedAssistantFixtures(ownerEmail) {
  const older401k = buildStatementCanonicalFixture({
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
    extractedValues: [
      {
        kind: "market_value",
        label: "Market value",
        money: { amount: "101000.00", currency: "USD" },
        dateId: "date-end",
      },
    ],
    normalizedValues: [
      {
        kind: "market_value",
        label: "Market value",
        money: { amount: "101000.00", currency: "USD" },
        dateId: "date-end",
      },
    ],
  });

  const newer401k = buildStatementCanonicalFixture({
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
    ],
    extractedValues: [
      {
        kind: "market_value",
        label: "Market value",
        money: { amount: "120500.42", currency: "USD" },
        dateId: "date-end",
      },
    ],
    normalizedValues: [
      {
        kind: "market_value",
        label: "Market value",
        money: { amount: "120500.42", currency: "USD" },
        dateId: "date-end",
      },
    ],
  });

  const oldLicense = buildIdentityCanonicalFixture({
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

  const renewedLicense = buildIdentityCanonicalFixture({
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

  const alexKimOne = buildIdentityCanonicalFixture({
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
  });

  const alexKimTwo = buildIdentityCanonicalFixture({
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
  });

  const checkingStatement = buildStatementCanonicalFixture({
    ownerName: "Christopher T Bakken",
    rawInstitutionName: "U.S. Bank National Association",
    normalizedInstitutionName: "U.S. Bank",
    rawAccountType: "U.S. Bank Smartly Checking",
    normalizedAccountType: "Checking",
    accountNumber: "665544332211",
    maskedAccountNumber: "XXXXXXXX2211",
    accountLast4: "2211",
    fileId: "christopher-checking-2026",
    sourceName: "christopher-checking-2026.pdf",
    documentDate: "2026-06-30",
    statementStartDate: "2026-06-01",
    statementEndDate: "2026-06-30",
    extractedValues: [
      {
        kind: "ending_balance",
        label: "Ending balance",
        money: { amount: "4321.09", currency: "USD" },
        dateId: "date-end",
      },
    ],
    normalizedValues: [
      {
        kind: "ending_balance",
        label: "Ending balance",
        money: { amount: "4321.09", currency: "USD" },
        dateId: "date-end",
      },
    ],
  });

  const savingsStatement = buildStatementCanonicalFixture({
    ownerName: "Christopher Bakken",
    rawInstitutionName: "U.S. Bank National Association",
    normalizedInstitutionName: "U.S. Bank",
    rawAccountType: "U.S. Bank Savings",
    normalizedAccountType: "Savings",
    accountNumber: "665544337777",
    maskedAccountNumber: "XXXXXXXX7777",
    accountLast4: "7777",
    fileId: "christopher-savings-2026",
    sourceName: "christopher-savings-2026.pdf",
    documentDate: "2026-05-31",
    statementStartDate: "2026-05-01",
    statementEndDate: "2026-05-31",
    extractedValues: [
      {
        kind: "ending_balance",
        label: "Ending balance",
        money: { amount: "9800.55", currency: "USD" },
        dateId: "date-end",
      },
    ],
    normalizedValues: [
      {
        kind: "ending_balance",
        label: "Ending balance",
        money: { amount: "9800.55", currency: "USD" },
        dateId: "date-end",
      },
    ],
  });

  for (const canonical of [
    older401k,
    newer401k,
    checkingStatement,
    savingsStatement,
    oldLicense,
    renewedLicense,
    alexKimOne,
    alexKimTwo,
  ]) {
    if (canonical.classification.normalized.documentTypeId === "account_statement") {
      writeCanonicalAccountStatementToSqlite({
        ownerEmail,
        analysisProfile: "preview_ai_primary",
        analysisVersion: "query-assistant-test",
        analysisRanAt: "2026-04-22T12:00:00.000Z",
        canonical,
      });
    } else {
      writeCanonicalIdentityDocumentToSqlite({
        ownerEmail,
        analysisProfile: "legacy",
        analysisVersion: "query-assistant-test",
        analysisRanAt: "2026-04-22T12:00:00.000Z",
        canonical,
      });
    }
  }
}

test("assistant answers a latest 401(k) snapshot question with source-aware snapshot details", () => {
  const tempDb = makeTempDbEnv("query-assistant-snapshot-");
  const ownerEmail = "query-assistant-snapshot@example.com";

  try {
    seedAssistantFixtures(ownerEmail);

    const result = askFirmDocumentAssistant({
      ownerEmail,
      dbPath: tempDb.dbPath,
      question: "What is the latest 401(k) balance for Christopher Bakken?",
    });

    assert.equal(result.status, "answered");
    assert.equal(result.intent, "latest_account_snapshot");
    assert.match(result.answer, /Empower/i);
    assert.match(result.answer, /120,500\.42|120500\.42/);
    assert.doesNotMatch(result.answer, /snapshot/i);
    assert.equal(result.presentation.mode, "concise_answer_with_source");
    assert.equal(result.presentation.shellTone, "assistant");
    assert.equal(result.presentation.showDetails, false);
    assert.equal(result.presentation.showSourceLine, true);
    assert.equal(result.presentation.showSources, false);
    assert.equal(result.sources[0]?.accountNumber, "4010001234567890");
    assert.equal(result.sources[0]?.maskedAccountNumber, "XXXXXXXX7890");
    assert.equal(result.sources[0]?.statementEndDate, "2026-03-31");
    assert.equal(result.sources[0]?.accountType, "401(k)");
  } finally {
    tempDb.cleanup();
  }
});

test("assistant answers a rollover support phone question", () => {
  const tempDb = makeTempDbEnv("query-assistant-contact-");
  const ownerEmail = "query-assistant-contact@example.com";

  try {
    seedAssistantFixtures(ownerEmail);

    const result = askFirmDocumentAssistant({
      ownerEmail,
      dbPath: tempDb.dbPath,
      question: "What is the rollover support phone for Christopher Bakken's 401(k)?",
    });

    assert.equal(result.status, "answered");
    assert.equal(result.intent, "latest_account_contact");
    assert.match(result.answer, /800-777-1212/);
    assert.match(result.answer, /^The rollover support phone/i);
    assert.equal(result.presentation.mode, "concise_answer_with_source");
    assert.equal(result.presentation.shellTone, "assistant");
    assert.equal(result.presentation.showDetails, false);
    assert.equal(result.sources[0]?.statementEndDate, "2026-03-31");
  } finally {
    tempDb.cleanup();
  }
});

test("assistant answers broader bank-statement existence and list questions without forcing an account type", () => {
  const tempDb = makeTempDbEnv("query-assistant-bank-statement-");
  const ownerEmail = "query-assistant-bank-statement@example.com";

  try {
    seedAssistantFixtures(ownerEmail);

    const existence = askFirmDocumentAssistant({
      ownerEmail,
      dbPath: tempDb.dbPath,
      question: "Do we have a bank statement for Christopher Bakken on file?",
    });
    const listing = askFirmDocumentAssistant({
      ownerEmail,
      dbPath: tempDb.dbPath,
      question: "What bank statements do we have on file for Christopher Bakken?",
    });

    assert.equal(existence.status, "answered");
    assert.equal(existence.intent, "statement_existence");
    assert.match(existence.answer, /Yes\./);
    assert.match(existence.answer, /2 bank statements/i);
    assert.match(existence.answer, /Checking/i);
    assert.match(existence.answer, /I also found Savings statements/i);
    assert.equal(existence.presentation.mode, "summary_answer");
    assert.equal(existence.presentation.shellTone, "assistant");
    assert.equal(existence.presentation.showDetails, true);
    assert.equal(existence.sources[0]?.accountNumber, "665544332211");
    assert.equal(existence.sources[1]?.accountNumber, "665544337777");

    assert.equal(listing.status, "answered");
    assert.equal(listing.intent, "statement_list");
    assert.match(listing.answer, /2 bank statements/i);
    assert.equal(listing.presentation.mode, "summary_answer");
    assert.equal(listing.presentation.shellTone, "assistant");
    assert.equal(listing.presentation.showDetails, true);
    assert.ok(listing.details.some((detail) => /Checking/i.test(detail)));
    assert.ok(listing.details.some((detail) => /Savings/i.test(detail)));
    assert.equal(listing.sources[0]?.accountNumber, "665544332211");
    assert.equal(listing.sources[1]?.accountNumber, "665544337777");
  } finally {
    tempDb.cleanup();
  }
});

test("assistant answers latest statement questions without extra follow-up text in normal success cases", () => {
  const tempDb = makeTempDbEnv("query-assistant-latest-statement-");
  const ownerEmail = "query-assistant-latest-statement@example.com";

  try {
    seedAssistantFixtures(ownerEmail);

    const result = askFirmDocumentAssistant({
      ownerEmail,
      dbPath: tempDb.dbPath,
      question: "What is Christopher Bakken's latest statement?",
    });

    assert.equal(result.status, "answered");
    assert.equal(result.intent, "latest_account_document");
    assert.match(result.answer, /christopher-checking-2026\.pdf/i);
    assert.match(result.answer, /latest statement for Christopher Bakken/i);
    assert.doesNotMatch(result.answer, /matching/i);
    assert.equal(result.presentation.mode, "concise_answer_with_source");
    assert.equal(result.presentation.shellTone, "assistant");
    assert.equal(result.presentation.showDetails, false);
    assert.equal(result.presentation.followUp, null);
  } finally {
    tempDb.cleanup();
  }
});

test("assistant can answer a rollover contact question without an explicit account type when only one matching purpose exists", () => {
  const tempDb = makeTempDbEnv("query-assistant-rollover-no-type-");
  const ownerEmail = "query-assistant-rollover-no-type@example.com";

  try {
    seedAssistantFixtures(ownerEmail);

    const result = askFirmDocumentAssistant({
      ownerEmail,
      dbPath: tempDb.dbPath,
      question: "What is Christopher Bakken's rollover support phone?",
    });

    assert.equal(result.status, "answered");
    assert.equal(result.intent, "latest_account_contact");
    assert.match(result.answer, /800-777-1212/);
    assert.match(result.answer, /401\(k\)/i);
    assert.equal(result.presentation.shellTone, "assistant");
  } finally {
    tempDb.cleanup();
  }
});

test("assistant resolves common client-name variants conservatively for supported prompts", () => {
  const tempDb = makeTempDbEnv("query-assistant-name-variants-");
  const ownerEmail = "query-assistant-name-variants@example.com";

  try {
    seedAssistantFixtures(ownerEmail);

    const statementVariant = askFirmDocumentAssistant({
      ownerEmail,
      dbPath: tempDb.dbPath,
      question: "What is the latest 401(k) balance for Christopher T Bakken?",
    });
    const identityVariant = askFirmDocumentAssistant({
      ownerEmail,
      dbPath: tempDb.dbPath,
      question: "What is Christopher Bakken's latest ID expiration date?",
    });

    assert.equal(statementVariant.status, "answered");
    assert.equal(statementVariant.intent, "latest_account_snapshot");
    assert.match(statementVariant.answer, /Empower/i);

    assert.equal(identityVariant.status, "answered");
    assert.equal(identityVariant.intent, "latest_identity_expiration");
    assert.match(identityVariant.answer, /2032-02-03/);
  } finally {
    tempDb.cleanup();
  }
});

test("assistant answers latest identity-document, DOB, address, and unexpired-license questions", () => {
  const tempDb = makeTempDbEnv("query-assistant-identity-");
  const ownerEmail = "query-assistant-identity@example.com";

  try {
    seedAssistantFixtures(ownerEmail);

    const latestId = askFirmDocumentAssistant({
      ownerEmail,
      dbPath: tempDb.dbPath,
      question: "What is the latest ID for Christopher Bakken?",
    });
    const dob = askFirmDocumentAssistant({
      ownerEmail,
      dbPath: tempDb.dbPath,
      question: "What is Christopher Bakken's DOB?",
    });
    const address = askFirmDocumentAssistant({
      ownerEmail,
      dbPath: tempDb.dbPath,
      question: "What address is on Christopher Bakken's latest ID?",
    });
    const licenseStatus = askFirmDocumentAssistant({
      ownerEmail,
      dbPath: tempDb.dbPath,
      question: "Do we have an unexpired driver's license on file for Christopher Bakken?",
    });

    assert.equal(latestId.status, "answered");
    assert.equal(latestId.intent, "latest_identity_document");
    assert.equal(latestId.sources[0]?.documentDate, "2024-03-01");

    assert.equal(dob.status, "answered");
    assert.equal(dob.intent, "latest_identity_dob");
    assert.match(dob.answer, /1985-02-03/);
    assert.equal(dob.presentation.mode, "concise_answer_with_source");
    assert.equal(dob.presentation.shellTone, "assistant");
    assert.equal(dob.presentation.showDetails, false);

    assert.equal(address.status, "answered");
    assert.equal(address.intent, "latest_identity_address");
    assert.match(address.answer, /1841 LAKE SHORE CT/i);
    assert.equal(address.presentation.mode, "concise_answer_with_source");
    assert.equal(address.presentation.shellTone, "assistant");

    assert.equal(licenseStatus.status, "answered");
    assert.equal(licenseStatus.intent, "unexpired_driver_license_check");
    assert.match(licenseStatus.answer, /Yes\./);
    assert.equal(licenseStatus.presentation.mode, "concise_answer_with_source");
    assert.equal(licenseStatus.presentation.shellTone, "assistant");
    assert.equal(licenseStatus.sources[0]?.expirationDate, "2032-02-03");
  } finally {
    tempDb.cleanup();
  }
});

test("assistant handles broader identity-document existence phrasing", () => {
  const tempDb = makeTempDbEnv("query-assistant-identity-existence-");
  const ownerEmail = "query-assistant-identity-existence@example.com";

  try {
    seedAssistantFixtures(ownerEmail);

    const result = askFirmDocumentAssistant({
      ownerEmail,
      dbPath: tempDb.dbPath,
      question: "Do we have an ID on file for Christopher Bakken?",
    });

    assert.equal(result.status, "answered");
    assert.equal(result.intent, "identity_document_existence");
    assert.match(result.answer, /Yes\./);
    assert.match(result.answer, /Driver License/i);
    assert.equal(result.presentation.mode, "summary_answer");
    assert.equal(result.presentation.shellTone, "assistant");
    assert.equal(result.presentation.showDetails, false);
    assert.equal(result.sources[0]?.documentDate, "2024-03-01");
  } finally {
    tempDb.cleanup();
  }
});

test("assistant returns bounded ambiguous, not-found, and unsupported responses instead of guessing", () => {
  const tempDb = makeTempDbEnv("query-assistant-bounded-");
  const ownerEmail = "query-assistant-bounded@example.com";

  try {
    seedAssistantFixtures(ownerEmail);

    const ambiguous = askFirmDocumentAssistant({
      ownerEmail,
      dbPath: tempDb.dbPath,
      question: "What is the latest ID for Alex Kim?",
    });
    const unsupported = askFirmDocumentAssistant({
      ownerEmail,
      dbPath: tempDb.dbPath,
      question: "What is Christopher Bakken's passport number?",
    });
    const missingClient = askFirmDocumentAssistant({
      ownerEmail,
      dbPath: tempDb.dbPath,
      question: "What is the latest IRA document for Jamie Example?",
    });

    assert.equal(ambiguous.status, "ambiguous");
    assert.equal(ambiguous.intent, "latest_identity_document");
    assert.equal(ambiguous.presentation.mode, "ambiguity_prompt");
    assert.equal(ambiguous.presentation.shellTone, "warning");
    assert.equal(ambiguous.presentation.showDetails, true);
    assert.ok(ambiguous.details.length >= 2);
    assert.match(ambiguous.details[0] ?? "", /Alex Kim/);
    assert.match(ambiguous.details[0] ?? "", /Party party_/);

    assert.equal(missingClient.status, "not_found");
    assert.equal(missingClient.intent, "latest_account_document");
    assert.equal(missingClient.presentation.mode, "not_found");
    assert.equal(missingClient.presentation.shellTone, "warning");
    assert.equal(missingClient.presentation.showDetails, false);
    assert.match(missingClient.answer, /couldn't find that client/i);

    assert.equal(unsupported.status, "unsupported");
    assert.equal(unsupported.intent, null);
    assert.equal(unsupported.presentation.mode, "unsupported");
    assert.equal(unsupported.presentation.shellTone, "warning");
  } finally {
    tempDb.cleanup();
  }
});

test("assistant asks a natural client clarification when no active client is available", () => {
  const tempDb = makeTempDbEnv("query-assistant-client-needed-");
  const ownerEmail = "query-assistant-client-needed@example.com";

  try {
    seedAssistantFixtures(ownerEmail);

    const result = askFirmDocumentAssistant({
      ownerEmail,
      dbPath: tempDb.dbPath,
      question: "Do we have an ID on file?",
    });

    assert.equal(result.status, "ambiguous");
    assert.equal(result.intent, "identity_document_existence");
    assert.equal(result.answer, "Which client do you want me to check?");
    assert.equal(result.presentation.mode, "ambiguity_prompt");
    assert.doesNotMatch(result.answer, /firm-document store/i);
  } finally {
    tempDb.cleanup();
  }
});

test("assistant treats uploaded/list phrasing and latest bank statement questions as statement-family retrieval", () => {
  const tempDb = makeTempDbEnv("query-assistant-statement-family-");
  const ownerEmail = "query-assistant-statement-family@example.com";

  try {
    seedAssistantFixtures(ownerEmail);

    const uploaded = askFirmDocumentAssistant({
      ownerEmail,
      dbPath: tempDb.dbPath,
      question: "What statements has Christopher Bakken uploaded?",
    });
    const latestBank = askFirmDocumentAssistant({
      ownerEmail,
      dbPath: tempDb.dbPath,
      question: "What is Christopher Bakken's latest bank statement?",
    });
    const creditCard = askFirmDocumentAssistant({
      ownerEmail,
      dbPath: tempDb.dbPath,
      question: "Do we have a credit card statement for Christopher Bakken on file?",
    });

    assert.equal(uploaded.status, "answered");
    assert.equal(uploaded.intent, "statement_list");
    assert.match(uploaded.answer, /3 statements/i);
    assert.match(uploaded.answer, /across/i);
    assert.ok(uploaded.details.some((detail) => /Checking/i.test(detail)));
    assert.ok(uploaded.details.some((detail) => /Savings/i.test(detail)));
    assert.ok(uploaded.details.some((detail) => /401\(k\)/i.test(detail)));

    assert.equal(latestBank.status, "answered");
    assert.equal(latestBank.intent, "latest_account_document");
    assert.match(latestBank.answer, /christopher-checking-2026\.pdf/i);
    assert.match(latestBank.answer, /latest bank statement/i);
    assert.equal(latestBank.sources[0]?.accountType, "Checking");

    assert.equal(creditCard.status, "not_found");
    assert.equal(creditCard.intent, "statement_existence");
    assert.equal(creditCard.presentation.mode, "not_found");
    assert.match(creditCard.answer, /credit card statement/i);
    assert.doesNotMatch(creditCard.answer, /matching/i);
  } finally {
    tempDb.cleanup();
  }
});

test("assistant returns a full account number only when explicitly requested", () => {
  const tempDb = makeTempDbEnv("query-assistant-account-number-");
  const ownerEmail = "query-assistant-account-number@example.com";

  try {
    seedAssistantFixtures(ownerEmail);

    const explicit = askFirmDocumentAssistant({
      ownerEmail,
      dbPath: tempDb.dbPath,
      question:
        "What is Christopher Bakken's full account number from his U.S. Bank savings account?",
    });
    const ordinary = askFirmDocumentAssistant({
      ownerEmail,
      dbPath: tempDb.dbPath,
      question: "What bank statements do we have on file for Christopher Bakken?",
    });

    assert.equal(explicit.status, "answered");
    assert.equal(explicit.intent, "account_identifier_lookup");
    assert.match(explicit.answer, /665544337777/);
    assert.equal(explicit.presentation.mode, "concise_answer_with_source");
    assert.equal(explicit.presentation.shellTone, "assistant");
    assert.equal(explicit.sources[0]?.statementEndDate, "2026-05-31");

    const ordinaryRendered = [
      ordinary.answer,
      ...ordinary.details,
      ordinary.presentation.sourceLine ?? "",
    ].join("\n");

    assert.equal(ordinary.status, "answered");
    assert.equal(ordinary.sources[0]?.accountNumber, "665544332211");
    assert.equal(ordinary.sources[1]?.accountNumber, "665544337777");
    assert.doesNotMatch(ordinaryRendered, /665544337777/);
    assert.doesNotMatch(ordinaryRendered, /665544332211/);
  } finally {
    tempDb.cleanup();
  }
});

test("assistant accepts a validated retrieval-plan override without changing deterministic retrieval", () => {
  const tempDb = makeTempDbEnv("query-assistant-plan-override-");
  const ownerEmail = "query-assistant-plan-override@example.com";

  try {
    seedAssistantFixtures(ownerEmail);

    const result = askFirmDocumentAssistant({
      ownerEmail,
      dbPath: tempDb.dbPath,
      question: "What about checking?",
      retrievalQuestion: "What is Christopher Bakken's latest checking statement?",
      retrievalPlan: buildQueryAssistantRetrievalPlan(
        "What is Christopher Bakken's latest checking statement?",
      ),
    });

    assert.equal(result.status, "answered");
    assert.equal(result.intent, "latest_account_document");
    assert.match(result.answer, /christopher-checking-2026\.pdf/i);
    assert.equal(result.sources[0]?.accountType, "Checking");
  } finally {
    tempDb.cleanup();
  }
});

test("hybrid assistant uses model interpretation for simple follow-up questions", async () => {
  const tempDb = makeTempDbEnv("query-assistant-hybrid-follow-up-");
  const ownerEmail = "query-assistant-hybrid-follow-up@example.com";
  const restoreEnv = withEnv({
    DATA_INTELLIGENCE_AI_ENABLED: "true",
    DATA_INTELLIGENCE_MODEL: "gpt-5.4-mini",
    DATA_INTELLIGENCE_API_KEY: "di-key",
    DATA_INTELLIGENCE_API_URL: "https://example.com/v1/chat/completions",
  });

  try {
    seedAssistantFixtures(ownerEmail);

    const fetchCalls = [];
    const modelFetch = async (_url, init) => {
      fetchCalls.push(JSON.parse(init.body));
      const responsePayload =
        fetchCalls.length === 1
          ? {
              standaloneQuestion:
                "What is Christopher Bakken's latest checking statement?",
              retrievalPlan: buildQueryAssistantRetrievalPlan(
                "What is Christopher Bakken's latest checking statement?",
              ),
            }
          : {
              answer:
                "Christopher Bakken's latest checking statement is christopher-checking-2026.pdf.",
              title: null,
              followUp: null,
              presentationMode: null,
            };

      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify(responsePayload),
            },
          },
        ],
      });
    };

    const result = await answerDataIntelligenceQuestion({
      ownerEmail,
      dbPath: tempDb.dbPath,
      question: "What about checking?",
      history: [
        {
          role: "user",
          text: "What bank statements do we have on file for Christopher Bakken?",
        },
        {
          role: "assistant",
          text: "I found checking and savings statements for Christopher Bakken.",
        },
      ],
      conversationState: {
        activeClientName: "Christopher Bakken",
        activeFamilyScope: "bank_statement",
        activeAccountType: null,
        lastIntent: "statement_list",
        lastTurnKind: "list",
        lastPrimarySource: {
          sourceFileId: "christopher-checking-2026",
          sourceName: "christopher-checking-2026.pdf",
          documentDate: "2026-06-30",
          statementEndDate: "2026-06-30",
          institutionName: "U.S. Bank",
          accountType: "Checking",
          accountLast4: "2211",
          maskedAccountNumber: "XXXXXXXX2211",
          partyDisplayName: "Christopher Bakken",
          idType: null,
          expirationDate: null,
        },
        lastSources: [],
      },
      modelFetch,
      includeDebug: true,
    });
    const debug = result.debug?.dataIntelligenceHybrid;

    assert.equal(fetchCalls.length, 2);
    assert.equal(result.status, "answered");
    assert.equal(result.intent, "latest_account_document");
    assert.equal(result.question, "What about checking?");
    assert.match(result.answer, /checking statement/i);
    assert.equal(result.sources[0]?.accountType, "Checking");
    assert.match(
      fetchCalls[0].messages[1].content,
      /What bank statements do we have on file/,
    );
    assert.match(fetchCalls[0].messages[1].content, /structuredConversationState/);
    assert.match(fetchCalls[0].messages[1].content, /Christopher Bakken/);
    assert.ok(debug);
    assert.equal(debug.config.answeringMode, "hybrid_ai");
    assert.equal(debug.interpretation.attempted, true);
    assert.equal(debug.interpretation.succeeded, true);
    assert.equal(debug.interpretation.fallbackUsed, false);
    assert.equal(debug.interpretation.standaloneQuestion, "What is Christopher Bakken's latest checking statement?");
    assert.equal(debug.executedPlan.intent, "latest_account_document");
    assert.equal(debug.executedPlan.accountType, "Checking");
    assert.equal(debug.composition.attempted, true);
    assert.equal(debug.composition.succeeded, true);
    assert.equal(debug.composition.fallbackUsed, false);
  } finally {
    restoreEnv();
    tempDb.cleanup();
  }
});

test("hybrid assistant uses structured state to keep client context for credit-card follow-ups", async () => {
  const tempDb = makeTempDbEnv("query-assistant-hybrid-state-credit-card-");
  const ownerEmail = "query-assistant-hybrid-state-credit-card@example.com";
  const restoreEnv = withEnv({
    DATA_INTELLIGENCE_AI_ENABLED: "true",
    DATA_INTELLIGENCE_MODEL: "gpt-5.4-mini",
    DATA_INTELLIGENCE_API_KEY: "di-key",
    DATA_INTELLIGENCE_API_URL: "https://example.com/v1/chat/completions",
  });

  try {
    seedAssistantFixtures(ownerEmail);

    let callCount = 0;
    const modelFetch = async () => {
      callCount += 1;
      return Response.json({
        choices: [
          {
            message: {
              content: callCount === 1 ? "{}" : JSON.stringify({ notAnswer: true }),
            },
          },
        ],
      });
    };

    const result = await answerDataIntelligenceQuestion({
      ownerEmail,
      dbPath: tempDb.dbPath,
      question: "what about credit card?",
      conversationState: {
        activeClientName: "Christopher Bakken",
        activeFamilyScope: "bank_statement",
        activeAccountType: null,
        lastIntent: "statement_list",
        lastTurnKind: "list",
        lastPrimarySource: null,
        lastSources: [],
      },
      modelFetch,
      includeDebug: true,
    });
    const debug = result.debug?.dataIntelligenceHybrid;

    assert.equal(result.status, "not_found");
    assert.equal(result.intent, "statement_list");
    assert.match(result.answer, /credit card statement/i);
    assert.match(result.answer, /Christopher Bakken/i);
    assert.ok(debug);
    assert.equal(debug.conversationStatePresent, true);
    assert.equal(debug.interpretation.fallbackUsed, true);
    assert.equal(debug.executedPlan.familyScope, "credit_card_statement");
    assert.equal(debug.executedPlan.accountType, "Credit Card");
  } finally {
    restoreEnv();
    tempDb.cleanup();
  }
});

test("hybrid assistant uses structured state to resolve that-one account-number follow-ups", async () => {
  const tempDb = makeTempDbEnv("query-assistant-hybrid-state-that-one-");
  const ownerEmail = "query-assistant-hybrid-state-that-one@example.com";
  const restoreEnv = withEnv({
    DATA_INTELLIGENCE_AI_ENABLED: "true",
    DATA_INTELLIGENCE_MODEL: "gpt-5.4-mini",
    DATA_INTELLIGENCE_API_KEY: "di-key",
    DATA_INTELLIGENCE_API_URL: "https://example.com/v1/chat/completions",
  });

  try {
    seedAssistantFixtures(ownerEmail);

    let callCount = 0;
    const modelFetch = async () => {
      callCount += 1;
      return Response.json({
        choices: [
          {
            message: {
              content: callCount === 1 ? "{}" : JSON.stringify({ notAnswer: true }),
            },
          },
        ],
      });
    };

    const result = await answerDataIntelligenceQuestion({
      ownerEmail,
      dbPath: tempDb.dbPath,
      question: "What's the account number on that one?",
      conversationState: {
        activeClientName: "Christopher Bakken",
        activeFamilyScope: "bank_statement",
        activeAccountType: "Savings",
        lastIntent: "latest_account_document",
        lastTurnKind: "detail",
        lastPrimarySource: {
          sourceFileId: "christopher-savings-2026",
          sourceName: "christopher-savings-2026.pdf",
          documentDate: "2026-05-31",
          statementEndDate: "2026-05-31",
          institutionName: "U.S. Bank",
          accountType: "Savings",
          accountLast4: "7777",
          maskedAccountNumber: "XXXXXXXX7777",
          partyDisplayName: "Christopher Bakken",
          idType: null,
          expirationDate: null,
        },
        lastSources: [],
      },
      modelFetch,
      includeDebug: true,
    });
    const debug = result.debug?.dataIntelligenceHybrid;

    assert.equal(result.status, "answered");
    assert.equal(result.intent, "account_identifier_lookup");
    assert.match(result.answer, /665544337777/);
    assert.equal(result.sources[0]?.accountType, "Savings");
    assert.ok(debug);
    assert.equal(debug.conversationStatePresent, true);
    assert.equal(debug.interpretation.fallbackUsed, true);
    assert.equal(debug.executedPlan.intent, "account_identifier_lookup");
    assert.equal(debug.executedPlan.accountType, "Savings");
  } finally {
    restoreEnv();
    tempDb.cleanup();
  }
});

test("hybrid assistant stays conservative when that-one follow-up has no structured result reference", async () => {
  const tempDb = makeTempDbEnv("query-assistant-hybrid-state-ambiguous-");
  const ownerEmail = "query-assistant-hybrid-state-ambiguous@example.com";
  const restoreEnv = withEnv({
    DATA_INTELLIGENCE_AI_ENABLED: "true",
    DATA_INTELLIGENCE_MODEL: "gpt-5.4-mini",
    DATA_INTELLIGENCE_API_KEY: "di-key",
    DATA_INTELLIGENCE_API_URL: "https://example.com/v1/chat/completions",
  });

  try {
    seedAssistantFixtures(ownerEmail);

    const modelFetch = async () =>
      Response.json({
        choices: [{ message: { content: "{}" } }],
      });

    const result = await answerDataIntelligenceQuestion({
      ownerEmail,
      dbPath: tempDb.dbPath,
      question: "What's the account number on that one?",
      conversationState: {
        activeClientName: "Christopher Bakken",
        activeFamilyScope: "statement",
        activeAccountType: null,
        lastIntent: "statement_list",
        lastTurnKind: "list",
        lastPrimarySource: null,
        lastSources: [],
      },
      modelFetch,
      includeDebug: true,
    });

    assert.notEqual(result.status, "answered");
    assert.doesNotMatch(result.answer, /665544/);
  } finally {
    restoreEnv();
    tempDb.cleanup();
  }
});

test("hybrid state fallback does not override a new explicit client question", async () => {
  const tempDb = makeTempDbEnv("query-assistant-hybrid-state-other-client-");
  const ownerEmail = "query-assistant-hybrid-state-other-client@example.com";
  const restoreEnv = withEnv({
    DATA_INTELLIGENCE_AI_ENABLED: "true",
    DATA_INTELLIGENCE_MODEL: "gpt-5.4-mini",
    DATA_INTELLIGENCE_API_KEY: "di-key",
    DATA_INTELLIGENCE_API_URL: "https://example.com/v1/chat/completions",
  });

  try {
    seedAssistantFixtures(ownerEmail);

    const modelFetch = async () =>
      Response.json({
        choices: [{ message: { content: "{}" } }],
      });

    const result = await answerDataIntelligenceQuestion({
      ownerEmail,
      dbPath: tempDb.dbPath,
      question: "What is the latest ID for Alex Kim?",
      conversationState: {
        activeClientName: "Christopher Bakken",
        activeFamilyScope: "bank_statement",
        activeAccountType: null,
        lastIntent: "statement_list",
        lastTurnKind: "list",
        lastPrimarySource: null,
        lastSources: [],
      },
      modelFetch,
      includeDebug: true,
    });

    assert.equal(result.status, "ambiguous");
    assert.equal(result.intent, "latest_identity_document");
    assert.match(result.answer, /more than one possible client/i);
  } finally {
    restoreEnv();
    tempDb.cleanup();
  }
});

test("hybrid state fallback reuses prior question shape when a new client is introduced", async () => {
  const tempDb = makeTempDbEnv("query-assistant-hybrid-state-replacement-");
  const ownerEmail = "query-assistant-hybrid-state-replacement@example.com";
  const restoreEnv = withEnv({
    DATA_INTELLIGENCE_AI_ENABLED: "true",
    DATA_INTELLIGENCE_MODEL: "gpt-5.4-mini",
    DATA_INTELLIGENCE_API_KEY: "di-key",
    DATA_INTELLIGENCE_API_URL: "https://example.com/v1/chat/completions",
  });

  try {
    seedAssistantFixtures(ownerEmail);

    const modelFetch = async () =>
      Response.json({
        choices: [{ message: { content: "{}" } }],
      });

    const result = await answerDataIntelligenceQuestion({
      ownerEmail,
      dbPath: tempDb.dbPath,
      question: "What about Alex Kim?",
      conversationState: {
        activeClientName: "Christopher Bakken",
        activeFamilyScope: "bank_statement",
        activeAccountType: null,
        lastIntent: "statement_list",
        lastTurnKind: "list",
        lastPrimarySource: null,
        lastSources: [],
      },
      modelFetch,
      includeDebug: true,
    });
    const debug = result.debug?.dataIntelligenceHybrid;

    assert.equal(result.status, "ambiguous");
    assert.equal(result.intent, "statement_list");
    assert.ok(debug);
    assert.equal(
      debug.executedQuestion,
      "What bank statements do we have on file for Alex Kim?",
    );
    assert.doesNotMatch(result.answer, /Christopher/);
  } finally {
    restoreEnv();
    tempDb.cleanup();
  }
});

test("hybrid assistant keeps active client in scope for omitted-client ID follow-ups", async () => {
  const tempDb = makeTempDbEnv("query-assistant-hybrid-state-id-follow-up-");
  const ownerEmail = "query-assistant-hybrid-state-id-follow-up@example.com";
  const restoreEnv = withEnv({
    DATA_INTELLIGENCE_AI_ENABLED: "true",
    DATA_INTELLIGENCE_MODEL: "gpt-5.4-mini",
    DATA_INTELLIGENCE_API_KEY: "di-key",
    DATA_INTELLIGENCE_API_URL: "https://example.com/v1/chat/completions",
  });

  try {
    seedAssistantFixtures(ownerEmail);

    let callCount = 0;
    const modelFetch = async () => {
      callCount += 1;
      return Response.json({
        choices: [
          {
            message: {
              content: callCount === 1 ? "{}" : JSON.stringify({ notAnswer: true }),
            },
          },
        ],
      });
    };

    const result = await answerDataIntelligenceQuestion({
      ownerEmail,
      dbPath: tempDb.dbPath,
      question: "Do we have an ID on file?",
      conversationState: {
        activeClientName: "Christopher Bakken",
        activeFamilyScope: "bank_statement",
        activeAccountType: null,
        lastIntent: "statement_list",
        lastTurnKind: "list",
        lastPrimarySource: null,
        lastSources: [],
      },
      modelFetch,
      includeDebug: true,
    });
    const debug = result.debug?.dataIntelligenceHybrid;

    assert.equal(result.status, "answered");
    assert.equal(result.intent, "identity_document_existence");
    assert.match(result.answer, /Christopher/i);
    assert.equal(result.sources[0]?.idType, "Driver License");
    assert.ok(debug);
    assert.equal(debug.conversationStatePresent, true);
    assert.equal(debug.executedQuestion, "Do we have an ID on file for Christopher Bakken?");
    assert.equal(debug.executedPlan.intent, "identity_document_existence");
  } finally {
    restoreEnv();
    tempDb.cleanup();
  }
});

test("hybrid assistant resolves omitted-client expiration follow-up from active identity context", async () => {
  const tempDb = makeTempDbEnv("query-assistant-hybrid-state-expiration-follow-up-");
  const ownerEmail = "query-assistant-hybrid-state-expiration-follow-up@example.com";
  const restoreEnv = withEnv({
    DATA_INTELLIGENCE_AI_ENABLED: "true",
    DATA_INTELLIGENCE_MODEL: "gpt-5.4-mini",
    DATA_INTELLIGENCE_API_KEY: "di-key",
    DATA_INTELLIGENCE_API_URL: "https://example.com/v1/chat/completions",
  });

  try {
    seedAssistantFixtures(ownerEmail);

    const modelFetch = async () =>
      Response.json({
        choices: [{ message: { content: "{}" } }],
      });

    const result = await answerDataIntelligenceQuestion({
      ownerEmail,
      dbPath: tempDb.dbPath,
      question: "What's the expiration date?",
      conversationState: {
        activeClientName: "Christopher Bakken",
        activeFamilyScope: "identity_document",
        activeAccountType: null,
        lastIntent: "latest_identity_document",
        lastTurnKind: "detail",
        lastPrimarySource: {
          sourceFileId: "christopher-bakken-renewed-id",
          sourceName: "case-06-renewed-license.pdf",
          documentDate: "2024-03-01",
          statementEndDate: null,
          institutionName: null,
          accountType: null,
          accountLast4: null,
          maskedAccountNumber: null,
          partyDisplayName: "Christopher T Bakken",
          idType: "Driver License",
          expirationDate: "2032-02-03",
        },
        lastSources: [],
      },
      modelFetch,
      includeDebug: true,
    });

    assert.equal(result.status, "answered");
    assert.equal(result.intent, "latest_identity_expiration");
    assert.match(result.answer, /2032-02-03/);
  } finally {
    restoreEnv();
    tempDb.cleanup();
  }
});

test("hybrid assistant falls back to deterministic planning when model interpretation fails", async () => {
  const tempDb = makeTempDbEnv("query-assistant-hybrid-interpret-fallback-");
  const ownerEmail = "query-assistant-hybrid-interpret-fallback@example.com";
  const restoreEnv = withEnv({
    DATA_INTELLIGENCE_AI_ENABLED: "true",
    DATA_INTELLIGENCE_MODEL: "gpt-5.4-mini",
    DATA_INTELLIGENCE_API_KEY: "di-key",
    DATA_INTELLIGENCE_API_URL: "https://example.com/v1/chat/completions",
  });

  try {
    seedAssistantFixtures(ownerEmail);

    let callCount = 0;
    const modelFetch = async () => {
      callCount += 1;
      return Response.json({
        choices: [
          {
            message: {
              content: callCount === 1 ? "{}" : JSON.stringify({ notAnswer: true }),
            },
          },
        ],
      });
    };

    const result = await answerDataIntelligenceQuestion({
      ownerEmail,
      dbPath: tempDb.dbPath,
      question: "What is Christopher Bakken's latest bank statement?",
      modelFetch,
      includeDebug: true,
    });
    const debug = result.debug?.dataIntelligenceHybrid;

    assert.equal(callCount, 2);
    assert.equal(result.status, "answered");
    assert.equal(result.intent, "latest_account_document");
    assert.match(result.answer, /christopher-checking-2026\.pdf/i);
    assert.ok(debug);
    assert.equal(debug.interpretation.attempted, true);
    assert.equal(debug.interpretation.succeeded, false);
    assert.equal(debug.interpretation.failureReason, "invalid_structured_output");
    assert.equal(debug.interpretation.fallbackUsed, true);
    assert.equal(debug.executedPlan.intent, "latest_account_document");
    assert.equal(debug.composition.attempted, true);
    assert.equal(debug.composition.succeeded, false);
    assert.equal(debug.composition.fallbackUsed, true);
  } finally {
    restoreEnv();
    tempDb.cleanup();
  }
});

test("hybrid answer composition falls back when model output violates sensitive-field policy", async () => {
  const tempDb = makeTempDbEnv("query-assistant-hybrid-sensitive-fallback-");
  const ownerEmail = "query-assistant-hybrid-sensitive-fallback@example.com";
  const restoreEnv = withEnv({
    DATA_INTELLIGENCE_AI_ENABLED: "true",
    DATA_INTELLIGENCE_MODEL: "gpt-5.4-mini",
    DATA_INTELLIGENCE_API_KEY: "di-key",
    DATA_INTELLIGENCE_API_URL: "https://example.com/v1/chat/completions",
  });

  try {
    seedAssistantFixtures(ownerEmail);

    let callCount = 0;
    const modelFetch = async () => {
      callCount += 1;
      const responsePayload =
        callCount === 1
          ? {
              standaloneQuestion:
                "What is Christopher Bakken's full account number from his U.S. Bank savings account?",
              retrievalPlan: buildQueryAssistantRetrievalPlan(
                "What is Christopher Bakken's full account number from his U.S. Bank savings account?",
              ),
            }
          : {
              answer:
                "Christopher has bank statements and the savings account number is 665544337777.",
              title: null,
              followUp: null,
              presentationMode: null,
            };

      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify(responsePayload),
            },
          },
        ],
      });
    };

    const result = await answerDataIntelligenceQuestion({
      ownerEmail,
      dbPath: tempDb.dbPath,
      question: "What bank statements do we have on file for Christopher Bakken?",
      modelFetch,
      includeDebug: true,
    });
    const debug = result.debug?.dataIntelligenceHybrid;

    assert.equal(callCount, 2);
    assert.equal(result.status, "answered");
    assert.equal(result.intent, "statement_list");
    assert.doesNotMatch(result.answer, /665544337777/);
    assert.equal(result.sources[1]?.accountNumber, "665544337777");
    assert.ok(debug);
    assert.equal(debug.interpretation.sensitivePolicyBlocked, true);
    assert.equal(debug.interpretation.fallbackUsed, true);
    assert.equal(debug.interpretation.failureReason, "sensitive_account_number_policy");
    assert.equal(debug.executedPlan.intent, "statement_list");
    assert.equal(debug.composition.fallbackUsed, true);
    assert.equal(debug.composition.failureReason, "sensitive_account_number_policy");
  } finally {
    restoreEnv();
    tempDb.cleanup();
  }
});
