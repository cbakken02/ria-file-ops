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

export type AccountStatementClientSource =
  | "fields_or_joint_clients"
  | "anchored_header"
  | "owner_address_block_lines"
  | "owner_address_block_inline"
  | "header_block_name"
  | "generic_text_fallback"
  | "generic_first_page_fallback"
  | "none";

export type AccountStatementMetadataOverlay = {
  detectedClient?: string | null;
  detectedClient2?: string | null;
  custodian?: string | null;
  accountType?: string | null;
  accountLast4?: string | null;
  documentDate?: string | null;
  statementClientSource?: AccountStatementClientSource | null;
  statementClientCandidate?: string | null;
};

export type AccountStatementExtractionContext = {
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
    extractAccountType: (
      text: string,
      fallbackText: string,
      fields?: Record<string, string>,
      documentTypeHint?: DocumentInsight["documentTypeId"],
    ) => string | null;
    extractAccountLast4: (
      text: string,
      fields: Record<string, string>,
    ) => string | null;
    normalizeWhitespace: (value: string) => string;
  };
};

const HEADER_INSTITUTION_PATTERNS: Array<[RegExp, string]> = [
  [/\bu\.?\s*s\.?\s*bank\b/i, "U.S. Bank"],
  [/\bfidelity\b/i, "Fidelity"],
  [/\bschwab\b/i, "Schwab"],
  [/\bcharles schwab\b/i, "Schwab"],
  [/\bpershing\b/i, "Pershing"],
  [/\bvanguard\b/i, "Vanguard"],
  [/\bmorgan stanley\b/i, "Morgan Stanley"],
  [/\btd ameritrade\b/i, "TD Ameritrade"],
  [/\bmerrill\b/i, "Merrill"],
  [/\braymond james\b/i, "Raymond James"],
  [/\be\*trade\b/i, "E*TRADE"],
];

const HEADER_ANCHORS = [
  /statement period/i,
  /account summary/i,
  /portfolio summary/i,
  /account number/i,
  /account owner/i,
] as const;

