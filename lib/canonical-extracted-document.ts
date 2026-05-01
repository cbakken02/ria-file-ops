import type { ParsedDocumentTypeId } from "@/lib/ai-primary-parser-types";

export type CanonicalContentSource =
  | "pdf_text"
  | "pdf_ocr"
  | "image_ocr"
  | "metadata_only";

export type CanonicalDocumentTypeId = ParsedDocumentTypeId;

export type CanonicalAddress = {
  kind: "identity" | "mailing" | "residential" | "business" | "service" | "other";
  rawText: string | null;
  lines: string[];
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
};

export type CanonicalMoney = {
  amount: string | null;
  currency: string | null;
};

export type CanonicalTaxFactValueType = "money" | "number" | "text" | "code" | "date";

export type CanonicalTaxFact = {
  id: string;
  form: string | null;
  fieldId: string;
  label: string;
  line: string | null;
  box: string | null;
  valueType: CanonicalTaxFactValueType;
  rawValue: string | null;
  value: string | null;
  money: CanonicalMoney | null;
};

export type ExtractedTaxFact = CanonicalTaxFact;

export type NormalizedTaxFact = CanonicalTaxFact;

export type CanonicalAccountValue = {
  kind:
    | "beginning_balance"
    | "ending_balance"
    | "available_balance"
    | "current_balance"
    | "market_value"
    | "vested_balance"
    | "loan_balance"
    | "cash_value"
    | "surrender_value"
    | "death_benefit"
    | "contribution_balance"
    | "other";
  label: string | null;
  money: CanonicalMoney | null;
  dateId: string | null;
};

export type CanonicalTaxIdentifier = {
  kind: "ssn" | "ssn_last4" | "masked_ssn" | "ein" | "other";
  value: string | null;
};

export type CanonicalGovernmentId = {
  kind: "driver_license" | "state_id" | "passport" | "other";
  value: string | null;
  maskedValue?: string | null;
  issuingAuthority: string | null;
  expirationDateId: string | null;
};

type CanonicalPartyBase = {
  id: string;
  kind: "person" | "entity";
  displayName: string | null;
  rawName: string | null;
  addresses: CanonicalAddress[];
  birthDateId: string | null;
  taxIdentifiers: CanonicalTaxIdentifier[];
  governmentIds: CanonicalGovernmentId[];
};

export type ExtractedParty = CanonicalPartyBase;

export type NormalizedParty = CanonicalPartyBase;

type CanonicalAccountBase = {
  id: string;
  institutionIds: string[];
  accountNumber: string | null;
  maskedAccountNumber: string | null;
  accountLast4: string | null;
  accountType: string | null;
  registrationType: string | null;
  openedDateId: string | null;
  closedDateId: string | null;
  statementStartDateId: string | null;
  statementEndDateId: string | null;
  values: CanonicalAccountValue[];
  beneficiaryText: string | null;
};

export type ExtractedAccount = CanonicalAccountBase;

export type NormalizedAccount = CanonicalAccountBase;

export type CanonicalAccountPartyRole =
  | "owner"
  | "joint_owner"
  | "beneficiary"
  | "annuitant"
  | "insured"
  | "trustee"
  | "authorized_signer"
  | "other";

type CanonicalAccountPartyBase = {
  id: string;
  accountId: string;
  partyId: string;
  roles: CanonicalAccountPartyRole[];
  relationshipLabel: string | null;
  allocationPercent: string | null;
};

export type ExtractedAccountParty = CanonicalAccountPartyBase;

export type NormalizedAccountParty = CanonicalAccountPartyBase;

type CanonicalInstitutionBase = {
  id: string;
  name: string | null;
  rawName: string | null;
  addresses: CanonicalAddress[];
};

export type ExtractedInstitution = CanonicalInstitutionBase;

export type NormalizedInstitution = CanonicalInstitutionBase;

export type CanonicalContact = {
  id: string;
  institutionId: string | null;
  method: "phone" | "email" | "website" | "address" | "fax" | "other";
  purpose:
    | "general_support"
    | "customer_service"
    | "rollover_support"
    | "beneficiary_services"
    | "branch"
    | "other";
  label: string | null;
  value: string | null;
  address: CanonicalAddress | null;
  hoursText: string | null;
};

export type ExtractedContact = CanonicalContact;

export type NormalizedContact = CanonicalContact;

export type CanonicalDate = {
  id: string;
  kind:
    | "document_date"
    | "statement_period_start"
    | "statement_period_end"
    | "statement_start"
    | "statement_end"
    | "issue_date"
    | "effective_date"
    | "expiration_date"
    | "birth_date"
    | "other";
  value: string | null;
  rawValue: string | null;
  entityType: "document" | "party" | "account" | "institution" | "account_party" | "other";
  entityId: string | null;
};

