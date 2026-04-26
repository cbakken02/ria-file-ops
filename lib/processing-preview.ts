import type { GoogleDriveFile } from "@/lib/google-drive";
import { resolveAnalysisProfileForMode } from "@/lib/ai-primary-parser";
import { isSupabasePersistence } from "@/lib/persistence/backend";
import {
  createPreviewFileSnapshot,
  hasPreviewFileSnapshot,
} from "@/lib/preview-file-snapshots";
import {
  resolveHouseholdFolderName,
  suggestCanonicalHouseholdFolderName,
} from "@/lib/client-matching";
import {
  analyzeDocumentWithEnvelope,
  DOCUMENT_ANALYSIS_VERSION,
  type DocumentInsight,
} from "@/lib/document-intelligence";
import {
  writeCanonicalAccountStatement,
  writeCanonicalIdentityDocument,
} from "@/lib/firm-document-store";
import {
  readPreviewAnalysisCache,
  writePreviewAnalysisCache,
} from "@/lib/preview-analysis-cache";
import type {
  AnalysisProfile,
  ParsedFieldOwnership,
  ParsedFieldKey,
} from "@/lib/ai-primary-parser-types";
import {
  getReviewRuleOption,
  normalizeFolderTemplate,
  type ReviewRuleValue,
} from "@/lib/setup-config";
import type { ClientMemoryRule, FirmSettings } from "@/lib/db";
import {
  buildDocumentFilenamePlan,
  getDetectedDocumentSubtype,
  getDefaultNamingConventionSummary,
  getDefaultNamingRules,
  parseNamingRules,
  type NamingRuleDocumentType,
} from "@/lib/naming-rules";

export type PreviewItem = {
  id: string;
  sourceName: string;
  mimeType: string;
  createdTime?: string;
  modifiedTime?: string;
  driveSize?: string;
  downloadByteLength: number | null;
  downloadSha1: string | null;
  previewSnapshotId: string | null;
  parserConflictSummary: string | null;
  proposedTopLevelFolder: string;
  proposedFilename: string;
  confidenceLabel: "High" | "Medium" | "Low";
  confidenceScore: number;
  status: "Ready to stage" | "Needs review";
  reasons: string[];
  detectedDocumentType: string;
  detectedDocumentSubtype: string | null;
  detectedClient: string | null;
  detectedClient2: string | null;
  ownershipType: "single" | "joint";
  resolvedHouseholdFolder: string | null;
  suggestedHouseholdFolder: string | null;
  householdMatchReason: string;
  householdResolutionStatus: "matched_existing" | "created_new" | "needs_review";
  resolvedClientFolder: string | null;
  suggestedClientFolder: string | null;
  clientMatchReason: string;
  clientResolutionStatus: "matched_existing" | "created_new" | "needs_review";
  analysisSource: "fresh_analysis" | "loaded_from_cache";
  analysisRanAt: string | null;
  cacheWrittenAt: string | null;
  contentSource: "pdf_text" | "pdf_ocr" | "image_ocr" | "metadata_only";
  textExcerpt: string | null;
  diagnosticText: string | null;
  pdfFields: Array<{ name: string; value: string }>;
  debug: {
    parserVersion: string;
    parserConflictSummary: string | null;
    documentSignal: string | null;
    statementClientSource: DocumentInsight["debug"]["statementClientSource"];
    statementClientCandidate: DocumentInsight["debug"]["statementClientCandidate"];
    aiModel: string | null;
    aiPromptVersion: string | null;
    aiRawSummary: string | null;
    aiRawDetectedClient: string | null;
    aiRawDetectedClient2: string | null;
    aiRawCustodian: string | null;
    aiRawAccountType: string | null;
    aiEnabled: boolean;
    aiAttempted: boolean;
    aiUsed: boolean;
    aiFailureReason: string | null;
    custodianWasNormalized: boolean;
    accountTypeWasNormalized: boolean;
    custodianNormalizationRule: string | null;
    accountTypeNormalizationRule: string | null;
    fieldOwnership: Partial<Record<ParsedFieldKey, ParsedFieldOwnership>>;
    ownershipClientCandidate: string | null;
    accountContextCandidate: string | null;
    accountLooseCandidate: string | null;
    taxKeywordDetected: boolean;
    yearCandidates: string[];
  };
  documentTypeId: NamingRuleDocumentType;
  extractedAccountLast4: string | null;
  extractedAccountType: string | null;
  extractedCustodian: string | null;
  extractedDocumentDate: string | null;
  extractedEntityName: string | null;
  extractedIdType: string | null;
  extractedTaxYear: string | null;
  phase1ReviewFlags: PreviewPhase1ReviewFlag[];
  phase1ReviewPriority: PreviewPhase1ReviewPriority;
};

