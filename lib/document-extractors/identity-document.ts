import type { DocumentInsight } from "@/lib/document-intelligence";
import type { GoogleDriveFile } from "@/lib/google-drive";
import {
  collectAnchoredLines,
  extractFirstPageText,
  getHeaderZoneLines,
} from "@/lib/document-extractors/shared-text-zones";

export type IdentityDocumentMetadataOverlay = {
  detectedClient?: string | null;
  idType?: string | null;
};

export type IdentityDocumentExtractionContext = {
  file: GoogleDriveFile;
  rawText: string;
  normalizedText: string;
  fields: Record<string, string>;
  metadata: DocumentInsight["metadata"];
  helpers: {
    extractClientNameFromFields: (fields: Record<string, string>) => string | null;
    extractClientNameFromText: (text: string) => string | null;
    normalizeWhitespace: (value: string) => string;
  };
};

const DRIVER_LICENSE_ANCHORS = [
  /\bdriver'?s?\s+license\b/i,
  /\bdriver license\b/i,
  /\boperator'?s?\s+license\b/i,
  /\bdl\b/i,
  /\bdln\b/i,
  /\bclass\b/i,
  /\bsex\b/i,
  /\bheight\b/i,
  /\bhgt\b/i,
  /\bweight\b/i,
  /\bwt\b/i,
  /\beyes\b/i,
  /\biss\b/i,
  /\bexp\b/i,
  /\bdob\b/i,
  /\bdate of birth\b/i,
] as const;

const DRIVER_LICENSE_CUE_PATTERNS = [
  /\bclass\b/i,
  /\bsex\b/i,
  /\bheight\b/i,
  /\bhgt\b/i,
  /\bweight\b/i,
  /\bwt\b/i,
  /\beyes\b/i,
  /\biss\b/i,
  /\bexp\b/i,
  /\bdob\b/i,
  /\bdate of birth\b/i,
] as const;

const PASSPORT_ANCHORS = [
  /\bpassport\b/i,
  /\bpassport\s*(?:no|number)\b/i,
  /\bname\b/i,
  /\bsurname\b/i,
  /\bgiven names?\b/i,
  /\bnationality\b/i,
  /\bplace of birth\b/i,
  /\bdate of birth\b/i,
  /\bexpiration date\b/i,
  /\bsex\b/i,
] as const;

const PASSPORT_CUE_PATTERNS = [
  /\bpassport\b/i,
  /\bpassport\s*(?:no|number)\b/i,
  /\bnationality\b/i,
  /\bplace of birth\b/i,
  /\bdate of birth\b/i,
  /\bexpiration date\b/i,
  /\bsex\b/i,
] as const;

const LICENSE_NAME_STOPWORDS = new Set([
  "driver",
  "license",
  "class",
  "sex",
  "height",
  "hgt",
  "weight",
  "wt",
  "eyes",
  "iss",
  "exp",
  "dob",
  "date",
  "birth",
  "address",
  "state",
  "department",
  "donor",
  "organ",
  "veteran",
  "restriction",
  "restrictions",
  "endorsement",
  "endorsements",
  "customer",
  "signature",
  "card",
  "identification",
  "issued",
  "expires",
  "none",
  "usa",
  "united",
  "states",
  "male",
  "female",
]);

const PASSPORT_NAME_STOPWORDS = new Set([
  "passport",
  "passportno",
  "passportnumber",
  "nationality",
  "united",
  "states",
  "america",
  "state",
  "date",
  "birth",
  "place",
  "expiration",
  "expiry",
  "authority",
  "country",
  "sex",
  "male",
  "female",
  "name",
  "surname",
  "given",
  "givennames",
]);

