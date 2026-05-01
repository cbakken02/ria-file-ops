#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const corpusRoot = path.join(repoRoot, "tests", "synthetic-corpus");
const casesRoot = path.join(corpusRoot, "cases");
const sharedRoot = path.join(corpusRoot, "shared");
const manifestPath = path.join(corpusRoot, "manifest.json");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function maskAccountNumber(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 4) {
    return null;
  }

  return `${"x".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function renderMoney(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(amount));
}

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildAddress(lines, city, state, postalCode) {
  return {
    kind: "mailing",
    rawText: [...lines, `${city} ${state} ${postalCode}`].join(", "),
    lines: [...lines, `${city} ${state} ${postalCode}`],
    city,
    state,
    postalCode,
    country: "US",
  };
}

function buildDates(statementPeriod) {
  return [
    {
      id: "date-document",
      kind: "document_date",
      value: statementPeriod.end,
      rawValue: statementPeriod.endRaw,
      entityType: "document",
      entityId: null,
    },
    {
      id: "date-period-start",
      kind: "statement_period_start",
      value: statementPeriod.start,
      rawValue: statementPeriod.startRaw,
      entityType: "document",
      entityId: null,
    },
    {
      id: "date-period-end",
      kind: "statement_period_end",
      value: statementPeriod.end,
      rawValue: statementPeriod.endRaw,
      entityType: "document",
      entityId: null,
    },
  ];
}

function buildAnswerKey(caseDef) {
  const accountParties = caseDef.accounts.flatMap((account) =>
    account.ownerIds.map((partyId, ownerIndex) => ({
      id: `${account.id}-party-${ownerIndex + 1}`,
      accountId: account.id,
      partyId,
      roles: [
        account.ownerIds.length > 1 ? "joint_owner" : "owner",
      ],
      relationshipLabel: account.ownerIds.length > 1 ? "Joint owner" : "Owner",
      allocationPercent: null,
    })),
  );

  return {
    schemaVersion: "synthetic-answer-key-v1",
    caseId: caseDef.id,
    title: caseDef.title,
    documentTypeId: "account_statement",
    documentSubtype: caseDef.documentSubtype,
    parties: caseDef.parties.map((party) => ({
      id: party.id,
      kind: "person",
      displayName: party.displayName,
      rawName: party.displayName,
      addresses: [buildAddress(party.addressLines, party.city, party.state, party.postalCode)],
    })),
    institutions: [
      {
        id: caseDef.institution.id,
        name: caseDef.institution.name,
        rawName: caseDef.institution.rawName,
        addresses: [],
      },
    ],
    contacts: caseDef.contacts.map((contact, index) => ({
      id: `contact-${index + 1}`,
      institutionId: caseDef.institution.id,
      method: contact.method,
      purpose: contact.purpose,
      label: contact.label,
      value: contact.value,
      address: null,
      hoursText: contact.hoursText ?? null,
    })),
    accounts: caseDef.accounts.map((account) => ({
      id: account.id,
      institutionIds: [caseDef.institution.id],
      accountNumber: account.accountNumber,
      maskedAccountNumber: maskAccountNumber(account.accountNumber),
      accountLast4: account.accountNumber.slice(-4),
      accountType: account.accountType,
      registrationType: account.registrationType ?? null,
      statementStartDateId: "date-period-start",
      statementEndDateId: "date-period-end",
      values: account.values.map((value) => ({
        kind: value.kind,
        label: value.label,
        money: {
          amount: value.amount,
          currency: "USD",
        },
        dateId: "date-document",
      })),
    })),
    accountParties,
    dates: buildDates(caseDef.statementPeriod),
    normalized: {
      primaryFacts: caseDef.primaryFacts,
    },
    expectedAmbiguities: caseDef.expectedAmbiguities,
  };
}

function renderFactRows(rows) {
  return rows
    .map(
      (row) => `
        <div class="fact-row">
          <span>${htmlEscape(row.label)}</span>
          <span class="${row.emphasis ? "emphasis" : ""}">${htmlEscape(row.value)}</span>
        </div>`,
    )
    .join("");
}

function renderPartyBlock(party) {
  return `
    <div class="mailing-block panel">
      <div class="eyebrow">Account owner</div>
      <div class="owner-name">${htmlEscape(party.displayName)}</div>
      ${party.addressLines
        .map((line) => `<div class="address-line">${htmlEscape(line)}</div>`)
        .join("")}
      <div class="address-line">${htmlEscape(`${party.city} ${party.state} ${party.postalCode}`)}</div>
    </div>`;
}

function renderAccountTable(caseDef) {
  return `
    <div class="account-grid">
      ${caseDef.accounts
        .map((account) => {
          const accountFacts = [
            { label: "Account type", value: account.rawAccountType ?? account.accountType },
            { label: "Account number", value: account.accountNumber, emphasis: true },
            { label: "Registration", value: account.registrationType ?? "Individual" },
            { label: "Owners", value: account.ownerIds.map((id) => caseDef.parties.find((party) => party.id === id)?.displayName ?? id).join(" / ") },
          ];

          return `
            <section class="account-card">
              <div class="account-heading">
                <div>
                  <div class="account-title">${htmlEscape(account.displayLabel)}</div>
                  <div class="small-note">${htmlEscape(account.summaryNote)}</div>
                </div>
                <div class="account-chip">${htmlEscape(account.accountType)}</div>
              </div>
              <div class="two-col">
                <div class="fact-list">
                  ${renderFactRows(accountFacts)}
                </div>
                <div>
                  <table>
                    <thead>
                      <tr>
                        <th>Value label</th>
                        <th class="right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${account.values
                        .map(
                          (value) => `
                            <tr>
                              <td>${htmlEscape(value.label)}</td>
                              <td class="money">${htmlEscape(renderMoney(value.amount))}</td>
                            </tr>`,
                        )
                        .join("")}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>`;
        })
        .join("")}
    </div>`;
}

function renderContacts(caseDef) {
  return `
    <div class="contact-grid">
      ${caseDef.contacts
        .map(
          (contact) => `
            <div class="contact-card">
              <div class="eyebrow">${htmlEscape(contact.purposeLabel)}</div>
              <div class="emphasis">${htmlEscape(contact.label)}</div>
              <div>${htmlEscape(contact.value)}</div>
              ${contact.hoursText ? `<div class="small-note">${htmlEscape(contact.hoursText)}</div>` : ""}
            </div>`,
        )
        .join("")}
    </div>`;
}

function renderHighlights(caseDef) {
  return `
    <div class="pill-row">
      ${caseDef.highlights
        .map((item) => `<div class="pill">${htmlEscape(item)}</div>`)
        .join("")}
    </div>`;
}

function renderLayoutSpecificLead(caseDef) {
  if (caseDef.layout === "messy") {
    return `
      <div class="noise-banner all-caps">
        Read this statement carefully. Compare deposits, withdrawals, transfers, and electronic activity to your records. If you believe there is an error, tell us your name and account number, describe the error, and explain why you believe there is an error.
      </div>`;
  }

  if (caseDef.layout === "annuity") {
    return `
      <div class="callout">
        <div class="eyebrow">Contract overview</div>
        <div>${htmlEscape(caseDef.heroMessage)}</div>
      </div>`;
  }

  if (caseDef.layout === "retirement") {
    return `
      <div class="callout">
        <div class="eyebrow">Retirement planning note</div>
        <div>${htmlEscape(caseDef.heroMessage)}</div>
      </div>`;
  }

  return `
    <div class="callout">
      <div class="eyebrow">Statement focus</div>
      <div>${htmlEscape(caseDef.heroMessage)}</div>
    </div>`;
}

function renderDisclosures(caseDef) {
  return `
    <div class="page disclosure-page">
      <section class="section">
        <h2>Important notices</h2>
        ${caseDef.disclosures
          .map(
            (disclosure) => `
              <div class="notice-box">
                <div class="eyebrow">${htmlEscape(disclosure.title)}</div>
                <p>${htmlEscape(disclosure.body)}</p>
                ${
                  disclosure.bullets?.length
                    ? `<ul>${disclosure.bullets
                        .map((bullet) => `<li>${htmlEscape(bullet)}</li>`)
                        .join("")}</ul>`
                    : ""
                }
              </div>`,
          )
          .join("")}
      </section>
      <div class="footer-note">
        Synthetic statement for parser testing only. ${htmlEscape(caseDef.title)}.
        <span class="page-number"></span>
      </div>
    </div>`;
}

function renderStatementHtml(caseDef) {
  const primaryParty = caseDef.parties[0];
  const answerKey = buildAnswerKey(caseDef);
  const periodLabel = `${caseDef.statementPeriod.startRaw} through ${caseDef.statementPeriod.endRaw}`;
  const accountCount = String(caseDef.accounts.length);
  const ownerCount = String(caseDef.parties.length);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${htmlEscape(caseDef.title)}</title>
    <link rel="stylesheet" href="../../shared/statement.css" />
  </head>
  <body class="layout-${htmlEscape(caseDef.layout)}">
    <div class="page">
      <header class="statement-header">
        <div class="brand-bar">
          <div>
            <div class="brand-name">${htmlEscape(caseDef.institution.rawName)}</div>
            <div class="brand-subtitle">${htmlEscape(caseDef.headerKicker)}</div>
          </div>
          <div>
            <div class="statement-title">${htmlEscape(caseDef.statementTitle)}</div>
            <div class="statement-subtitle">${htmlEscape(caseDef.title)}</div>
          </div>
        </div>

        <div class="header-grid">
          ${renderPartyBlock(primaryParty)}
          <div class="snapshot-card">
            <div class="eyebrow">Statement snapshot</div>
            <div class="fact-list">
              ${renderFactRows([
                { label: "Statement period", value: periodLabel, emphasis: true },
                { label: "Document date", value: caseDef.statementPeriod.endRaw },
                { label: "Owners shown", value: ownerCount },
                { label: "Accounts shown", value: accountCount },
              ])}
            </div>
          </div>
        </div>
      </header>

      ${renderLayoutSpecificLead(caseDef)}

      <section class="section">
        <h2>Highlights</h2>
        ${renderHighlights(caseDef)}
      </section>

      <section class="section">
        <h2>Account summary</h2>
        ${renderAccountTable(caseDef)}
      </section>

      <section class="section two-col">
        <div>
          <h2>Service contacts</h2>
          ${renderContacts(caseDef)}
        </div>
        <div>
          <h2>Expected semantic truth</h2>
          <div class="panel">
            <div class="eyebrow">Primary facts</div>
            <div class="fact-list">
              ${renderFactRows([
                { label: "Document type", value: answerKey.documentTypeId },
                { label: "Subtype", value: answerKey.documentSubtype },
                { label: "Detected client", value: answerKey.normalized.primaryFacts.detectedClient ?? "null" },
                { label: "Detected client 2", value: answerKey.normalized.primaryFacts.detectedClient2 ?? "null" },
                { label: "Ownership", value: answerKey.normalized.primaryFacts.ownershipType ?? "null" },
                { label: "Custodian", value: answerKey.normalized.primaryFacts.custodian ?? "null" },
                { label: "Account type", value: answerKey.normalized.primaryFacts.accountType ?? "null" },
                { label: "Account last4", value: answerKey.normalized.primaryFacts.accountLast4 ?? "null" },
                { label: "Document date", value: answerKey.normalized.primaryFacts.documentDate ?? "null" },
              ])}
            </div>
          </div>
        </div>
      </section>

      <div class="footer-note">
        Synthetic statement for parser testing only. ${htmlEscape(caseDef.id)}.
        <span class="page-number"></span>
      </div>
    </div>

    ${renderDisclosures(caseDef)}
  </body>
</html>`;
}

