import fs from "node:fs/promises";
import path from "node:path";
import type { AnalysisProfile } from "@/lib/ai-primary-parser-types";
import { analyzeDocumentWithEnvelope, type DocumentInsight } from "@/lib/document-intelligence";
import { readPreviewAnalysisCache, writePreviewAnalysisCache } from "@/lib/preview-analysis-cache";
import type { CanonicalExtractedDocument } from "@/lib/canonical-extracted-document";
import type { GoogleDriveFile } from "@/lib/google-drive";

export type SyntheticCorpusManifest = {
  schemaVersion: string;
  generationPath: {
    source: string;
    script: string;
    stylesheet: string;
  };
  cases: SyntheticCorpusManifestCase[];
};

export type SyntheticCorpusManifestCase = {
  id: string;
  title: string;
  category: string;
  documentTypeId: string;
  documentSubtype: string | null;
  layout: string;
  expectedAmbiguousFields: string[];
  artifacts: {
    html: string;
    pdf: string;
    answerKey: string;
    notes: string;
  };
};

export type SyntheticCorpusAnswerKey = {
  schemaVersion: string;
  caseId: string;
  title: string;
  documentTypeId: string | null;
  documentSubtype: string | null;
  parties: Array<{
    id: string;
    displayName: string | null;
  }>;
  institutions: Array<{
    id: string;
    name: string | null;
    rawName: string | null;
  }>;
  contacts: Array<{
    id: string;
    method: string | null;
    purpose: string | null;
    value: string | null;
  }>;
  accounts: Array<{
    id: string;
    accountNumber: string | null;
    accountLast4: string | null;
    accountType: string | null;
    values: Array<{
      kind: string;
      money: {
        amount: string | null;
        currency: string | null;
      } | null;
    }>;
  }>;
  dates: Array<{
    id: string;
    kind: string;
    value: string | null;
  }>;
  normalized: {
    primaryFacts: {
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
  };
  expectedAmbiguities: Array<{
    fieldPath: string;
    reason: string;
    expected: string | null;
  }>;
};

export type SyntheticCorpusComparableActual = {
  documentTypeId: string | null;
  documentSubtype: string | null;
  parties: Array<{ displayName: string | null }>;
  extractedInstitutions: Array<{ rawName: string | null }>;
  normalizedInstitutions: Array<{ name: string | null }>;
  contacts: Array<{
    method: string | null;
    purpose: string | null;
    value: string | null;
  }>;
  accounts: Array<{
    id: string;
    accountNumber: string | null;
    accountLast4: string | null;
    accountType: string | null;
    values: Array<{
      kind: string;
      amount: string | null;
    }>;
  }>;
  dates: Array<{
    kind: string;
    value: string | null;
  }>;
  normalizedPrimaryFacts: SyntheticCorpusAnswerKey["normalized"]["primaryFacts"];
};

export type SyntheticCorpusCaseDiagnostics = {
  analysisSource: "fresh_analysis" | "loaded_from_cache";
  analysisRanAt: string | null;
  cacheWrittenAt: string | null;
  aiEnabled: boolean;
  aiAttempted: boolean;
  aiUsed: boolean;
  aiFailureReason: string | null;
  canonicalPresent: boolean;
};

export type SyntheticCorpusFieldMismatch = {
  caseId: string;
  caseTitle: string;
  path: string;
  expected: unknown;
  actual: unknown;
  reason: string;
  ambiguous: boolean;
};

export type SyntheticCorpusCaseScore = {
  checked: number;
  matched: number;
  mismatched: number;
  ambiguousSkipped: number;
};

export type SyntheticCorpusCaseResult = {
  caseId: string;
  title: string;
  category: string;
  diagnostics: SyntheticCorpusCaseDiagnostics;
  score: SyntheticCorpusCaseScore;
  mismatches: SyntheticCorpusFieldMismatch[];
  actual: SyntheticCorpusComparableActual;
  answerKey: SyntheticCorpusAnswerKey;
};

export type SyntheticCorpusEvaluationReport = {
  generatedAt: string;
  corpusRoot: string;
  analysisProfile: AnalysisProfile;
  cacheMode: "read_write" | "fresh_without_cache" | "read_only";
  ownerEmail: string | null;
  totals: {
    cases: number;
    checked: number;
    matched: number;
    mismatched: number;
    ambiguousSkipped: number;
    freshAnalysis: number;
    loadedFromCache: number;
    aiSucceeded: number;
    aiFailedOrFellBack: number;
    aiSkipped: number;
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
  cases: SyntheticCorpusCaseResult[];
};

type EvaluateSyntheticCorpusOptions = {
  corpusRoot?: string;
  analysisProfile?: AnalysisProfile;
  ownerEmail?: string | null;
  useCache?: boolean;
  writeCache?: boolean;
  caseIds?: string[];
};

export async function loadSyntheticCorpusManifest(corpusRoot = defaultCorpusRoot()) {
  const manifestPath = path.join(corpusRoot, "manifest.json");
  const raw = await fs.readFile(manifestPath, "utf8");
  return JSON.parse(raw) as SyntheticCorpusManifest;
}

export async function evaluateSyntheticCorpus(
  options: EvaluateSyntheticCorpusOptions = {},
): Promise<SyntheticCorpusEvaluationReport> {
  const corpusRoot = options.corpusRoot ?? defaultCorpusRoot();
  const manifest = await loadSyntheticCorpusManifest(corpusRoot);
  const selectedCases =
    options.caseIds && options.caseIds.length > 0
      ? manifest.cases.filter((entry) => options.caseIds?.includes(entry.id))
      : manifest.cases;

  const caseResults: SyntheticCorpusCaseResult[] = [];
  for (const caseEntry of selectedCases) {
    caseResults.push(
      await evaluateSyntheticCorpusCase(caseEntry, {
        corpusRoot,
        analysisProfile: options.analysisProfile ?? "preview_ai_primary",
        ownerEmail:
          options.ownerEmail === undefined
            ? "synthetic-corpus-eval@example.com"
            : options.ownerEmail,
        useCache: options.useCache ?? true,
        writeCache: options.writeCache ?? (options.useCache ?? true),
      }),
    );
  }

  return summarizeSyntheticCorpusReport(
    caseResults,
    corpusRoot,
    options.analysisProfile ?? "preview_ai_primary",
    options.ownerEmail === undefined
      ? "synthetic-corpus-eval@example.com"
      : options.ownerEmail ?? null,
    options.useCache ?? true,
    options.writeCache ?? (options.useCache ?? true),
  );
}

export async function evaluateSyntheticCorpusCase(
  manifestCase: SyntheticCorpusManifestCase,
  options: {
    corpusRoot: string;
    analysisProfile: AnalysisProfile;
    ownerEmail: string | null;
    useCache: boolean;
    writeCache: boolean;
  },
): Promise<SyntheticCorpusCaseResult> {
  const answerKey = await loadSyntheticCorpusAnswerKey(options.corpusRoot, manifestCase);
  const pdfPath = path.join(repoRoot(), manifestCase.artifacts.pdf);
  const stat = await fs.stat(pdfPath);
  const file: GoogleDriveFile = {
    id: manifestCase.id,
    name: path.basename(pdfPath),
    mimeType: "application/pdf",
    modifiedTime: stat.mtime.toISOString(),
    size: String(stat.size),
  };

  let diagnostics: SyntheticCorpusCaseDiagnostics;
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
      const comparison = compareSyntheticCorpusCase(answerKey, actual);

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
  const envelope = await analyzeDocumentWithEnvelope(
    file,
    async () => buffer,
    { analysisProfile: options.analysisProfile },
  );
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
  const comparison = compareSyntheticCorpusCase(answerKey, actual);

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

export function compareSyntheticCorpusCase(
  answerKey: SyntheticCorpusAnswerKey,
  actual: SyntheticCorpusComparableActual,
) {
  const ambiguousPaths = new Set(
    answerKey.expectedAmbiguities.map((entry) => entry.fieldPath),
  );
  const mismatches: Array<Omit<SyntheticCorpusFieldMismatch, "caseId" | "caseTitle">> = [];
  const score: SyntheticCorpusCaseScore = {
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
    "Document type should match the answer key.",
  );

  compareValue(
    "parties[0].displayName",
    answerKey.parties[0]?.displayName ?? null,
    actual.parties[0]?.displayName ?? null,
    "Primary detected party name should match the expected owner.",
  );
  compareValue(
    "parties[1].displayName",
    answerKey.parties[1]?.displayName ?? null,
    actual.parties[1]?.displayName ?? null,
    "Secondary detected party name should match when present.",
  );

  compareValue(
    "extracted.institutions[0].rawName",
    answerKey.institutions[0]?.rawName ?? null,
    actual.extractedInstitutions[0]?.rawName ?? null,
    "Primary extracted institution name should preserve the document-facing raw name.",
  );

  compareValue(
    "normalized.institutions[0].name",
    answerKey.institutions[0]?.name ?? null,
    actual.normalizedInstitutions[0]?.name ?? null,
    "Primary normalized institution name should match the canonical downstream name.",
  );

  const expectedContacts = [...answerKey.contacts].sort(compareContacts);
  const actualContacts = [...actual.contacts].sort(compareContacts);
  compareValue(
    "contacts.length",
    expectedContacts.length,
    actualContacts.length,
    "Contact count should stay aligned for the focused phone/website surface.",
  );
  for (const expectedContact of expectedContacts) {
    const contactKey = `${expectedContact.method ?? "unknown"}:${expectedContact.value ?? "null"}`;
    const actualContact = actualContacts.find(
      (entry) =>
        entry.method === expectedContact.method && entry.value === expectedContact.value,
    );

    compareValue(
      `contacts[${contactKey}].value`,
      expectedContact.value ?? null,
      actualContact?.value ?? null,
      "Expected contact value should be present.",
    );
    compareValue(
      `contacts[${contactKey}].purpose`,
      expectedContact.purpose ?? null,
      actualContact?.purpose ?? null,
      "Expected contact purpose should match for the focused contact surface.",
    );
  }

  const actualAccounts = [...actual.accounts];
  compareValue(
    "accounts.length",
    answerKey.accounts.length,
    actualAccounts.length,
    "Account count should align with the answer key.",
  );

  for (const expectedAccount of answerKey.accounts) {
    const actualAccount = matchActualAccount(actualAccounts, expectedAccount);
    compareValue(
      `accounts[${expectedAccount.id}].accountNumber`,
      expectedAccount.accountNumber ?? null,
      actualAccount?.accountNumber ?? null,
      "Full account number should match when canonical extraction captures it.",
    );
    compareValue(
      `accounts[${expectedAccount.id}].accountLast4`,
      expectedAccount.accountLast4 ?? null,
      actualAccount?.accountLast4 ?? null,
      "Account last4 should match expected truth.",
    );
    compareValue(
      `accounts[${expectedAccount.id}].accountType`,
      expectedAccount.accountType ?? null,
      actualAccount?.accountType ?? null,
      "Account type should match normalized account truth.",
    );

    for (const expectedValue of expectedAccount.values) {
      const actualValue = actualAccount?.values.find(
        (entry) => entry.kind === expectedValue.kind,
      );
      compareValue(
        `accounts[${expectedAccount.id}].values[${expectedValue.kind}].money.amount`,
        expectedValue.money?.amount ?? null,
        actualValue?.amount ?? null,
        "Account value amount should match when present in the answer key.",
      );
    }
  }

  const expectedDatesByKind = new Map(
    answerKey.dates
      .filter((entry) =>
        entry.kind === "statement_period_start" ||
        entry.kind === "statement_period_end" ||
        entry.kind === "document_date",
      )
      .map((entry) => [entry.kind, entry.value ?? null]),
  );
  const actualDatesByKind = new Map(
    actual.dates.map((entry) => [entry.kind, entry.value ?? null]),
  );
  for (const [kind, expectedValue] of expectedDatesByKind.entries()) {
    compareValue(
      `dates[${kind}].value`,
      expectedValue,
      actualDatesByKind.get(kind) ?? null,
      "Focused statement dates should match expected truth.",
    );
  }

  for (const field of [
    "detectedClient",
    "detectedClient2",
    "ownershipType",
    "accountLast4",
    "accountType",
    "custodian",
    "documentDate",
    "entityName",
    "idType",
    "taxYear",
  ] as const) {
    compareValue(
      `normalized.primaryFacts.${field}`,
      answerKey.normalized.primaryFacts[field],
      actual.normalizedPrimaryFacts[field],
      "Primary facts should match the answer key on the focused evaluation surface.",
    );
  }

  return { score, mismatches };
}

export function formatSyntheticCorpusEvaluationReport(
  report: SyntheticCorpusEvaluationReport,
) {
  const lines: string[] = [];
  lines.push("Synthetic statement corpus evaluation");
  lines.push(
    `Profile: ${report.analysisProfile} | Cache mode: ${report.cacheMode} | Cases: ${report.totals.cases}`,
  );
  lines.push(
    `Checked: ${report.totals.checked} | Matched: ${report.totals.matched} | Mismatched: ${report.totals.mismatched} | Ambiguous skipped: ${report.totals.ambiguousSkipped}`,
  );
  lines.push(
    `Fresh: ${report.totals.freshAnalysis} | Cache: ${report.totals.loadedFromCache} | AI succeeded: ${report.totals.aiSucceeded} | AI failed/fell back: ${report.totals.aiFailedOrFellBack} | AI skipped: ${report.totals.aiSkipped}`,
  );
  lines.push("");
  lines.push("Per-case summary");

  for (const caseResult of report.cases) {
    const status = caseResult.score.mismatched === 0 ? "PASS" : "FAIL";
    lines.push(
      `- [${status}] ${caseResult.caseId} | mismatches=${caseResult.score.mismatched} | source=${caseResult.diagnostics.analysisSource} | aiUsed=${caseResult.diagnostics.aiUsed} | canonical=${caseResult.diagnostics.canonicalPresent}`,
    );
    lines.push(
      `  primaryFacts: client=${caseResult.actual.normalizedPrimaryFacts.detectedClient ?? "null"} | client2=${caseResult.actual.normalizedPrimaryFacts.detectedClient2 ?? "null"} | custodian=${caseResult.actual.normalizedPrimaryFacts.custodian ?? "null"} | accountType=${caseResult.actual.normalizedPrimaryFacts.accountType ?? "null"} | last4=${caseResult.actual.normalizedPrimaryFacts.accountLast4 ?? "null"} | date=${caseResult.actual.normalizedPrimaryFacts.documentDate ?? "null"}`,
    );
    if (caseResult.mismatches.length > 0) {
      for (const mismatch of caseResult.mismatches.slice(0, 5)) {
        lines.push(
          `  mismatch: ${mismatch.path} | expected=${formatUnknown(mismatch.expected)} | actual=${formatUnknown(mismatch.actual)}`,
        );
      }
      if (caseResult.mismatches.length > 5) {
        lines.push(`  ... ${caseResult.mismatches.length - 5} more mismatches`);
      }
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

  lines.push("");
  lines.push("Worst failures");
  if (report.worstFailures.length === 0) {
    lines.push("- none");
  } else {
    for (const entry of report.worstFailures) {
      lines.push(`- ${entry.caseId}: ${entry.mismatchCount} mismatches`);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function loadSyntheticCorpusAnswerKey(
  corpusRoot: string,
  manifestCase: SyntheticCorpusManifestCase,
) {
  const answerKeyPath = path.join(repoRoot(), manifestCase.artifacts.answerKey);
  const raw = await fs.readFile(answerKeyPath, "utf8");
  return JSON.parse(raw) as SyntheticCorpusAnswerKey;
}

function projectComparableActual(
  canonical: CanonicalExtractedDocument | null,
  insight: DocumentInsight,
): SyntheticCorpusComparableActual {
  if (canonical) {
    return {
      documentTypeId: canonical.classification.normalized.documentTypeId ?? null,
      documentSubtype: canonical.classification.normalized.documentSubtype ?? null,
      parties: canonical.normalized.parties.map((party) => ({
        displayName: party.displayName ?? null,
      })),
      extractedInstitutions: canonical.extracted.institutions.map((institution) => ({
        rawName: institution.rawName ?? institution.name ?? null,
      })),
      normalizedInstitutions: canonical.normalized.institutions.map((institution) => ({
        name: institution.name ?? null,
      })),
      contacts: canonical.normalized.contacts.map((contact) => ({
        method: contact.method ?? null,
        purpose: contact.purpose ?? null,
        value: contact.value ?? null,
      })),
      accounts: canonical.normalized.accounts.map((account) => ({
        id: account.id,
        accountNumber: account.accountNumber ?? null,
        accountLast4: account.accountLast4 ?? null,
        accountType: account.accountType ?? null,
        values: account.values.map((value) => ({
          kind: value.kind,
          amount: value.money?.amount ?? null,
        })),
      })),
      dates: canonical.normalized.dates.map((date) => ({
        kind: date.kind,
        value: date.value ?? null,
      })),
      normalizedPrimaryFacts: canonical.normalized.primaryFacts,
    };
  }

  return {
    documentTypeId: insight.documentTypeId,
    documentSubtype: null,
    parties: [insight.detectedClient, insight.detectedClient2]
      .filter((value): value is string => value !== null && value !== "")
      .map((displayName) => ({ displayName })),
    extractedInstitutions: [],
    normalizedInstitutions: insight.metadata.custodian
      ? [{ name: insight.metadata.custodian }]
      : [],
    contacts: [],
    accounts:
      insight.metadata.accountLast4 || insight.metadata.accountType
        ? [
            {
              id: "legacy-account-1",
              accountNumber: null,
              accountLast4: insight.metadata.accountLast4,
              accountType: insight.metadata.accountType,
              values: [],
            },
          ]
        : [],
    dates: insight.metadata.documentDate
      ? [{ kind: "document_date", value: insight.metadata.documentDate }]
      : [],
    normalizedPrimaryFacts: {
      detectedClient: insight.detectedClient,
      detectedClient2: insight.detectedClient2,
      ownershipType: insight.ownershipType,
      accountLast4: insight.metadata.accountLast4,
      accountType: insight.metadata.accountType,
      custodian: insight.metadata.custodian,
      documentDate: insight.metadata.documentDate,
      entityName: insight.metadata.entityName,
      idType: insight.metadata.idType,
      taxYear: insight.metadata.taxYear,
    },
  };
}

function summarizeSyntheticCorpusReport(
  caseResults: SyntheticCorpusCaseResult[],
  corpusRoot: string,
  analysisProfile: AnalysisProfile,
  ownerEmail: string | null,
  useCache: boolean,
  writeCache: boolean,
): SyntheticCorpusEvaluationReport {
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
    cacheMode: useCache
      ? writeCache
        ? "read_write"
        : "read_only"
      : "fresh_without_cache",
    ownerEmail,
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
      aiSucceeded: caseResults.filter((entry) => entry.diagnostics.aiUsed).length,
      aiFailedOrFellBack: caseResults.filter(
        (entry) =>
          entry.diagnostics.aiAttempted &&
          !entry.diagnostics.aiUsed &&
          Boolean(entry.diagnostics.aiFailureReason),
      ).length,
      aiSkipped: caseResults.filter(
        (entry) =>
          entry.diagnostics.aiEnabled &&
          !entry.diagnostics.aiAttempted &&
          !entry.diagnostics.aiUsed,
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
  caseResults: SyntheticCorpusCaseResult[],
  field: keyof SyntheticCorpusCaseScore,
) {
  return caseResults.reduce((sum, entry) => sum + entry.score[field], 0);
}

function matchActualAccount(
  actualAccounts: SyntheticCorpusComparableActual["accounts"],
  expectedAccount: SyntheticCorpusAnswerKey["accounts"][number],
) {
  if (expectedAccount.accountNumber) {
    return (
      actualAccounts.find((entry) => entry.accountNumber === expectedAccount.accountNumber) ??
      null
    );
  }

  if (expectedAccount.accountLast4) {
    return (
      actualAccounts.find(
        (entry) =>
          entry.accountLast4 === expectedAccount.accountLast4 &&
          (expectedAccount.accountType === null || entry.accountType === expectedAccount.accountType),
      ) ?? null
    );
  }

  return actualAccounts.find((entry) => entry.id === expectedAccount.id) ?? null;
}

function compareContacts(
  left: { method: string | null; value: string | null },
  right: { method: string | null; value: string | null },
) {
  return `${left.method ?? ""}:${left.value ?? ""}`.localeCompare(
    `${right.method ?? ""}:${right.value ?? ""}`,
  );
}

function isEqualComparable(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function formatUnknown(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function defaultCorpusRoot() {
  return path.join(process.cwd(), "tests", "synthetic-corpus");
}

function repoRoot() {
  return process.cwd();
}
