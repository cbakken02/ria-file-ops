import type { DocumentInsight } from "@/lib/document-intelligence";
import type { GoogleDriveFile } from "@/lib/google-drive";
import {
  collectAnchoredLines,
  extractFirstPageText,
  getHeaderZoneLines,
} from "@/lib/document-extractors/shared-text-zones";

type JointClients = {
  primary: string;
  secondary: string;
} | null;

export type MoneyMovementFormMetadataOverlay = {
  detectedClient?: string | null;
  detectedClient2?: string | null;
  custodian?: string | null;
  accountType?: string | null;
  accountLast4?: string | null;
};

export type MoneyMovementFormExtractionContext = {
  file: GoogleDriveFile;
  rawText: string;
  normalizedText: string;
  fields: Record<string, string>;
  metadata: DocumentInsight["metadata"];
  helpers: {
    extractClientNameFromFields: (fields: Record<string, string>) => string | null;
    extractClientNameFromText: (text: string) => string | null;
    extractJointClientNamesFromFields: (fields: Record<string, string>) => JointClients;
    extractJointClientNames: (text: string) => JointClients;
    normalizeWhitespace: (value: string) => string;
  };
};

const HEADER_ANCHORS = [
  /account owner/i,
  /account holder/i,
  /name on bank account/i,
  /bank name/i,
  /financial institution/i,
  /account number/i,
  /routing number/i,
  /checking/i,
  /savings/i,
  /ach authorization/i,
  /electronic funds transfer/i,
] as const;

export function extractMoneyMovementForm(
  context: MoneyMovementFormExtractionContext,
): MoneyMovementFormMetadataOverlay {
  const firstPageText = extractFirstPageText(context.rawText);
  const headerLines = getHeaderZoneLines(
    firstPageText,
    context.helpers.normalizeWhitespace,
    { minLines: 8, ratio: 0.35 },
  );
  const anchoredLines = collectAnchoredLines(
    firstPageText,
    context.helpers.normalizeWhitespace,
    HEADER_ANCHORS,
  );
  const prioritizedLines = [...headerLines, ...anchoredLines];
  const prioritizedLineText = prioritizedLines.join("\n");
  const prioritizedText = context.helpers.normalizeWhitespace(prioritizedLineText);

  if (!looksLikeAchBankLinking(context, prioritizedText, firstPageText)) {
    return {};
  }

  const jointClients =
    context.helpers.extractJointClientNamesFromFields(context.fields) ??
    context.helpers.extractJointClientNames(prioritizedText) ??
    context.helpers.extractJointClientNames(firstPageText);

  let detectedClient = context.helpers.extractClientNameFromFields(context.fields);
  if (jointClients) {
    detectedClient = jointClients.primary;
  }

  if (!detectedClient) {
    detectedClient =
      extractAnchoredClientName(prioritizedLines, context.helpers.normalizeWhitespace) ??
      context.helpers.extractClientNameFromText(prioritizedText) ??
      context.helpers.extractClientNameFromText(firstPageText);
  }

  const custodian =
    extractBankNameFromFields(context.fields, context.helpers.normalizeWhitespace) ??
    extractBankNameFromLines(anchoredLines, context.helpers.normalizeWhitespace) ??
    extractBankNameFromLines(headerLines, context.helpers.normalizeWhitespace) ??
    null;

  const accountType =
    extractBankAccountTypeFromFields(context.fields) ??
    extractBankAccountType(prioritizedText) ??
    extractBankAccountType(firstPageText) ??
    null;

  const accountLast4 =
    extractBankAccountLast4FromFields(context.fields) ??
    extractAnchoredBankAccountLast4(anchoredLines) ??
    extractAnchoredBankAccountLast4(headerLines) ??
    extractVoidedCheckAccountLast4(firstPageText) ??
    null;

  return {
    detectedClient: detectedClient ?? undefined,
    detectedClient2: jointClients?.secondary ?? undefined,
    custodian: custodian ?? undefined,
    accountType: accountType ?? undefined,
    accountLast4: accountLast4 ?? undefined,
  };
}

