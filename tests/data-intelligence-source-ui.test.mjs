import assert from "node:assert/strict";
import test from "node:test";

import {
  canCopyDetailRow,
  canRevealDetailRow,
  DETAIL_COPY_RESET_MS,
  buildDetailSectionTitle,
  buildPrimarySourceFileHref,
  buildSourceDetailRows,
  getDetailRowCopyValue,
  getDetailRowVisibleValue,
  hasDetailPanelContent,
  toggleExpandedDetailsMessage,
} from "../lib/data-intelligence-source-ui.ts";

test("detail panel content is available only when there are sources or details", () => {
  assert.equal(hasDetailPanelContent([], 0), false);
  assert.equal(
    hasDetailPanelContent(
      [
        {
          sourceName: "statement.pdf",
          documentDate: "2025-10-14",
        },
      ],
      0,
    ),
    true,
  );
  assert.equal(hasDetailPanelContent([], 2), true);
});

test("statement detail rows include structured fact inspection fields", () => {
  const rows = buildSourceDetailRows({
    sourceName: "07484839030544y4f4 copy.pdf",
    documentDate: "2025-10-14",
    statementEndDate: "2025-10-14",
    institutionName: "U.S. Bank",
    accountType: "Checking",
    registrationType: "Individual",
    partyDisplayName: "Christopher T Bakken",
    accountNumber: "9876543216642",
    maskedAccountNumber: "xxxx6642",
    valueLabel: "Ending balance",
    valueAmount: "$4,230.19",
    contactValue: "800-872-2657",
  });

  assert.deepEqual(rows, [
    {
      key: "source_file::07484839030544y4f4 copy.pdf",
      label: "Source file",
      kind: "default",
      value: "07484839030544y4f4 copy.pdf",
    },
    {
      key: "institution::U.S. Bank",
      label: "Institution",
      kind: "default",
      value: "U.S. Bank",
    },
    {
      key: "account_type::Checking",
      label: "Account type",
      kind: "default",
      value: "Checking",
    },
    {
      key: "registration::Individual",
      label: "Registration",
      kind: "default",
      value: "Individual",
    },
    {
      key: "client::Christopher T Bakken",
      label: "Client",
      kind: "default",
      value: "Christopher T Bakken",
    },
    {
      key: "account_number::9876543216642",
      label: "Account number",
      kind: "account_number",
      value: "xxxx6642",
      revealedValue: "9876543216642",
    },
    {
      key: "ending_balance::$4,230.19",
      label: "Ending balance",
      kind: "default",
      value: "$4,230.19",
    },
    {
      key: "support_contact::800-872-2657",
      label: "Support contact",
      kind: "default",
      value: "800-872-2657",
    },
    {
      key: "end_date::2025-10-14",
      label: "End date",
      kind: "default",
      value: "2025-10-14",
    },
  ]);
});

test("identity-document detail rows stay focused on core ID facts", () => {
  const rows = buildSourceDetailRows({
    sourceName: "wi-license.pdf",
    documentDate: "2025-02-03",
    partyDisplayName: "Christopher T Bakken",
    idType: "Driver License",
    birthDate: "1985-04-17",
    addressText: "N1345 MAPLE HILLS DR, FONTANA WI 53125-1921",
    issuingAuthority: "Wisconsin DMV",
    expirationDate: "2032-02-03",
  });

  assert.deepEqual(rows, [
    {
      key: "source_file::wi-license.pdf",
      label: "Source file",
      kind: "default",
      value: "wi-license.pdf",
    },
    {
      key: "client::Christopher T Bakken",
      label: "Client",
      kind: "default",
      value: "Christopher T Bakken",
    },
    {
      key: "document_date::2025-02-03",
      label: "Document date",
      kind: "default",
      value: "2025-02-03",
    },
    {
      key: "id_type::Driver License",
      label: "ID type",
      kind: "default",
      value: "Driver License",
    },
    {
      key: "date_of_birth::1985-04-17",
      label: "Date of birth",
      kind: "default",
      value: "1985-04-17",
    },
    {
      key: "address::N1345 MAPLE HILLS DR, FONTANA WI 53125-1921",
      label: "Address",
      kind: "default",
      value: "N1345 MAPLE HILLS DR, FONTANA WI 53125-1921",
    },
    {
      key: "issuing_authority::Wisconsin DMV",
      label: "Issuing authority",
      kind: "default",
      value: "Wisconsin DMV",
    },
    {
      key: "expiration::2032-02-03",
      label: "Expiration",
      kind: "default",
      value: "2032-02-03",
    },
  ]);
});