export function extractAccountStatement(
  context: AccountStatementExtractionContext,
): AccountStatementMetadataOverlay {
  const firstPageText = extractFirstPageText(context.rawText);
  const firstPageLines = firstPageText
    .split("\n")
    .map((line) => context.helpers.normalizeWhitespace(line))
    .filter(Boolean);
  const headerLines = getHeaderZoneLines(
    firstPageText,
    context.helpers.normalizeWhitespace,
    { minLines: 6, ratio: 0.3 },
  );
  const anchoredLines = collectAnchoredLines(
    firstPageText,
    context.helpers.normalizeWhitespace,
    HEADER_ANCHORS,
  );
  const prioritizedLineText = [...headerLines, ...anchoredLines].join("\n");
  const prioritizedText = context.helpers.normalizeWhitespace(
    prioritizedLineText,
  );

  const jointClients =
    context.helpers.extractJointClientNamesFromFields(context.fields) ??
    context.helpers.extractJointClientNames(prioritizedLineText) ??
    context.helpers.extractJointClientNames(firstPageText);

  let detectedClient = context.helpers.extractClientNameFromFields(context.fields);
  let statementClientSource: AccountStatementClientSource | null = null;
  let statementClientCandidate: string | null = null;
  if (jointClients) {
    detectedClient = jointClients.primary;
  }

  if (detectedClient) {
    statementClientSource = "fields_or_joint_clients";
    statementClientCandidate = detectedClient;
  }

  if (!detectedClient) {
    const labeledOwnerClient = extractLabeledOwnerClientName(
      [...headerLines, ...anchoredLines, ...firstPageLines],
      context.helpers.normalizeWhitespace,
    );
    const anchoredClient = extractAnchoredClientName(
      prioritizedLineText,
      context.helpers.normalizeWhitespace,
    );
    const ownerAddressBlockClient = extractOwnerAddressBlockClientName(
      firstPageLines,
      context.helpers.normalizeWhitespace,
    );
    const inlineOwnerAddressClient = extractInlineOwnerAddressBlockClientName(
      firstPageText,
      context.helpers.normalizeWhitespace,
    );
    const headerBlockClient = extractHeaderBlockClientName(
      headerLines,
      context.helpers.normalizeWhitespace,
    );
    const genericTextFallback = sanitizeStatementClientCandidate(
      context.helpers.extractClientNameFromText(prioritizedLineText),
      context.helpers.normalizeWhitespace,
    );
    const genericFirstPageFallback = sanitizeStatementClientCandidate(
      context.helpers.extractClientNameFromText(firstPageText),
      context.helpers.normalizeWhitespace,
    );

    if (labeledOwnerClient) {
      detectedClient = labeledOwnerClient;
      statementClientSource = "anchored_header";
      statementClientCandidate = labeledOwnerClient;
    } else if (anchoredClient) {
      detectedClient = anchoredClient;
      statementClientSource = "anchored_header";
      statementClientCandidate = anchoredClient;
    } else if (ownerAddressBlockClient) {
      detectedClient = ownerAddressBlockClient;
      statementClientSource = "owner_address_block_lines";
      statementClientCandidate = ownerAddressBlockClient;
    } else if (inlineOwnerAddressClient) {
      detectedClient = inlineOwnerAddressClient;
      statementClientSource = "owner_address_block_inline";
      statementClientCandidate = inlineOwnerAddressClient;
    } else if (headerBlockClient) {
      detectedClient = headerBlockClient;
      statementClientSource = "header_block_name";
      statementClientCandidate = headerBlockClient;
    } else if (genericTextFallback) {
      detectedClient = genericTextFallback;
      statementClientSource = "generic_text_fallback";
      statementClientCandidate = genericTextFallback;
    } else if (genericFirstPageFallback) {
      detectedClient = genericFirstPageFallback;
      statementClientSource = "generic_first_page_fallback";
      statementClientCandidate = genericFirstPageFallback;
    } else {
      statementClientSource = "none";
    }
  }

  const accountType =
    context.helpers.extractAccountType(
      prioritizedText,
      context.file.name,
      context.fields,
      "account_statement",
    ) ??
    context.helpers.extractAccountType(
      firstPageText,
      context.file.name,
      context.fields,
      "account_statement",
    ) ??
    extractRetailBankAccountType(prioritizedText) ??
    extractRetailBankAccountType(firstPageText) ??
    null;

  const accountLast4 =
    context.helpers.extractAccountLast4(prioritizedText, context.fields) ??
    extractHeaderAccountLast4(anchoredLines) ??
    context.helpers.extractAccountLast4(firstPageText, context.fields) ??
    null;

  const documentDate =
    extractStatementPeriodEnd(prioritizedText) ??
    extractStatementPeriodEnd(firstPageText) ??
    null;

  const custodian = extractHeaderInstitution(prioritizedText);

  return {
    detectedClient: detectedClient ?? undefined,
    detectedClient2: jointClients?.secondary ?? undefined,
    custodian: custodian ?? undefined,
    accountType: accountType ?? undefined,
    accountLast4: accountLast4 ?? undefined,
    documentDate: documentDate ?? undefined,
    statementClientSource: statementClientSource ?? undefined,
    statementClientCandidate: statementClientCandidate ?? undefined,
  };
}

function extractLabeledOwnerClientName(
  lines: string[],
  normalizeWhitespace: (value: string) => string,
) {
  for (const line of lines) {
    const match = line.match(
      /(?:^|\b)(?:account owner|primary owner|owner name)\s*[:\-]?\s*(.+)$/i,
    );
    const candidate = sanitizeStatementClientCandidate(
      match?.[1] ?? null,
      normalizeWhitespace,
    );
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function extractAnchoredClientName(
  text: string,
  normalizeWhitespace: (value: string) => string,
) {
  const patterns = [
    /(?:account owner|account owners|statement for)\s*[:\-]?\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})/gi,
    /(?:account summary|portfolio summary)\s+for\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const candidate = sanitizeStatementClientCandidate(
        normalizeWhitespace(match[1] ?? ""),
        normalizeWhitespace,
      );
      if (candidate) {
        return candidate;
      }
    }
  }

  return null;
}

