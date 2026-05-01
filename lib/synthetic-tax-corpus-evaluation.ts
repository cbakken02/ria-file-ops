import fs from "node:fs/promises";
import path from "node:path";
import type { AnalysisProfile } from "@/lib/ai-primary-parser-types";
import type { CanonicalExtractedDocument } from "@/lib/canonical-extracted-document";
import {
  analyzeTextContentWithEnvelope,
  type DocumentInsight,
} from "@/lib/document-intelligence";
import type { GoogleDriveFile } from "@/lib/google-drive";

export type SyntheticTaxCorpusManifest = {
  schemaVersion: string;
  generationPath: {
    source: string;
    script: string;
  };
  cases: SyntheticTaxCorpusManifestCase[];
};

export type SyntheticTaxCorpusManifestCase = {
  id: string;
  title: string;
  category: string;
  documentTypeId: string;
  documentSubtype: string | null;
  golden: boolean;
  expectedAmbiguousFields: string[];
  artifacts: {
    text: string;
    answerKey: string;
    notes: string;
  };
};

export type SyntheticTaxCorpusAnswerKey = {
  schemaVersion: string;
  caseId: string;
  title: string;
  documentTypeId: string | null;
  documentSubtype: string | null;
  normalized: {
    primaryFacts: {
      detectedClient: string | null;
      custodian: string | null;
      documentDate: string | null;
      idType: string | null;
      taxYear: string | null;
    };
  };
  taxFacts: SyntheticTaxFactExpectation[];
  expectedAmbiguities: Array<{
    fieldPath: string;
    reason: string;
    expected: string | null;
  }>;
};

export type SyntheticTaxFactExpectation = {
  fieldId: string;
  form: string | null;
  label: string;
  line: string | null;
  box: string | null;
  valueType: string;
  value: string | null;
  amount: string | null;
  currency: string | null;
};

export type SyntheticTaxComparableActual = {
  documentTypeId: string | null;
  documentSubtype: string | null;
  normalizedPrimaryFacts: SyntheticTaxCorpusAnswerKey["normalized"]["primaryFacts"];
  taxFacts: SyntheticTaxFactExpectation[];
};

export type SyntheticTaxCorpusCaseDiagnostics = {
  analysisRanAt: string;
  aiEnabled: boolean;
  aiAttempted: boolean;
  aiUsed: boolean;
  aiFailureReason: string | null;
  canonicalPresent: boolean;
};

export type SyntheticTaxCorpusFieldMismatch = {
  caseId: string;
  caseTitle: string;
  path: string;
  expected: unknown;
  actual: unknown;
  reason: string;
  ambiguous: boolean;
};

export type SyntheticTaxCorpusCaseScore = {
  checked: number;
  matched: number;
  mismatched: number;
  ambiguousSkipped: number;
};

export type SyntheticTaxCorpusCaseResult = {
  caseId: string;
  title: string;
  category: string;
  golden: boolean;
  diagnostics: SyntheticTaxCorpusCaseDiagnostics;
  score: SyntheticTaxCorpusCaseScore;
  mismatches: SyntheticTaxCorpusFieldMismatch[];
  actual: SyntheticTaxComparableActual;
  answerKey: SyntheticTaxCorpusAnswerKey;
};

