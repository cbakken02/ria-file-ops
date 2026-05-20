import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  CompletionPlan,
  CompletionPlanField,
  ReviewFlag,
} from "@/lib/work-packets/types";
import type {
  PdfFillAdapterResult,
  PdfFillTraceEntry,
} from "@/lib/work-packets/pdf-fill-adapter";
import {
  JON_SMITH_FIDELITY_TOA_FILLED_OUTPUT_PATH,
  JON_SMITH_FIDELITY_TOA_TASK,
  JON_SMITH_FIDELITY_TOA_TEMPLATE_PATH,
  JON_SMITH_FIDELITY_TOA_TEMPLATE_REF,
  type JonSmithFidelityToaDemo,
} from "@/lib/work-packets/dev-demo/jon-smith-fidelity-toa";
import type {
  JonSmithFidelityToaVerificationSummary,
} from "@/lib/work-packets/dev-demo/fidelity-toa-output-verification";

export const JON_SMITH_FIDELITY_TOA_REVIEW_ARTIFACT_PATH =
  "local-dev/generated/jon-smith-fidelity-toa-execution-review.json";

type SafeOptionSummary = {
  label?: string;
  exportValue?: string;
};

type SafeReviewFlagSummary = {
  reviewFlagId: string;
  flagType: ReviewFlag["flagType"];
  severity: ReviewFlag["severity"];
  message: string;
  status: ReviewFlag["status"];
  fieldId?: string;
  valueRefId?: string;
};

export type JonSmithFidelityToaReviewArtifact = {
  artifactType: "jon_smith_fidelity_toa_execution_review";
  artifactVersion: 1;
  metadata: {
    demoId: string;
    packetId: string;
    runId: string;
    taskInstruction: string;
    taskType: string;
    templatePath: string;
    templateDocumentId: string;
    generatedOutputPdfPath: string;
    createdAt: string;
    status: "passed" | "failed";
    devOnly: true;
  };
  safeTaskContext: {
    receivingCustodian: string;
    deliveringFirm: string;
    accountTypeSummary: string;
    transferInstructionSummary: string;
  };
  completionPlanSummary: {
    completionPlanId: string;
    status: CompletionPlan["status"];
    safeSummary?: string;
    fields: Array<{
      planFieldId: string;
      destinationFieldName?: string;
      action: CompletionPlanField["action"];
      plannedValueKind: CompletionPlanField["plannedValue"]["valueKind"];
      valueRefId?: string;
      maskedPreview?: string;
      selectedOption?: SafeOptionSummary;
      reason: string;
      confidence: CompletionPlanField["confidence"];
      reviewFlags: SafeReviewFlagSummary[];
    }>;
  };
  fillTrace: {
    filledFieldCount: number;
    skippedFieldCount: number;
    errorCount: number;
    entries: Array<{
      destinationFieldName: string;
      status: PdfFillTraceEntry["status"];
      valueRefId?: string;
      maskedPreview?: string;
      selectedOption?: SafeOptionSummary;
      reason: string;
    }>;
  };
  verificationSummary: {
    status: JonSmithFidelityToaVerificationSummary["status"];
    outputPdfPath: string;
    filledTextFieldsExpected: number;
    selectedOptionsExpected: number;
    blankFieldsExpected: number;
    issueCount: number;
    issues: JonSmithFidelityToaVerificationSummary["issues"];
  };
  reviewFlags: SafeReviewFlagSummary[];
  safety: {
    fakeDataOnly: true;
    rawSensitiveValuesIncluded: false;
    modelSafe: true;
  };
};

export class JonSmithFidelityToaReviewArtifactError extends Error {
  readonly code: "unsafe_output_path" | "unsafe_artifact";

  constructor(
    message: string,
    code: "unsafe_output_path" | "unsafe_artifact",
  ) {
    super(message);
    this.name = "JonSmithFidelityToaReviewArtifactError";
    this.code = code;
  }
}

