import { readFile } from "node:fs/promises";
import {
  JON_SMITH_FIDELITY_TOA_REVIEW_ARTIFACT_PATH,
  assertJonSmithFidelityToaReviewArtifactIsSafe,
  assertLocalDevGeneratedJsonOutputPath,
  type JonSmithFidelityToaReviewArtifact,
} from "@/lib/work-packets/dev-demo/fidelity-toa-review-artifact";

export type ExecutionReviewViewModelStatus = "passed" | "failed";

export type ExecutionReviewPlanRowStatus =
  | "confirmed"
  | "manual_review"
  | "planned"
  | "intentionally_blank";

export type ExecutionReviewFlagDisplay = {
  reviewFlagId: string;
  flagType?: string;
  severity: string;
  message: string;
  status: string;
  count?: number;
};

export type ExecutionReviewReference =
  | {
      referenceKind: "value_ref";
      valueRefId: string;
      maskedPreview?: string;
    }
  | {
      referenceKind: "option_ref";
      valueRefId?: string;
      optionRef: string;
      label?: string;
      exportValue: string;
      maskedPreview?: string;
    }
  | {
      referenceKind: "intentionally_blank";
    }
  | {
      referenceKind: "none";
    };

export type ExecutionReviewViewModel = {
  viewModelType: "execution_review";
  viewModelVersion: 1;
  header: {
    demoId: string;
    taskInstruction: string;
    status: ExecutionReviewViewModelStatus;
    displayStatus: string;
    taskType: string;
    generatedPdfPath: string;
    createdAt: string;
    warning: string;
  };
  taskContext: {
    receivingCustodian: string;
    deliveringFirm: string;
    accountTypeSummary: string;
    transferInstructionSummary: string;
  };
  completionPlan: {
    sectionId: "completion_plan";
    completionPlanId: string;
    status: JonSmithFidelityToaReviewArtifact["completionPlanSummary"]["status"];
    displayStatus: string;
    safeSummary?: string;
    summary: {
      totalRows: number;
      mappedFields: number;
      confirmedRows: number;
      manualReviewRows: number;
      intentionallyBlankRows: number;
      hiddenDebugWarnings: number;
    };
    rows: Array<{
      planFieldId: string;
      destinationField: string;
      reference: ExecutionReviewReference;
      status: ExecutionReviewPlanRowStatus;
      action: string;
      reason: string;
      confidence?: string;
      reviewFlags: ExecutionReviewFlagDisplay[];
      hiddenDebugWarningCount: number;
    }>;
  };
  fillTrace: {
    sectionId: "fill_trace";
    counts: {
      fieldsFilled: number;
      optionsSelected: number;
      skipped: number;
      errors: number;
    };
    rows: Array<{
      destinationField: string;
      status: string;
      valueRefId?: string;
      maskedPreview?: string;
      selectedOption?: {
        label?: string;
        exportValue?: string;
      };
      reason: string;
    }>;
  };
  verification: {
    sectionId: "verification";
    status: ExecutionReviewViewModelStatus;
    displayStatus: string;
    expectedTextFieldsFilledCount: number;
    expectedOptionsSelectedCount: number;
    blankFieldsConfirmedCount: number;
    issueCount: number;
    issues: JonSmithFidelityToaReviewArtifact["verificationSummary"]["issues"];
  };
  reviewFlags: ExecutionReviewFlagDisplay[];
  debugWarnings: {
    sectionId: "debug_warnings";
    hiddenCount: number;
    groups: ExecutionReviewFlagDisplay[];
  };
  artifactRefs: {
    generatedPdfPath: string;
    reviewJsonPath: string;
    publicUrl: null;
  };
  safety: {
    devOnly: true;
    fakeDataOnly: true;
    rawSensitiveValuesIncluded: false;
    modelSafe: true;
  };
};

export class JonSmithFidelityToaReviewViewModelError extends Error {
  readonly code: "missing_artifact" | "invalid_artifact" | "unsafe_view_model";

  constructor(
    message: string,
    code: "missing_artifact" | "invalid_artifact" | "unsafe_view_model",
  ) {
    super(message);
    this.name = "JonSmithFidelityToaReviewViewModelError";
    this.code = code;
  }
}

