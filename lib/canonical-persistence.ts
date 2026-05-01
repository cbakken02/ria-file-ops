import type {
  CanonicalAccountPartyRole,
  CanonicalDocumentFacts,
  CanonicalExtractedDocument,
  CanonicalFieldProvenance,
  CanonicalNormalizationRecord,
  CanonicalPrimaryFacts,
  CanonicalSourceRef,
  CanonicalTaxFact,
} from "@/lib/canonical-extracted-document";

const REDACTION_POLICY_VERSION = "canonical-redaction-v1";
const OMITTED_FIELD_GROUPS = [
  "full_account_numbers",
  "addresses",
  "tax_identifiers",
  "government_ids",
  "birth_dates",
  "beneficiary_details",
  "contact_values",
  "account_values",
  "tax_fact_values",
] as const;

export type PreviewSafeCanonicalPersistedShape = {
  schemaVersion: "canonical-preview-safe-v1";
  classification: CanonicalExtractedDocument["classification"];
  extractedSummary: CanonicalEntitySummary;
  normalizedSummary: CanonicalEntitySummary;
  normalized: {
    primaryFacts: CanonicalPrimaryFacts;
    parties: PreviewSafeCanonicalParty[];
    accounts: PreviewSafeCanonicalAccount[];
    accountParties: PreviewSafeCanonicalAccountParty[];
    institutions: PreviewSafeCanonicalInstitution[];
    dates: PreviewSafeCanonicalDate[];
    documentFacts: CanonicalDocumentFacts;
    taxFacts: PreviewSafeCanonicalTaxFact[];
  };
  diagnostics: {
    parserVersion: string | null;
    parserConflictSummary: string | null;
    documentSignal: string | null;
    ai: CanonicalExtractedDocument["diagnostics"]["ai"];
  };
  redaction: {
    policyVersion: typeof REDACTION_POLICY_VERSION;
    omittedFieldGroups: Array<(typeof OMITTED_FIELD_GROUPS)[number]>;
  };
};

export type RedactedCanonicalDebugShape = PreviewSafeCanonicalPersistedShape & {
  extracted: {
    parties: RedactedCanonicalParty[];
    accounts: RedactedCanonicalAccount[];
    accountParties: PreviewSafeCanonicalAccountParty[];
    institutions: RedactedCanonicalInstitution[];
    dates: PreviewSafeCanonicalDate[];
    documentFacts: CanonicalDocumentFacts;
    taxFacts: PreviewSafeCanonicalTaxFact[];
  };
  provenance: {
    fields: Record<string, RedactedCanonicalFieldProvenance>;
    normalization: CanonicalNormalizationRecord[];
    sourceRefs: RedactedCanonicalSourceRef[];
  };
};

export type PersistableCanonicalCacheRecord = CanonicalExtractedDocument;

type CanonicalEntitySummary = {
  partyCount: number;
  accountCount: number;
  accountPartyCount: number;
  institutionCount: number;
  contactCount: number;
  dateCount: number;
  taxFactCount: number;
};

type PreviewSafeCanonicalParty = {
  id: string;
  kind: "person" | "entity";
  displayName: string | null;
};

type RedactedCanonicalParty = PreviewSafeCanonicalParty & {
  rawName: string | null;
};

type PreviewSafeCanonicalAccount = {
  id: string;
  institutionIds: string[];
  accountLast4: string | null;
  accountType: string | null;
  registrationType: string | null;
  openedDateId: string | null;
  closedDateId: string | null;
  statementStartDateId: string | null;
  statementEndDateId: string | null;
};

type RedactedCanonicalAccount = PreviewSafeCanonicalAccount & {
  accountNumber: null;
  maskedAccountNumber: null;
  beneficiaryText: null;
};

type PreviewSafeCanonicalAccountParty = {
  id: string;
  accountId: string;
  partyId: string;
  roles: CanonicalAccountPartyRole[];
  relationshipLabel: string | null;
  allocationPercent: string | null;
};

type PreviewSafeCanonicalInstitution = {
  id: string;
  name: string | null;
};

type RedactedCanonicalInstitution = PreviewSafeCanonicalInstitution & {
  rawName: string | null;
};