export function buildJonSmithFidelityToaReviewArtifact(args: {
  demo: JonSmithFidelityToaDemo;
  fillResult: PdfFillAdapterResult;
  verificationSummary: JonSmithFidelityToaVerificationSummary;
  templatePath?: string;
  templateDocumentId?: string;
  generatedOutputPdfPath?: string;
  createdAt?: string;
}): JonSmithFidelityToaReviewArtifact {
  const artifact: JonSmithFidelityToaReviewArtifact = {
    artifactType: "jon_smith_fidelity_toa_execution_review",
    artifactVersion: 1,
    metadata: {
      demoId: "jon_smith_fidelity_toa_dev_demo",
      packetId: args.demo.packet.id,
      runId: args.demo.run.id,
      taskInstruction: JON_SMITH_FIDELITY_TOA_TASK,
      taskType: "transfer",
      templatePath: args.templatePath ?? JON_SMITH_FIDELITY_TOA_TEMPLATE_PATH,
      templateDocumentId:
        args.templateDocumentId ?? JON_SMITH_FIDELITY_TOA_TEMPLATE_REF.documentId,
      generatedOutputPdfPath:
        args.generatedOutputPdfPath ||
        args.fillResult.outputPdfPath ||
        JON_SMITH_FIDELITY_TOA_FILLED_OUTPUT_PATH,
      createdAt: args.createdAt ?? new Date().toISOString(),
      status: args.verificationSummary.status,
      devOnly: true,
    },
    safeTaskContext: {
      receivingCustodian: "Fidelity",
      deliveringFirm: "Ameriprise",
      accountTypeSummary:
        "Receiving Fidelity Traditional/Rollover IRA; delivering Ameriprise Traditional IRA.",
      transferInstructionSummary: "Full in-kind transfer.",
    },
    completionPlanSummary: {
      completionPlanId: args.demo.completionPlan.completionPlanId,
      status: args.demo.completionPlan.status,
      safeSummary: args.demo.completionPlan.safeSummary,
      fields: args.demo.completionPlan.fields.map(summarizeCompletionPlanField),
    },
    fillTrace: {
      filledFieldCount: args.fillResult.filledFieldCount,
      skippedFieldCount: args.fillResult.skippedFieldCount,
      errorCount: args.fillResult.errorCount,
      entries: args.fillResult.trace.map(summarizeFillTraceEntry),
    },
    verificationSummary: {
      status: args.verificationSummary.status,
      outputPdfPath: args.verificationSummary.outputPdfPath,
      filledTextFieldsExpected:
        args.verificationSummary.counts.filledTextFieldsExpected,
      selectedOptionsExpected:
        args.verificationSummary.counts.selectedOptionsExpected,
      blankFieldsExpected:
        args.verificationSummary.counts.blankFieldsExpected,
      issueCount: args.verificationSummary.counts.issues,
      issues: args.verificationSummary.issues,
    },
    reviewFlags: [
      ...artifactSpecificReviewFlags(),
      ...(args.demo.completionPlan.reviewFlags ?? []).map(summarizeReviewFlag),
    ],
    safety: {
      fakeDataOnly: true,
      rawSensitiveValuesIncluded: false,
      modelSafe: true,
    },
  };

  assertJonSmithFidelityToaReviewArtifactIsSafe(artifact);
  return artifact;
}

export async function writeJonSmithFidelityToaReviewArtifact(
  artifact: JonSmithFidelityToaReviewArtifact,
  outputPath = JON_SMITH_FIDELITY_TOA_REVIEW_ARTIFACT_PATH,
): Promise<string> {
  assertLocalDevGeneratedJsonOutputPath(outputPath);
  assertJonSmithFidelityToaReviewArtifactIsSafe(artifact);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  return outputPath;
}

export function assertLocalDevGeneratedJsonOutputPath(outputPath: string): void {
  const repoRoot = process.cwd();
  const resolvedOutputPath = path.resolve(repoRoot, outputPath);
  const resolvedGeneratedDir = path.resolve(repoRoot, "local-dev/generated");
  const relative = path.relative(resolvedGeneratedDir, resolvedOutputPath);

  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !resolvedOutputPath.toLowerCase().endsWith(".json")
  ) {
    throw new JonSmithFidelityToaReviewArtifactError(
      "Review artifact output path must be under local-dev/generated and end in .json.",
      "unsafe_output_path",
    );
  }
}