export type PreviewNormalizationSummary = {
  normalizedFileCount: number;
  custodianNormalizedCount: number;
  accountTypeNormalizedCount: number;
};

export type PreviewPhase1ReviewFlag =
  | "document_date_conflict"
  | "missing_custodian_on_valid_statement"
  | "missing_account_type_on_valid_statement"
  | "custodian_differs_from_raw_ai"
  | "account_type_differs_from_raw_ai";

export type PreviewPhase1ReviewPriority = "high" | "medium" | "low" | null;

export type PreviewPhase1Summary = {
  aiSucceededCount: number;
  aiFailedFallbackCount: number;
  aiSkippedCount: number;
  custodianNormalizedCount: number;
  accountTypeNormalizedCount: number;
  flaggedFileCount: number;
  highPriorityCount: number;
  mediumPriorityCount: number;
  lowPriorityCount: number;
};

export function getEmptyPreviewNormalizationSummary(): PreviewNormalizationSummary {
  return {
    normalizedFileCount: 0,
    custodianNormalizedCount: 0,
    accountTypeNormalizedCount: 0,
  };
}

export function getEmptyPreviewPhase1Summary(): PreviewPhase1Summary {
  return {
    aiSucceededCount: 0,
    aiFailedFallbackCount: 0,
    aiSkippedCount: 0,
    custodianNormalizedCount: 0,
    accountTypeNormalizedCount: 0,
    flaggedFileCount: 0,
    highPriorityCount: 0,
    mediumPriorityCount: 0,
    lowPriorityCount: 0,
  };
}

export function summarizePreviewNormalizationChanges(
  items: Array<Pick<PreviewItem, "debug">>,
): PreviewNormalizationSummary {
  return items.reduce((summary, item) => {
    const custodianChanged = item.debug.custodianWasNormalized === true;
    const accountTypeChanged = item.debug.accountTypeWasNormalized === true;

    if (custodianChanged || accountTypeChanged) {
      summary.normalizedFileCount += 1;
    }
    if (custodianChanged) {
      summary.custodianNormalizedCount += 1;
    }
    if (accountTypeChanged) {
      summary.accountTypeNormalizedCount += 1;
    }

    return summary;
  }, getEmptyPreviewNormalizationSummary());
}

export function summarizePreviewPhase1Evaluation(
  items: Array<Pick<PreviewItem, "debug" | "phase1ReviewFlags" | "phase1ReviewPriority">>,
): PreviewPhase1Summary {
  return items.reduce((summary, item) => {
    if (item.debug.aiEnabled) {
      if (item.debug.aiAttempted && item.debug.aiUsed) {
        summary.aiSucceededCount += 1;
      } else if (item.debug.aiAttempted) {
        summary.aiFailedFallbackCount += 1;
      } else {
        summary.aiSkippedCount += 1;
      }
    }

    if (item.debug.custodianWasNormalized) {
      summary.custodianNormalizedCount += 1;
    }
    if (item.debug.accountTypeWasNormalized) {
      summary.accountTypeNormalizedCount += 1;
    }
    if (item.phase1ReviewFlags.length > 0) {
      summary.flaggedFileCount += 1;
    }
    if (item.phase1ReviewPriority === "high") {
      summary.highPriorityCount += 1;
    } else if (item.phase1ReviewPriority === "medium") {
      summary.mediumPriorityCount += 1;
    } else if (item.phase1ReviewPriority === "low") {
      summary.lowPriorityCount += 1;
    }

    return summary;
  }, getEmptyPreviewPhase1Summary());
}

