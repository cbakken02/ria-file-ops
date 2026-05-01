import type { DocumentInsight } from "@/lib/document-intelligence";
import type {
  CanonicalTaxFact,
  CanonicalTaxFactValueType,
} from "@/lib/canonical-extracted-document";
import type { GoogleDriveFile } from "@/lib/google-drive";
import {
  collectAnchoredLines,
  extractFirstPageText,
  getHeaderZoneLines,
} from "@/lib/document-extractors/shared-text-zones";

export type TaxDocumentTaxIdentifier = {
  kind: "ssn" | "ssn_last4" | "masked_ssn" | "ein" | "other";
  value: string;
};

export type TaxDocumentMetadataOverlay = {
  detectedClient?: string | null;
  custodian?: string | null;
  documentDate?: string | null;
  taxYear?: string | null;
  taxIdentifier?: TaxDocumentTaxIdentifier | null;
  taxFacts?: CanonicalTaxFact[];
};

export type TaxDocumentExtractionContext = {
  file: GoogleDriveFile;
  rawText: string;
  normalizedText: string;
  fields: Record<string, string>;
  metadata: DocumentInsight["metadata"];
  helpers: {
    extractClientNameFromFields: (fields: Record<string, string>) => string | null;
    extractClientNameFromText: (text: string) => string | null;
    extractCustodian: (text: string, fallbackText: string) => string | null;
    extractTaxYear: (text: string, fallbackText: string) => string | null;
    extractDocumentDate: (text: string) => string | null;
    normalizeWhitespace: (value: string) => string;
  };
};

const TAX_DOCUMENT_ANCHORS = [
  /\bform\s+1040\b/i,
  /\bform\s+1040x\b/i,
  /\bform\s+1099\b/i,
  /\b1099[-\s]?(?:div|int|b|r|misc|nec|da)\b/i,
  /\bform\s+w[-\s]?2\b/i,
  /\bschedule\s+k[-\s]?1\b/i,
  /\brecipient'?s?\s+name\b/i,
  /\btaxpayer'?s?\s+name\b/i,
  /\bemployee'?s?\s+name\b/i,
  /\bpayer'?s?\s+name\b/i,
  /\bemployer'?s?\s+name\b/i,
  /\bnotice\s+date\b/i,
] as const;