export type ExtractedDate = CanonicalDate;

export type NormalizedDate = CanonicalDate;

export type CanonicalDocumentFacts = {
  entityName: string | null;
  idType: string | null;
  taxYear: string | null;
};

export type CanonicalPrimaryFacts = {
  detectedClient: string | null;
  detectedClient2: string | null;
  ownershipType: "single" | "joint" | null;
  accountLast4: string | null;
  accountType: string | null;
  custodian: string | null;
  documentDate: string | null;
  entityName: string | null;
  idType: string | null;
  taxYear: string | null;
};

export type CanonicalFieldProvenance = {
  owner: "ai" | "logic" | "metadata_fallback" | "review";
  source: string;
  confidence: number | null;
  raw: string | null;
  sourceRefIds: string[];
};

export type CanonicalNormalizationRecord = {
  fieldPath: string;
  source: string;
  ruleId: string | null;
  rawValue: string | null;
  finalValue: string | null;
  sourceRefId: string | null;
};

export type CanonicalSourceRef = {
  id: string;
  kind: "ai_field" | "ai_summary" | "logic_field" | "metadata_fallback" | "normalization";
  fieldPath: string | null;
  label: string;
  value: string | null;
};

export type CanonicalExtractedDocument = {
  source: {
    file: {
      fileId: string | null;
      sourceName: string | null;
      mimeType: string | null;
      modifiedTime: string | null;
      driveSize: string | null;
      downloadByteLength: number | null;
      downloadSha1: string | null;
    };
    extraction: {
      contentSource: CanonicalContentSource | null;
      pdfFields: Array<{ name: string; value: string }>;
      pdfFieldReaders: string[];
      pdfExtractionAttempts?: Array<{
        extractor: "pdfjs" | "pdf-parse" | "pypdf" | "pdfkit" | "ocr";
        status: "succeeded" | "empty" | "skipped" | "failed";
        detail: string | null;
        textLength: number | null;
        fieldCount: number | null;
      }>;
    };
  };
  classification: {
    extracted: {
      documentTypeId: CanonicalDocumentTypeId | null;
      documentSubtype: string | null;
    };
    normalized: {
      documentTypeId: CanonicalDocumentTypeId | null;
      documentSubtype: string | null;
    };
  };
  extracted: {
    parties: ExtractedParty[];
    accounts: ExtractedAccount[];
    accountParties: ExtractedAccountParty[];
    institutions: ExtractedInstitution[];
    contacts: ExtractedContact[];
    dates: ExtractedDate[];
    documentFacts: CanonicalDocumentFacts;
    taxFacts?: ExtractedTaxFact[];
  };
  normalized: {
    parties: NormalizedParty[];
    accounts: NormalizedAccount[];
    accountParties: NormalizedAccountParty[];
    institutions: NormalizedInstitution[];
    contacts: NormalizedContact[];
    dates: NormalizedDate[];
    documentFacts: CanonicalDocumentFacts;
    taxFacts?: NormalizedTaxFact[];
    primaryFacts: CanonicalPrimaryFacts;
  };
  provenance: {
    fields: Record<string, CanonicalFieldProvenance>;
    normalization: CanonicalNormalizationRecord[];
    sourceRefs: CanonicalSourceRef[];
  };
  diagnostics: {
    parserVersion: string | null;
    parserConflictSummary: string | null;
    documentSignal: string | null;
    reasons: string[];
    textExcerpt: string | null;
    diagnosticText: string | null;
    statementClientSource: string | null;
    statementClientCandidate: string | null;
    ownershipClientCandidate: string | null;
    accountContextCandidate: string | null;
    accountLooseCandidate: string | null;
    taxKeywordDetected: boolean;
    yearCandidates: string[];
    ai: {
      enabled: boolean;
      attempted: boolean;
      used: boolean;
      model: string | null;
      promptVersion: string | null;
      failureReason: string | null;
      rawSummary: string | null;
    };
  };
};

export type CanonicalExtractedDocumentDraft = Omit<
  CanonicalExtractedDocument,
  "normalized"
> & {
  normalized: Omit<CanonicalExtractedDocument["normalized"], "primaryFacts"> & {
    primaryFacts?: CanonicalPrimaryFacts;
  };
};