function looksLikeAchBankLinking(
  context: MoneyMovementFormExtractionContext,
  prioritizedText: string,
  firstPageText: string,
) {
  const fieldText = Object.entries(context.fields)
    .map(([key, value]) => `${key} ${value}`)
    .join(" ");
  const source = `${prioritizedText}\n${firstPageText}\n${fieldText}\n${context.file.name}`;
  const lowerSource = source.toLowerCase();

  const hasExplicitAchLabel =
    /\bach authorization\b/i.test(source) ||
    /\belectronic funds transfer\b/i.test(source) ||
    /\beft authorization\b/i.test(source) ||
    /\bdirect deposit\b/i.test(source) ||
    /\bvoid(?:ed)? check\b/i.test(source);
  const hasAccountNumber = /\b(?:account number|acct(?:ount)?\s*(?:no\.?|#))\b/i.test(source);
  const hasRoutingNumber = /\brouting number\b/i.test(source);
  const hasBankLabel =
    /\b(?:bank name|financial institution|institution name)\b/i.test(source) ||
    /\bcredit union\b/i.test(source);
  const hasDepositAccountType =
    /\bchecking\b/i.test(lowerSource) || /\bsavings\b/i.test(lowerSource);

  return hasExplicitAchLabel || ((hasAccountNumber || hasBankLabel) && hasRoutingNumber && hasDepositAccountType);
}

function extractAnchoredClientName(
  lines: string[],
  normalizeWhitespace: (value: string) => string,
) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    if (
      /\b(?:account owner|account holder|name on bank account|depositor account title)\b/i.test(
        line,
      )
    ) {
      const inlineCandidate = extractNameCandidate(
        line.replace(
          /^.*?(?:account owner|account holder|name on bank account|depositor account title)\s*[:\-]?\s*/i,
          "",
        ),
        normalizeWhitespace,
      );
      if (inlineCandidate) {
        return inlineCandidate;
      }

      const nextLineCandidate = extractNameCandidate(
        lines[index + 1] ?? "",
        normalizeWhitespace,
      );
      if (nextLineCandidate) {
        return nextLineCandidate;
      }
    }

    const achMatch = line.match(
      /(?:ach authorization|electronic funds transfer)\s+for\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})/i,
    );
    const achCandidate = normalizeWhitespace(achMatch?.[1] ?? "");
    if (achCandidate) {
      return achCandidate;
    }
  }

  return null;
}

function extractNameCandidate(
  value: string,
  normalizeWhitespace: (value: string) => string,
) {
  const cleaned = normalizeWhitespace(value).replace(
    /\s+(?:bank name|financial institution|routing number|account number|account type|checking|savings)\b.*$/i,
    "",
  );
  const match = cleaned.match(
    /^([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})$/,
  );

  return normalizeWhitespace(match?.[1] ?? "") || null;
}

function extractBankNameFromFields(
  fields: Record<string, string>,
  normalizeWhitespace: (value: string) => string,
) {
  for (const [key, value] of Object.entries(fields)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes("bank name") ||
      lowerKey.includes("financial institution") ||
      lowerKey.includes("institution name")
    ) {
      const candidate = normalizeInstitutionName(value, normalizeWhitespace);
      if (candidate) {
        return candidate;
      }
    }
  }

  return null;
}

function extractBankNameFromLines(
  lines: string[],
  normalizeWhitespace: (value: string) => string,
) {
  for (const line of lines) {
    const explicitMatch = line.match(
      /(?:bank name|financial institution|institution name)\s*[:\-]?\s*(.+)$/i,
    );
    const explicitCandidate = normalizeInstitutionName(
      explicitMatch?.[1] ?? "",
      normalizeWhitespace,
    );
    if (explicitCandidate) {
      return explicitCandidate;
    }
  }

  for (const line of lines) {
    const cleaned = normalizeInstitutionName(line, normalizeWhitespace);
    if (!cleaned) {
      continue;
    }

    if (
      /\b(bank|credit union|federal savings|national association|n\.a\.|bancorp)\b/i.test(
        cleaned,
      ) &&
      !/\b(account owner|account holder|account number|routing number|checking|savings|ach authorization|electronic funds transfer|check no)\b/i.test(
        cleaned,
      )
    ) {
      return cleaned;
    }
  }

  return null;
}

function normalizeInstitutionName(
  value: string,
  normalizeWhitespace: (value: string) => string,
) {
  const cleaned = normalizeWhitespace(value)
    .replace(/^[\s:.-]+/, "")
    .replace(/[\s:.-]+$/, "");

  if (!cleaned) {
    return null;
  }

  if (/\d{5,}/.test(cleaned)) {
    return null;
  }

  return cleaned;
}

function extractBankAccountTypeFromFields(fields: Record<string, string>) {
  for (const [key, value] of Object.entries(fields)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes("account type") ||
      lowerKey.includes("type of account") ||
      lowerKey.includes("checking") ||
      lowerKey.includes("savings")
    ) {
      const resolved = normalizeBankAccountType(value);
      if (resolved) {
        return resolved;
      }
    }
  }

  return null;
}