const CLIENT_LABEL_PATTERNS = [
  /\b(?:recipient'?s?|taxpayer'?s?|employee'?s?|participant'?s?|shareholder'?s?|partner'?s?|spouse'?s?)\s+name\b/i,
  /\bname\s+shown\s+on\s+return\b/i,
] as const;

const PAYER_LABEL_PATTERNS = [
  /\b(?:payer'?s?|employer'?s?|issuer'?s?|filer'?s?|trustee'?s?|corporation'?s?|partnership'?s?)\s+name\b/i,
  /\bfinancial\s+institution\b/i,
  /\bpayer\b/i,
  /\bemployer\b/i,
  /\bissuer\b/i,
] as const;

type TaxFactForm = "1040" | "W-2" | "1099-DIV" | "1099-R";

type TaxFactRule = {
  form: TaxFactForm;
  fieldId: string;
  label: string;
  line: string | null;
  box: string | null;
  valueType: CanonicalTaxFactValueType;
  patterns: RegExp[];
};

const MONEY_VALUE_CAPTURE = String.raw`(\(?\$?-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?\)?|\(?\$?-?\.\d{1,2}\)?)`;

function moneyPattern(source: string) {
  return new RegExp(source.replace("__VALUE__", MONEY_VALUE_CAPTURE), "i");
}

function textPattern(source: string) {
  return new RegExp(source, "i");
}

const TAX_FACT_RULES: TaxFactRule[] = [
  {
    form: "1040",
    fieldId: "form_1040.adjusted_gross_income",
    label: "Adjusted gross income",
    line: "11",
    box: null,
    valueType: "money",
    patterns: [
      moneyPattern(String.raw`(?:^|\b)(?:line\s*)?11\b\s+Adjusted\s+gross\s+income\b.{0,60}?__VALUE__`),
      moneyPattern(String.raw`\bAdjusted\s+gross\s+income\b.{0,60}?__VALUE__`),
    ],
  },
  {
    form: "1040",
    fieldId: "form_1040.taxable_income",
    label: "Taxable income",
    line: "15",
    box: null,
    valueType: "money",
    patterns: [
      moneyPattern(String.raw`(?:^|\b)(?:line\s*)?15\b\s+Taxable\s+income\b.{0,60}?__VALUE__`),
      moneyPattern(String.raw`\bTaxable\s+income\b.{0,60}?__VALUE__`),
    ],
  },
  {
    form: "1040",
    fieldId: "form_1040.total_tax",
    label: "Total tax",
    line: "24",
    box: null,
    valueType: "money",
    patterns: [
      moneyPattern(String.raw`(?:^|\b)(?:line\s*)?24\b\s+Total\s+tax\b.{0,60}?__VALUE__`),
      moneyPattern(String.raw`\bTotal\s+tax\b.{0,60}?__VALUE__`),
    ],
  },
  {
    form: "1040",
    fieldId: "form_1040.refund",
    label: "Refund",
    line: "34",
    box: null,
    valueType: "money",
    patterns: [
      moneyPattern(String.raw`(?:^|\b)(?:line\s*)?34\b\s+Refund\b.{0,60}?__VALUE__`),
      moneyPattern(String.raw`\bRefund\b.{0,60}?__VALUE__`),
    ],
  },
  {
    form: "1040",
    fieldId: "form_1040.amount_owed",
    label: "Amount owed",
    line: "37",
    box: null,
    valueType: "money",
    patterns: [
      moneyPattern(String.raw`(?:^|\b)(?:line\s*)?37\b\s+Amount\s+(?:you\s+owe|owed)\b.{0,60}?__VALUE__`),
      moneyPattern(String.raw`\bAmount\s+(?:you\s+owe|owed)\b.{0,60}?__VALUE__`),
    ],
  },
  {
    form: "W-2",
    fieldId: "form_w2.wages_tips_other_compensation",
    label: "Wages, tips, other compensation",
    line: null,
    box: "1",
    valueType: "money",
    patterns: [
      moneyPattern(String.raw`(?:^|\b)(?:box\s*)?1\b\s+Wages,?\s+tips(?:,?\s+other\s+compensation)?\b.{0,80}?__VALUE__`),
      moneyPattern(String.raw`\bWages,?\s+tips,?\s+other\s+compensation\b.{0,80}?__VALUE__`),
    ],
  },
  {
    form: "W-2",
    fieldId: "form_w2.federal_income_tax_withheld",
    label: "Federal income tax withheld",
    line: null,
    box: "2",
    valueType: "money",
    patterns: [
      moneyPattern(String.raw`(?:^|\b)(?:box\s*)?2\b\s+Federal\s+income\s+tax\s+withheld\b.{0,80}?__VALUE__`),
      moneyPattern(String.raw`\bFederal\s+income\s+tax\s+withheld\b.{0,80}?__VALUE__`),
    ],
  },
  {
    form: "W-2",
    fieldId: "form_w2.social_security_wages",
    label: "Social security wages",
    line: null,
    box: "3",
    valueType: "money",
    patterns: [
      moneyPattern(String.raw`(?:^|\b)(?:box\s*)?3\b\s+Social\s+security\s+wages\b.{0,80}?__VALUE__`),
      moneyPattern(String.raw`\bSocial\s+security\s+wages\b.{0,80}?__VALUE__`),
    ],
  },
  {
    form: "W-2",
    fieldId: "form_w2.social_security_tax_withheld",
    label: "Social security tax withheld",
    line: null,
    box: "4",
    valueType: "money",
    patterns: [
      moneyPattern(String.raw`(?:^|\b)(?:box\s*)?4\b\s+Social\s+security\s+tax\s+withheld\b.{0,80}?__VALUE__`),
      moneyPattern(String.raw`\bSocial\s+security\s+tax\s+withheld\b.{0,80}?__VALUE__`),
    ],
  },
  {
    form: "W-2",
    fieldId: "form_w2.medicare_wages_and_tips",
    label: "Medicare wages and tips",
    line: null,
    box: "5",
    valueType: "money",
    patterns: [
      moneyPattern(String.raw`(?:^|\b)(?:box\s*)?5\b\s+Medicare\s+wages(?:\s+and\s+tips)?\b.{0,80}?__VALUE__`),
      moneyPattern(String.raw`\bMedicare\s+wages(?:\s+and\s+tips)?\b.{0,80}?__VALUE__`),
    ],
  },
  {
    form: "W-2",
    fieldId: "form_w2.medicare_tax_withheld",
    label: "Medicare tax withheld",
    line: null,
    box: "6",
    valueType: "money",
    patterns: [
      moneyPattern(String.raw`(?:^|\b)(?:box\s*)?6\b\s+Medicare\s+tax\s+withheld\b.{0,80}?__VALUE__`),
      moneyPattern(String.raw`\bMedicare\s+tax\s+withheld\b.{0,80}?__VALUE__`),
    ],
  },
  {
    form: "W-2",
    fieldId: "form_w2.state_wages_tips",
    label: "State wages, tips, etc.",
    line: null,
    box: "16",
    valueType: "money",
    patterns: [
      moneyPattern(String.raw`(?:^|\b)(?:box\s*)?16\b\s+State\s+wages(?:,?\s+tips(?:,?\s+etc\.?)?)?\b.{0,80}?__VALUE__`),
      moneyPattern(String.raw`\bState\s+wages(?:,?\s+tips(?:,?\s+etc\.?)?)?\b.{0,80}?__VALUE__`),
    ],
  },
  {
    form: "W-2",
    fieldId: "form_w2.state_income_tax",
    label: "State income tax",
    line: null,
    box: "17",
    valueType: "money",
    patterns: [
      moneyPattern(String.raw`(?:^|\b)(?:box\s*)?17\b\s+State\s+income\s+tax\b.{0,80}?__VALUE__`),
      moneyPattern(String.raw`\bState\s+income\s+tax\b.{0,80}?__VALUE__`),
    ],
  },
  {
    form: "1099-DIV",
    fieldId: "form_1099_div.total_ordinary_dividends",
    label: "Total ordinary dividends",
    line: null,
    box: "1a",
    valueType: "money",
    patterns: [
      moneyPattern(String.raw`(?:^|\b)(?:box\s*)?1a\b\s+Total\s+ordinary\s+dividends\b.{0,80}?__VALUE__`),
      moneyPattern(String.raw`\bTotal\s+ordinary\s+dividends\b.{0,80}?__VALUE__`),
    ],
  },
  {
    form: "1099-DIV",
    fieldId: "form_1099_div.qualified_dividends",
    label: "Qualified dividends",
    line: null,
    box: "1b",
    valueType: "money",
    patterns: [
      moneyPattern(String.raw`(?:^|\b)(?:box\s*)?1b\b\s+Qualified\s+dividends\b.{0,80}?__VALUE__`),
      moneyPattern(String.raw`\bQualified\s+dividends\b.{0,80}?__VALUE__`),
    ],
  },
  {
    form: "1099-DIV",
    fieldId: "form_1099_div.total_capital_gain_distributions",
    label: "Total capital gain distributions",
    line: null,
    box: "2a",
    valueType: "money",
    patterns: [
      moneyPattern(String.raw`(?:^|\b)(?:box\s*)?2a\b\s+Total\s+capital\s+gain\s+distributions\b.{0,80}?__VALUE__`),
      moneyPattern(String.raw`\bTotal\s+capital\s+gain\s+distributions\b.{0,80}?__VALUE__`),
    ],
  },
  {
    form: "1099-DIV",
    fieldId: "form_1099_div.federal_income_tax_withheld",
    label: "Federal income tax withheld",
    line: null,
    box: "4",
    valueType: "money",
    patterns: [
      moneyPattern(String.raw`(?:^|\b)(?:box\s*)?4\b\s+Federal\s+income\s+tax\s+withheld\b.{0,80}?__VALUE__`),
      moneyPattern(String.raw`\bFederal\s+income\s+tax\s+withheld\b.{0,80}?__VALUE__`),
    ],
  },
  {
    form: "1099-DIV",
    fieldId: "form_1099_div.foreign_tax_paid",
    label: "Foreign tax paid",
    line: null,
    box: "7",
    valueType: "money",
    patterns: [
      moneyPattern(String.raw`(?:^|\b)(?:box\s*)?7\b\s+Foreign\s+tax\s+paid\b.{0,80}?__VALUE__`),
      moneyPattern(String.raw`\bForeign\s+tax\s+paid\b.{0,80}?__VALUE__`),
    ],
  },
  {
    form: "1099-R",
    fieldId: "form_1099_r.gross_distribution",
    label: "Gross distribution",
    line: null,
    box: "1",
    valueType: "money",
    patterns: [
      moneyPattern(String.raw`(?:^|\b)(?:box\s*)?1\b\s+Gross\s+distribution\b.{0,80}?__VALUE__`),
      moneyPattern(String.raw`\bGross\s+distribution\b.{0,80}?__VALUE__`),
    ],
  },
  {
    form: "1099-R",
    fieldId: "form_1099_r.taxable_amount",
    label: "Taxable amount",
    line: null,
    box: "2a",
    valueType: "money",
    patterns: [
      moneyPattern(String.raw`(?:^|\b)(?:box\s*)?2a\b\s+Taxable\s+amount\b.{0,80}?__VALUE__`),
      moneyPattern(String.raw`\bTaxable\s+amount\b.{0,80}?__VALUE__`),
    ],
  },
  {
    form: "1099-R",
    fieldId: "form_1099_r.federal_income_tax_withheld",
    label: "Federal income tax withheld",
    line: null,
    box: "4",
    valueType: "money",
    patterns: [
      moneyPattern(String.raw`(?:^|\b)(?:box\s*)?4\b\s+Federal\s+income\s+tax\s+withheld\b.{0,80}?__VALUE__`),
      moneyPattern(String.raw`\bFederal\s+income\s+tax\s+withheld\b.{0,80}?__VALUE__`),
    ],
  },
  {
    form: "1099-R",
    fieldId: "form_1099_r.distribution_codes",
    label: "Distribution code(s)",
    line: null,
    box: "7",
    valueType: "code",
    patterns: [
      textPattern(String.raw`(?:^|\b)(?:box\s*)?7\b\s+Distribution\s+code(?:\(s\)|s)?(?:\s|[:.-])+([A-Z0-9]{1,3}(?:\s*,\s*[A-Z0-9]{1,3})*)\b`),
      textPattern(String.raw`\bDistribution\s+code(?:\(s\)|s)?(?:\s|[:.-])+([A-Z0-9]{1,3}(?:\s*,\s*[A-Z0-9]{1,3})*)\b`),
    ],
  },
  {
    form: "1099-R",
    fieldId: "form_1099_r.state_tax_withheld",
    label: "State tax withheld",
    line: null,
    box: "14",
    valueType: "money",
    patterns: [
      moneyPattern(String.raw`(?:^|\b)(?:box\s*)?14\b\s+State\s+tax\s+withheld\b.{0,80}?__VALUE__`),
      moneyPattern(String.raw`\bState\s+tax\s+withheld\b.{0,80}?__VALUE__`),
    ],
  },
  {
    form: "1099-R",
    fieldId: "form_1099_r.state_distribution",
    label: "State distribution",
    line: null,
    box: "16",
    valueType: "money",
    patterns: [
      moneyPattern(String.raw`(?:^|\b)(?:box\s*)?16\b\s+State\s+distribution\b.{0,80}?__VALUE__`),
      moneyPattern(String.raw`\bState\s+distribution\b.{0,80}?__VALUE__`),
    ],
  },
];

export function extractTaxDocument(
  context: TaxDocumentExtractionContext,
): TaxDocumentMetadataOverlay {
  const firstPageText = extractFirstPageText(context.rawText);
  const firstPageLines = firstPageText
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => context.helpers.normalizeWhitespace(line))
    .filter(Boolean);
  const headerLines = getHeaderZoneLines(
    firstPageText,
    context.helpers.normalizeWhitespace,
    { minLines: 10, ratio: 0.45 },
  );
  const anchoredLines = collectAnchoredLines(
    firstPageText,
    context.helpers.normalizeWhitespace,
    TAX_DOCUMENT_ANCHORS,
  );
  const prioritizedLines = Array.from(
    new Set([...headerLines, ...anchoredLines, ...firstPageLines.slice(0, 40)]),
  );
  const prioritizedText = prioritizedLines.join("\n");

  const detectedClient =
    normalizeTaxName(context.helpers.extractClientNameFromFields(context.fields)) ??
    extractLabeledLineValue(prioritizedLines, CLIENT_LABEL_PATTERNS) ??
    extractInlineTaxName(prioritizedText, CLIENT_LABEL_PATTERNS) ??
    extractStandaloneTaxClientName(prioritizedLines) ??
    normalizeTaxName(context.helpers.extractClientNameFromText(prioritizedText)) ??
    normalizeTaxName(context.helpers.extractClientNameFromText(firstPageText)) ??
    undefined;

  const custodian =
    extractLabeledLineValue(prioritizedLines, PAYER_LABEL_PATTERNS) ??
    extractInlineTaxName(prioritizedText, PAYER_LABEL_PATTERNS) ??
    context.helpers.extractCustodian(prioritizedText, context.file.name) ??
    context.helpers.extractCustodian(firstPageText, context.file.name) ??
    context.metadata.custodian ??
    undefined;

  const taxYear =
    extractTaxYearFromTaxText(prioritizedText) ??
    context.helpers.extractTaxYear(firstPageText, context.file.name) ??
    context.metadata.taxYear ??
    undefined;
  const documentDate =
    extractLabeledTaxDate(prioritizedText) ??
    context.helpers.extractDocumentDate(firstPageText) ??
    context.metadata.documentDate ??
    undefined;

  return {
    detectedClient,
    custodian,
    documentDate,
    taxYear,
    taxIdentifier: extractTaxIdentifier(prioritizedText) ?? undefined,
    taxFacts: extractTaxFacts(
      [firstPageText, context.normalizedText, context.file.name].join("\n"),
      context.file.name,
    ),
  };
}

function extractTaxFacts(text: string, fileName: string): CanonicalTaxFact[] {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => normalizeTaxFactSearchText(line))
    .filter(Boolean);
  const compactText = lines.join("\n");
  const detectedForms = detectTaxFactForms(compactText, fileName);
  const facts: CanonicalTaxFact[] = [];
  const seenFieldIds = new Set<string>();

  for (const rule of TAX_FACT_RULES) {
    if (detectedForms.size > 0 && !detectedForms.has(rule.form)) {
      continue;
    }

    const rawValue = matchTaxFactRawValue(rule, lines, compactText);
    if (!rawValue) {
      continue;
    }

    const value =
      rule.valueType === "money"
        ? normalizeMoneyAmount(rawValue)
        : normalizeTaxFactTextValue(rawValue);
    if (!value || seenFieldIds.has(rule.fieldId)) {
      continue;
    }

    seenFieldIds.add(rule.fieldId);
    facts.push({
      id: `tax-fact-${facts.length + 1}`,
      form: rule.form,
      fieldId: rule.fieldId,
      label: rule.label,
      line: rule.line,
      box: rule.box,
      valueType: rule.valueType,
      rawValue: rawValue.trim(),
      value,
      money:
        rule.valueType === "money"
          ? {
              amount: value,
              currency: "USD",
            }
          : null,
    });
  }

  return facts;
}