export function derivePreviewPhase1ReviewPriority(
  item: Pick<PreviewItem, "documentTypeId" | "phase1ReviewFlags" | "debug">,
): PreviewPhase1ReviewPriority {
  if (item.documentTypeId !== "account_statement" || !item.debug.aiEnabled) {
    return null;
  }

  const hasHighFlag = item.phase1ReviewFlags.some(
    (flag) =>
      flag === "document_date_conflict" ||
      flag === "missing_custodian_on_valid_statement" ||
      flag === "missing_account_type_on_valid_statement",
  );

  if (!item.debug.aiUsed || hasHighFlag) {
    return "high";
  }

  const hasMediumSignal =
    item.debug.custodianWasNormalized ||
    item.debug.accountTypeWasNormalized ||
    item.phase1ReviewFlags.some(
      (flag) =>
        flag === "custodian_differs_from_raw_ai" ||
        flag === "account_type_differs_from_raw_ai",
    );

  if (hasMediumSignal) {
    return "medium";
  }

  return "low";
}

export function derivePreviewPhase1ReviewFlags(
  item: Pick<
    PreviewItem,
    | "documentTypeId"
    | "detectedClient"
    | "diagnosticText"
    | "extractedAccountLast4"
    | "extractedAccountType"
    | "extractedCustodian"
    | "extractedDocumentDate"
    | "debug"
  >,
): PreviewPhase1ReviewFlag[] {
  if (item.documentTypeId !== "account_statement") {
    return [];
  }

  const flags = new Set<PreviewPhase1ReviewFlag>();
  const isValidStatement =
    Boolean(item.detectedClient) ||
    Boolean(item.extractedAccountLast4) ||
    Boolean(item.extractedDocumentDate);

  if (isValidStatement && !normalizePreviewValue(item.extractedCustodian)) {
    flags.add("missing_custodian_on_valid_statement");
  }

  if (isValidStatement && !normalizePreviewValue(item.extractedAccountType)) {
    flags.add("missing_account_type_on_valid_statement");
  }

  const rawCustodian = normalizePreviewValue(item.debug.aiRawCustodian);
  const finalCustodian = normalizePreviewValue(item.extractedCustodian);
  if (rawCustodian && finalCustodian && rawCustodian !== finalCustodian) {
    flags.add("custodian_differs_from_raw_ai");
  }

  const rawAccountType = normalizePreviewValue(item.debug.aiRawAccountType);
  const finalAccountType = normalizePreviewValue(item.extractedAccountType);
  if (rawAccountType && finalAccountType && rawAccountType !== finalAccountType) {
    flags.add("account_type_differs_from_raw_ai");
  }

  if (hasConflictingStatementDateSignals(item.diagnosticText, item.extractedDocumentDate)) {
    flags.add("document_date_conflict");
  }

  return Array.from(flags);
}

export async function buildProcessingPreview(
  files: GoogleDriveFile[],
  settings: FirmSettings | null,
  getFileBuffer: (fileId: string) => Promise<Buffer>,
  existingClientFolders: string[],
  clientMemoryRules: ClientMemoryRule[] = [],
  options: {
    analysisMode?: "default" | "preview";
  } = {},
) {
  const folderTemplate = normalizeFolderTemplate(settings?.folderTemplate);
  const namingRules = parseNamingRules(
    settings?.namingRulesJson,
    settings?.namingConvention ?? getDefaultNamingConventionSummary(getDefaultNamingRules()),
  );
  const reviewRule = getReviewRuleOption(settings?.reviewInstruction);

  const candidateFiles = files
    .filter((file) => file.mimeType !== "application/vnd.google-apps.folder")
    .slice(0, 20);

  const items = await Promise.all(
    candidateFiles.map((file) =>
      buildPreviewItem(
        file,
        folderTemplate,
        namingRules,
        reviewRule.value,
        getFileBuffer,
        existingClientFolders,
        clientMemoryRules,
        settings?.ownerEmail ?? null,
        resolveAnalysisProfileForMode(options.analysisMode ?? "default"),
      ),
    ),
  );

  const readyCount = items.filter((item) => item.status === "Ready to stage").length;
  const reviewCount = items.length - readyCount;
  const normalizationSummary = summarizePreviewNormalizationChanges(items);
  const phase1Summary = summarizePreviewPhase1Evaluation(items);

  return {
    items,
    readyCount,
    reviewCount,
    normalizationSummary,
    phase1Summary,
    folderTemplate,
    reviewRule,
  };
}