export async function loadJonSmithFidelityToaExecutionReviewViewModel(
  artifactPath = JON_SMITH_FIDELITY_TOA_REVIEW_ARTIFACT_PATH,
): Promise<ExecutionReviewViewModel> {
  assertLocalDevGeneratedJsonOutputPath(artifactPath);

  const artifact = await readJonSmithFidelityToaReviewArtifact(artifactPath);
  return buildExecutionReviewViewModelFromArtifact(artifact, {
    reviewJsonPath: artifactPath,
  });
}

export function buildExecutionReviewViewModelFromArtifact(
  artifact: JonSmithFidelityToaReviewArtifact,
  options: {
    reviewJsonPath?: string;
  } = {},
): ExecutionReviewViewModel {
  assertJonSmithFidelityToaReviewArtifactIsSafe(artifact);
  const artifactPassed = artifact.verificationSummary.status === "passed";
  const reviewFlagBuckets = bucketReviewFlags(
    artifact.reviewFlags,
    artifactPassed,
  );
  const completionPlanRows = artifact.completionPlanSummary.fields.map((field) => {
    const fieldFlagBuckets = bucketReviewFlags(field.reviewFlags, artifactPassed);

    return {
      planFieldId: field.planFieldId,
      destinationField: field.destinationFieldName ?? "(unmapped field)",
      reference: referenceForPlanField(field),
      status: statusForPlanField(field, fieldFlagBuckets.visibleFlags),
      action: field.action,
      reason: field.reason,
      confidence: field.confidence,
      reviewFlags: fieldFlagBuckets.visibleFlags,
      hiddenDebugWarningCount: fieldFlagBuckets.hiddenCount,
    };
  });
  const completionPlanSummary = summarizeCompletionPlanRows(completionPlanRows);

  const viewModel: ExecutionReviewViewModel = {
    viewModelType: "execution_review",
    viewModelVersion: 1,
    header: {
      demoId: artifact.metadata.demoId,
      taskInstruction: artifact.metadata.taskInstruction,
      status: artifact.metadata.status,
      displayStatus: artifactPassed ? "Demo completed" : "Needs review",
      taskType: artifact.metadata.taskType,
      generatedPdfPath: artifact.metadata.generatedOutputPdfPath,
      createdAt: artifact.metadata.createdAt,
      warning:
        "Dev-only fake-data review artifact. Do not use for real client workflows.",
    },
    taskContext: {
      receivingCustodian: artifact.safeTaskContext.receivingCustodian,
      deliveringFirm: artifact.safeTaskContext.deliveringFirm,
      accountTypeSummary: artifact.safeTaskContext.accountTypeSummary,
      transferInstructionSummary:
        artifact.safeTaskContext.transferInstructionSummary,
    },
    completionPlan: {
      sectionId: "completion_plan",
      completionPlanId: artifact.completionPlanSummary.completionPlanId,
      status: artifact.completionPlanSummary.status,
      displayStatus: artifactPassed ? "Mapped and verified" : formatToken(artifact.completionPlanSummary.status),
      safeSummary: artifact.completionPlanSummary.safeSummary,
      summary: completionPlanSummary,
      rows: completionPlanRows,
    },
    fillTrace: {
      sectionId: "fill_trace",
      counts: {
        fieldsFilled: artifact.fillTrace.filledFieldCount,
        optionsSelected: artifact.fillTrace.entries.filter(
          (entry) => entry.status === "filled" && entry.selectedOption,
        ).length,
        skipped: artifact.fillTrace.skippedFieldCount,
        errors: artifact.fillTrace.errorCount,
      },
      rows: artifact.fillTrace.entries.map((entry) => ({
        destinationField: entry.destinationFieldName,
        status: entry.status,
        valueRefId: entry.valueRefId,
        maskedPreview: entry.maskedPreview,
        selectedOption: entry.selectedOption,
        reason: entry.reason,
      })),
    },
    verification: {
      sectionId: "verification",
      status: artifact.verificationSummary.status,
      displayStatus: artifactPassed ? "Verified" : "Needs attention",
      expectedTextFieldsFilledCount:
        artifact.verificationSummary.filledTextFieldsExpected,
      expectedOptionsSelectedCount:
        artifact.verificationSummary.selectedOptionsExpected,
      blankFieldsConfirmedCount:
        artifact.verificationSummary.blankFieldsExpected,
      issueCount: artifact.verificationSummary.issueCount,
      issues: artifact.verificationSummary.issues,
    },
    reviewFlags: reviewFlagBuckets.visibleFlags,
    debugWarnings: {
      sectionId: "debug_warnings",
      hiddenCount: reviewFlagBuckets.hiddenCount,
      groups: reviewFlagBuckets.debugGroups,
    },
    artifactRefs: {
      generatedPdfPath: artifact.metadata.generatedOutputPdfPath,
      reviewJsonPath:
        options.reviewJsonPath ?? JON_SMITH_FIDELITY_TOA_REVIEW_ARTIFACT_PATH,
      publicUrl: null,
    },
    safety: {
      devOnly: true,
      fakeDataOnly: true,
      rawSensitiveValuesIncluded: false,
      modelSafe: true,
    },
  };

  assertExecutionReviewViewModelIsSafe(viewModel);
  return viewModel;
}