test("statement details fall back to document date when no statement end date exists", () => {
  const rows = buildSourceDetailRows({
    sourceName: "statement.pdf",
    documentDate: "2025-10-14",
    institutionName: "U.S. Bank",
    accountType: "Checking",
  });

  assert.ok(
    rows.some(
      (row) =>
        row.label === "Document date" && row.value === "2025-10-14",
    ),
  );
  assert.ok(rows.every((row) => row.label !== "End date"));
});

test("copy affordance exists only for rows with actual values", () => {
  assert.equal(canCopyDetailRow(null), false);
  assert.equal(
    canCopyDetailRow({
      key: "institution::U.S. Bank",
      label: "Institution",
      value: "U.S. Bank",
    }),
    true,
  );
});

test("account number copy prefers the full underlying value when available", () => {
  assert.equal(
    getDetailRowCopyValue({
      key: "account_number::xxxx6642",
      label: "Account number",
      kind: "account_number",
      value: "xxxx6642",
      revealedValue: "9876543216642",
    }),
    "9876543216642",
  );
  assert.equal(
    getDetailRowCopyValue({
      key: "account_number::9876543210",
      label: "Account number",
      kind: "account_number",
      value: "xxxx3210",
      revealedValue: "9876543210",
    }, true),
    "9876543210",
  );
});

test("account number copy falls back to the best visible value when full number is unavailable", () => {
  assert.equal(
    getDetailRowCopyValue({
      key: "account_number::xxxx6642",
      label: "Account number",
      kind: "account_number",
      value: "xxxx6642",
      revealedValue: null,
    }),
    "xxxx6642",
  );
  assert.equal(
    getDetailRowCopyValue({
      key: "account_number::xxxxxxxx6642",
      label: "Account number",
      kind: "account_number",
      value: "xxxxxxxx6642",
      revealedValue: null,
    }),
    "xxxxxxxx6642",
  );
});

test("non-account-number rows keep ordinary value copy behavior", () => {
  assert.equal(
    getDetailRowCopyValue({
      key: "institution::U.S. Bank",
      label: "Institution",
      kind: "default",
      value: "U.S. Bank",
    }),
    "U.S. Bank",
  );
});

test("account number is masked by default and can be revealed inline", () => {
  const [row] = buildSourceDetailRows({
    sourceName: "statement.pdf",
    documentDate: "2025-10-14",
    accountNumber: "9876543216642",
  }).filter((entry) => entry.label === "Account number");

  assert.equal(row?.value, "xxxxxxxxx6642");
  assert.equal(getDetailRowVisibleValue(row, false), "xxxxxxxxx6642");
  assert.equal(getDetailRowVisibleValue(row, true), "9876543216642");
});

test("eye toggle affordance appears only when a full account number exists", () => {
  assert.equal(
    canRevealDetailRow({
      key: "account_number::9876543216642",
      label: "Account number",
      kind: "account_number",
      value: "xxxxxxxxx6642",
      revealedValue: "9876543216642",
    }),
    true,
  );
  assert.equal(
    canRevealDetailRow({
      key: "account_number::xxxx6642",
      label: "Account number",
      kind: "account_number",
      value: "xxxx6642",
      revealedValue: null,
    }),
    false,
  );
  assert.equal(
    canRevealDetailRow({
      key: "institution::U.S. Bank",
      label: "Institution",
      kind: "default",
      value: "U.S. Bank",
    }),
    false,
  );
});

test("copy feedback reset timing stays compact and automatic", () => {
  assert.equal(DETAIL_COPY_RESET_MS, 1400);
});

test("primary source file href uses the first available file id", () => {
  assert.equal(
    buildPrimarySourceFileHref([
      {
        sourceName: "statement.pdf",
        documentDate: "2025-10-14",
      },
      {
        sourceFileId: "14Li39jxQxOjkaYbFOgNH503c96UR4DYJ",
        sourceName: "statement.pdf",
        documentDate: "2025-10-14",
      },
    ]),
    "/api/drive/files/14Li39jxQxOjkaYbFOgNH503c96UR4DYJ",
  );
  assert.equal(
    buildPrimarySourceFileHref([
      {
        sourceName: "statement.pdf",
        documentDate: "2025-10-14",
      },
    ]),
    null,
  );
});

test("detail section title appears only when multiple source records exist", () => {
  assert.equal(buildDetailSectionTitle(0, 1), null);
  assert.equal(buildDetailSectionTitle(1, 2), "Result 2");
});

test("expanded details toggle opens and closes predictably", () => {
  assert.equal(toggleExpandedDetailsMessage(null, "assistant-1"), "assistant-1");
  assert.equal(toggleExpandedDetailsMessage("assistant-1", "assistant-1"), null);
  assert.equal(
    toggleExpandedDetailsMessage("assistant-1", "assistant-2"),
    "assistant-2",
  );
});