export type SyntheticTaxCorpusEvaluationReport = {
  generatedAt: string;
  corpusRoot: string;
  analysisProfile: AnalysisProfile;
  totals: {
    cases: number;
    goldenCases: number;
    checked: number;
    matched: number;
    mismatched: number;
    ambiguousSkipped: number;
    goldenMismatched: number;
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
  cases: SyntheticTaxCorpusCaseResult[];
};

type EvaluateSyntheticTaxCorpusOptions = {
  corpusRoot?: string;
  analysisProfile?: AnalysisProfile;
  caseIds?: string[];
};

export async function loadSyntheticTaxCorpusManifest(
  corpusRoot = defaultCorpusRoot(),
) {
  const manifestPath = path.join(corpusRoot, "manifest.json");
  const raw = await fs.readFile(manifestPath, "utf8");
  return JSON.parse(raw) as SyntheticTaxCorpusManifest;
}

export async function evaluateSyntheticTaxCorpus(
  options: EvaluateSyntheticTaxCorpusOptions = {},
): Promise<SyntheticTaxCorpusEvaluationReport> {
  const corpusRoot = options.corpusRoot ?? defaultCorpusRoot();
  const manifest = await loadSyntheticTaxCorpusManifest(corpusRoot);
  const selectedCases =
    options.caseIds && options.caseIds.length > 0
      ? manifest.cases.filter((entry) => options.caseIds?.includes(entry.id))
      : manifest.cases;

  const caseResults: SyntheticTaxCorpusCaseResult[] = [];
  for (const manifestCase of selectedCases) {
    caseResults.push(
      await evaluateSyntheticTaxCorpusCase(manifestCase, {
        corpusRoot,
        analysisProfile: options.analysisProfile ?? "legacy",
      }),
    );
  }

  return summarizeSyntheticTaxCorpusReport(
    caseResults,
    corpusRoot,
    options.analysisProfile ?? "legacy",
  );
}

export async function evaluateSyntheticTaxCorpusCase(
  manifestCase: SyntheticTaxCorpusManifestCase,
  options: {
    corpusRoot: string;
    analysisProfile: AnalysisProfile;
  },
): Promise<SyntheticTaxCorpusCaseResult> {
  const answerKey = await loadSyntheticTaxCorpusAnswerKey(
    options.corpusRoot,
    manifestCase,
  );
  const textPath = path.join(repoRoot(), manifestCase.artifacts.text);
  const text = await fs.readFile(textPath, "utf8");
  const stat = await fs.stat(textPath);
  const file: GoogleDriveFile = {
    id: manifestCase.id,
    name: path.basename(textPath).replace(/\.txt$/i, ".pdf"),
    mimeType: "application/pdf",
    modifiedTime: stat.mtime.toISOString(),
    size: String(Buffer.byteLength(text)),
  };
  const analysisRanAt = new Date().toISOString();
  const envelope = await analyzeTextContentWithEnvelope(
    file,
    text,
    {},
    "pdf_text",
    undefined,
    [],
    undefined,
    null,
    { analysisProfile: options.analysisProfile },
  );

  const actual = projectComparableActual(
    envelope.canonical,
    envelope.legacyInsight,
  );
  const comparison = compareSyntheticTaxCorpusCase(answerKey, actual);

  return {
    caseId: manifestCase.id,
    title: manifestCase.title,
    category: manifestCase.category,
    golden: manifestCase.golden,
    diagnostics: {
      analysisRanAt,
      aiEnabled: envelope.legacyInsight.debug.aiEnabled,
      aiAttempted: envelope.legacyInsight.debug.aiAttempted,
      aiUsed: envelope.legacyInsight.debug.aiUsed,
      aiFailureReason: envelope.legacyInsight.debug.aiFailureReason,
      canonicalPresent: Boolean(envelope.canonical),
    },
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

export function compareSyntheticTaxCorpusCase(
  answerKey: SyntheticTaxCorpusAnswerKey,
  actual: SyntheticTaxComparableActual,
) {
  const ambiguousPaths = new Set(
    answerKey.expectedAmbiguities.map((entry) => entry.fieldPath),
  );
  const mismatches: Array<Omit<SyntheticTaxCorpusFieldMismatch, "caseId" | "caseTitle">> = [];
  const score: SyntheticTaxCorpusCaseScore = {
    checked: 0,
    matched: 0,
    mismatched: 0,
    ambiguousSkipped: 0,
  };

  const compareValue = (
    fieldPath: string,
    expected: unknown,
    actualValue: unknown,
    reason: string,
  ) => {
    if (ambiguousPaths.has(fieldPath)) {
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
      path: fieldPath,
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
    "Document type should resolve to the tax document family.",
  );
  compareValue(
    "documentSubtype",
    answerKey.documentSubtype,
    actual.documentSubtype,
    "Document subtype should match the expected tax subtype.",
  );

  for (const field of [
    "detectedClient",
    "custodian",
    "documentDate",
    "idType",
    "taxYear",
  ] as const) {
    compareValue(
      `normalized.primaryFacts.${field}`,
      answerKey.normalized.primaryFacts[field],
      actual.normalizedPrimaryFacts[field],
      "Primary tax document facts should match the answer key.",
    );
  }

  compareValue(
    "taxFacts.length",
    answerKey.taxFacts.length,
    actual.taxFacts.length,
    "Tax fact count should match the expected focused extraction surface.",
  );

  for (const expectedFact of answerKey.taxFacts) {
    const actualFact = actual.taxFacts.find(
      (entry) => entry.fieldId === expectedFact.fieldId,
    );
    const basePath = `taxFacts[${expectedFact.fieldId}]`;
    compareValue(
      `${basePath}.value`,
      expectedFact.value,
      actualFact?.value ?? null,
      "Tax fact normalized value should match the answer key.",
    );
    compareValue(
      `${basePath}.amount`,
      expectedFact.amount,
      actualFact?.amount ?? null,
      "Tax fact amount should match the answer key for money fields.",
    );
    compareValue(
      `${basePath}.box`,
      expectedFact.box,
      actualFact?.box ?? null,
      "Tax fact box number should remain attached to form fields.",
    );
    compareValue(
      `${basePath}.line`,
      expectedFact.line,
      actualFact?.line ?? null,
      "Tax fact line number should remain attached to return fields.",
    );
  }

  return { score, mismatches };
}

export function formatSyntheticTaxCorpusEvaluationReport(
  report: SyntheticTaxCorpusEvaluationReport,
) {
  const lines: string[] = [];
  lines.push("Synthetic tax corpus evaluation");
  lines.push(
    `Profile: ${report.analysisProfile} | Cases: ${report.totals.cases} | Golden: ${report.totals.goldenCases}`,
  );
  lines.push(
    `Checked: ${report.totals.checked} | Matched: ${report.totals.matched} | Mismatched: ${report.totals.mismatched} | Golden mismatched: ${report.totals.goldenMismatched} | Ambiguous skipped: ${report.totals.ambiguousSkipped}`,
  );
  lines.push("");
  lines.push("Per-case summary");

  for (const caseResult of report.cases) {
    const status = caseResult.score.mismatched === 0 ? "PASS" : "FAIL";
    lines.push(
      `- [${status}] ${caseResult.caseId} | golden=${caseResult.golden ? "yes" : "no"} | mismatches=${caseResult.score.mismatched} | canonical=${caseResult.diagnostics.canonicalPresent}`,
    );
    lines.push(
      `  subtype=${caseResult.actual.documentSubtype ?? "null"} | client=${caseResult.actual.normalizedPrimaryFacts.detectedClient ?? "null"} | taxYear=${caseResult.actual.normalizedPrimaryFacts.taxYear ?? "null"} | facts=${caseResult.actual.taxFacts.length}`,
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

async function loadSyntheticTaxCorpusAnswerKey(
  corpusRoot: string,
  manifestCase: SyntheticTaxCorpusManifestCase,
) {
  const answerKeyPath = path.join(repoRoot(), manifestCase.artifacts.answerKey);
  const raw = await fs.readFile(answerKeyPath, "utf8");
  return JSON.parse(raw) as SyntheticTaxCorpusAnswerKey;
}

function projectComparableActual(
  canonical: CanonicalExtractedDocument | null,
  insight: DocumentInsight,
): SyntheticTaxComparableActual {
  if (canonical) {
    return {
      documentTypeId: canonical.classification.normalized.documentTypeId ?? null,
      documentSubtype: canonical.classification.normalized.documentSubtype ?? null,
      normalizedPrimaryFacts: {
        detectedClient: canonical.normalized.primaryFacts.detectedClient,
        custodian: canonical.normalized.primaryFacts.custodian,
        documentDate: canonical.normalized.primaryFacts.documentDate,
        idType: canonical.normalized.primaryFacts.idType,
        taxYear: canonical.normalized.primaryFacts.taxYear,
      },
      taxFacts: (canonical.normalized.taxFacts ?? []).map((fact) => ({
        fieldId: fact.fieldId,
        form: fact.form,
        label: fact.label,
        line: fact.line,
        box: fact.box,
        valueType: fact.valueType,
        value: fact.value,
        amount: fact.money?.amount ?? null,
        currency: fact.money?.currency ?? null,
      })),
    };
  }

  return {
    documentTypeId: insight.documentTypeId,
    documentSubtype: insight.documentSubtype,
    normalizedPrimaryFacts: {
      detectedClient: insight.detectedClient,
      custodian: insight.metadata.custodian,
      documentDate: insight.metadata.documentDate,
      idType: insight.metadata.idType,
      taxYear: insight.metadata.taxYear,
    },
    taxFacts: [],
  };
}

function summarizeSyntheticTaxCorpusReport(
  caseResults: SyntheticTaxCorpusCaseResult[],
  corpusRoot: string,
  analysisProfile: AnalysisProfile,
): SyntheticTaxCorpusEvaluationReport {
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
      goldenCases: caseResults.filter((entry) => entry.golden).length,
      checked: sumCaseScores(caseResults, "checked"),
      matched: sumCaseScores(caseResults, "matched"),
      mismatched: sumCaseScores(caseResults, "mismatched"),
      ambiguousSkipped: sumCaseScores(caseResults, "ambiguousSkipped"),
      goldenMismatched: caseResults
        .filter((entry) => entry.golden)
        .reduce((sum, entry) => sum + entry.score.mismatched, 0),
      canonicalPresent: caseResults.filter(
        (entry) => entry.diagnostics.canonicalPresent,
      ).length,
    },
    mismatchSummary: [...mismatchCountByPath.entries()]
      .map(([fieldPath, count]) => ({ path: fieldPath, count }))
      .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path)),
    worstFailures: [...caseResults]
      .filter((entry) => entry.score.mismatched > 0)
      .sort((a, b) => b.score.mismatched - a.score.mismatched)
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
  caseResults: SyntheticTaxCorpusCaseResult[],
  field: keyof SyntheticTaxCorpusCaseScore,
) {
  return caseResults.reduce((sum, entry) => sum + entry.score[field], 0);
}

function isEqualComparable(expected: unknown, actual: unknown) {
  return JSON.stringify(expected) === JSON.stringify(actual);
}

function formatUnknown(value: unknown) {
  if (value === null) {
    return "null";
  }

  if (value === undefined) {
    return "undefined";
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function defaultCorpusRoot() {
  return path.join(repoRoot(), "tests", "synthetic-tax-corpus");
}

function repoRoot() {
  return process.cwd();
}