function extractBankAccountType(text: string) {
  const explicitMatch = text.match(
    /\b(?:account type|type of account)\s*[:\-]?\s*(checking|savings)\b/i,
  );
  if (explicitMatch?.[1]) {
    return normalizeBankAccountType(explicitMatch[1]);
  }

  const checkingCount = (text.match(/\bchecking\b/gi) ?? []).length;
  const savingsCount = (text.match(/\bsavings\b/gi) ?? []).length;

  if (checkingCount > 0 && savingsCount === 0) {
    return "Checking";
  }

  if (savingsCount > 0 && checkingCount === 0) {
    return "Savings";
  }

  return null;
}

function normalizeBankAccountType(value: string | null | undefined) {
  const normalized = (value ?? "").trim().toLowerCase();

  if (normalized.includes("checking")) {
    return "Checking";
  }

  if (normalized.includes("savings")) {
    return "Savings";
  }

  return null;
}

function extractBankAccountLast4FromFields(fields: Record<string, string>) {
  for (const [key, value] of Object.entries(fields)) {
    const lowerKey = key.toLowerCase();
    if (
      !(lowerKey.includes("account number") || lowerKey.includes("acct no") || lowerKey.includes("account #")) ||
      lowerKey.includes("routing") ||
      lowerKey.includes("check") ||
      lowerKey.includes("reference")
    ) {
      continue;
    }

    const last4 = extractLast4FromValue(value);
    if (last4) {
      return last4;
    }
  }

  return null;
}

function extractAnchoredBankAccountLast4(lines: string[]) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (
      !/\b(?:account number|acct(?:ount)?\s*(?:no\.?|#))\b/i.test(line) ||
      /\brouting number\b/i.test(line) ||
      /\bcheck(?:\s+no\.?)?\b/i.test(line)
    ) {
      continue;
    }

    const inlineMatch = line.match(
      /\b(?:account number|acct(?:ount)?\s*(?:no\.?|#))\b[^0-9A-Za-z]*(?:ending in[^0-9]*)?(?:x|#|\*{2,}|•{2,}|\.{2,}|[\s-])?(\d{4,17})\b/i,
    );
    if (inlineMatch?.[1]) {
      const digits = inlineMatch[1].replace(/\D/g, "");
      const last4 = normalizeLast4Digits(digits);
      if (last4) {
        return last4;
      }
    }

    const nextLine = lines[index + 1] ?? "";
    if (/\brouting number\b/i.test(nextLine) || /\bcheck(?:\s+no\.?)?\b/i.test(nextLine)) {
      continue;
    }

    const nextLineMatch = nextLine.match(
      /(?:x|#|\*{2,}|•{2,}|\.{2,}|[\s-])?(\d{4,17})\b/,
    );
    if (nextLineMatch?.[1]) {
      const digits = nextLineMatch[1].replace(/\D/g, "");
      const last4 = normalizeLast4Digits(digits);
      if (last4) {
        return last4;
      }
    }
  }

  return null;
}

function extractVoidedCheckAccountLast4(text: string) {
  if (!/\bvoid(?:ed)?\b/i.test(text)) {
    return null;
  }

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const groups = [...line.matchAll(/\d{3,17}/g)].map((match) => match[0] ?? "");

    for (let index = 0; index + 1 < groups.length; index += 1) {
      const current = groups[index] ?? "";
      const next = groups[index + 1] ?? "";

      if (current.length !== 9 || next.length < 6 || next.length === 9) {
        continue;
      }

      const last4 = normalizeLast4Digits(next);
      if (last4) {
        return last4;
      }
    }
  }

  return null;
}

function extractLast4FromValue(value: string) {
  const directDigits = value.replace(/\D/g, "");
  const normalizedDirect = normalizeLast4Digits(directDigits);
  if (normalizedDirect) {
    return normalizedDirect;
  }

  const maskedMatch = value.match(
    /(?:ending in[^0-9]*)?(?:x|#|\*{2,}|•{2,}|\.{2,}|[\s-])?(\d{4})\b/i,
  );
  if (maskedMatch?.[1]) {
    return normalizeLast4Digits(maskedMatch[1]);
  }

  return null;
}

function normalizeLast4Digits(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D/g, "");

  if (digits.length < 4) {
    return null;
  }

  const last4 = digits.slice(-4);
  return /^0{4}$/.test(last4) ? null : last4;
}
