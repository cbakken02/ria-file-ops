import fs from "node:fs/promises";
import path from "node:path";
import type { AnalysisProfile } from "@/lib/ai-primary-parser-types";
import type { CanonicalExtractedDocument } from "@/lib/canonical-extracted-document";
import { analyzeDocumentWithEnvelope, type DocumentInsight } from "@/lib/document-intelligence";
import type { GoogleDriveFile } from "@/lib/google-drive";
import {
  readPreviewAnalysisCache,
  writePreviewAnalysisCache,
} from "@/lib/preview-analysis-cache";

export type SyntheticIdentityCorpusManifest = {
  schemaVersion: string;
  cases: SyntheticIdentityCorpusManifestCase[];
};

export type SyntheticIdentityCorpusManifestCase = {
  id: string;
  title: string;
  category: string;
  documentTypeId: string;
  documentSubtype: string | null;
  expectedAmbiguousFields: string[];
  artifacts: {
    pdf: string;
    answerKey: string;
  };
};

export type SyntheticIdentityCorpusAnswerKey = {
  schemaVersion: string;
  caseId: string;
  title: string;
  documentTypeId: string | null;
  documentSubtype: string | null;
  parties: Array<{
    id: string;
    displayName: string | null;
    rawName: string | null;
    addresses: Array<{
      rawText: string | null;
    }>;
    governmentIds: Array<{
      kind: string | null;
      value: string | null;
      issuingAuthority: string | null;
    }>;
  }>;
  dates: Array<{
    kind: string;
    value: string | null;
  }>;
  documentFacts: {
    idType: string | null;
  };
  normalized: {
    documentFacts: {
      idType: string | null;
    };
    primaryFacts: {
      detectedClient: string | null;
      detectedClient2: string | null;
      ownershipType: "single" | "joint" | null;
      documentDate: string | null;
      idType: string | null;
    };
  };
  expectedAmbiguities: Array<{
    fieldPath: string;
    reason: string;
    expected: string | null;
  }>;
};

export type SyntheticIdentityComparableActual = {
  documentTypeId: string | null;
  documentSubtype: string | null;
  parties: Array<{
    displayName: string | null;
    addressRawText: string | null;
    governmentIdKind: string | null;
    governmentIdValue: string | null;
    issuingAuthority: string | null;
  }>;
  dates: Array<{
    kind: string;
    value: string | null;
  }>;
  normalizedDocumentFacts: {
    idType: string | null;
  };
  normalizedPrimaryFacts: {
    detectedClient: string | null;
    detectedClient2: string | null;
    ownershipType: "single" | "joint" | null;
    documentDate: string | null;
    idType: string | null;
  };
};

export type SyntheticIdentityCorpusCaseDiagnostics = {
  analysisSource: "fresh_analysis" | "loaded_from_cache";
  analysisRanAt: string | null;
  cacheWrittenAt: string | null;
  aiEnabled: boolean;
  aiAttempted: boolean;
  aiUsed: boolean;
  aiFailureReason: string | null;
  canonicalPresent: boolean;
};

export type SyntheticIdentityCorpusFieldMismatch = {
  caseId: string;
  caseTitle: string;
  path: string;
  expected: unknown;
  actual: unknown;
  reason: string;
  ambiguous: boolean;
};

export type SyntheticIdentityCorpusCaseScore = {
  checked: number;
  matched: number;
  mismatched: number;
  ambiguousSkipped: number;
};

export type SyntheticIdentityCorpusCaseResult = {
  caseId: string;
  title: string;
  category: string;
  diagnostics: SyntheticIdentityCorpusCaseDiagnostics;
  score: SyntheticIdentityCorpusCaseScore;
  mismatches: SyntheticIdentityCorpusFieldMismatch[];
  actual: SyntheticIdentityComparableActual;
  answerKey: SyntheticIdentityCorpusAnswerKey;
};

export type SyntheticIdentityCorpusEvaluationReport = {
  generatedAt: string;
  corpusRoot: string;
  analysisProfile: AnalysisProfile;
  totals: {
    cases: number;
    checked: number;
    matched: number;
    mismatched: number;
    ambiguousSkipped: number;
    freshAnalysis: number;
    loadedFromCache: number;
    canonicalPresent: number;
  };
  mismatchSummary: Array<{
    path: string;
    count: number;
  }>;
  worstFailures: Array<{
    caseId: string;
    title: string;
    mismatchCount: number;
  }>;
  cases: SyntheticIdentityCorpusCaseResult[];
};

