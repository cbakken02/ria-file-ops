export const TAX_DOCUMENT_SUBTYPES = [
  "individual_return",
  "amended_individual_return",
  "state_return",
  "extension",
  "estimated_payment",
  "form_1099",
  "form_1099_div",
  "form_1099_int",
  "form_1099_b",
  "form_1099_r",
  "form_1099_misc",
  "form_1099_nec",
  "form_1099_da",
  "form_1098",
  "form_w2",
  "schedule_k1",
  "tax_notice",
  "unknown_tax_document",
] as const;

export type TaxDocumentSubtype = (typeof TAX_DOCUMENT_SUBTYPES)[number];

const TAX_DOCUMENT_SUBTYPE_LABELS: Record<TaxDocumentSubtype, string> = {
  individual_return: "1040 Return",
  amended_individual_return: "1040X Amended Return",
  state_return: "State Return",
  extension: "Extension",
  estimated_payment: "Estimated Payment",
  form_1099: "1099",
  form_1099_div: "1099-DIV",
  form_1099_int: "1099-INT",
  form_1099_b: "1099-B",
  form_1099_r: "1099-R",
  form_1099_misc: "1099-MISC",
  form_1099_nec: "1099-NEC",
  form_1099_da: "1099-DA",
  form_1098: "1098",
  form_w2: "W-2",
  schedule_k1: "K-1",
  tax_notice: "Tax Notice",
  unknown_tax_document: "Tax Document",
};

const LEGACY_TAX_SUBTYPE_LABEL_TO_ID: Array<[RegExp, TaxDocumentSubtype]> = [
  [/\b1040x\b|\bamended\b/i, "amended_individual_return"],
  [/\b1040\b|\bindividual return\b|\btax return\b/i, "individual_return"],
  [/\bstate return\b/i, "state_return"],
  [/\bextension\b/i, "extension"],
  [/\bestimated payment\b|\bestimated tax\b/i, "estimated_payment"],
  [/\b1099[-\s]?da\b/i, "form_1099_da"],
  [/\b1099[-\s]?div\b/i, "form_1099_div"],
  [/\b1099[-\s]?int\b/i, "form_1099_int"],
  [/\b1099[-\s]?misc\b/i, "form_1099_misc"],
  [/\b1099[-\s]?nec\b/i, "form_1099_nec"],
  [/\b1099[-\s]?b\b/i, "form_1099_b"],
  [/\b1099[-\s]?r\b/i, "form_1099_r"],
  [/\bform\s+1099\b|\b1099\b/i, "form_1099"],
  [/\b1098\b/i, "form_1098"],
  [/\bw[-\s]?2\b/i, "form_w2"],
  [/\bk[-\s]?1\b|\bschedule\s+k[-\s]?1\b/i, "schedule_k1"],
  [/\bnotice\b|\bcp\d{2,4}\b|\bletter\s+\d{2,4}\b/i, "tax_notice"],
];

export function getTaxDocumentSubtypeLabel(
  subtype: string | null | undefined,
) {
  const normalized = normalizeTaxDocumentSubtype(subtype);
  return normalized ? TAX_DOCUMENT_SUBTYPE_LABELS[normalized] : null;
}

export function normalizeTaxDocumentSubtype(
  subtype: string | null | undefined,
): TaxDocumentSubtype | null {
  const value = subtype?.trim();
  if (!value) {
    return null;
  }

  if ((TAX_DOCUMENT_SUBTYPES as readonly string[]).includes(value)) {
    return value as TaxDocumentSubtype;
  }

  for (const [pattern, normalizedSubtype] of LEGACY_TAX_SUBTYPE_LABEL_TO_ID) {
    if (pattern.test(value)) {
      return normalizedSubtype;
    }
  }

  return null;
}

export function detectTaxDocumentSubtype(
  text: string | null | undefined,
  fallbackText: string | null | undefined,
): TaxDocumentSubtype {
  const source = `${text ?? ""} ${fallbackText ?? ""}`;

  for (const [pattern, subtype] of LEGACY_TAX_SUBTYPE_LABEL_TO_ID) {
    if (pattern.test(source)) {
      return subtype;
    }
  }

  return "unknown_tax_document";
}