function detectTaxFactForms(text: string, fileName: string): Set<TaxFactForm> {
  const source = normalizeTaxFactSearchText(`${text}\n${fileName}`);
  const forms = new Set<TaxFactForm>();

  if (
    /\bform\s+1040\b/i.test(source) ||
    /\b1040\b.{0,80}\bindividual\s+income\s+tax\s+return\b/i.test(source) ||
    /\bindividual\s+income\s+tax\s+return\b/i.test(source)
  ) {
    forms.add("1040");
  }

  if (/\bform\s+w[-\s]?2\b/i.test(source) || /\bwage\s+and\s+tax\s+statement\b/i.test(source)) {
    forms.add("W-2");
  }

  if (
    /\b1099[-\s]?div\b/i.test(source) ||
    /\bdividends\s+and\s+distributions\b/i.test(source)
  ) {
    forms.add("1099-DIV");
  }

  if (
    /\b1099[-\s]?r\b/i.test(source) ||
    /\bdistributions?\s+from\s+(?:pensions|annuities|retirement)\b/i.test(source)
  ) {
    forms.add("1099-R");
  }

  return forms;
}

function matchTaxFactRawValue(
  rule: TaxFactRule,
  lines: string[],
  compactText: string,
) {
  for (const line of lines) {
    for (const pattern of rule.patterns) {
      const match = line.match(pattern);
      if (match?.[1]) {
        return match[1];
      }
    }
  }

  for (const pattern of rule.patterns) {
    const match = compactText.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function normalizeTaxFactSearchText(value: string) {
  return value.replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
}

function normalizeMoneyAmount(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const isParentheticalNegative = /^\(.*\)$/.test(trimmed);
  const isSignedNegative = trimmed.includes("-");
  const strippedRaw = trimmed.replace(/[$,\s()_-]/g, "");
  const stripped = strippedRaw.startsWith(".") ? `0${strippedRaw}` : strippedRaw;
  if (!/^\d+(?:\.\d{1,2})?$/.test(stripped)) {
    return null;
  }

  const [wholeRaw, centsRaw = ""] = stripped.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
  const cents = centsRaw.padEnd(2, "0").slice(0, 2);
  const sign = isParentheticalNegative || isSignedNegative ? "-" : "";
  return `${sign}${whole}.${cents}`;
}

function normalizeTaxFactTextValue(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.toUpperCase() : null;
}

function extractLabeledLineValue(
  lines: string[],
  labelPatterns: readonly RegExp[],
) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const matchingLabel = labelPatterns.find((pattern) => pattern.test(line));
    if (!matchingLabel) {
      continue;
    }

    const inlineValue = extractValueAfterLabel(line, matchingLabel);
    if (inlineValue) {
      return inlineValue;
    }

    for (let offset = 1; offset <= 3; offset += 1) {
      const candidate = normalizeTaxName(lines[index + offset]);
      if (candidate) {
        return candidate;
      }
    }
  }

  return null;
}