function renderNotes(caseDef) {
  const ambiguityLines =
    caseDef.expectedAmbiguities.length === 0
      ? "- None. This case is intended to have one clean semantic interpretation.\n"
      : caseDef.expectedAmbiguities
          .map(
            (item) =>
              `- \`${item.fieldPath}\`: ${item.reason}. Expected resolution: \`${item.expected}\`.`,
          )
          .join("\n");

  return `# ${caseDef.title}

## What this case is testing

${caseDef.notes.map((note) => `- ${note}`).join("\n")}

## Document family

- Category: ${caseDef.category}
- Target document type: account_statement
- Target subtype truth: ${caseDef.documentSubtype}

## Expected ambiguity

${ambiguityLines}
`;
}

const cases = [
  {
    id: "case-01-us-bank-smartly-checking-single",
    title: "U.S. Bank Smartly Checking | Single-owner retail bank statement",
    category: "Simple single-account bank statement",
    documentSubtype: "bank_statement",
    layout: "bank",
    headerKicker: "Consumer deposit statement",
    statementTitle: "Monthly Statement",
    heroMessage:
      "Clean retail bank statement with a branded checking product, a visible full account number, and a straightforward owner address block.",
    highlights: [
      "Single owner",
      "Raw institution name should normalize to U.S. Bank",
      "Branded account label should normalize to Checking",
    ],
    institution: {
      id: "institution-1",
      name: "U.S. Bank",
      rawName: "U.S. Bank National Association",
    },
    parties: [
      {
        id: "party-1",
        displayName: "Avery T Demo",
        addressLines: ["N1345 MAPLE HILLS DR"],
        city: "FONTANA",
        state: "WI",
        postalCode: "53125-1921",
      },
    ],
    contacts: [
      {
        label: "Customer service phone",
        method: "phone",
        purpose: "customer_service",
        purposeLabel: "Customer service",
        value: "800-555-1212",
        hoursText: "Mon-Fri 7 a.m. to 9 p.m. CT",
      },
      {
        label: "Customer service website",
        method: "website",
        purpose: "customer_service",
        purposeLabel: "Digital support",
        value: "www.usbank.com",
      },
    ],
    statementPeriod: {
      start: "2025-09-13",
      startRaw: "Sep 13, 2025",
      end: "2025-10-14",
      endRaw: "Oct 14, 2025",
    },
    accounts: [
      {
        id: "account-1",
        displayLabel: "U.S. Bank Smartly Checking",
        rawAccountType: "U.S. Bank Smartly Checking",
        accountType: "Checking",
        accountNumber: "123456789012",
        registrationType: "Individual",
        ownerIds: ["party-1"],
        summaryNote: "Retail checking account ending in 9012.",
        values: [
          { kind: "ending_balance", label: "Ending balance", amount: "4321.09" },
          { kind: "current_balance", label: "Current balance", amount: "4555.10" },
        ],
      },
    ],
    primaryFacts: {
      detectedClient: "Avery T Demo",
      detectedClient2: null,
      ownershipType: "single",
      accountLast4: "9012",
      accountType: "Checking",
      custodian: "U.S. Bank",
      documentDate: "2025-10-14",
      entityName: null,
      idType: null,
      taxYear: null,
    },
    expectedAmbiguities: [],
    notes: [
      "Owner name and mailing address are isolated in a clean header block.",
      "Institution truth intentionally uses a raw long-form bank name plus a shorter normalized custodian.",
      "Account type truth is canonical Checking even though the visible label is branded.",
    ],
    disclosures: [
      {
        title: "How to reach us",
        body:
          "Questions about your statement or account activity should be directed to customer service using the phone number or website shown on page one.",
      },
      {
        title: "Electronic activity notice",
        body:
          "Retain this statement for your records. Online banking activity, debit card usage, and scheduled transfers may appear with different posting dates than transaction dates.",
      },
    ],
  },
  {
    id: "case-02-harbor-state-premier-savings-single",
    title: "Harbor State Premier Savings | Single-owner savings statement",
    category: "Simple single-account bank statement",
    documentSubtype: "bank_statement",
    layout: "bank",
    headerKicker: "Retail deposit statement",
    statementTitle: "Monthly Savings Statement",
    heroMessage:
      "Straightforward savings statement with beginning, ending, and available balances plus a clearly labeled savings product.",
    highlights: [
      "Single owner",
      "Savings-specific wording",
      "Simple balance truth with no multi-account ambiguity",
    ],
    institution: {
      id: "institution-1",
      name: "Harbor State Bank & Trust",
      rawName: "Harbor State Bank & Trust",
    },
    parties: [
      {
        id: "party-1",
        displayName: "Danielle M Ortiz",
        addressLines: ["847 SHORELINE PASS"],
        city: "TRAVERSE CITY",
        state: "MI",
        postalCode: "49684",
      },
    ],
    contacts: [
      {
        label: "Savings support phone",
        method: "phone",
        purpose: "customer_service",
        purposeLabel: "Customer service",
        value: "877-555-0194",
      },
      {
        label: "Online banking website",
        method: "website",
        purpose: "general_support",
        purposeLabel: "Online banking",
        value: "www.harborstatebank.com",
      },
    ],
    statementPeriod: {
      start: "2026-01-01",
      startRaw: "Jan 1, 2026",
      end: "2026-01-31",
      endRaw: "Jan 31, 2026",
    },
    accounts: [
      {
        id: "account-1",
        displayLabel: "Premier Savings",
        rawAccountType: "Premier Savings",
        accountType: "Savings",
        accountNumber: "558800771234",
        registrationType: "Individual",
        ownerIds: ["party-1"],
        summaryNote: "Interest-bearing savings account ending in 1234.",
        values: [
          { kind: "beginning_balance", label: "Beginning balance", amount: "12100.00" },
          { kind: "ending_balance", label: "Ending balance", amount: "12345.67" },
          { kind: "available_balance", label: "Available balance", amount: "12345.67" },
        ],
      },
    ],
    primaryFacts: {
      detectedClient: "Danielle M Ortiz",
      detectedClient2: null,
      ownershipType: "single",
      accountLast4: "1234",
      accountType: "Savings",
      custodian: "Harbor State Bank & Trust",
      documentDate: "2026-01-31",
      entityName: null,
      idType: null,
      taxYear: null,
    },
    expectedAmbiguities: [],
    notes: [
      "A clean savings statement baseline with no need for institution-name shortening.",
      "Includes beginning and available balance fields that should stay tied to the single account.",
      "Useful as a low-noise control case for statement parsing and regression checks.",
    ],
    disclosures: [
      {
        title: "Interest information",
        body:
          "Interest earned during the statement cycle is included in the ending balance shown above.",
      },
      {
        title: "FDIC notice",
        body:
          "Deposits are insured up to applicable limits. Keep this statement with your tax and banking records.",
      },
    ],
  },
  {
    id: "case-03-fidelity-summary-brokerage-roth-ira",
    title: "Fidelity multi-account summary | Brokerage and Roth IRA",
    category: "Multi-account summary statement",
    documentSubtype: "multi_account_summary",
    layout: "summary",
    headerKicker: "Household summary statement",
    statementTitle: "Quarterly Portfolio Summary",
    heroMessage:
      "Two-account summary for a single owner. The right behavior is conservative primary facts instead of flattening one account into the whole document.",
    highlights: [
      "Single owner",
      "Two accounts at one institution",
      "Primary facts should leave account type and last4 unset",
    ],
    institution: {
      id: "institution-1",
      name: "Fidelity",
      rawName: "Fidelity Investments",
    },
    parties: [
      {
        id: "party-1",
        displayName: "Samuel J Lee",
        addressLines: ["2410 JUNIPER RIDGE AVE"],
        city: "MADISON",
        state: "WI",
        postalCode: "53705",
      },
    ],
    contacts: [
      {
        label: "Customer service phone",
        method: "phone",
        purpose: "customer_service",
        purposeLabel: "Customer service",
        value: "800-555-3438",
      },
      {
        label: "Portfolio website",
        method: "website",
        purpose: "general_support",
        purposeLabel: "Portfolio access",
        value: "www.fidelity.com",
      },
    ],
    statementPeriod: {
      start: "2026-01-01",
      startRaw: "Jan 1, 2026",
      end: "2026-03-31",
      endRaw: "Mar 31, 2026",
    },
    accounts: [
      {
        id: "account-1",
        displayLabel: "Roth IRA",
        rawAccountType: "Roth IRA",
        accountType: "Roth IRA",
        accountNumber: "321654987788",
        registrationType: "Individual retirement account",
        ownerIds: ["party-1"],
        summaryNote: "Tax-advantaged retirement account ending in 7788.",
        values: [
          { kind: "market_value", label: "Market value", amount: "125441.23" },
          { kind: "current_balance", label: "Current balance", amount: "125441.23" },
        ],
      },
      {
        id: "account-2",
        displayLabel: "Brokerage Account",
        rawAccountType: "Brokerage Account",
        accountType: "Brokerage",
        accountNumber: "908877664411",
        registrationType: "Individual",
        ownerIds: ["party-1"],
        summaryNote: "Taxable brokerage account ending in 4411.",
        values: [
          { kind: "ending_balance", label: "Ending balance", amount: "28550.44" },
          { kind: "market_value", label: "Market value", amount: "28550.44" },
        ],
      },
    ],
    primaryFacts: {
      detectedClient: "Samuel J Lee",
      detectedClient2: null,
      ownershipType: "single",
      accountLast4: null,
      accountType: null,
      custodian: "Fidelity",
      documentDate: "2026-03-31",
      entityName: null,
      idType: null,
      taxYear: null,
    },
    expectedAmbiguities: [
      {
        fieldPath: "normalized.primaryFacts.accountLast4",
        reason: "Two accounts are equally primary in the same summary statement",
        expected: "null",
      },
      {
        fieldPath: "normalized.primaryFacts.accountType",
        reason: "Two distinct account types are present in the same summary statement",
        expected: "null",
      },
    ],
    notes: [
      "Multi-account truth should preserve both accounts independently instead of flattening one.",
      "The document still has a single unambiguous owner and a single custodian.",
      "This is a good baseline for future multi-account canonical population tests.",
    ],
    disclosures: [
      {
        title: "Quarter-end valuation",
        body:
          "Market values reflect positions and cash balances as of the statement end date shown on page one.",
      },
      {
        title: "Retirement account note",
        body:
          "Contribution limits, tax treatment, and withdrawal penalties vary by account type and individual circumstances.",
      },
    ],
  },
  {
    id: "case-04-schwab-household-joint-summary",
    title: "Charles Schwab household summary | Joint brokerage and investor checking",
    category: "Multi-account summary statement",
    documentSubtype: "multi_account_summary",
    layout: "summary",
    headerKicker: "Household relationship summary",
    statementTitle: "Monthly Household Summary",
    heroMessage:
      "Joint-owner summary with two accounts and two named owners. The parser should preserve both parties and keep primary account facts conservative.",
    highlights: [
      "Joint ownership",
      "Two accounts",
      "Two detected clients in owner order",
    ],
    institution: {
      id: "institution-1",
      name: "Charles Schwab",
      rawName: "Charles Schwab & Co., Inc.",
    },
    parties: [
      {
        id: "party-1",
        displayName: "Ava R Martin",
        addressLines: ["1128 CEDAR BLUFF LN"],
        city: "DENVER",
        state: "CO",
        postalCode: "80210",
      },
      {
        id: "party-2",
        displayName: "Noah E Martin",
        addressLines: ["1128 CEDAR BLUFF LN"],
        city: "DENVER",
        state: "CO",
        postalCode: "80210",
      },
    ],
    contacts: [
      {
        label: "Client service phone",
        method: "phone",
        purpose: "customer_service",
        purposeLabel: "Client service",
        value: "877-555-7242",
      },
      {
        label: "Account access website",
        method: "website",
        purpose: "general_support",
        purposeLabel: "Account access",
        value: "www.schwab.com",
      },
    ],
    statementPeriod: {
      start: "2025-12-01",
      startRaw: "Dec 1, 2025",
      end: "2025-12-31",
      endRaw: "Dec 31, 2025",
    },
    accounts: [
      {
        id: "account-1",
        displayLabel: "Joint Brokerage",
        rawAccountType: "Joint Brokerage",
        accountType: "Brokerage",
        accountNumber: "770055556677",
        registrationType: "Joint tenants with rights of survivorship",
        ownerIds: ["party-1", "party-2"],
        summaryNote: "Primary investment account ending in 6677.",
        values: [
          { kind: "market_value", label: "Market value", amount: "340221.77" },
          { kind: "current_balance", label: "Current balance", amount: "340221.77" },
        ],
      },
      {
        id: "account-2",
        displayLabel: "Investor Checking",
        rawAccountType: "Investor Checking",
        accountType: "Checking",
        accountNumber: "880099998899",
        registrationType: "Joint tenants with rights of survivorship",
        ownerIds: ["party-1", "party-2"],
        summaryNote: "Joint checking account ending in 8899.",
        values: [
          { kind: "ending_balance", label: "Ending balance", amount: "18550.01" },
          { kind: "available_balance", label: "Available balance", amount: "18200.01" },
        ],
      },
    ],
    primaryFacts: {
      detectedClient: "Ava R Martin",
      detectedClient2: "Noah E Martin",
      ownershipType: "joint",
      accountLast4: null,
      accountType: null,
      custodian: "Charles Schwab",
      documentDate: "2025-12-31",
      entityName: null,
      idType: null,
      taxYear: null,
    },
    expectedAmbiguities: [
      {
        fieldPath: "normalized.primaryFacts.accountLast4",
        reason: "Two joint-owned accounts are shown in the same household summary",
        expected: "null",
      },
      {
        fieldPath: "normalized.primaryFacts.accountType",
        reason: "The document contains both brokerage and checking account types",
        expected: "null",
      },
    ],
    notes: [
      "Tests joint-owner detection and stable owner ordering.",
      "Each account should link to both parties via accountParties.",
      "Good case for guarding against flattening a joint summary into one primary account.",
    ],
    disclosures: [
      {
        title: "Household aggregation",
        body:
          "Relationship summaries may include more than one account registration under the same mailing address.",
      },
      {
        title: "Cash features notice",
        body:
          "Checking features and brokerage sweep arrangements are governed by separate agreements and disclosures.",
      },
    ],
  },
  {
    id: "case-05-vanguard-rollover-ira-quarterly",
    title: "Vanguard rollover IRA | Quarterly retirement statement",
    category: "Retirement / rollover-oriented statement",
    documentSubtype: "retirement_statement",
    layout: "retirement",
    headerKicker: "Retirement account statement",
    statementTitle: "Quarterly Retirement Statement",
    heroMessage:
      "Rollover IRA statement with clear retirement language and a visible rollover support contact that should remain tied to the institution.",
    highlights: [
      "Single retirement account",
      "Rollover-focused wording",
      "Conservative retirement truth with one unambiguous account",
    ],
    institution: {
      id: "institution-1",
      name: "Vanguard",
      rawName: "The Vanguard Group, Inc.",
    },
    parties: [
      {
        id: "party-1",
        displayName: "Linda K Chen",
        addressLines: ["66 PINE ORCHARD CT"],
        city: "NAPERVILLE",
        state: "IL",
        postalCode: "60540",
      },
    ],
    contacts: [
      {
        label: "Rollover support phone",
        method: "phone",
        purpose: "rollover_support",
        purposeLabel: "Rollover support",
        value: "866-555-7280",
      },
      {
        label: "Retirement website",
        method: "website",
        purpose: "general_support",
        purposeLabel: "Retirement access",
        value: "www.vanguard.com",
      },
    ],
    statementPeriod: {
      start: "2026-01-01",
      startRaw: "Jan 1, 2026",
      end: "2026-03-31",
      endRaw: "Mar 31, 2026",
    },
    accounts: [
      {
        id: "account-1",
        displayLabel: "Rollover IRA",
        rawAccountType: "Rollover IRA",
        accountType: "Rollover IRA",
        accountNumber: "550011227654",
        registrationType: "Traditional IRA rollover",
        ownerIds: ["party-1"],
        summaryNote: "Retirement rollover account ending in 7654.",
        values: [
          { kind: "beginning_balance", label: "Beginning balance", amount: "201992.10" },
          { kind: "market_value", label: "Market value", amount: "208771.32" },
        ],
      },
    ],
    primaryFacts: {
      detectedClient: "Linda K Chen",
      detectedClient2: null,
      ownershipType: "single",
      accountLast4: "7654",
      accountType: "Rollover IRA",
      custodian: "Vanguard",
      documentDate: "2026-03-31",
      entityName: null,
      idType: null,
      taxYear: null,
    },
    expectedAmbiguities: [],
    notes: [
      "Good corpus case for retirement wording that is still an account statement, not a tax form or brochure.",
      "The raw institution name is long-form but the normalized custodian is shorter.",
      "Includes a rollover support contact that future enrichment should preserve distinctly.",
    ],
    disclosures: [
      {
        title: "Rollover guidance",
        body:
          "Before requesting a rollover, review plan rules, tax considerations, and timing requirements with your tax advisor and plan administrator.",
      },
      {
        title: "Retirement account notice",
        body:
          "Investment return and principal value will fluctuate, and past performance is not a guarantee of future results.",
      },
    ],
  },
  {
    id: "case-06-empower-401k-rollover-support",
    title: "Empower 401(k) rollover support | Former employer retirement statement",
    category: "Retirement / rollover-oriented statement",
    documentSubtype: "retirement_statement",
    layout: "retirement",
    headerKicker: "Employer retirement plan statement",
    statementTitle: "Quarterly Plan Statement",
    heroMessage:
      "Former-employer 401(k) statement with explicit rollover-support language and one clearly attributable retirement account.",
    highlights: [
      "401(k) account type",
      "Rollover support contact",
      "Single-account retirement statement",
    ],
    institution: {
      id: "institution-1",
      name: "Empower",
      rawName: "Empower Retirement, LLC",
    },
    parties: [
      {
        id: "party-1",
        displayName: "Marcus D Holloway",
        addressLines: ["3901 PRAIRIE STONE RD"],
        city: "OMAHA",
        state: "NE",
        postalCode: "68144",
      },
    ],
    contacts: [
      {
        label: "Rollover support phone",
        method: "phone",
        purpose: "rollover_support",
        purposeLabel: "Rollover support",
        value: "888-555-4010",
      },
      {
        label: "Plan website",
        method: "website",
        purpose: "general_support",
        purposeLabel: "Plan access",
        value: "www.empower.com",
      },
    ],
    statementPeriod: {
      start: "2026-01-01",
      startRaw: "Jan 1, 2026",
      end: "2026-03-31",
      endRaw: "Mar 31, 2026",
    },
    accounts: [
      {
        id: "account-1",
        displayLabel: "401(k) Savings Plan",
        rawAccountType: "401(k) Savings Plan",
        accountType: "401(k)",
        accountNumber: "661122334455",
        registrationType: "Employer-sponsored retirement plan",
        ownerIds: ["party-1"],
        summaryNote: "Former employer plan account ending in 4455.",
        values: [
          { kind: "current_balance", label: "Current balance", amount: "184221.55" },
          { kind: "market_value", label: "Market value", amount: "184221.55" },
        ],
      },
    ],
    primaryFacts: {
      detectedClient: "Marcus D Holloway",
      detectedClient2: null,
      ownershipType: "single",
      accountLast4: "4455",
      accountType: "401(k)",
      custodian: "Empower",
      documentDate: "2026-03-31",
      entityName: null,
      idType: null,
      taxYear: null,
    },
    expectedAmbiguities: [],
    notes: [
      "Covers 401(k) normalization without requiring subtype-specific parser logic in the current app.",
      "Rollover-support wording is intentional for future contact-purpose evaluation.",
      "Useful for distinguishing retirement statements from general bank statements.",
    ],
    disclosures: [
      {
        title: "Distribution options",
        body:
          "Distribution, rollover, and loan availability depend on plan rules, employer elections, and applicable regulations.",
      },
      {
        title: "Participant notice",
        body:
          "Review your beneficiary election and mailing address periodically to keep plan records current.",
      },
    ],
  },
  {
    id: "case-07-jackson-fixed-indexed-annuity-annual",
    title: "Jackson fixed indexed annuity | Annual contract statement",
    category: "Annuity statement",
    documentSubtype: "annuity_statement",
    layout: "annuity",
    headerKicker: "Insurance contract statement",
    statementTitle: "Annual Contract Statement",
    heroMessage:
      "Single annuity contract statement with insurer phrasing, cash value, and a clearly named annuity product.",
    highlights: [
      "Fixed indexed annuity",
      "Cash value present",
      "Single contract owner",
    ],
    institution: {
      id: "institution-1",
      name: "Jackson",
      rawName: "Jackson National Life Insurance Company",
    },
    parties: [
      {
        id: "party-1",
        displayName: "Renee L Carter",
        addressLines: ["14 WILLOW BEND RD"],
        city: "FRANKLIN",
        state: "TN",
        postalCode: "37067",
      },
    ],
    contacts: [
      {
        label: "Contract service phone",
        method: "phone",
        purpose: "customer_service",
        purposeLabel: "Contract service",
        value: "800-555-6640",
      },
      {
        label: "Service website",
        method: "website",
        purpose: "general_support",
        purposeLabel: "Policy access",
        value: "www.jackson.com",
      },
    ],
    statementPeriod: {
      start: "2025-01-01",
      startRaw: "Jan 1, 2025",
      end: "2025-12-31",
      endRaw: "Dec 31, 2025",
    },
    accounts: [
      {
        id: "account-1",
        displayLabel: "Fixed Indexed Annuity",
        rawAccountType: "Fixed Indexed Annuity",
        accountType: "Fixed Indexed Annuity",
        accountNumber: "440012349876",
        registrationType: "Individual annuity contract",
        ownerIds: ["party-1"],
        summaryNote: "Annuity contract ending in 9876.",
        values: [
          { kind: "cash_value", label: "Cash value", amount: "151422.88" },
          { kind: "current_balance", label: "Contract value", amount: "151422.88" },
        ],
      },
    ],
    primaryFacts: {
      detectedClient: "Renee L Carter",
      detectedClient2: null,
      ownershipType: "single",
      accountLast4: "9876",
      accountType: "Fixed Indexed Annuity",
      custodian: "Jackson",
      documentDate: "2025-12-31",
      entityName: null,
      idType: null,
      taxYear: null,
    },
    expectedAmbiguities: [],
    notes: [
      "Adds annuity language and insurer naming to the corpus without introducing a separate document family yet.",
      "Cash value is the key balance truth for this case.",
      "Useful for future contact, institution, and account-type normalization checks.",
    ],
    disclosures: [
      {
        title: "Contract terms",
        body:
          "Surrender charges, rider fees, and indexed-crediting methods are governed by the annuity contract and endorsements.",
      },
      {
        title: "Insurance notice",
        body:
          "Guarantees are backed by the claims-paying ability of the issuing insurance company.",
      },
    ],
  },
  {
    id: "case-08-lakeside-credit-union-noisy-layout",
    title: "Lakeside Community Credit Union | Noisy disclosure-heavy checking statement",
    category: "Messy / noisy statement layout",
    documentSubtype: "bank_statement",
    layout: "messy",
    headerKicker: "Statement and member disclosure packet",
    statementTitle: "Monthly Member Statement",
    heroMessage:
      "Single-account checking statement intentionally mixed with noisy disclosure text, support blurbs, and all-caps warnings to stress name and account selection.",
    highlights: [
      "Noisy all-caps disclosure text",
      "Single checking account",
      "Good case for resisting body-text contamination",
    ],
    institution: {
      id: "institution-1",
      name: "Lakeside Community Credit Union",
      rawName: "Lakeside Community Credit Union",
    },
    parties: [
      {
        id: "party-1",
        displayName: "Owen P Whitaker",
        addressLines: ["920 HARBOR VIEW DR"],
        city: "MILWAUKEE",
        state: "WI",
        postalCode: "53202",
      },
    ],
    contacts: [
      {
        label: "Member service phone",
        method: "phone",
        purpose: "customer_service",
        purposeLabel: "Member service",
        value: "800-555-2210",
      },
      {
        label: "Online banking website",
        method: "website",
        purpose: "general_support",
        purposeLabel: "Online banking",
        value: "www.lakesidecu.com",
      },
    ],
    statementPeriod: {
      start: "2026-02-01",
      startRaw: "Feb 1, 2026",
      end: "2026-02-28",
      endRaw: "Feb 28, 2026",
    },
    accounts: [
      {
        id: "account-1",
        displayLabel: "Everyday Checking",
        rawAccountType: "Everyday Checking",
        accountType: "Checking",
        accountNumber: "302200110044",
        registrationType: "Individual",
        ownerIds: ["party-1"],
        summaryNote: "Primary checking account ending in 0044.",
        values: [
          { kind: "ending_balance", label: "Ending balance", amount: "2188.76" },
          { kind: "available_balance", label: "Available balance", amount: "1905.12" },
        ],
      },
    ],
    primaryFacts: {
      detectedClient: "Owen P Whitaker",
      detectedClient2: null,
      ownershipType: "single",
      accountLast4: "0044",
      accountType: "Checking",
      custodian: "Lakeside Community Credit Union",
      documentDate: "2026-02-28",
      entityName: null,
      idType: null,
      taxYear: null,
    },
    expectedAmbiguities: [],
    notes: [
      "Deliberately includes error-resolution language like 'Describe the error' to stress false-positive name extraction.",
      "Still has a clean owner/address block near the top, so ground truth remains unambiguous.",
      "Useful as a real-world hardening case for noisy retail-bank statement layouts.",
    ],
    disclosures: [
      {
        title: "Error resolution",
        body:
          "Tell us your name and account number. Describe the error. Explain why you believe there is an error or why you need more information.",
        bullets: [
          "If you believe there is an error, contact member service promptly.",
          "Review all EFT and debit card transactions each month.",
          "Retain a copy of your written notice with this statement.",
        ],
      },
      {
        title: "Federal benefit notice",
        body:
          "If you receive federal benefits, certain protections may apply. Social Security and other payments may be subject to special account review procedures.",
      },
      {
        title: "Digital banking notice",
        body:
          "For mobile deposit, card controls, alerts, and bill pay, sign in at www.lakesidecu.com or call 800-555-2210.",
      },
    ],
  },
];

