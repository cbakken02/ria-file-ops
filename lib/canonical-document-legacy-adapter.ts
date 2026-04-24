import type { ParsedFieldKey, ParsedFieldOwnership } from "@/lib/ai-primary-parser-types";
import {
  deriveCanonicalPartyNames,
  type CanonicalExtractedDocument,
  type CanonicalFieldProvenance,
} from "@/lib/canonical-extracted-document";
import type { AccountStatementClientSource } from "@/lib/document-extractors/account-statement";
import type { DocumentInsight } from "@/lib/document-intelligence";

export function adaptCanonicalToLegacyDocumentInsight(
  canonical: CanonicalExtractedDocument,
): DocumentInsight {
  const primaryFacts = canonical.normalized.primaryFacts;
  const presentation = getLegacyPresentationForDocumentType(
    canonical.classification.normalized.documentTypeId,
  );
  const reasons = [...canonical.diagnostics.reasons];
  let confidence = Math.max(
    presentation.defaultConfidence,
    getCanonicalFieldConfidence(
      canonical.provenance.fields["classification.normalized.documentTypeId"],
    ) ?? 0,
  );

  if (primaryFacts.detectedClient) {
    confidence = Math.min(0.95, confidence + 0.08);
    reasons.push(
      `Client name inferred from document content: ${primaryFacts.detectedClient}.`,
    );
  }

  return {
    textExcerpt: canonical.diagnostics.textExcerpt,
    diagnosticText: canonical.diagnostics.diagnosticText,
    pdfFields: canonical.source.extraction.pdfFields,
    detectedClient: primaryFacts.detectedClient,
    detectedClient2: primaryFacts.detectedClient2,
    ownershipType: primaryFacts.ownershipType === "joint" ? "joint" : "single",
    documentTypeId: presentation.documentTypeId,
    documentLabel: presentation.documentLabel,
    filenameLabel: presentation.filenameLabel,
    topLevelFolder: presentation.topLevelFolder,
    confidence,
    reasons,
    contentSource: canonical.source.extraction.contentSource ?? "metadata_only",
    debug: {
      parserVersion: canonical.diagnostics.parserVersion ?? "unknown",
      parserConflictSummary: canonical.diagnostics.parserConflictSummary,
      documentSignal: canonical.diagnostics.documentSignal,
      statementClientSource:
        (canonical.diagnostics.statementClientSource as AccountStatementClientSource | null) ??
        null,
      statementClientCandidate: canonical.diagnostics.statementClientCandidate,
      aiModel: canonical.diagnostics.ai.model,
      aiPromptVersion: canonical.diagnostics.ai.promptVersion,
      aiRawSummary: canonical.diagnostics.ai.rawSummary,
      aiRawDetectedClient: deriveExtractedClientValue(canonical, 0),
      aiRawDetectedClient2: deriveExtractedClientValue(canonical, 1),
      aiRawCustodian: canonical.extracted.institutions[0]?.name ?? null,
      aiRawAccountType: canonical.extracted.accounts[0]?.accountType ?? null,
      aiEnabled: canonical.diagnostics.ai.enabled,
      aiAttempted: canonical.diagnostics.ai.attempted,
      aiUsed: canonical.diagnostics.ai.used,
      aiFailureReason: canonical.diagnostics.ai.failureReason,
      custodianWasNormalized: hasNormalizationForField(
        canonical,
        "normalized.institutions[0].name",
      ),
      accountTypeWasNormalized: hasNormalizationForField(
        canonical,
        "normalized.accounts[0].accountType",
      ),
      custodianNormalizationRule: getNormalizationRuleId(
        canonical,
        "normalized.institutions[0].name",
      ),
      accountTypeNormalizationRule: getNormalizationRuleId(
        canonical,
        "normalized.accounts[0].accountType",
      ),
      fieldOwnership: buildLegacyFieldOwnership(canonical),
      ownershipClientCandidate: canonical.diagnostics.ownershipClientCandidate,
      accountContextCandidate: canonical.diagnostics.accountContextCandidate,
      accountLooseCandidate: canonical.diagnostics.accountLooseCandidate,
      taxKeywordDetected: canonical.diagnostics.taxKeywordDetected,
      yearCandidates: canonical.diagnostics.yearCandidates,
      downloadByteLength: canonical.source.file.downloadByteLength,
      downloadSha1: canonical.source.file.downloadSha1,
      pdfFieldReaders: canonical.source.extraction.pdfFieldReaders,
    },
    metadata: {
      accountLast4: primaryFacts.accountLast4,
      accountType: primaryFacts.accountType,
      custodian: primaryFacts.custodian,
      documentDate: primaryFacts.documentDate,
      entityName: primaryFacts.entityName,
      idType: primaryFacts.idType,
      taxYear: primaryFacts.taxYear,
    },
  };
}