type EvaluateSyntheticIdentityCorpusOptions = {
  corpusRoot?: string;
  analysisProfile?: AnalysisProfile;
  ownerEmail?: string | null;
  useCache?: boolean;
  writeCache?: boolean;
  caseIds?: string[];
};

export async function loadSyntheticIdentityCorpusManifest(
  corpusRoot = defaultCorpusRoot(),
) {
  const manifestPath = path.join(corpusRoot, "manifest.json");
  const raw = await fs.readFile(manifestPath, "utf8");
  return JSON.parse(raw) as SyntheticIdentityCorpusManifest;
}

export async function evaluateSyntheticIdentityCorpus(
  options: EvaluateSyntheticIdentityCorpusOptions = {},
): Promise<SyntheticIdentityCorpusEvaluationReport> {
  const corpusRoot = options.corpusRoot ?? defaultCorpusRoot();
  const manifest = await loadSyntheticIdentityCorpusManifest(corpusRoot);
  const selectedCases =
    options.caseIds && options.caseIds.length > 0
      ? manifest.cases.filter((entry) => options.caseIds?.includes(entry.id))
      : manifest.cases;

  const caseResults: SyntheticIdentityCorpusCaseResult[] = [];
  for (const manifestCase of selectedCases) {
    caseResults.push(
      await evaluateSyntheticIdentityCorpusCase(manifestCase, {
        corpusRoot,
        analysisProfile: options.analysisProfile ?? "legacy",
        ownerEmail:
          options.ownerEmail === undefined
            ? "synthetic-id-corpus-eval@example.com"
            : options.ownerEmail,
        useCache: options.useCache ?? true,
        writeCache: options.writeCache ?? (options.useCache ?? true),
      }),
    );
  }

  return summarizeSyntheticIdentityCorpusReport(
    caseResults,
    corpusRoot,
    options.analysisProfile ?? "legacy",
  );
}

export async function evaluateSyntheticIdentityCorpusCase(
  manifestCase: SyntheticIdentityCorpusManifestCase,
  options: {
    corpusRoot: string;
    analysisProfile: AnalysisProfile;
    ownerEmail: string | null;
    useCache: boolean;
    writeCache: boolean;
  },
): Promise<SyntheticIdentityCorpusCaseResult> {
  const answerKey = await loadSyntheticIdentityCorpusAnswerKey(
    options.corpusRoot,
    manifestCase,
  );
  const pdfPath = path.join(repoRoot(), manifestCase.artifacts.pdf);
  const stat = await fs.stat(pdfPath);
  const file: GoogleDriveFile = {
    id: manifestCase.id,
    name: path.basename(pdfPath),
    mimeType: "application/pdf",
    modifiedTime: stat.mtime.toISOString(),
    size: String(stat.size),
  };

  let diagnostics: SyntheticIdentityCorpusCaseDiagnostics;
  let canonical: CanonicalExtractedDocument | null;
  let insight: DocumentInsight;

  if (options.useCache && options.ownerEmail) {
    const cached = await readPreviewAnalysisCache({
      analysisProfile: options.analysisProfile,
      ownerEmail: options.ownerEmail,
      file,
    });

    if (cached) {
      canonical = cached.canonical;
      insight = cached.insight;
      diagnostics = {
        analysisSource: "loaded_from_cache",
        analysisRanAt: cached.analysisRanAt ?? cached.createdAt,
        cacheWrittenAt: cached.updatedAt,
        aiEnabled: cached.insight.debug.aiEnabled,
        aiAttempted: cached.insight.debug.aiAttempted,
        aiUsed: cached.insight.debug.aiUsed,
        aiFailureReason: cached.insight.debug.aiFailureReason,
        canonicalPresent: Boolean(cached.canonical),
      };

      const actual = projectComparableActual(canonical, insight);
      const comparison = compareSyntheticIdentityCorpusCase(answerKey, actual);
      return {
        caseId: manifestCase.id,
        title: manifestCase.title,
        category: manifestCase.category,
        diagnostics,
        score: comparison.score,
        mismatches: comparison.mismatches.map((mismatch) => ({
          ...mismatch,
          caseId: manifestCase.id,
          caseTitle: manifestCase.title,
        })),
        actual,
        answerKey,
      };
    }
  }

  const buffer = await fs.readFile(pdfPath);
  const analysisRanAt = new Date().toISOString();
  const envelope = await analyzeDocumentWithEnvelope(file, async () => buffer, {
    analysisProfile: options.analysisProfile,
  });
  canonical = envelope.canonical;
  insight = envelope.legacyInsight;

  let cacheWrittenAt: string | null = null;
  if (options.writeCache && options.ownerEmail) {
    const cacheEntry = await writePreviewAnalysisCache({
      analysisProfile: options.analysisProfile,
      ownerEmail: options.ownerEmail,
      file,
      insight,
      canonical,
      previewSnapshotId: null,
      analysisRanAt,
    });
    cacheWrittenAt = cacheEntry.updatedAt;
  }

  diagnostics = {
    analysisSource: "fresh_analysis",
    analysisRanAt,
    cacheWrittenAt,
    aiEnabled: insight.debug.aiEnabled,
    aiAttempted: insight.debug.aiAttempted,
    aiUsed: insight.debug.aiUsed,
    aiFailureReason: insight.debug.aiFailureReason,
    canonicalPresent: Boolean(canonical),
  };

  const actual = projectComparableActual(canonical, insight);
  const comparison = compareSyntheticIdentityCorpusCase(answerKey, actual);
  return {
    caseId: manifestCase.id,
    title: manifestCase.title,
    category: manifestCase.category,
    diagnostics,
    score: comparison.score,
    mismatches: comparison.mismatches.map((mismatch) => ({
      ...mismatch,
      caseId: manifestCase.id,
      caseTitle: manifestCase.title,
    })),
    actual,
    answerKey,
  };
}