type PreviewSafeCanonicalDate = {
  id: string;
  kind: CanonicalExtractedDocument["normalized"]["dates"][number]["kind"];
  value: string | null;
  entityType: CanonicalExtractedDocument["normalized"]["dates"][number]["entityType"];
  entityId: string | null;
};

type PreviewSafeCanonicalTaxFact = Pick<
  CanonicalTaxFact,
  "id" | "form" | "fieldId" | "label" | "line" | "box" | "valueType"
> & {
  rawValue: null;
  value: null;
  money: null;
};

type RedactedCanonicalFieldProvenance = Omit<CanonicalFieldProvenance, "raw"> & {
  raw: string | null;
  redacted: boolean;
};

type RedactedCanonicalSourceRef = Omit<CanonicalSourceRef, "value"> & {
  value: string | null;
  redacted: boolean;
};

export function persistCanonicalForPreviewAnalysisCache(
  canonical: CanonicalExtractedDocument | null | undefined,
): PersistableCanonicalCacheRecord | null {
  return canonical ? structuredClone(canonical) : null;
}

export function projectCanonicalToPreviewSafePersistedShape(
  canonical: CanonicalExtractedDocument | null | undefined,
): PreviewSafeCanonicalPersistedShape | null {
  if (!canonical) {
    return null;
  }

  return {
    schemaVersion: "canonical-preview-safe-v1",
    classification: canonical.classification,
    extractedSummary: buildEntitySummary(canonical.extracted),
    normalizedSummary: buildEntitySummary(canonical.normalized),
    normalized: {
      primaryFacts: canonical.normalized.primaryFacts,
      parties: canonical.normalized.parties.map((party) => ({
        id: party.id,
        kind: party.kind,
        displayName: party.displayName,
      })),
      accounts: canonical.normalized.accounts.map((account) => ({
        id: account.id,
        institutionIds: account.institutionIds,
        accountLast4: account.accountLast4,
        accountType: account.accountType,
        registrationType: account.registrationType,
        openedDateId: account.openedDateId,
        closedDateId: account.closedDateId,
        statementStartDateId: account.statementStartDateId,
        statementEndDateId: account.statementEndDateId,
      })),
      accountParties: canonical.normalized.accountParties.map((relationship) => ({
        id: relationship.id,
        accountId: relationship.accountId,
        partyId: relationship.partyId,
        roles: relationship.roles,
        relationshipLabel: relationship.relationshipLabel,
        allocationPercent: relationship.allocationPercent,
      })),
      institutions: canonical.normalized.institutions.map((institution) => ({
        id: institution.id,
        name: institution.name,
      })),
      dates: canonical.normalized.dates.map((date) => ({
        id: date.id,
        kind: date.kind,
        value: date.value,
        entityType: date.entityType,
        entityId: date.entityId,
      })),
      documentFacts: canonical.normalized.documentFacts,
      taxFacts: (canonical.normalized.taxFacts ?? []).map(redactTaxFact),
    },
    diagnostics: {
      parserVersion: canonical.diagnostics.parserVersion,
      parserConflictSummary: canonical.diagnostics.parserConflictSummary,
      documentSignal: canonical.diagnostics.documentSignal,
      ai: canonical.diagnostics.ai,
    },
    redaction: {
      policyVersion: REDACTION_POLICY_VERSION,
      omittedFieldGroups: [...OMITTED_FIELD_GROUPS],
    },
  };
}