function getLegacyPresentationForDocumentType(
  documentTypeId: CanonicalExtractedDocument["classification"]["normalized"]["documentTypeId"],
) {
  switch (documentTypeId) {
    case "account_statement":
      return {
        documentTypeId: "account_statement" as const,
        documentLabel: "Account statement",
        filenameLabel: "Account_Statement",
        topLevelFolder: "Accounts",
        defaultConfidence: 0.86,
      };
    case "money_movement_form":
      return {
        documentTypeId: "money_movement_form" as const,
        documentLabel: "Money movement form",
        filenameLabel: "Money_Movement",
        topLevelFolder: "Money Movement",
        defaultConfidence: 0.82,
      };
    case "tax_return":
      return {
        documentTypeId: "tax_return" as const,
        documentLabel: "Tax return",
        filenameLabel: "Tax_Return",
        topLevelFolder: "Tax",
        defaultConfidence: 0.76,
      };
    case "tax_document":
      return {
        documentTypeId: "tax_document" as const,
        documentLabel: "Tax document",
        filenameLabel: "Tax_Document",
        topLevelFolder: "Tax",
        defaultConfidence: 0.75,
      };
    case "identity_document":
      return {
        documentTypeId: "identity_document" as const,
        documentLabel: "Identity document",
        filenameLabel: "Client_ID",
        topLevelFolder: "Client Info",
        defaultConfidence: 0.76,
      };
    case "planning_document":
      return {
        documentTypeId: "planning_document" as const,
        documentLabel: "Planning / advice document",
        filenameLabel: "Planning_Document",
        topLevelFolder: "Planning",
        defaultConfidence: 0.72,
      };
    case "legal_document":
      return {
        documentTypeId: "legal_document" as const,
        documentLabel: "Legal / estate document",
        filenameLabel: "Legal_Document",
        topLevelFolder: "Review",
        defaultConfidence: 0.7,
      };
    default:
      return {
        documentTypeId: "default" as const,
        documentLabel: "Needs inspection",
        filenameLabel: "Review_Item",
        topLevelFolder: "Review",
        defaultConfidence: 0.44,
      };
  }
}

function deriveExtractedClientValue(
  canonical: CanonicalExtractedDocument,
  index: number,
) {
  const names = deriveCanonicalPartyNames(
    canonical.extracted.parties,
    canonical.extracted.accountParties,
  );

  return names[index] ?? canonical.extracted.parties[index]?.displayName ?? null;
}

function buildLegacyFieldOwnership(
  canonical: CanonicalExtractedDocument,
): Partial<Record<ParsedFieldKey, ParsedFieldOwnership>> {
  return {
    documentTypeId: mapFieldOwnership(
      canonical.provenance.fields["classification.normalized.documentTypeId"],
    ),
    detectedClient: mapFieldOwnership(
      canonical.provenance.fields["normalized.parties[0].displayName"],
    ),
    detectedClient2: mapFieldOwnership(
      canonical.provenance.fields["normalized.parties[1].displayName"],
    ),
    ownershipType: mapFieldOwnership(
      canonical.provenance.fields["normalized.accountParties[0].roles"],
    ),
    accountLast4: mapFieldOwnership(
      canonical.provenance.fields["normalized.accounts[0].accountLast4"],
    ),
    accountType: mapFieldOwnership(
      canonical.provenance.fields["normalized.accounts[0].accountType"],
    ),
    custodian: mapFieldOwnership(
      canonical.provenance.fields["normalized.institutions[0].name"],
    ),
    documentDate: mapFieldOwnership(
      canonical.provenance.fields["normalized.dates[0].value"],
    ),
    entityName: mapFieldOwnership(
      canonical.provenance.fields["normalized.documentFacts.entityName"],
    ),
    idType: mapFieldOwnership(
      canonical.provenance.fields["normalized.documentFacts.idType"],
    ),
    taxYear: mapFieldOwnership(
      canonical.provenance.fields["normalized.documentFacts.taxYear"],
    ),
  };
}

function mapFieldOwnership(
  value: CanonicalFieldProvenance | undefined,
): ParsedFieldOwnership | undefined {
  if (!value) {
    return undefined;
  }

  return {
    owner: value.owner,
    source: value.source,
    confidence: value.confidence,
    raw: value.raw,
  };
}

function getCanonicalFieldConfidence(value: CanonicalFieldProvenance | undefined) {
  return value?.confidence ?? null;
}

function hasNormalizationForField(
  canonical: CanonicalExtractedDocument,
  fieldPath: string,
) {
  return canonical.provenance.normalization.some(
    (entry) => entry.fieldPath === fieldPath && entry.rawValue !== entry.finalValue,
  );
}

function getNormalizationRuleId(
  canonical: CanonicalExtractedDocument,
  fieldPath: string,
) {
  return (
    canonical.provenance.normalization.find((entry) => entry.fieldPath === fieldPath)?.ruleId ??
    null
  );
}