export function extractIdentityDocument(
  context: IdentityDocumentExtractionContext,
): IdentityDocumentMetadataOverlay | null {
  const firstPageText = extractFirstPageText(context.rawText);
  const headerLines = getHeaderZoneLines(
    firstPageText,
    context.helpers.normalizeWhitespace,
    { minLines: 8, ratio: 0.45 },
  );
  const driverAnchoredLines = collectAnchoredLines(
    firstPageText,
    context.helpers.normalizeWhitespace,
    DRIVER_LICENSE_ANCHORS,
  );
  const driverPrioritizedLines = Array.from(new Set([...headerLines, ...driverAnchoredLines]));
  const driverPrioritizedText = context.helpers.normalizeWhitespace(
    driverPrioritizedLines.join("\n"),
  );

  if (looksLikeDriverLicense(context, driverPrioritizedText, firstPageText)) {
    const detectedClientFromFields = normalizeDetectedDriverLicenseName(
      context.helpers.extractClientNameFromFields(context.fields),
      context.helpers.normalizeWhitespace,
    );
    const detectedClient =
      detectedClientFromFields ??
      extractDriverLicenseName(
        driverPrioritizedLines,
        context.helpers.normalizeWhitespace,
      ) ??
      extractDriverLicenseName(headerLines, context.helpers.normalizeWhitespace) ??
      normalizeDetectedDriverLicenseName(
        context.helpers.extractClientNameFromText(driverPrioritizedText),
        context.helpers.normalizeWhitespace,
      ) ??
      normalizeDetectedDriverLicenseName(
        context.helpers.extractClientNameFromText(firstPageText),
        context.helpers.normalizeWhitespace,
      );

    return {
      detectedClient: detectedClient ?? undefined,
      idType: "Driver License",
    };
  }

  const passportAnchoredLines = collectAnchoredLines(
    firstPageText,
    context.helpers.normalizeWhitespace,
    PASSPORT_ANCHORS,
  );
  const passportPrioritizedLines = Array.from(
    new Set([...headerLines, ...passportAnchoredLines]),
  );
  const passportPrioritizedText = context.helpers.normalizeWhitespace(
    passportPrioritizedLines.join("\n"),
  );

  if (!looksLikePassport(context, passportPrioritizedText, firstPageText)) {
    return null;
  }

  const detectedClientFromFields = normalizeDetectedPassportName(
    context.helpers.extractClientNameFromFields(context.fields),
    context.helpers.normalizeWhitespace,
  );
  const detectedClient =
    detectedClientFromFields ??
    extractPassportName(
      passportPrioritizedLines,
      context.helpers.normalizeWhitespace,
    ) ??
    extractPassportName(headerLines, context.helpers.normalizeWhitespace) ??
    normalizeDetectedPassportName(
      context.helpers.extractClientNameFromText(passportPrioritizedText),
      context.helpers.normalizeWhitespace,
    ) ??
    normalizeDetectedPassportName(
      context.helpers.extractClientNameFromText(firstPageText),
      context.helpers.normalizeWhitespace,
    );

  return {
    detectedClient: detectedClient ?? undefined,
    idType: "Passport",
  };
}

function looksLikeDriverLicense(
  context: IdentityDocumentExtractionContext,
  prioritizedText: string,
  firstPageText: string,
) {
  const fieldText = Object.entries(context.fields)
    .map(([key, value]) => `${key} ${value}`)
    .join(" ");
  const source = `${prioritizedText}\n${firstPageText}\n${fieldText}\n${context.file.name}`;

  if (/\bpassport\b/i.test(source) || /\bsocial security\b/i.test(source)) {
    return false;
  }

  const hasDriverLabel =
    /\bdriver'?s?\s+license\b/i.test(source) ||
    /\bdriver license\b/i.test(source) ||
    /\boperator'?s?\s+license\b/i.test(source);
  const hasDlIndicator =
    /\bdl\b/i.test(source) ||
    /\bdln\b/i.test(source) ||
    /\bdl\s*(?:no|number|#)\b/i.test(source);

  const cueCount = DRIVER_LICENSE_CUE_PATTERNS.filter((pattern) =>
    pattern.test(source),
  ).length;

  return hasDriverLabel || (hasDlIndicator && cueCount >= 3);
}

function looksLikePassport(
  context: IdentityDocumentExtractionContext,
  prioritizedText: string,
  firstPageText: string,
) {
  const fieldText = Object.entries(context.fields)
    .map(([key, value]) => `${key} ${value}`)
    .join(" ");
  const source = `${prioritizedText}\n${firstPageText}\n${fieldText}\n${context.file.name}`;

  if (
    /\bdriver'?s?\s+license\b/i.test(source) ||
    /\bdriver license\b/i.test(source) ||
    /\boperator'?s?\s+license\b/i.test(source)
  ) {
    return false;
  }

  const hasPassportLabel = /\bpassport\b/i.test(source);
  const hasPassportNumber = /\bpassport\s*(?:no|number)\b/i.test(source);
  const cueCount = PASSPORT_CUE_PATTERNS.filter((pattern) => pattern.test(source)).length;

  return (hasPassportLabel && cueCount >= 3) || (hasPassportNumber && cueCount >= 2);
}

function extractDriverLicenseName(
  lines: string[],
  normalizeWhitespace: (value: string) => string,
) {
  let bestCandidate: { name: string; score: number } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const candidate = parseDriverLicenseNameLine(line, normalizeWhitespace);
    if (!candidate) {
      continue;
    }

    const neighboringText = `${lines[index - 1] ?? ""} ${lines[index + 1] ?? ""}`.toLowerCase();
    let score = 1;

    if (index <= 6) {
      score += 1;
    }
    if (line === line.toUpperCase()) {
      score += 1;
    }
    if (
      /\b(?:driver'?s?\s+license|driver license|class|sex|eyes|height|hgt|weight|wt|iss|exp|dob|date of birth)\b/i.test(
        neighboringText,
      )
    ) {
      score += 2;
    }

    if (!bestCandidate || score > bestCandidate.score) {
      bestCandidate = { name: candidate, score };
    }
  }

  return bestCandidate?.name ?? null;
}

