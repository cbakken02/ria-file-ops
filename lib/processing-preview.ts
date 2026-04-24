import type { GoogleDriveFile } from "@/lib/google-drive";
import { resolveAnalysisProfileForMode } from "@/lib/ai-primary-parser";
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
} from "@/lib/document-intelligence";
import {
  writeCanonicalAccountStatementToSqlite,
  writeCanonicalIdentityDocumentToSqlite,
} from "@/lib/firm-document-sqlite";
import {
  readPreviewAnalysisCache,
  writePreviewAnalysisCache,
} from "@/lib/preview-analysis-cache";
import type { AnalysisProfile } from "@/lib/ai-primary-parser-types";
import {
  getReviewRuleOption,
  normalizeFolderTemplate,
  type ReviewRuleValue,
} from "@/lib/setup-config";
import type { ClientMemoryRule, FirmSettings } from "@/lib/db";
import {
  buildDocumentFilenamePlan,
  getDefaultNamingConventionSummary,
  getDefaultNamingRules,
  parseNamingRules,
  type NamingRuleDocumentType,
} from "@/lib/naming-rules";

export type PreviewItem = {
  id: string;
  sourceName: string;
  mimeType: string;
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
};

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

  return {
    items,
    readyCount,
    reviewCount,
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
  const canAutoFile =
    reviewRule === "auto_file_high_confidence" &&
    confidenceScore >= 0.72 &&
    resolvedClientFolder &&
    clientMatch.status === "matched_existing";
  const status = canAutoFile ? "Ready to stage" : "Needs review";
  const reasons = [clientMatch.matchReason, ...insight.reasons];

  if (!resolvedClientFolder && suggestedClientFolder) {
    reasons.unshift(
      `Possible new household candidate: ${suggestedClientFolder}. Review before creating a new household folder.`,
    );
  }

  if (reviewRule === "manual_only") {
    reasons.unshift(
      "Manual review only is enabled, so this file stays in review even if the match looks confident.",
    );
  }

  return {
    id: file.id,
    sourceName: file.name,
    mimeType: file.mimeType,
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
  };
}

async function loadPreviewArtifacts(input: {
  file: GoogleDriveFile;
  getFileBuffer: (fileId: string) => Promise<Buffer>;
  ownerEmail: string | null;
  analysisProfile: AnalysisProfile;
}) {
  const cachedEntry = input.ownerEmail
    ? await readPreviewAnalysisCache({
        analysisProfile: input.analysisProfile,
        ownerEmail: input.ownerEmail,
        file: input.file,
      })
    : null;

  if (cachedEntry) {
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
  const previewSnapshot = await createPreviewFileSnapshot({
    buffer,
    fileId: input.file.id,
    sourceName: input.file.name,
    mimeType: input.file.mimeType,
  }).catch(() => null);
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
          writeCanonicalAccountStatementToSqlite({
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
          writeCanonicalIdentityDocumentToSqlite({
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
