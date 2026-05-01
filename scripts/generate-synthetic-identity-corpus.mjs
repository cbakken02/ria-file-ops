#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const corpusRoot = path.join(repoRoot, "tests", "synthetic-id-corpus");
const casesRoot = path.join(corpusRoot, "cases");
const sharedRoot = path.join(corpusRoot, "shared");
const manifestPath = path.join(corpusRoot, "manifest.json");
const readmePath = path.join(corpusRoot, "README.md");
const stylesheetPath = path.join(sharedRoot, "id-card.css");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normalizeDateForDisplay(value) {
  if (!value) {
    return "Not shown";
  }

  const [year, month, day] = String(value).split("-");
  if (!year || !month || !day) {
    return String(value);
  }

  return `${month}/${day}/${year}`;
}

function maskGovernmentId(value) {
  if (!value) {
    return null;
  }

  const trimmed = String(value).trim();
  if (trimmed.length <= 4) {
    return trimmed;
  }

  return `${"x".repeat(Math.max(0, trimmed.length - 4))}${trimmed.slice(-4)}`;
}

function buildAddress(address) {
  return {
    kind: "identity",
    rawText: [...address.lines, `${address.city} ${address.state} ${address.postalCode}`].join(
      ", ",
    ),
    lines: [...address.lines, `${address.city} ${address.state} ${address.postalCode}`],
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    country: "US",
  };
}

function buildDates(caseDef) {
  const dates = [
    {
      id: "date-document",
      kind: "document_date",
      value: caseDef.issueDate,
      rawValue: caseDef.issueDateRaw ?? normalizeDateForDisplay(caseDef.issueDate),
      entityType: "document",
      entityId: null,
    },
    {
      id: "date-birth",
      kind: "birth_date",
      value: caseDef.birthDate,
      rawValue: caseDef.birthDateRaw ?? normalizeDateForDisplay(caseDef.birthDate),
      entityType: "party",
      entityId: "party-1",
    },
    {
      id: "date-issue",
      kind: "issue_date",
      value: caseDef.issueDate,
      rawValue: caseDef.issueDateRaw ?? normalizeDateForDisplay(caseDef.issueDate),
      entityType: "party",
      entityId: "party-1",
    },
  ];

  if ("expirationDate" in caseDef) {
    dates.push({
      id: "date-expiration",
      kind: "expiration_date",
      value: caseDef.expirationDate ?? null,
      rawValue:
        caseDef.expirationDateRaw ??
        (caseDef.expirationDate ? normalizeDateForDisplay(caseDef.expirationDate) : null),
      entityType: "party",
      entityId: "party-1",
    });
  }

  return dates;
}

function buildGovernmentId(caseDef) {
  return {
    kind: caseDef.governmentIdKind,
    value: caseDef.idNumber ?? null,
    maskedValue: maskGovernmentId(caseDef.idNumber ?? null),
    issuingAuthority: caseDef.issuingAuthority,
    expirationDateId:
      "expirationDate" in caseDef && caseDef.expirationDate !== undefined
        ? "date-expiration"
        : null,
  };
}

function buildAnswerKey(caseDef) {
  return {
    schemaVersion: "synthetic-answer-key-v1",
    caseId: caseDef.id,
    title: caseDef.title,
    documentTypeId: "identity_document",
    documentSubtype: caseDef.documentSubtype,
    parties: [
      {
        id: "party-1",
        kind: "person",
        displayName: caseDef.displayName,
        rawName: caseDef.rawName,
        birthDateId: "date-birth",
        addresses: [buildAddress(caseDef.address)],
        governmentIds: [buildGovernmentId(caseDef)],
      },
    ],
    institutions: [],
    contacts: [],
    accounts: [],
    accountParties: [],
    dates: buildDates(caseDef),
    documentFacts: {
      entityName: null,
      idType: caseDef.idType,
      taxYear: null,
    },
    normalized: {
      documentFacts: {
        entityName: null,
        idType: caseDef.idType,
        taxYear: null,
      },
      primaryFacts: {
        detectedClient: caseDef.displayName,
        detectedClient2: null,
        ownershipType: "single",
        accountLast4: null,
        accountType: null,
        custodian: null,
        documentDate: caseDef.issueDate,
        entityName: null,
        idType: caseDef.idType,
        taxYear: null,
      },
    },
    expectedAmbiguities: caseDef.expectedAmbiguities,
  };
}