function extractHeaderBlockClientName(
  lines: string[],
  normalizeWhitespace: (value: string) => string,
) {
  let bestCandidate: { name: string; score: number } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const candidate = sanitizeStatementClientCandidate(line, normalizeWhitespace);
    if (!candidate) {
      continue;
    }

    const previousLine = (lines[index - 1] ?? "").toLowerCase();
    const nextLine = (lines[index + 1] ?? "").toLowerCase();
    let score = 1;

    if (index <= 5) {
      score += 1;
    }
    if (line === line.toUpperCase()) {
      score += 1;
    }
    if (/\baccount summary\b|\bportfolio summary\b/.test(previousLine)) {
      score += 2;
    }
    if (/\d/.test(nextLine) || /\b(?:drive|street|st\b|road|rd\b|avenue|ave\b|lane|ln\b)\b/.test(nextLine)) {
      score += 2;
    }

    if (!bestCandidate || score > bestCandidate.score) {
      bestCandidate = { name: candidate, score };
    }
  }

  return bestCandidate?.name ?? null;
}

function extractOwnerAddressBlockClientName(
  lines: string[],
  normalizeWhitespace: (value: string) => string,
) {
  let bestCandidate: { name: string; score: number } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const candidate = sanitizeStatementClientCandidate(line, normalizeWhitespace);
    if (!candidate) {
      continue;
    }

    const nextLine = lines[index + 1] ?? "";
    const thirdLine = lines[index + 2] ?? "";
    const previousLine = (lines[index - 1] ?? "").toLowerCase();

    const hasStreetLine = looksLikeStreetAddress(nextLine);
    const hasCityStateZipLine = looksLikeCityStateZip(thirdLine);

    if (!hasStreetLine || !hasCityStateZipLine) {
      continue;
    }

    let score = 4;
    if (index <= 10) {
      score += 1;
    }
    if (/\baccount summary\b|\bportfolio summary\b/.test(previousLine)) {
      score += 2;
    }

    if (!bestCandidate || score > bestCandidate.score) {
      bestCandidate = { name: candidate, score };
    }
  }

  return bestCandidate?.name ?? null;
}

function extractInlineOwnerAddressBlockClientName(
  text: string,
  normalizeWhitespace: (value: string) => string,
) {
  const normalized = normalizeWhitespace(text);
  const match = normalized.match(
    /(?:^|\s)(?:[A-Z0-9]+\s+ER\s+)?([A-Z][A-Z.'-]+(?:\s+[A-Z])?(?:\s+[A-Z][A-Z.'-]+){1,2})\s+((?:[NSEW]\s+)?[NSEW]?\d{1,6}\s+[A-Z0-9.'#-]+(?:\s+[A-Z0-9.'#-]+){0,6}\s+[A-Z][A-Z]+(?:\s+[A-Z][A-Z]+){0,2}\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?)\b/,
  );

  if (!match?.[1] || !match[2]) {
    return null;
  }

  if (!looksLikeStreetAddress(match[2]) || !looksLikeCityStateZip(match[2])) {
    return null;
  }

  return sanitizeStatementClientCandidate(match[1], normalizeWhitespace);
}

function extractHeaderInstitution(text: string) {
  for (const [pattern, label] of HEADER_INSTITUTION_PATTERNS) {
    if (pattern.test(text)) {
      return label;
    }
  }

  return null;
}

function extractRetailBankAccountType(text: string) {
  const source = text.toLowerCase();

  if (
    /\bsmartly checking\b/.test(source) ||
    /\bchecking account\b/.test(source) ||
    /\bchecking\b/.test(source)
  ) {
    return "Checking";
  }

  if (/\bsavings account\b/.test(source) || /\bsavings\b/.test(source)) {
    return "Savings";
  }

  return null;
}

function extractHeaderAccountLast4(lines: string[]) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!/\baccount number\b/i.test(line)) {
      continue;
    }

    const inlineMatch = line.match(
      /\baccount number\b[^0-9A-Za-z]*(?:ending in[^0-9]*)?(?:x|#|\*{2,}|•{2,}|\.{2,}|[\s-])?(\d{4})\b/i,
    );
    if (inlineMatch?.[1]) {
      return inlineMatch[1];
    }

    const nextLine = lines[index + 1] ?? "";
    const nextLineMatch = nextLine.match(
      /(?:x|#|\*{2,}|•{2,}|\.{2,}|[\s-])?(\d{4})\b/,
    );
    if (nextLineMatch?.[1]) {
      return nextLineMatch[1];
    }
  }

  return null;
}