async function buildPreviewItem(
  file: GoogleDriveFile,
  folderTemplate: string[],
  namingRules: ReturnType<typeof parseNamingRules>,
  reviewRule: ReviewRuleValue,
  getFileBuffer: (fileId: string) => Promise<Buffer>,
  existingClientFolders: string[],
  clientMemoryRules: ClientMemoryRule[],
  ownerEmail: string | null,
  analysisProfile: AnalysisProfile,
): Promise<PreviewItem> {
  const {
    insight,
    previewSnapshotId,
    analysisSource,
    analysisRanAt,
    cacheWrittenAt,
  } = await loadPreviewArtifacts({
    file,
    getFileBuffer,
    ownerEmail,
    analysisProfile,
  });
  const detectedClient = insight.detectedClient;
  const detectedClient2 = insight.detectedClient2;
  const detectedDocumentSubtype = getDetectedDocumentSubtype(
    insight.documentTypeId,
    insight.documentLabel,
  );
  const clientMatch = resolveHouseholdFolderName(
    detectedClient,
    detectedClient2,
    existingClientFolders,
    clientMemoryRules,
  );
  const resolvedClientFolder = clientMatch.folderName;
  const suggestedClientFolder =
    resolvedClientFolder ??
    suggestCanonicalHouseholdFolderName(detectedClient, detectedClient2);
  const extension = detectExtension(file);
  const modifiedDate = formatDateForFilename(file.modifiedTime);
  const documentTypeId = insight.documentTypeId;
  const proposedTopLevelFolder = mapDocumentTypeToFolder(
    insight.topLevelFolder,
    folderTemplate,
  );
  const proposedFilename = buildDocumentFilenamePlan({
    accountLast4: insight.metadata.accountLast4,
    accountType: insight.metadata.accountType,
    clientName: detectedClient,
    clientName2: detectedClient2,
    custodian: insight.metadata.custodian,
    detectedClient,
    detectedClient2,
    documentDate: insight.metadata.documentDate ?? modifiedDate,
    documentTypeLabel: insight.documentLabel,
    entityName: insight.metadata.entityName,
    extension,
    fallbackName: file.name,
    householdFolder: suggestedClientFolder,
    idType: insight.metadata.idType,
    ownershipType: insight.ownershipType,
    rules: namingRules,
    sourceName: file.name,
    taxYear: insight.metadata.taxYear,
  });
  let confidenceScore = Math.max(0.18, Math.min(0.96, insight.confidence));

  if (clientMatch.status === "matched_existing") {
    confidenceScore = Math.min(0.97, confidenceScore + 0.06);
  } else if (clientMatch.status === "needs_review") {
    confidenceScore = Math.max(0.22, confidenceScore - 0.15);
  }

  const confidenceLabel =
    confidenceScore >= 0.8 ? "High" : confidenceScore >= 0.6 ? "Medium" : "Low";
  const isReadyToStage =
    confidenceScore >= 0.72 &&
    resolvedClientFolder &&
    clientMatch.status === "matched_existing";
  const status = isReadyToStage ? "Ready to stage" : "Needs review";
  const reasons = [clientMatch.matchReason, ...insight.reasons];

  if (!resolvedClientFolder && suggestedClientFolder) {
    reasons.unshift(
      `Possible new household candidate: ${suggestedClientFolder}. Review before creating a new household folder.`,
    );
  }

  const phase1ReviewFlags = derivePreviewPhase1ReviewFlags({
    documentTypeId,
    detectedClient,
    diagnosticText: insight.diagnosticText,
    extractedAccountLast4: insight.metadata.accountLast4,
    extractedAccountType: insight.metadata.accountType,
    extractedCustodian: insight.metadata.custodian,
    extractedDocumentDate: insight.metadata.documentDate,
    debug: insight.debug,
  });
  const phase1ReviewPriority = derivePreviewPhase1ReviewPriority({
    documentTypeId,
    phase1ReviewFlags,
    debug: insight.debug,
  });

  return {
    id: file.id,
    sourceName: file.name,
    mimeType: file.mimeType,
    createdTime: file.createdTime,
    modifiedTime: file.modifiedTime,
    driveSize: file.size,
    downloadByteLength: insight.debug.downloadByteLength,
    downloadSha1: insight.debug.downloadSha1,
    previewSnapshotId,
    parserConflictSummary: insight.debug.parserConflictSummary,
    proposedTopLevelFolder,
    proposedFilename,
    confidenceLabel,
    confidenceScore,
    status,
    reasons,
    detectedDocumentType: insight.documentLabel,
    detectedDocumentSubtype,
    detectedClient,
    detectedClient2,
    ownershipType: insight.ownershipType,
    resolvedHouseholdFolder: resolvedClientFolder,
    suggestedHouseholdFolder: suggestedClientFolder,
    householdMatchReason: clientMatch.matchReason,
    householdResolutionStatus: clientMatch.status,
    resolvedClientFolder,
    suggestedClientFolder,
    clientMatchReason: clientMatch.matchReason,
    clientResolutionStatus: clientMatch.status,
    analysisSource,
    analysisRanAt,
    cacheWrittenAt,
    contentSource: insight.contentSource,
    textExcerpt: insight.textExcerpt,
    diagnosticText: insight.diagnosticText,
    pdfFields: insight.pdfFields,
    debug: insight.debug,
    documentTypeId,
    extractedAccountLast4: insight.metadata.accountLast4,
    extractedAccountType: insight.metadata.accountType,
    extractedCustodian: insight.metadata.custodian,
    extractedDocumentDate: insight.metadata.documentDate ?? modifiedDate,
    extractedEntityName: insight.metadata.entityName,
    extractedIdType: insight.metadata.idType,
    extractedTaxYear: insight.metadata.taxYear,
    phase1ReviewFlags,
    phase1ReviewPriority,
  };
}

