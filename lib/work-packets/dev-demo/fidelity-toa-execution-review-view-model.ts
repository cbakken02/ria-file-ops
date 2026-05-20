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
    safeSummary?: string;
    rows: Array<{
      planFieldId: string;
      destinationField: string;
      reference: ExecutionReviewReference;
      status: ExecutionReviewPlanRowStatus;
      action: string;
      reason: string;
      confidence?: string;
      reviewFlags: Array<{
        reviewFlagId: string;
        severity: string;
        message: string;
        status: string;
      }>;
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
    expectedTextFieldsFilledCount: number;
    expectedOptionsSelectedCount: number;
    blankFieldsConfirmedCount: number;
    issueCount: number;
    issues: JonSmithFidelityToaReviewArtifact["verificationSummary"]["issues"];
  };
  reviewFlags: Array<{
    reviewFlagId: string;
    flagType: string;
    severity: string;
    message: string;
    status: string;
  }>;
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

  const viewModel: ExecutionReviewViewModel = {
    viewModelType: "execution_review",
    viewModelVersion: 1,
    header: {
      demoId: artifact.metadata.demoId,
      taskInstruction: artifact.metadata.taskInstruction,
      status: artifact.metadata.status,
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
      safeSummary: artifact.completionPlanSummary.safeSummary,
      rows: artifact.completionPlanSummary.fields.map((field) => ({
        planFieldId: field.planFieldId,
        destinationField: field.destinationFieldName ?? "(unmapped field)",
        reference: referenceForPlanField(field),
        status: statusForPlanField(field),
        action: field.action,
        reason: field.reason,
        confidence: field.confidence,
        reviewFlags: field.reviewFlags.map((flag) => ({
          reviewFlagId: flag.reviewFlagId,
          severity: flag.severity,
          message: flag.message,
          status: flag.status,
        })),
      })),
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
      expectedTextFieldsFilledCount:
        artifact.verificationSummary.filledTextFieldsExpected,
      expectedOptionsSelectedCount:
        artifact.verificationSummary.selectedOptionsExpected,
      blankFieldsConfirmedCount:
        artifact.verificationSummary.blankFieldsExpected,
      issueCount: artifact.verificationSummary.issueCount,
      issues: artifact.verificationSummary.issues,
    },
    reviewFlags: artifact.reviewFlags.map((flag) => ({
      reviewFlagId: flag.reviewFlagId,
      flagType: flag.flagType,
      severity: flag.severity,
      message: flag.message,
      status: flag.status,
    })),
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
    /123 Demo Lane/i.test(serialized)
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
): ExecutionReviewPlanRowStatus {
  if (field.reviewFlags.length > 0) {
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