function extractPassportName(
  lines: string[],
  normalizeWhitespace: (value: string) => string,
) {
  const labeledName = extractExplicitPassportName(lines, normalizeWhitespace);
  if (labeledName) {
    return labeledName;
  }

  const splitName = extractSplitPassportName(lines, normalizeWhitespace);
  if (splitName) {
    return splitName;
  }

  let bestCandidate: { name: string; score: number } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const candidate = parsePassportNameLine(line, normalizeWhitespace);
    if (!candidate) {
      continue;
    }

    const neighboringText =
      `${lines[index - 1] ?? ""} ${lines[index + 1] ?? ""}`.toLowerCase();
    let score = 1;

    if (index <= 6) {
      score += 1;
    }
    if (line === line.toUpperCase()) {
      score += 1;
    }
    if (
      /\b(?:passport|passport no|passport number|nationality|place of birth|date of birth|expiration date|surname|given names?)\b/i.test(
        neighboringText,
      )
    ) {
      score += 2;
    }

    if (!bestCandidate || score > bestCandidate.score) {
      bestCandidate = { name: candidate, score };
    }
  }

  return bestCandidate?.name ?? null;
}

function extractExplicitPassportName(
  lines: string[],
  normalizeWhitespace: (value: string) => string,
) {
  const patterns = [
    /(?:^|\b)name\s*[:\-]?\s*([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){1,3})$/i,
    /(?:^|\b)passport holder\s*[:\-]?\s*([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){1,3})$/i,
  ];

  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      const candidate = normalizeDetectedPassportName(
        match?.[1] ?? null,
        normalizeWhitespace,
      );
      if (candidate) {
        return candidate;
      }
    }
  }

  return null;
}

function extractSplitPassportName(
  lines: string[],
  normalizeWhitespace: (value: string) => string,
) {
  let surname: string | null = null;
  let givenNames: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    if (!surname) {
      surname =
        extractLabeledPassportValue(line, "surname", normalizeWhitespace) ??
        extractLabeledPassportValue(lines[index + 1] ?? "", "surname", normalizeWhitespace);
    }

    if (!givenNames) {
      givenNames =
        extractLabeledPassportValue(line, "given names?", normalizeWhitespace) ??
        extractLabeledPassportValue(
          lines[index + 1] ?? "",
          "given names?",
          normalizeWhitespace,
        );
    }
  }

  if (!surname || !givenNames) {
    return null;
  }

  const firstGiven = givenNames.split(/\s+/).filter(Boolean)[0] ?? "";
  const passportName = normalizeDetectedPassportName(
    `${firstGiven} ${surname}`,
    normalizeWhitespace,
  );

  return passportName;
}

function extractLabeledPassportValue(
  value: string,
  labelPattern: string,
  normalizeWhitespace: (value: string) => string,
) {
  const match = value.match(
    new RegExp(`(?:^|\\b)${labelPattern}\\s*[:\\-]?\\s*(.+)$`, "i"),
  );
  const candidate = normalizeWhitespace(match?.[1] ?? "");
  if (!candidate) {
    return null;
  }

  return candidate;
}

function parseDriverLicenseNameLine(
  value: string,
  normalizeWhitespace: (value: string) => string,
) {
  const normalized = normalizeWhitespace(value);
  if (!normalized || /\d/.test(normalized)) {
    return null;
  }

  if (
    /\b(?:driver'?s?\s+license|driver license|operator'?s?\s+license|class|sex|height|hgt|weight|wt|eyes|iss|exp|dob|date of birth|address|department|donor|organ|restriction|endorsement|signature)\b/i.test(
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

  if (tokens.some((token) => LICENSE_NAME_STOPWORDS.has(token.toLowerCase()))) {
    return null;
  }

  if (tokens.some((token) => token.length < 2)) {
    return null;
  }

  return tokens.map(toTitleCase).join(" ");
}

function normalizeDetectedDriverLicenseName(
  value: string | null | undefined,
  normalizeWhitespace: (value: string) => string,
) {
  if (!value) {
    return null;
  }

  return parseDriverLicenseNameLine(value, normalizeWhitespace);
}

function normalizeDetectedPassportName(
  value: string | null | undefined,
  normalizeWhitespace: (value: string) => string,
) {
  if (!value) {
    return null;
  }

  return parsePassportNameLine(value, normalizeWhitespace);
}

function parsePassportNameLine(
  value: string,
  normalizeWhitespace: (value: string) => string,
) {
  const normalized = normalizeWhitespace(value)
    .replace(
      /^(?:name|surname|given names?|passport holder)\s*[:\-]?\s*/i,
      "",
    )
    .replace(
      /\s+(?:nationality|place of birth|date of birth|expiration date|passport(?: no| number)?)\b.*$/i,
      "",
    );

  if (!normalized || /\d/.test(normalized)) {
    return null;
  }

  if (
    /\b(?:passport|nationality|place of birth|date of birth|expiration date|authority|country)\b/i.test(
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

  if (tokens.some((token) => PASSPORT_NAME_STOPWORDS.has(token.toLowerCase()))) {
    return null;
  }

  if (tokens.some((token) => token.length < 2)) {
    return null;
  }

  return tokens.map(toTitleCase).join(" ");
}

function toTitleCase(value: string) {
  if (!value) {
    return value;
  }

  return value[0].toUpperCase() + value.slice(1).toLowerCase();
}