async function loadPreviewArtifacts(input: {
  file: GoogleDriveFile;
  getFileBuffer: (fileId: string) => Promise<Buffer>;
  ownerEmail: string | null;
  analysisProfile: AnalysisProfile;
}) {
  const previewFileSnapshotsEnabled = !isSupabasePersistence();
  const cachedEntry = input.ownerEmail
    ? await readPreviewAnalysisCache({
        analysisProfile: input.analysisProfile,
        ownerEmail: input.ownerEmail,
        file: input.file,
      })
    : null;

  if (cachedEntry) {
    if (!previewFileSnapshotsEnabled) {
      return {
        insight: cachedEntry.insight,
        previewSnapshotId: null,
        analysisSource: "loaded_from_cache" as const,
        analysisRanAt: cachedEntry.analysisRanAt ?? cachedEntry.createdAt,
        cacheWrittenAt: cachedEntry.updatedAt,
      };
    }

    const cachedSnapshotId =
      cachedEntry.previewSnapshotId &&
      (await hasPreviewFileSnapshot(cachedEntry.previewSnapshotId))
        ? cachedEntry.previewSnapshotId
        : null;

    if (cachedSnapshotId) {
      return {
        insight: cachedEntry.insight,
        previewSnapshotId: cachedSnapshotId,
        analysisSource: "loaded_from_cache" as const,
        analysisRanAt: cachedEntry.analysisRanAt ?? cachedEntry.createdAt,
        cacheWrittenAt: cachedEntry.updatedAt,
      };
    }

    const buffer = await input.getFileBuffer(input.file.id);
    const previewSnapshot = await createPreviewFileSnapshot({
      buffer,
      fileId: input.file.id,
      sourceName: input.file.name,
      mimeType: input.file.mimeType,
    }).catch(() => null);
    const previewSnapshotId = previewSnapshot?.id ?? null;

    if (input.ownerEmail) {
      const cacheEntry = await writePreviewAnalysisCache({
        analysisProfile: input.analysisProfile,
        ownerEmail: input.ownerEmail,
        file: input.file,
        insight: cachedEntry.insight,
        previewSnapshotId,
      });

      return {
        insight: cachedEntry.insight,
        previewSnapshotId,
        analysisSource: "loaded_from_cache" as const,
        analysisRanAt: cacheEntry.analysisRanAt,
        cacheWrittenAt: cacheEntry.updatedAt,
      };
    }

    return {
      insight: cachedEntry.insight,
      previewSnapshotId,
      analysisSource: "loaded_from_cache" as const,
      analysisRanAt: cachedEntry.analysisRanAt ?? cachedEntry.createdAt,
      cacheWrittenAt: null,
    };
  }

  const buffer = await input.getFileBuffer(input.file.id);
  const analysisRanAt = new Date().toISOString();
  const envelope = await analyzeDocumentWithEnvelope(
    input.file,
    async () => buffer,
    { analysisProfile: input.analysisProfile },
  );
  const insight = envelope.legacyInsight;
  const previewSnapshot = previewFileSnapshotsEnabled
    ? await createPreviewFileSnapshot({
        buffer,
        fileId: input.file.id,
        sourceName: input.file.name,
        mimeType: input.file.mimeType,
      }).catch(() => null)
    : null;
  const previewSnapshotId = previewSnapshot?.id ?? null;

  if (input.ownerEmail) {
    const canonical = envelope.canonical;
    const canonicalDocumentTypeId =
      canonical?.classification.normalized.documentTypeId ?? null;
    if (canonical) {
      if (
        input.analysisProfile === "preview_ai_primary" &&
        canonicalDocumentTypeId === "account_statement"
      ) {
        try {
          await writeCanonicalAccountStatement({
            ownerEmail: input.ownerEmail,
            analysisProfile: input.analysisProfile,
            analysisVersion: DOCUMENT_ANALYSIS_VERSION,
            analysisRanAt,
            canonical,
          });
        } catch (error) {
          console.error("Canonical statement SQLite write failed.", error);
        }
      } else if (canonicalDocumentTypeId === "identity_document") {
        try {
          await writeCanonicalIdentityDocument({
            ownerEmail: input.ownerEmail,
            analysisProfile: input.analysisProfile,
            analysisVersion: DOCUMENT_ANALYSIS_VERSION,
            analysisRanAt,
            canonical,
          });
        } catch (error) {
          console.error("Canonical identity-document SQLite write failed.", error);
        }
      }
    }

    const cacheEntry = await writePreviewAnalysisCache({
      analysisProfile: input.analysisProfile,
      ownerEmail: input.ownerEmail,
      file: input.file,
      insight,
      canonical: envelope.canonical,
      previewSnapshotId,
      analysisRanAt,
    });

    return {
      insight,
      previewSnapshotId,
      analysisSource: "fresh_analysis" as const,
      analysisRanAt: cacheEntry.analysisRanAt,
      cacheWrittenAt: cacheEntry.updatedAt,
    };
  }

  return {
    insight,
    previewSnapshotId,
    analysisSource: "fresh_analysis" as const,
    analysisRanAt,
    cacheWrittenAt: null,
  };
}