export function projectCanonicalToRedactedDebugShape(
  canonical: CanonicalExtractedDocument | null | undefined,
): RedactedCanonicalDebugShape | null {
  if (!canonical) {
    return null;
  }

  const previewSafe = projectCanonicalToPreviewSafePersistedShape(canonical);
  if (!previewSafe) {
    return null;
  }

  return {
    ...previewSafe,
    extracted: {
      parties: canonical.extracted.parties.map((party) => ({
        id: party.id,
        kind: party.kind,
        displayName: party.displayName,
        rawName: party.rawName,
      })),
      accounts: canonical.extracted.accounts.map((account) => ({
        id: account.id,
        institutionIds: account.institutionIds,
        accountLast4: account.accountLast4,
        accountType: account.accountType,
        registrationType: account.registrationType,
        openedDateId: account.openedDateId,
        closedDateId: account.closedDateId,
        statementStartDateId: account.statementStartDateId,
        statementEndDateId: account.statementEndDateId,
        accountNumber: null,
        maskedAccountNumber: null,
        beneficiaryText: null,
      })),
      accountParties: canonical.extracted.accountParties.map((relationship) => ({
        id: relationship.id,
        accountId: relationship.accountId,
        partyId: relationship.partyId,
        roles: relationship.roles,
        relationshipLabel: relationship.relationshipLabel,
        allocationPercent: relationship.allocationPercent,
      })),
      institutions: canonical.extracted.institutions.map((institution) => ({
        id: institution.id,
        name: institution.name,
        rawName: institution.rawName,
      })),
      dates: canonical.extracted.dates.map((date) => ({
        id: date.id,
        kind: date.kind,
        value: date.value,
        entityType: date.entityType,
        entityId: date.entityId,
      })),
      documentFacts: canonical.extracted.documentFacts,
      taxFacts: (canonical.extracted.taxFacts ?? []).map(redactTaxFact),
    },
    provenance: {
      fields: Object.fromEntries(
        Object.entries(canonical.provenance.fields).map(([fieldPath, value]) => [
          fieldPath,
          redactFieldProvenance(fieldPath, value),
        ]),
      ),
      normalization: canonical.provenance.normalization.map((entry) => ({
        ...entry,
        rawValue: redactValueForFieldPath(entry.fieldPath, entry.rawValue),
        finalValue: redactValueForFieldPath(entry.fieldPath, entry.finalValue),
      })),
      sourceRefs: canonical.provenance.sourceRefs.map((sourceRef) =>
        redactSourceRef(sourceRef),
      ),
    },
  };
}

function buildEntitySummary(
  section:
    | CanonicalExtractedDocument["extracted"]
    | CanonicalExtractedDocument["normalized"],
): CanonicalEntitySummary {
  return {
    partyCount: section.parties.length,
    accountCount: section.accounts.length,
    accountPartyCount: section.accountParties.length,
    institutionCount: section.institutions.length,
    contactCount: section.contacts.length,
    dateCount: section.dates.length,
    taxFactCount: section.taxFacts?.length ?? 0,
  };
}

function redactTaxFact(fact: CanonicalTaxFact): PreviewSafeCanonicalTaxFact {
  return {
    id: fact.id,
    form: fact.form,
    fieldId: fact.fieldId,
    label: fact.label,
    line: fact.line,
    box: fact.box,
    valueType: fact.valueType,
    rawValue: null,
    value: null,
    money: null,
  };
}

function redactFieldProvenance(
  fieldPath: string,
  value: CanonicalFieldProvenance,
): RedactedCanonicalFieldProvenance {
  const redactedRaw = redactValueForFieldPath(fieldPath, value.raw);

  return {
    ...value,
    raw: redactedRaw,
    redacted: redactedRaw !== value.raw,
  };
}

function redactSourceRef(sourceRef: CanonicalSourceRef): RedactedCanonicalSourceRef {
  const redactedValue =
    sourceRef.kind === "ai_summary"
      ? "[REDACTED]"
      : redactValueForFieldPath(sourceRef.fieldPath, sourceRef.value);

  return {
    ...sourceRef,
    value: redactedValue,
    redacted: redactedValue !== sourceRef.value,
  };
}

function redactValueForFieldPath(fieldPath: string | null, value: string | null) {
  if (!value) {
    return value;
  }

  if (!fieldPath) {
    return value;
  }

  const lowerPath = fieldPath.toLowerCase();
  if (
    lowerPath.includes("accountnumber") ||
    lowerPath.includes("maskedaccountnumber") ||
    lowerPath.includes("address") ||
    lowerPath.includes("taxidentifier") ||
    lowerPath.includes("governmentid") ||
    lowerPath.includes("birthdate") ||
    lowerPath.includes("beneficiary") ||
    lowerPath.includes("contact") ||
    lowerPath.includes("taxfacts") ||
    lowerPath.includes("values") ||
    lowerPath.includes("money")
  ) {
    return "[REDACTED]";
  }

  return value;
}