function buildManifest(caseDefs) {
  return {
    schemaVersion: "synthetic-corpus-manifest-v1",
    generationPath: {
      source: "Reusable HTML/CSS templates rendered to PDF with headless Chrome",
      script: "scripts/generate-synthetic-statement-corpus.mjs",
      stylesheet: "tests/synthetic-corpus/shared/statement.css",
    },
    cases: caseDefs.map((caseDef) => ({
      id: caseDef.id,
      title: caseDef.title,
      category: caseDef.category,
      documentTypeId: "account_statement",
      documentSubtype: caseDef.documentSubtype,
      layout: caseDef.layout,
      expectedAmbiguousFields: caseDef.expectedAmbiguities.map((item) => item.fieldPath),
      artifacts: {
        html: `tests/synthetic-corpus/cases/${caseDef.id}/statement.html`,
        pdf: `tests/synthetic-corpus/cases/${caseDef.id}/statement.pdf`,
        answerKey: `tests/synthetic-corpus/cases/${caseDef.id}/answer_key.json`,
        notes: `tests/synthetic-corpus/cases/${caseDef.id}/notes.md`,
      },
    })),
  };
}

function writeCaseArtifacts(caseDef) {
  const caseDir = path.join(casesRoot, caseDef.id);
  mkdirSync(caseDir, { recursive: true });

  const answerKey = buildAnswerKey(caseDef);
  const html = renderStatementHtml(caseDef);
  const notes = renderNotes(caseDef);

  writeFileSync(path.join(caseDir, "statement.html"), `${html}\n`);
  writeFileSync(path.join(caseDir, "answer_key.json"), `${JSON.stringify(answerKey, null, 2)}\n`);
  writeFileSync(path.join(caseDir, "notes.md"), notes);

  return caseDir;
}