function mapDocumentTypeToFolder(preferredFolder: string, template: string[]) {
  const exact = template.find(
    (folder) => folder.toLowerCase() === preferredFolder.toLowerCase(),
  );

  if (exact) {
    return exact;
  }

  const reviewFolder = template.find(
    (folder) => folder.toLowerCase() === "review",
  );

  return reviewFolder ?? template[0] ?? "Review";
}

function detectExtension(file: GoogleDriveFile) {
  if (file.fileExtension) {
    return `.${file.fileExtension.toLowerCase()}`;
  }

  if (file.name.includes(".")) {
    return `.${file.name.split(".").pop()?.toLowerCase() ?? "file"}`;
  }

  return "";
}

function formatDateForFilename(value?: string) {
  if (!value) {
    return "Undated";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Undated";
  }

  return parsed.toISOString().slice(0, 10);
}

function hasConflictingStatementDateSignals(
  text: string | null | undefined,
  finalDate: string | null | undefined,
) {
  const candidates = collectStatementDocumentDateCandidates(text);
  if (candidates.length < 2) {
    return false;
  }

  const finalNormalized = normalizeCandidateDate(finalDate);
  if (!finalNormalized) {
    return true;
  }

  return candidates.some((candidate) => candidate !== finalNormalized);
}

function collectStatementDocumentDateCandidates(text: string | null | undefined) {
  const normalizedText = normalizePreviewValue(text);
  if (!normalizedText) {
    return [];
  }

  const candidates = new Set<string>();
  const statementPeriodMatches = normalizedText.matchAll(
    /\bstatement period\b[\s:]*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})\s+(?:through|to|-)\s+([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/gi,
  );
  for (const match of statementPeriodMatches) {
    const endDate = normalizeCandidateDate(match[2]);
    if (endDate) {
      candidates.add(endDate);
    }
  }

  const anchoredPatterns = [
    /\bstatement date\b[\s:]*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})/gi,
    /\b(?:period ending|ending date|as of|report date)\b[\s:]*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})/gi,
  ];

  for (const pattern of anchoredPatterns) {
    const matches = normalizedText.matchAll(pattern);
    for (const match of matches) {
      const candidate = normalizeCandidateDate(match[1]);
      if (candidate) {
        candidates.add(candidate);
      }
    }
  }

  return Array.from(candidates);
}

function normalizeCandidateDate(value: string | null | undefined) {
  const normalized = normalizePreviewValue(value);
  if (!normalized) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function normalizePreviewValue(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized ? normalized : null;
}