function renderField(label, value, options = {}) {
  const { mono = false, strong = false } = options;
  return `
    <div class="field">
      <div class="field-label">${htmlEscape(label)}</div>
      <div class="field-value ${mono ? "mono" : ""} ${strong ? "strong" : ""}">${htmlEscape(
        value ?? "",
      )}</div>
    </div>`;
}

function renderCaseHtml(caseDef) {
  const addressCityLine = `${caseDef.address.city} ${caseDef.address.state} ${caseDef.address.postalCode}`;
  const cardLabel =
    caseDef.documentSubtype === "driver_license" ? "Driver License" : "State Identification Card";
  const idNumberDisplay = caseDef.idNumberDisplay ?? caseDef.idNumber ?? "Not fully legible";
  const issueDateDisplay =
    caseDef.issueDateDisplay ?? caseDef.issueDateRaw ?? normalizeDateForDisplay(caseDef.issueDate);
  const expirationDateDisplay =
    caseDef.expirationDateDisplay ??
    caseDef.expirationDateRaw ??
    ("expirationDate" in caseDef && caseDef.expirationDate
      ? normalizeDateForDisplay(caseDef.expirationDate)
      : "Not shown");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${htmlEscape(caseDef.title)}</title>
    <link rel="stylesheet" href="../../shared/id-card.css" />
  </head>
  <body class="${htmlEscape(caseDef.layout)}">
    <div class="page">
      <header class="doc-header">
        <div>
          <div class="issuer">${htmlEscape(caseDef.issuerDisplay)}</div>
          <div class="doc-type">${htmlEscape(cardLabel)}</div>
        </div>
        <div class="badge">${htmlEscape(caseDef.stateBadge)}</div>
      </header>

      <section class="id-card">
        <div class="identity-strip">
          <div class="portrait-box">PHOTO</div>
          <div class="identity-core">
            <div class="eyebrow">${htmlEscape(caseDef.headerKicker)}</div>
            <div class="name">${htmlEscape(caseDef.rawName)}</div>
            <div class="address-block">
              ${caseDef.address.lines
                .map((line) => `<div>${htmlEscape(line)}</div>`)
                .join("")}
              <div>${htmlEscape(addressCityLine)}</div>
            </div>
          </div>
        </div>

        <div class="field-grid">
          ${renderField("ID type", caseDef.idType, { strong: true })}
          ${renderField(caseDef.idNumberLabel, idNumberDisplay, { mono: true, strong: true })}
          ${renderField("DOB", caseDef.birthDateDisplay ?? caseDef.birthDateRaw ?? normalizeDateForDisplay(caseDef.birthDate))}
          ${renderField("ISS", issueDateDisplay)}
          ${renderField("EXP", expirationDateDisplay)}
          ${renderField("Jurisdiction", caseDef.issuingAuthority)}
        </div>

        ${
          caseDef.callouts?.length
            ? `<div class="callout-list">
                ${caseDef.callouts
                  .map((callout) => `<div class="callout">${htmlEscape(callout)}</div>`)
                  .join("")}
              </div>`
            : ""
        }
      </section>

      <section class="detail-panel">
        <h2>Document notes</h2>
        <ul>
          ${caseDef.notes.map((note) => `<li>${htmlEscape(note)}</li>`).join("")}
        </ul>
      </section>

      <footer class="footer">
        Synthetic identity document for parser testing only. ${htmlEscape(caseDef.id)}.
      </footer>
    </div>
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
- Target document type: identity_document
- Target subtype truth: ${caseDef.documentSubtype}
- Expected ID type: ${caseDef.idType}

## Expected ambiguity

${ambiguityLines}
`;
}

function buildManifest(caseDefs) {
  return {
    schemaVersion: "synthetic-id-corpus-manifest-v1",
    generationPath: {
      source: "Reusable HTML/CSS identity-card templates rendered to PDF with headless Chrome",
      script: "scripts/generate-synthetic-identity-corpus.mjs",
      stylesheet: "tests/synthetic-id-corpus/shared/id-card.css",
    },
    cases: caseDefs.map((caseDef) => ({
      id: caseDef.id,
      title: caseDef.title,
      category: caseDef.category,
      documentTypeId: "identity_document",
      documentSubtype: caseDef.documentSubtype,
      layout: caseDef.layout,
      expectedAmbiguousFields: caseDef.expectedAmbiguities.map((item) => item.fieldPath),
      artifacts: {
        html: `tests/synthetic-id-corpus/cases/${caseDef.id}/document.html`,
        pdf: `tests/synthetic-id-corpus/cases/${caseDef.id}/document.pdf`,
        answerKey: `tests/synthetic-id-corpus/cases/${caseDef.id}/answer_key.json`,
        notes: `tests/synthetic-id-corpus/cases/${caseDef.id}/notes.md`,
      },
    })),
  };
}

function renderReadme(caseDefs) {
  return `# Synthetic Identity-Document Corpus

This corpus is the identity-document counterpart to the synthetic statement corpus. It is optimized for known ground truth, deterministic regeneration, and text-extractable PDFs rather than visual perfection.

## Generation path

1. Author reusable HTML/CSS ID-card templates.
2. Keep case truth in code/data close to the rendered artifacts.
3. Render HTML to PDF with local headless Chrome.

Why this path works well here:

- Source files stay diff-friendly and easy to review.
- PDFs are reproducible locally without introducing design-tool overhead.
- Chrome-generated PDFs keep text selectable, which is useful for OCR/PDF-text parser work.
- We can add front/back or noisy variants later without changing the answer-key contract.

## Command

\`\`\`bash
node ./scripts/generate-synthetic-identity-corpus.mjs
\`\`\`

The generator writes:

- \`tests/synthetic-id-corpus/manifest.json\`
- \`tests/synthetic-id-corpus/cases/<case-id>/document.html\`
- \`tests/synthetic-id-corpus/cases/<case-id>/document.pdf\` when local Chrome is available
- \`tests/synthetic-id-corpus/cases/<case-id>/answer_key.json\`
- \`tests/synthetic-id-corpus/cases/<case-id>/notes.md\`

## Initial ${caseDefs.length} cases

| Case ID | Family | What it stresses | Expected ambiguity |
| --- | --- | --- | --- |
${caseDefs
  .map(
    (caseDef) =>
      `| \`${caseDef.id}\` | ${caseDef.category} | ${caseDef.summaryStress} | ${
        caseDef.expectedAmbiguities.length === 0
          ? "None"
          : caseDef.expectedAmbiguities.map((item) => `\`${item.fieldPath}\``).join(", ")
      } |`,
  )
  .join("\n")}

## Notes on truth format

Each \`answer_key.json\` captures semantic ground truth for future parser and SQLite assertions, including:

- \`documentTypeId\`
- \`documentSubtype\`
- \`parties\`
- \`governmentIds\`
- \`dates\`
- \`documentFacts.idType\`
- \`normalized.documentFacts\`
- \`normalized.primaryFacts\`
- \`expectedAmbiguities\`

The answer keys are meant to be the identity-document truth source even before the evaluator and SQLite projection are implemented.
`;
}