function renderPdf(caseDir) {
  if (!existsSync(chromePath)) {
    return { status: "skipped", reason: "Chrome not found" };
  }

  const htmlPath = path.join(caseDir, "statement.html");
  const pdfPath = path.join(caseDir, "statement.pdf");

  try {
    execFileSync(
      chromePath,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--allow-file-access-from-files",
        "--no-first-run",
        "--no-default-browser-check",
        "--no-pdf-header-footer",
        `--print-to-pdf=${pdfPath}`,
        pathToFileURL(htmlPath).href,
      ],
      {
        cwd: repoRoot,
        stdio: "ignore",
      },
    );

    return { status: "rendered", path: pdfPath };
  } catch (error) {
    return {
      status: "skipped",
      reason:
        error instanceof Error
          ? error.message
          : "Chrome headless render failed",
    };
  }
}

mkdirSync(casesRoot, { recursive: true });
mkdirSync(sharedRoot, { recursive: true });

for (const caseDef of cases) {
  const caseDir = writeCaseArtifacts(caseDef);
  const pdfResult = renderPdf(caseDir);
  const suffix =
    pdfResult.status === "rendered"
      ? "PDF rendered"
      : `PDF skipped (${pdfResult.reason ?? "unknown reason"})`;
  console.log(`${caseDef.id}: ${suffix}`);
}

writeFileSync(manifestPath, `${JSON.stringify(buildManifest(cases), null, 2)}\n`);
console.log(`Wrote manifest: ${manifestPath}`);