function extractInlineTaxName(
  text: string,
  labelPatterns: readonly RegExp[],
) {
  for (const labelPattern of labelPatterns) {
    const pattern = new RegExp(
      `${labelPattern.source}[:\\s-]{1,24}([A-Z][A-Za-z&.',-]+(?:\\s+[A-Z][A-Za-z&.',-]+){1,7})`,
      "i",
    );
    const match = text.match(pattern);
    const value = normalizeTaxName(match?.[1]);
    if (value) {
      return value;
    }
  }

  return null;
}

function extractValueAfterLabel(line: string, labelPattern: RegExp) {
  const labelMatch = line.match(labelPattern);
  if (!labelMatch || labelMatch.index === undefined) {
    return null;
  }

  const afterLabel = line
    .slice(labelMatch.index + labelMatch[0].length)
    .replace(/^[:\s-]+/, "");
  return normalizeTaxName(afterLabel);
}

function extractStandaloneTaxClientName(lines: string[]) {
  for (const line of lines) {
    const candidate = normalizeTaxName(line);
    if (!candidate || !/^[A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,3}$/.test(candidate)) {
      continue;
    }

    if (/\b(?:llc|inc|corp|company|services|brokerage|bank|financial|fidelity|schwab|vanguard)\b/i.test(candidate)) {
      continue;
    }

    return candidate;
  }

  return null;
}

