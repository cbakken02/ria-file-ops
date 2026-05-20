import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);

if (
  !process.env.WORK_PACKETS_REVIEW_ARTIFACT_REEXEC &&
  !process.execArgv.includes("--experimental-strip-types")
) {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--loader",
      "./tests/ts-alias-loader.mjs",
      SCRIPT_PATH,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        WORK_PACKETS_REVIEW_ARTIFACT_REEXEC: "true",
      },
      stdio: "inherit",
    },
  );
  process.exit(result.status ?? 1);
}

const {
  JON_SMITH_FIDELITY_TOA_FILLED_OUTPUT_PATH,
  JON_SMITH_FIDELITY_TOA_TEMPLATE_PATH,
  buildJonSmithFidelityToaDemo,
  resolveJonSmithFidelityToaFakeValue,
} = await import("../lib/work-packets/dev-demo/jon-smith-fidelity-toa.ts");
const { fillPdfFromCompletionPlan } = await import(
  "../lib/work-packets/pdf-fill-adapter.ts"
);
const { inspectPdfFieldInventoryFromFile } = await import(
  "../lib/work-packets/pdf-field-inventory.ts"
);
const {
  verifyJonSmithFidelityToaOutputPdf,
} = await import("../lib/work-packets/dev-demo/fidelity-toa-output-verification.ts");
const {
  JON_SMITH_FIDELITY_TOA_REVIEW_ARTIFACT_PATH,
  buildJonSmithFidelityToaReviewArtifact,
  writeJonSmithFidelityToaReviewArtifact,
} = await import("../lib/work-packets/dev-demo/fidelity-toa-review-artifact.ts");

const fieldInventory = await inspectPdfFieldInventoryFromFile(
  JON_SMITH_FIDELITY_TOA_TEMPLATE_PATH,
);
const demo = buildJonSmithFidelityToaDemo({ fieldInventory });
const fillResult = await fillPdfFromCompletionPlan({
  templatePdfPath: JON_SMITH_FIDELITY_TOA_TEMPLATE_PATH,
  outputPdfPath: JON_SMITH_FIDELITY_TOA_FILLED_OUTPUT_PATH,
  completionPlan: demo.completionPlan,
  valueRefs: demo.valueRefs,
  resolveValue: (valueRef) => {
    const resolved = resolveJonSmithFidelityToaFakeValue(valueRef.valueRefId);

    if (resolved.status !== "resolved") {
      return {
        status: "not_found",
        reason: resolved.reason,
        maskedPreview: valueRef.maskedPreview,
      };
    }

    return {
      status: "resolved",
      rawValue: resolved.rawValue,
      maskedPreview: resolved.maskedPreview,
    };
  },
});
const verificationSummary = await verifyJonSmithFidelityToaOutputPdf(
  fillResult.outputPdfPath,
);
const artifact = buildJonSmithFidelityToaReviewArtifact({
  demo,
  fillResult,
  verificationSummary,
});
const artifactPath = await writeJonSmithFidelityToaReviewArtifact(
  artifact,
  JON_SMITH_FIDELITY_TOA_REVIEW_ARTIFACT_PATH,
);

console.log(
  JSON.stringify(
    {
      status: artifact.metadata.status,
      artifactPath,
      outputPdfPath: artifact.metadata.generatedOutputPdfPath,
      completionPlanFieldCount: artifact.completionPlanSummary.fields.length,
      fillTraceEntryCount: artifact.fillTrace.entries.length,
      filledFieldCount: artifact.fillTrace.filledFieldCount,
      skippedFieldCount: artifact.fillTrace.skippedFieldCount,
      verification: artifact.verificationSummary,
      reviewFlagCount: artifact.reviewFlags.length,
      rawSensitiveValuesIncluded: artifact.safety.rawSensitiveValuesIncluded,
      modelSafe: artifact.safety.modelSafe,
    },
    null,
    2,
  ),
);

process.exit(artifact.metadata.status === "passed" ? 0 : 1);
