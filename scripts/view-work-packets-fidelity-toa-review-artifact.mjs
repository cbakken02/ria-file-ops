import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);

if (
  !process.env.WORK_PACKETS_REVIEW_VIEW_MODEL_REEXEC &&
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
        WORK_PACKETS_REVIEW_VIEW_MODEL_REEXEC: "true",
      },
      stdio: "inherit",
    },
  );
  process.exit(result.status ?? 1);
}

const {
  JON_SMITH_FIDELITY_TOA_REVIEW_ARTIFACT_PATH,
} = await import("../lib/work-packets/dev-demo/fidelity-toa-review-artifact.ts");
const {
  JonSmithFidelityToaReviewViewModelError,
  loadJonSmithFidelityToaExecutionReviewViewModel,
} = await import(
  "../lib/work-packets/dev-demo/fidelity-toa-execution-review-view-model.ts"
);

try {
  const viewModel = await loadJonSmithFidelityToaExecutionReviewViewModel(
    JON_SMITH_FIDELITY_TOA_REVIEW_ARTIFACT_PATH,
  );

  console.log(
    JSON.stringify(
      {
        status: viewModel.header.status,
        demoId: viewModel.header.demoId,
        taskType: viewModel.header.taskType,
        reviewJsonPath: viewModel.artifactRefs.reviewJsonPath,
        generatedPdfPath: viewModel.artifactRefs.generatedPdfPath,
        createdAt: viewModel.header.createdAt,
        sections: {
          header: true,
          taskContext: true,
          completionPlanRows: viewModel.completionPlan.rows.length,
          fillTraceRows: viewModel.fillTrace.rows.length,
          verification: true,
          reviewFlags: viewModel.reviewFlags.length,
          artifactRefs: true,
        },
        fillTraceCounts: viewModel.fillTrace.counts,
        verification: {
          status: viewModel.verification.status,
          expectedTextFieldsFilledCount:
            viewModel.verification.expectedTextFieldsFilledCount,
          expectedOptionsSelectedCount:
            viewModel.verification.expectedOptionsSelectedCount,
          blankFieldsConfirmedCount:
            viewModel.verification.blankFieldsConfirmedCount,
          issueCount: viewModel.verification.issueCount,
        },
        safety: viewModel.safety,
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (error instanceof JonSmithFidelityToaReviewViewModelError) {
    console.error(
      JSON.stringify(
        {
          status: "error",
          code: error.code,
          message: error.message,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  throw error;
}