const sharedStyles = `@page {
  size: letter;
  margin: 0.55in;
}

:root {
  --ink: #17202a;
  --muted: #5f6b76;
  --line: #d4dce5;
  --card: #f7fafc;
  --accent: #204b78;
  --accent-soft: #e6eef7;
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
  color: var(--ink);
  background: white;
  font-family: "Aptos", "Segoe UI", Arial, sans-serif;
  font-size: 11pt;
  line-height: 1.35;
}

.page {
  min-height: 10in;
}

.doc-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.35in;
  margin-bottom: 0.24in;
  padding-bottom: 0.14in;
  border-bottom: 2px solid var(--accent);
}

.issuer {
  font-size: 20pt;
  font-weight: 700;
}

.doc-type {
  margin-top: 0.05in;
  color: var(--muted);
  font-weight: 600;
}

.badge {
  padding: 0.08in 0.13in;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 700;
}

.id-card {
  background: linear-gradient(180deg, #ffffff 0%, var(--card) 100%);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 0.22in;
  margin-bottom: 0.22in;
}

.identity-strip {
  display: grid;
  grid-template-columns: 1.1in 1fr;
  gap: 0.18in;
  align-items: start;
  margin-bottom: 0.18in;
}

.portrait-box {
  height: 1.35in;
  border-radius: 12px;
  border: 1px dashed #8ea4bc;
  background: #eef4fb;
  color: #47688b;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.eyebrow {
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-size: 8.5pt;
  font-weight: 700;
  margin-bottom: 0.04in;
}

.name {
  font-size: 18pt;
  font-weight: 800;
  line-height: 1.08;
  margin-bottom: 0.08in;
}

.address-block {
  font-size: 11pt;
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.12in;
}

.field {
  border: 1px solid var(--line);
  border-radius: 10px;
  background: white;
  padding: 0.11in 0.12in;
}

.field-label {
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: 8.4pt;
  font-weight: 700;
  margin-bottom: 0.03in;
}

.field-value {
  font-size: 12pt;
}

.field-value.strong {
  font-weight: 700;
}

.field-value.mono {
  font-family: "SF Mono", "Menlo", "Consolas", monospace;
  font-size: 11pt;
}

.callout-list {
  display: grid;
  gap: 0.08in;
  margin-top: 0.16in;
}

.callout {
  border-left: 4px solid var(--accent);
  background: #f5f8fc;
  padding: 0.08in 0.1in;
  color: #23384f;
}

.detail-panel {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 0.16in 0.18in;
}

.detail-panel h2 {
  margin: 0 0 0.08in;
  font-size: 12.5pt;
}

.detail-panel ul {
  margin: 0;
  padding-left: 0.2in;
}

.detail-panel li + li {
  margin-top: 0.05in;
}

.footer {
  margin-top: 0.18in;
  color: var(--muted);
  font-size: 9pt;
}
`;