function extractStatementPeriodEnd(text: string) {
  const patterns = [
    /\bstatement period\b[^A-Za-z0-9]{0,6}([A-Za-z]+\s+\d{1,2},\s+20\d{2})\s*(?:to|through|\-|\u2013|\u2014)\s*([A-Za-z]+\s+\d{1,2},\s+20\d{2})/i,
    /\bstatement period\b[^0-9]{0,6}(\d{1,2}\/\d{1,2}\/\d{2,4})\s*(?:to|through|\-|\u2013|\u2014)\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /\b(?:period ending|quarter ended|year ended|as of)\s*[:\-]?\s*([A-Za-z]+\s+\d{1,2},\s+20\d{2})/i,
    /\b(?:period ending|quarter ended|year ended|as of)\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const endToken = match?.[2] ?? match?.[1];
    const normalized = normalizeDateToken(endToken);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function normalizeDateToken(value: string | null | undefined) {
  const token = (value ?? "").trim();
  if (!token) {
    return null;
  }

  const numericMatch = token.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (numericMatch) {
    const month = Number.parseInt(numericMatch[1] ?? "", 10);
    const day = Number.parseInt(numericMatch[2] ?? "", 10);
    const rawYear = Number.parseInt(numericMatch[3] ?? "", 10);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }

  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function normalizeDetectedHeaderName(
  value: string,
  normalizeWhitespace: (value: string) => string,
) {
  const normalized = normalizeWhitespace(value);
  if (!normalized || /\d/.test(normalized)) {
    return null;
  }

  if (
    /\b(?:account|summary|statement|period|bank|checking|savings|portfolio|describe|social security|federal benefits|member|fdic|questions|association|primary|parser|testing|synthetic)\b/i.test(
      normalized,
    )
  ) {
    return null;
  }

  const tokens = normalized
    .split(/\s+/)
    .map((part) => part.replace(/[^A-Za-z'-]/g, ""))
    .filter(Boolean);

  if (tokens.length < 2 || tokens.length > 4) {
    return null;
  }

  if (tokens.some((token) => token.length < 1)) {
    return null;
  }

  if (
    tokens.every((token) =>
      /^(?:and|any|describe|explain|tell|error|believe|name|number|federal|benefit|social|security|why|other|your|there|about)$/i.test(
        token,
      ),
    )
  ) {
    return null;
  }

  return tokens
    .map((token) =>
      token.length === 1
        ? token.toUpperCase()
        : token[0].toUpperCase() + token.slice(1).toLowerCase(),
    )
    .join(" ");
}

function sanitizeStatementClientCandidate(
  value: string | null | undefined,
  normalizeWhitespace: (value: string) => string,
) {
  if (!value) {
    return null;
  }

  const normalized = normalizeDetectedHeaderName(value, normalizeWhitespace);
  if (!normalized) {
    return null;
  }

  if (HEADER_INSTITUTION_PATTERNS.some(([pattern]) => pattern.test(normalized))) {
    return null;
  }

  return normalized;
}

function looksLikeStreetAddress(value: string) {
  return (
    /^(?:[NSEW]\s+)?[NSEW]?\d{1,6}\s+[A-Za-z0-9.'#-]+(?:\s+[A-Za-z0-9.'#-]+){0,6}\b/i.test(
      value,
    ) &&
    /\b(?:street|st\b|drive|dr\b|road|rd\b|avenue|ave\b|lane|ln\b|court|ct\b|boulevard|blvd\b|way)\b/i.test(
      value,
    )
  );
}

function looksLikeCityStateZip(value: string) {
  return /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/.test(value);
}