export function assertExecutionReviewViewModelIsSafe(
  viewModel: ExecutionReviewViewModel,
): void {
  const serialized = JSON.stringify(viewModel);

  if (
    /\b000126789\b/.test(serialized) ||
    /\b900012345\b/.test(serialized) ||
    /\b234567890\b/.test(serialized) ||
    /\b8005550199\b/.test(serialized) ||
    /\b6175550184\b/.test(serialized) ||
    /\b\d{3}-\d{2}-\d{4}\b/.test(serialized) ||
    /jon\.smith@example\.test/i.test(serialized) ||
    /123 Demo Lane/i.test(serialized) ||
    /100 Ameriprise Demo Way/i.test(serialized) ||
    /\bMinneapolis\b/i.test(serialized) ||
    /\b55402\b/.test(serialized)
  ) {
    throw new JonSmithFidelityToaReviewViewModelError(
      "Execution review view model included raw fake sensitive values.",
      "unsafe_view_model",
    );
  }
}

async function readJonSmithFidelityToaReviewArtifact(
  artifactPath: string,
): Promise<JonSmithFidelityToaReviewArtifact> {
  let contents: string;

  try {
    contents = await readFile(artifactPath, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") {
      throw new JonSmithFidelityToaReviewViewModelError(
        `Review artifact not found at ${artifactPath}. Run scripts/build-work-packets-fidelity-toa-review-artifact.mjs first.`,
        "missing_artifact",
      );
    }

    throw error;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new JonSmithFidelityToaReviewViewModelError(
      `Review artifact at ${artifactPath} is not valid JSON.`,
      "invalid_artifact",
    );
  }

  if (!isJonSmithFidelityToaReviewArtifact(parsed)) {
    throw new JonSmithFidelityToaReviewViewModelError(
      `Review artifact at ${artifactPath} is not a Jon Smith Fidelity TOA review artifact.`,
      "invalid_artifact",
    );
  }

  assertJonSmithFidelityToaReviewArtifactIsSafe(parsed);
  return parsed;
}

function referenceForPlanField(
  field: JonSmithFidelityToaReviewArtifact["completionPlanSummary"]["fields"][number],
): ExecutionReviewReference {
  if (field.selectedOption?.exportValue) {
    return {
      referenceKind: "option_ref",
      valueRefId: field.valueRefId,
      optionRef: `${field.destinationFieldName ?? field.planFieldId}=${field.selectedOption.exportValue}`,
      label: field.selectedOption.label,
      exportValue: field.selectedOption.exportValue,
      maskedPreview: field.maskedPreview,
    };
  }

  if (field.valueRefId) {
    return {
      referenceKind: "value_ref",
      valueRefId: field.valueRefId,
      maskedPreview: field.maskedPreview,
    };
  }

  if (field.plannedValueKind === "intentionally_blank") {
    return {
      referenceKind: "intentionally_blank",
    };
  }

  return {
    referenceKind: "none",
  };
}

function statusForPlanField(
  field: JonSmithFidelityToaReviewArtifact["completionPlanSummary"]["fields"][number],
  visibleReviewFlags: ExecutionReviewFlagDisplay[],
): ExecutionReviewPlanRowStatus {
  if (visibleReviewFlags.length > 0) {
    return "manual_review";
  }

  if (field.plannedValueKind === "intentionally_blank") {
    return "intentionally_blank";
  }

  if (field.valueRefId || field.selectedOption?.exportValue) {
    return "confirmed";
  }

  return "planned";
}

