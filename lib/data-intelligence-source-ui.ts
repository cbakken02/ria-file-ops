export type DataIntelligenceSource = {
  sourceFileId?: string | null;
  sourceName: string | null;
  documentDate: string | null;
  statementEndDate?: string | null;
  institutionName?: string | null;
  accountType?: string | null;
  registrationType?: string | null;
  partyDisplayName?: string | null;
  accountLast4?: string | null;
  accountNumber?: string | null;
  maskedAccountNumber?: string | null;
  valueLabel?: string | null;
  valueAmount?: string | null;
  contactValue?: string | null;
  birthDate?: string | null;
  addressText?: string | null;
  issuingAuthority?: string | null;
  expirationDate?: string | null;
  idType?: string | null;
};

export type DataIntelligenceDetailRow = {
  key: string;
  label: string;
  value: string;
  kind?: "default" | "account_number";
  revealedValue?: string | null;
};

export const DETAIL_COPY_RESET_MS = 1400;

export function hasDetailPanelContent(
  sources: DataIntelligenceSource[],
  detailCount = 0,
) {
  return sources.length > 0 || detailCount > 0;
}

export function buildSourceDetailRows(
  source: DataIntelligenceSource,
): DataIntelligenceDetailRow[] {
  return compactRows([
    row("Source file", source.sourceName),
    row("Institution", source.institutionName),
    row("Account type", source.accountType),
    row("Registration", source.registrationType),
    row("Client", source.partyDisplayName),
    accountNumberRow(source),
    row(source.valueLabel ?? "Value", source.valueAmount),
    row("Support contact", source.contactValue),
    primaryDateRow(source),
    row("ID type", source.idType),
    row("Date of birth", source.birthDate),
    row("Address", source.addressText),
    row("Issuing authority", source.issuingAuthority),
    row("Expiration", source.expirationDate),
  ]);
}

export function canCopyDetailRow(
  row: DataIntelligenceDetailRow | null | undefined,
) {
  return Boolean(row?.value);
}

export function getDetailRowCopyValue(
  row: DataIntelligenceDetailRow,
  revealed = false,
) {
  if (row.kind === "account_number" && row.revealedValue) {
    return row.revealedValue;
  }

  return getDetailRowVisibleValue(row, revealed);
}

export function getDetailRowVisibleValue(
  row: DataIntelligenceDetailRow,
  revealed = false,
) {
  if (row.kind === "account_number" && revealed && row.revealedValue) {
    return row.revealedValue;
  }

  return row.value;
}

export function canRevealDetailRow(
  row: DataIntelligenceDetailRow | null | undefined,
) {
  return Boolean(row?.kind === "account_number" && row.revealedValue);
}

export function buildDetailSectionTitle(
  index: number,
  total: number,
) {
  if (total <= 1) {
    return null;
  }

  return `Result ${index + 1}`;
}

export function buildPrimarySourceFileHref(
  sources: DataIntelligenceSource[],
) {
  const source = sources.find((candidate) => Boolean(candidate.sourceFileId));
  if (!source?.sourceFileId) {
    return null;
  }

  return `/api/drive/files/${encodeURIComponent(source.sourceFileId)}`;
}

export function toggleExpandedDetailsMessage(
  currentMessageId: string | null,
  nextMessageId: string,
) {
  return currentMessageId === nextMessageId ? null : nextMessageId;
}

function selectAccountNumberValue(source: DataIntelligenceSource) {
  if (source.maskedAccountNumber) {
    return source.maskedAccountNumber;
  }

  if (source.accountNumber) {
    return maskAccountNumberForDisplay(source.accountNumber);
  }

  if (source.accountLast4) {
    return `xxxxxxxx${source.accountLast4}`;
  }

  return null;
}

function accountNumberRow(source: DataIntelligenceSource) {
  const visibleValue = selectAccountNumberValue(source);
  if (!visibleValue) {
    return null;
  }

  return {
    key: buildDetailRowKey("Account number", source.accountNumber ?? visibleValue),
    label: "Account number",
    value: visibleValue,
    kind: "account_number" as const,
    revealedValue: source.accountNumber ?? null,
  };
}

function primaryDateRow(source: DataIntelligenceSource) {
  if (source.statementEndDate) {
    return row("End date", source.statementEndDate);
  }

  return row("Document date", source.documentDate);
}

function row(label: string, value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return {
    key: buildDetailRowKey(label, value),
    label,
    value,
    kind: "default" as const,
  };
}

function buildDetailRowKey(label: string, value: string) {
  return `${label.toLowerCase().replace(/\s+/g, "_")}::${value}`;
}

function compactRows(
  rows: Array<DataIntelligenceDetailRow | null>,
) {
  return rows.filter((value): value is DataIntelligenceDetailRow => Boolean(value));
}

function maskAccountNumberForDisplay(value: string) {
  const compactValue = value.replace(/\s+/g, "");
  if (compactValue.length <= 4) {
    return compactValue;
  }

  return `${"x".repeat(Math.max(8, compactValue.length - 4))}${compactValue.slice(-4)}`;
}