export function compareSyntheticIdentityCorpusCase(
  answerKey: SyntheticIdentityCorpusAnswerKey,
  actual: SyntheticIdentityComparableActual,
) {
  const ambiguousPaths = new Set(
    answerKey.expectedAmbiguities.map((entry) => entry.fieldPath),
  );
  const mismatches: Array<Omit<SyntheticIdentityCorpusFieldMismatch, "caseId" | "caseTitle">> = [];
  const score: SyntheticIdentityCorpusCaseScore = {
    checked: 0,
    matched: 0,
    mismatched: 0,
    ambiguousSkipped: 0,
  };

  const compareValue = (
    path: string,
    expected: unknown,
    actualValue: unknown,
    reason: string,
  ) => {
    if (ambiguousPaths.has(path)) {
      score.ambiguousSkipped += 1;
      return;
    }

    score.checked += 1;
    if (isEqualComparable(expected, actualValue)) {
      score.matched += 1;
      return;
    }

    score.mismatched += 1;
    mismatches.push({
      path,
      expected,
      actual: actualValue,
      reason,
      ambiguous: false,
    });
  };

  compareValue(
    "documentTypeId",
    answerKey.documentTypeId,
    actual.documentTypeId,
    "Document type should match the ID answer key.",
  );

  if (answerKey.documentSubtype) {
    compareValue(
      "documentSubtype",
      answerKey.documentSubtype,
      actual.documentSubtype,
      "Document subtype should match when the parser can resolve it cleanly.",
    );
  }

  compareValue(
    "parties[0].displayName",
    answerKey.parties[0]?.displayName ?? null,
    actual.parties[0]?.displayName ?? null,
    "Primary party display name should match the visible ID owner.",
  );
  compareValue(
    "parties[0].addresses[0].rawText",
    answerKey.parties[0]?.addresses[0]?.rawText ?? null,
    actual.parties[0]?.addressRawText ?? null,
    "Primary party address should preserve the visible ID address block.",
  );
  compareValue(
    "parties[0].governmentIds[0].kind",
    answerKey.parties[0]?.governmentIds[0]?.kind ?? null,
    actual.parties[0]?.governmentIdKind ?? null,
    "Government ID kind should distinguish driver licenses from state IDs.",
  );
  compareValue(
    "parties[0].governmentIds[0].value",
    answerKey.parties[0]?.governmentIds[0]?.value ?? null,
    actual.parties[0]?.governmentIdValue ?? null,
    "Government ID value should match when it is clearly visible.",
  );
  compareValue(
    "parties[0].governmentIds[0].issuingAuthority",
    answerKey.parties[0]?.governmentIds[0]?.issuingAuthority ?? null,
    actual.parties[0]?.issuingAuthority ?? null,
    "Issuing authority should match the visible jurisdiction/state.",
  );

  const expectedDatesByKind = new Map(
    answerKey.dates.map((entry) => [entry.kind, entry.value ?? null]),
  );
  const actualDatesByKind = new Map(
    actual.dates.map((entry) => [entry.kind, entry.value ?? null]),
  );
  for (const kind of [
    "birth_date",
    "issue_date",
    "expiration_date",
    "document_date",
  ]) {
    if (!expectedDatesByKind.has(kind)) {
      continue;
    }

    compareValue(
      `dates[${kind}].value`,
      expectedDatesByKind.get(kind) ?? null,
      actualDatesByKind.get(kind) ?? null,
      "Identity-document dates should resolve to the expected canonical date values.",
    );
  }

  compareValue(
    "normalized.documentFacts.idType",
    answerKey.normalized.documentFacts.idType ?? answerKey.documentFacts.idType ?? null,
    actual.normalizedDocumentFacts.idType ?? null,
    "Normalized document facts should preserve the resolved ID type.",
  );
  compareValue(
    "normalized.primaryFacts.detectedClient",
    answerKey.normalized.primaryFacts.detectedClient,
    actual.normalizedPrimaryFacts.detectedClient,
    "Primary facts detectedClient should match the ID owner.",
  );
  compareValue(
    "normalized.primaryFacts.idType",
    answerKey.normalized.primaryFacts.idType,
    actual.normalizedPrimaryFacts.idType,
    "Primary facts idType should match the resolved ID type.",
  );
  compareValue(
    "normalized.primaryFacts.documentDate",
    answerKey.normalized.primaryFacts.documentDate,
    actual.normalizedPrimaryFacts.documentDate,
    "Primary facts documentDate should use the resolved issue/document date.",
  );

  return { score, mismatches };
}