export function assertJonSmithFidelityToaReviewArtifactIsSafe(
  artifact: JonSmithFidelityToaReviewArtifact,
): void {
  const serialized = JSON.stringify(artifact);

  if (
    /\b000126789\b/.test(serialized) ||
    /\b900012345\b/.test(serialized) ||
    /\b234567890\b/.test(serialized) ||
    /\b\d{3}-\d{2}-\d{4}\b/.test(serialized)
  ) {
    throw new JonSmithFidelityToaReviewArtifactError(
      "Review artifact included raw fake sensitive values.",
      "unsafe_artifact",
    );
  }
}

function summarizeCompletionPlanField(field: CompletionPlanField) {
  return {
    planFieldId: field.planFieldId,
    destinationFieldName: field.destinationField?.name,
    action: field.action,
    plannedValueKind: field.plannedValue.valueKind,
    valueRefId: valueRefIdForPlannedValue(field.plannedValue),
    maskedPreview: maskedPreviewForPlannedValue(field.plannedValue),
    selectedOption: selectedOptionForPlannedValue(field.plannedValue),
    reason: field.reason,
    confidence: field.confidence,
    reviewFlags: (field.reviewFlags ?? []).map(summarizeReviewFlag),
  };
}

function summarizeFillTraceEntry(entry: PdfFillTraceEntry) {
  return {
    destinationFieldName: entry.destinationFieldName,
    status: entry.status,
    valueRefId: entry.valueRefId,
    maskedPreview: entry.maskedPreview?.display,
    selectedOption: entry.selectedOption
      ? {
          label: entry.selectedOption.label,
          exportValue: entry.selectedOption.exportValue,
        }
      : undefined,
    reason: entry.reason,
  };
}

function summarizeReviewFlag(flag: ReviewFlag): SafeReviewFlagSummary {
  return {
    reviewFlagId: flag.reviewFlagId,
    flagType: flag.flagType,
    severity: flag.severity,
    message: flag.message,
    status: flag.status,
    fieldId: flag.fieldId,
    valueRefId: flag.valueRefId,
  };
}

function artifactSpecificReviewFlags(): SafeReviewFlagSummary[] {
  return [
    {
      reviewFlagId: "review_signature_date_left_blank",
      flagType: "manual_confirmation",
      severity: "warning",
      message:
        "Signature and date fields were intentionally left blank for human completion.",
      status: "open",
    },
    {
      reviewFlagId: "review_confirm_client_account_details_before_real_use",
      flagType: "policy_review",
      severity: "warning",
      message:
        "Confirm client, account, custodian, and transfer details before any real-data workflow.",
      status: "open",
    },
    {
      reviewFlagId: "review_fake_data_only",
      flagType: "policy_review",
      severity: "warning",
      message:
        "This artifact is fake-data-only and must not be treated as production execution evidence.",
      status: "open",
    },
  ];
}

function valueRefIdForPlannedValue(
  plannedValue: CompletionPlanField["plannedValue"],
): string | undefined {
  return "valueRefId" in plannedValue ? plannedValue.valueRefId : undefined;
}

function maskedPreviewForPlannedValue(
  plannedValue: CompletionPlanField["plannedValue"],
): string | undefined {
  return "maskedPreview" in plannedValue
    ? plannedValue.maskedPreview?.display
    : undefined;
}

function selectedOptionForPlannedValue(
  plannedValue: CompletionPlanField["plannedValue"],
): SafeOptionSummary | undefined {
  return "selectedOption" in plannedValue && plannedValue.selectedOption
    ? {
        label: plannedValue.selectedOption.label,
        exportValue: plannedValue.selectedOption.exportValue,
      }
    : undefined;
}