function extractTaxYearFromTaxText(text: string) {
  const contextualPatterns = [
    /\btax\s+year[:\s]+(20\d{2})\b/i,
    /\bfor\s+(?:calendar\s+)?year[:\s]+(20\d{2})\b/i,
    /\b(20\d{2})\s+form\s+(?:1040|1040x|1099|w[-\s]?2)\b/i,
    /\bform\s+(?:1040|1040x|1099|w[-\s]?2)\b.{0,40}\b(20\d{2})\b/i,
  ] as const;

  for (const pattern of contextualPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function extractLabeledTaxDate(text: string) {
  const match = text.match(
    /\b(?:notice\s+date|date\s+issued|document\s+date|issued)[:\s]+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2}|20\d{2}-\d{2}-\d{2})\b/i,
  );
  const value = match?.[1];
  if (!value) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function extractTaxIdentifier(text: string): TaxDocumentTaxIdentifier | null {
  const maskedSsn = text.match(/\b(?:xxx|\*\*\*)[-\s]?(?:xx|\*\*)[-\s]?(\d{4})\b/i);
  if (maskedSsn?.[1]) {
    return {
      kind: "masked_ssn",
      value: `***-**-${maskedSsn[1]}`,
    };
  }

  const ssnLast4 = text.match(
    /\b(?:ssn|social\s+security\s+number|taxpayer\s+identification\s+number|tin)\D{0,40}(?:ending\s+in|last\s+4)?\D{0,12}(\d{4})\b/i,
  );
  if (ssnLast4?.[1]) {
    return {
      kind: "ssn_last4",
      value: ssnLast4[1],
    };
  }

  const ein = text.match(/\b(?:ein|employer\s+identification\s+number)\D{0,20}(\d{2}-\d{7})\b/i);
  if (ein?.[1]) {
    return {
      kind: "ein",
      value: ein[1],
    };
  }

  return null;
}

function normalizeTaxName(value: string | null | undefined) {
  const normalized = value
    ?.replace(/\s+/g, " ")
    .replace(/\b(?:name|address|zip|tin|taxpayer|recipient|employee|payer|employer)\b.*$/i, "")
    .replace(/^[\s:,-]+|[\s:,-]+$/g, "")
    .trim();
  if (!normalized || normalized.length < 3 || /\d/.test(normalized)) {
    return null;
  }

  if (
    /\b(?:form|copy|department|treasury|internal revenue service|irs|tax year|return|notice|qualified|div|dividends?|distributions?|taxpayer copy)\b/i.test(
      normalized,
    )
  ) {
    return null;
  }

  const tokens = normalized.split(/\s+/);
  if (tokens.length > 8) {
    return null;
  }

  return normalized;
}