export function formatSyntheticIdentityCorpusEvaluationReport(
  report: SyntheticIdentityCorpusEvaluationReport,
) {
  const lines: string[] = [];
  lines.push("Synthetic identity corpus evaluation");
  lines.push(
    `Profile: ${report.analysisProfile} | Cases: ${report.totals.cases} | Checked: ${report.totals.checked} | Matched: ${report.totals.matched} | Mismatched: ${report.totals.mismatched} | Ambiguous skipped: ${report.totals.ambiguousSkipped}`,
  );
  lines.push(
    `Fresh: ${report.totals.freshAnalysis} | Cache: ${report.totals.loadedFromCache} | Canonical present: ${report.totals.canonicalPresent}`,
  );
  lines.push("");
  lines.push("Per-case summary");

  for (const caseResult of report.cases) {
    const status = caseResult.score.mismatched === 0 ? "PASS" : "FAIL";
    lines.push(
      `- [${status}] ${caseResult.caseId} | mismatches=${caseResult.score.mismatched} | source=${caseResult.diagnostics.analysisSource} | canonical=${caseResult.diagnostics.canonicalPresent}`,
    );
    lines.push(
      `  party=${caseResult.actual.parties[0]?.displayName ?? "null"} | idType=${caseResult.actual.normalizedPrimaryFacts.idType ?? "null"} | documentDate=${caseResult.actual.normalizedPrimaryFacts.documentDate ?? "null"}`,
    );
    for (const mismatch of caseResult.mismatches.slice(0, 5)) {
      lines.push(
        `  mismatch: ${mismatch.path} | expected=${formatUnknown(mismatch.expected)} | actual=${formatUnknown(mismatch.actual)}`,
      );
    }
  }

  lines.push("");
  lines.push("Per-field mismatch summary");
  if (report.mismatchSummary.length === 0) {
    lines.push("- none");
  } else {
    for (const entry of report.mismatchSummary) {
      lines.push(`- ${entry.path}: ${entry.count}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function loadSyntheticIdentityCorpusAnswerKey(
  corpusRoot: string,
  manifestCase: SyntheticIdentityCorpusManifestCase,
) {
  const answerKeyPath = path.join(repoRoot(), manifestCase.artifacts.answerKey);
  const raw = await fs.readFile(answerKeyPath, "utf8");
  return JSON.parse(raw) as SyntheticIdentityCorpusAnswerKey;
}

function projectComparableActual(
  canonical: CanonicalExtractedDocument | null,
  insight: DocumentInsight,
): SyntheticIdentityComparableActual {
  if (canonical) {
    return {
      documentTypeId: canonical.classification.normalized.documentTypeId ?? null,
      documentSubtype: canonical.classification.normalized.documentSubtype ?? null,
      parties: canonical.normalized.parties.map((party) => ({
        displayName: party.displayName ?? null,
        addressRawText: party.addresses[0]?.rawText ?? null,
        governmentIdKind: party.governmentIds[0]?.kind ?? null,
        governmentIdValue: party.governmentIds[0]?.value ?? null,
        issuingAuthority: party.governmentIds[0]?.issuingAuthority ?? null,
      })),
      dates: canonical.normalized.dates.map((date) => ({
        kind: date.kind,
        value: date.value ?? null,
      })),
      normalizedDocumentFacts: {
        idType: canonical.normalized.documentFacts.idType ?? null,
      },
      normalizedPrimaryFacts: {
        detectedClient: canonical.normalized.primaryFacts.detectedClient,
        detectedClient2: canonical.normalized.primaryFacts.detectedClient2,
        ownershipType: canonical.normalized.primaryFacts.ownershipType,
        documentDate: canonical.normalized.primaryFacts.documentDate,
        idType: canonical.normalized.primaryFacts.idType,
      },
    };
  }

  return {
    documentTypeId: insight.documentTypeId,
    documentSubtype: null,
    parties: insight.detectedClient
      ? [
          {
            displayName: insight.detectedClient,
            addressRawText: null,
            governmentIdKind: null,
            governmentIdValue: null,
            issuingAuthority: null,
          },
        ]
      : [],
    dates: insight.metadata.documentDate
      ? [{ kind: "document_date", value: insight.metadata.documentDate }]
      : [],
    normalizedDocumentFacts: {
      idType: insight.metadata.idType,
    },
    normalizedPrimaryFacts: {
      detectedClient: insight.detectedClient,
      detectedClient2: insight.detectedClient2,
      ownershipType: insight.ownershipType,
      documentDate: insight.metadata.documentDate,
      idType: insight.metadata.idType,
    },
  };
}

function summarizeSyntheticIdentityCorpusReport(
  caseResults: SyntheticIdentityCorpusCaseResult[],
  corpusRoot: string,
  analysisProfile: AnalysisProfile,
): SyntheticIdentityCorpusEvaluationReport {
  const mismatchCountByPath = new Map<string, number>();
  for (const caseResult of caseResults) {
    for (const mismatch of caseResult.mismatches) {
      mismatchCountByPath.set(
        mismatch.path,
        (mismatchCountByPath.get(mismatch.path) ?? 0) + 1,
      );
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    corpusRoot,
    analysisProfile,
    totals: {
      cases: caseResults.length,
      checked: sumCaseScores(caseResults, "checked"),
      matched: sumCaseScores(caseResults, "matched"),
      mismatched: sumCaseScores(caseResults, "mismatched"),
      ambiguousSkipped: sumCaseScores(caseResults, "ambiguousSkipped"),
      freshAnalysis: caseResults.filter(
        (entry) => entry.diagnostics.analysisSource === "fresh_analysis",
      ).length,
      loadedFromCache: caseResults.filter(
        (entry) => entry.diagnostics.analysisSource === "loaded_from_cache",
      ).length,
      canonicalPresent: caseResults.filter((entry) => entry.diagnostics.canonicalPresent).length,
    },
    mismatchSummary: [...mismatchCountByPath.entries()]
      .map(([path, count]) => ({ path, count }))
      .sort((left, right) => right.count - left.count || left.path.localeCompare(right.path)),
    worstFailures: [...caseResults]
      .sort(
        (left, right) =>
          right.score.mismatched - left.score.mismatched ||
          left.caseId.localeCompare(right.caseId),
      )
      .filter((entry) => entry.score.mismatched > 0)
      .slice(0, 5)
      .map((entry) => ({
        caseId: entry.caseId,
        title: entry.title,
        mismatchCount: entry.score.mismatched,
      })),
    cases: caseResults,
  };
}

function sumCaseScores(
  caseResults: SyntheticIdentityCorpusCaseResult[],
  field: keyof SyntheticIdentityCorpusCaseScore,
) {
  return caseResults.reduce((sum, entry) => sum + entry.score[field], 0);
}

function isEqualComparable(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function formatUnknown(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function defaultCorpusRoot() {
  return path.join(process.cwd(), "tests", "synthetic-id-corpus");
}

function repoRoot() {
  return process.cwd();
}