const cases = [
  {
    id: "case-01-wi-driver-license-clean",
    title: "Wisconsin driver license | Clean front-only ID",
    category: "Clean driver’s license",
    documentSubtype: "driver_license",
    layout: "driver-license",
    summaryStress:
      "Clean name, DOB, address, ID number, issue date, expiration date, and issuing state.",
    issuerDisplay: "WISCONSIN DEPARTMENT OF TRANSPORTATION",
    stateBadge: "WI",
    headerKicker: "Operator license front",
    idType: "Driver License",
    governmentIdKind: "driver_license",
    issuingAuthority: "WI",
    displayName: "Melissa A Rivera",
    rawName: "MELISSA A RIVERA",
    birthDate: "1991-07-14",
    birthDateRaw: "07/14/1991",
    birthDateDisplay: "07/14/1991",
    issueDate: "2024-05-09",
    issueDateRaw: "05/09/2024",
    issueDateDisplay: "05/09/2024",
    expirationDate: "2032-07-14",
    expirationDateRaw: "07/14/2032",
    expirationDateDisplay: "07/14/2032",
    idNumberLabel: "DLN",
    idNumber: "RIVRM910714WI",
    address: {
      lines: ["4478 MAPLE TRACE DR"],
      city: "MIDDLETON",
      state: "WI",
      postalCode: "53562-1940",
    },
    callouts: [
      "Class D operator license.",
      "Clean front-only layout with no competing footer text.",
    ],
    expectedAmbiguities: [],
    notes: [
      "Baseline clean driver license with fully legible core fields.",
      "Useful first positive case for identity-document canonical extraction.",
      "Should produce one person, one government ID, and three meaningful dates.",
    ],
  },
  {
    id: "case-02-co-state-id-clean",
    title: "Colorado state ID | Clean front-only ID",
    category: "Clean state ID",
    documentSubtype: "state_id",
    layout: "state-id",
    summaryStress:
      "State ID should not be forced into Driver License while preserving the same core identity fields.",
    issuerDisplay: "COLORADO DEPARTMENT OF REVENUE",
    stateBadge: "CO",
    headerKicker: "Identification card front",
    idType: "State ID",
    governmentIdKind: "state_id",
    issuingAuthority: "CO",
    displayName: "Jordan P Ellis",
    rawName: "JORDAN P ELLIS",
    birthDate: "1988-11-22",
    birthDateRaw: "11/22/1988",
    birthDateDisplay: "11/22/1988",
    issueDate: "2023-08-18",
    issueDateRaw: "08/18/2023",
    issueDateDisplay: "08/18/2023",
    expirationDate: "2031-11-22",
    expirationDateRaw: "11/22/2031",
    expirationDateDisplay: "11/22/2031",
    idNumberLabel: "ID NO",
    idNumber: "COID-882211-547",
    address: {
      lines: ["1187 CEDAR POINT AVE"],
      city: "LAKEWOOD",
      state: "CO",
      postalCode: "80228",
    },
    callouts: [
      "State identification card, not a driving credential.",
      "Designed to stress idType and governmentId.kind separation.",
    ],
    expectedAmbiguities: [],
    notes: [
      "Baseline clean state ID case.",
      "Important negative control against over-labeling all IDs as Driver License.",
      "Uses the same core field surface as the driver-license baseline.",
    ],
  },
  {
    id: "case-05-avery-demo-driver-license-old-expired",
    title: "Avery Demo driver license | Older expired Wisconsin license",
    category: "Older expired license for the same person",
    documentSubtype: "driver_license",
    layout: "driver-license",
    summaryStress:
      "Older expired license for Avery Demo to support later latest-ID and expired-vs-current tests.",
    issuerDisplay: "WISCONSIN DEPARTMENT OF TRANSPORTATION",
    stateBadge: "WI",
    headerKicker: "Expired operator license",
    idType: "Driver License",
    governmentIdKind: "driver_license",
    issuingAuthority: "WI",
    displayName: "Avery T Demo",
    rawName: "AVERY T DEMO",
    birthDate: "1985-02-03",
    birthDateRaw: "02/03/1985",
    birthDateDisplay: "02/03/1985",
    issueDate: "2016-01-15",
    issueDateRaw: "01/15/2016",
    issueDateDisplay: "01/15/2016",
    expirationDate: "2020-02-03",
    expirationDateRaw: "02/03/2020",
    expirationDateDisplay: "02/03/2020",
    idNumberLabel: "DLN",
    idNumber: "BAKKC85020316",
    address: {
      lines: ["N1345 MAPLE HILLS DR"],
      city: "FONTANA",
      state: "WI",
      postalCode: "53125-1921",
    },
    callouts: [
      "Expired credential for the same person who appears in a newer renewal case.",
      "Address reflects an older mailing record for later change-over-time tests.",
    ],
    expectedAmbiguities: [],
    notes: [
      "Supports later tests for expired ID detection.",
      "Pairs with the renewed/current Avery Demo case.",
      "Keeps the same name and DOB while preserving an older address/version.",
    ],
  },
  {
    id: "case-06-avery-demo-driver-license-renewed-current",
    title: "Avery Demo driver license | Renewed current Wisconsin license",
    category: "Newer renewed/current license for the same person",
    documentSubtype: "driver_license",
    layout: "driver-license",
    summaryStress:
      "Newer unexpired replacement license for the same person, suitable for latest-ID and latest-address tests.",
    issuerDisplay: "WISCONSIN DEPARTMENT OF TRANSPORTATION",
    stateBadge: "WI",
    headerKicker: "Renewed operator license",
    idType: "Driver License",
    governmentIdKind: "driver_license",
    issuingAuthority: "WI",
    displayName: "Avery T Demo",
    rawName: "AVERY T DEMO",
    birthDate: "1985-02-03",
    birthDateRaw: "02/03/1985",
    birthDateDisplay: "02/03/1985",
    issueDate: "2024-03-01",
    issueDateRaw: "03/01/2024",
    issueDateDisplay: "03/01/2024",
    expirationDate: "2032-02-03",
    expirationDateRaw: "02/03/2032",
    expirationDateDisplay: "02/03/2032",
    idNumberLabel: "DLN",
    idNumber: "BAKKC85020324",
    address: {
      lines: ["1841 LAKE SHORE CT"],
      city: "WALWORTH",
      state: "WI",
      postalCode: "53184",
    },
    callouts: [
      "Current unexpired credential for Avery Demo.",
      "Address intentionally differs from the older expired license.",
    ],
    expectedAmbiguities: [],
    notes: [
      "Supports latest-ID and latest-address tests for the same person.",
      "Pairs with the expired Avery Demo license as a controlled replacement case.",
      "Should later be the winner for unexpired-license and latest-address queries.",
    ],
  },
  {
    id: "case-08-state-id-missing-expiration-or-unclear-id-number",
    title: "State ID | Missing expiration and unclear ID number",
    category: "Incomplete / unclear ID",
    documentSubtype: "state_id",
    layout: "state-id incomplete",
    summaryStress:
      "Conservative null-handling for a state ID with a clipped/unclear ID number and no reliable expiration date.",
    issuerDisplay: "ILLINOIS SECRETARY OF STATE",
    stateBadge: "IL",
    headerKicker: "Identification card front",
    idType: "State ID",
    governmentIdKind: "state_id",
    issuingAuthority: "IL",
    displayName: "Priya N Shah",
    rawName: "PRIYA N SHAH",
    birthDate: "1993-09-18",
    birthDateRaw: "09/18/1993",
    birthDateDisplay: "09/18/1993",
    issueDate: "2025-01-12",
    issueDateRaw: "01/12/2025",
    issueDateDisplay: "01/12/2025",
    expirationDate: null,
    expirationDateRaw: null,
    expirationDateDisplay: "Not shown",
    idNumberLabel: "ID NO",
    idNumber: null,
    idNumberDisplay: "IL-??78-41",
    address: {
      lines: ["905 EASTVIEW TER APT 3B"],
      city: "EVANSTON",
      state: "IL",
      postalCode: "60201",
    },
    callouts: [
      "Right edge of the card is clipped in the scan.",
      "Expiration field is blank or unreadable in the visible document.",
    ],
    expectedAmbiguities: [
      {
        fieldPath: "parties[0].governmentIds[0].value",
        reason: "The visible ID number is intentionally clipped and should stay unresolved.",
        expected: "null",
      },
      {
        fieldPath: "dates[expiration_date].value",
        reason: "The expiration field is intentionally missing or unreadable.",
        expected: "null",
      },
    ],
    notes: [
      "Designed to prove conservative handling of missing or partial ID facts.",
      "Issue date, name, DOB, and address remain readable even though the card is incomplete.",
      "Useful for later evaluator support around expected ambiguities.",
    ],
  },
];

function writeCaseArtifacts(caseDef) {
  const caseDir = path.join(casesRoot, caseDef.id);
  mkdirSync(caseDir, { recursive: true });

  writeFileSync(path.join(caseDir, "document.html"), `${renderCaseHtml(caseDef)}\n`);
  writeFileSync(
    path.join(caseDir, "answer_key.json"),
    `${JSON.stringify(buildAnswerKey(caseDef), null, 2)}\n`,
  );
  writeFileSync(path.join(caseDir, "notes.md"), renderNotes(caseDef));

  return caseDir;
}

function renderPdf(caseDir) {
  if (!existsSync(chromePath)) {
    return { status: "skipped", reason: "Chrome not found" };
  }

  const htmlPath = path.join(caseDir, "document.html");
  const pdfPath = path.join(caseDir, "document.pdf");

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
      reason: error instanceof Error ? error.message : "Chrome headless render failed",
    };
  }
}

mkdirSync(casesRoot, { recursive: true });
mkdirSync(sharedRoot, { recursive: true });

writeFileSync(stylesheetPath, `${sharedStyles}\n`);
writeFileSync(readmePath, `${renderReadme(cases)}\n`);

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