function summarizeCompletionPlanRows(
  rows: ExecutionReviewViewModel["completionPlan"]["rows"],
): ExecutionReviewViewModel["completionPlan"]["summary"] {
  return {
    totalRows: rows.length,
    mappedFields: rows.filter(
      (row) =>
        row.reference.referenceKind === "value_ref" ||
        row.reference.referenceKind === "option_ref",
    ).length,
    confirmedRows: rows.filter((row) => row.status === "confirmed").length,
    manualReviewRows: rows.filter((row) => row.status === "manual_review").length,
    intentionallyBlankRows: rows.filter(
      (row) => row.status === "intentionally_blank",
    ).length,
    hiddenDebugWarnings: rows.reduce(
      (total, row) => total + row.hiddenDebugWarningCount,
      0,
    ),
  };
}

function bucketReviewFlags(
  flags: Array<{
    reviewFlagId: string;
    flagType?: string;
    severity: string;
    message: string;
    status: string;
  }>,
  artifactPassed: boolean,
): {
  visibleFlags: ExecutionReviewFlagDisplay[];
  debugGroups: ExecutionReviewFlagDisplay[];
  hiddenCount: number;
} {
  const visible = new Map<string, ExecutionReviewFlagDisplay>();
  const debug = new Map<string, ExecutionReviewFlagDisplay>();

  for (const flag of flags) {
    if (isDebugOnlyReviewFlag(flag, artifactPassed)) {
      const key = `${flag.severity}:${flag.status}:${flag.message}`;
      const existing = debug.get(key);

      if (existing) {
        existing.count = (existing.count ?? 1) + 1;
      } else {
        debug.set(key, {
          reviewFlagId: flag.reviewFlagId,
          flagType: flag.flagType,
          severity: flag.severity,
          message: flag.message,
          status: flag.status,
          count: 1,
        });
      }

      continue;
    }

    const key = `${flag.severity}:${flag.status}:${flag.message}`;
    const existing = visible.get(key);

    if (existing) {
      existing.count = (existing.count ?? 1) + 1;
    } else {
      visible.set(key, {
        reviewFlagId: flag.reviewFlagId,
        flagType: flag.flagType,
        severity: flag.severity,
        message: flag.message,
        status: flag.status,
      });
    }
  }

  const debugGroups = Array.from(debug.values());

  return {
    visibleFlags: Array.from(visible.values()),
    debugGroups,
    hiddenCount: debugGroups.reduce((total, group) => total + (group.count ?? 1), 0),
  };
}

function isDebugOnlyReviewFlag(
  flag: { reviewFlagId: string; message: string },
  artifactPassed: boolean,
) {
  if (!artifactPassed) {
    return false;
  }

  return (
    flag.reviewFlagId.endsWith("_field_not_inspected") ||
    flag.reviewFlagId.endsWith("_export_value") ||
    /scaffold placeholder until the local PDF template is inspected/i.test(
      flag.message,
    ) ||
    /local PDF template has not been inspected/i.test(flag.message)
  );
}

function formatToken(value: string) {
  return value.replaceAll("_", " ");
}

function isJonSmithFidelityToaReviewArtifact(
  value: unknown,
): value is JonSmithFidelityToaReviewArtifact {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as {
    artifactType?: unknown;
    artifactVersion?: unknown;
    metadata?: unknown;
    safeTaskContext?: unknown;
    completionPlanSummary?: unknown;
    fillTrace?: unknown;
    verificationSummary?: unknown;
    reviewFlags?: unknown;
    safety?: unknown;
  };

  return (
    candidate.artifactType === "jon_smith_fidelity_toa_execution_review" &&
    candidate.artifactVersion === 1 &&
    typeof candidate.metadata === "object" &&
    typeof candidate.safeTaskContext === "object" &&
    typeof candidate.completionPlanSummary === "object" &&
    typeof candidate.fillTrace === "object" &&
    typeof candidate.verificationSummary === "object" &&
    Array.isArray(candidate.reviewFlags) &&
    typeof candidate.safety === "object"
  );
}