export function deriveCanonicalPrimaryFacts(
  normalized: CanonicalExtractedDocumentDraft["normalized"],
  classification?: CanonicalExtractedDocumentDraft["classification"],
): CanonicalPrimaryFacts {
  const ownerNames = deriveCanonicalPartyNames(
    normalized.parties,
    normalized.accountParties,
  );
  const primaryAccount = normalized.accounts.length === 1 ? normalized.accounts[0] ?? null : null;
  const institutionName = resolvePrimaryInstitutionName(normalized, primaryAccount);
  const documentDate = resolvePrimaryDocumentDate(normalized.dates);
  const primaryDocumentFacts = derivePrimaryDocumentFacts(
    normalized.documentFacts,
    classification?.normalized.documentTypeId ?? null,
  );

  return {
    detectedClient: ownerNames[0] ?? null,
    detectedClient2: ownerNames[1] ?? null,
    ownershipType:
      ownerNames.length >= 2 ? "joint" : ownerNames.length === 1 ? "single" : null,
    accountLast4: primaryAccount?.accountLast4 ?? null,
    accountType: primaryAccount?.accountType ?? null,
    custodian: institutionName,
    documentDate,
    entityName: primaryDocumentFacts.entityName,
    idType: primaryDocumentFacts.idType,
    taxYear: primaryDocumentFacts.taxYear,
  };
}

export function finalizeCanonicalExtractedDocument(
  document: CanonicalExtractedDocumentDraft,
): CanonicalExtractedDocument {
  const extracted = {
    ...document.extracted,
    taxFacts: document.extracted.taxFacts ?? [],
  };
  const normalized = {
    ...document.normalized,
    taxFacts: document.normalized.taxFacts ?? [],
  };

  return {
    ...document,
    extracted,
    normalized: {
      ...normalized,
      primaryFacts: deriveCanonicalPrimaryFacts(
        normalized,
        document.classification,
      ),
    },
  };
}

function derivePrimaryDocumentFacts(
  documentFacts: CanonicalDocumentFacts,
  documentTypeId: CanonicalDocumentTypeId | null,
) {
  if (documentTypeId === "account_statement") {
    return {
      entityName: null,
      idType: documentFacts.idType ?? null,
      taxYear: null,
    };
  }

  if (documentTypeId !== "tax_document") {
    return {
      entityName: documentFacts.entityName ?? null,
      idType: documentFacts.idType ?? null,
      taxYear: null,
    };
  }

  return {
    entityName: documentFacts.entityName ?? null,
    idType: documentFacts.idType ?? null,
    taxYear: documentFacts.taxYear ?? null,
  };
}

export function deriveCanonicalPartyNames(
  parties: Array<Pick<NormalizedParty | ExtractedParty, "id" | "displayName">>,
  accountParties: Array<Pick<NormalizedAccountParty | ExtractedAccountParty, "partyId" | "roles">>,
) {
  const partiesById = new Map(parties.map((party) => [party.id, party.displayName]));
  const orderedNames: string[] = [];

  for (const relationship of accountParties) {
    if (!relationship.roles.some((role) => role === "owner" || role === "joint_owner")) {
      continue;
    }

    const displayName = partiesById.get(relationship.partyId) ?? null;
    if (!displayName || orderedNames.includes(displayName)) {
      continue;
    }

    orderedNames.push(displayName);
  }

  if (orderedNames.length > 0) {
    return orderedNames;
  }

  for (const party of parties) {
    if (!party.displayName || orderedNames.includes(party.displayName)) {
      continue;
    }

    orderedNames.push(party.displayName);
  }

  return orderedNames;
}

function resolvePrimaryInstitutionName(
  normalized: Pick<CanonicalExtractedDocumentDraft["normalized"], "accounts" | "institutions">,
  primaryAccount: Pick<NormalizedAccount, "institutionIds"> | null,
) {
  const { accounts, institutions } = normalized;
  const institutionsById = new Map(
    institutions.map((institution) => [institution.id, institution.name ?? null]),
  );

  if (primaryAccount) {
    for (const institutionId of primaryAccount.institutionIds) {
      const resolved = institutionsById.get(institutionId) ?? null;
      if (resolved) {
        return resolved;
      }
    }
  }

  const uniqueInstitutionIds = new Set(
    accounts.flatMap((account) => account.institutionIds).filter(Boolean),
  );
  if (uniqueInstitutionIds.size === 1) {
    const [institutionId] = [...uniqueInstitutionIds];
    return institutionsById.get(institutionId) ?? null;
  }

  return institutions.length === 1 ? institutions[0]?.name ?? null : null;
}

function resolvePrimaryDocumentDate(
  dates: Array<Pick<NormalizedDate, "kind" | "value">>,
) {
  const kindPriority = [
    "statement_period_end",
    "statement_end",
    "document_date",
    "issue_date",
    "effective_date",
  ];

  for (const kind of kindPriority) {
    const match = dates.find((date) => date.kind === kind && date.value);
    if (match?.value) {
      return match.value;
    }
  }

  return dates.find((date) => date.value)?.value ?? null;
}
