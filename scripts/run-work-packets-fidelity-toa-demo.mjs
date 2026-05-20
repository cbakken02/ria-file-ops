import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const TEMPLATE_PATH = "local-dev/pdf-templates/fidelity-toa-template.pdf";
const DEV_ROUTE_URL = "http://localhost:3000/dev/execution-lab/fidelity-toa";

const STEPS = [
  {
    name: "fill",
    command: ["node", "scripts/fill-work-packets-fidelity-toa-demo.mjs"],
  },
  {
    name: "verify",
    command: ["node", "scripts/verify-work-packets-fidelity-toa-demo.mjs"],
  },
  {
    name: "build_review_artifact",
    command: ["node", "scripts/build-work-packets-fidelity-toa-review-artifact.mjs"],
  },
  {
    name: "view_model_summary",
    command: ["node", "scripts/view-work-packets-fidelity-toa-review-artifact.mjs"],
  },
];

if (!existsSync(TEMPLATE_PATH)) {
  printErrorAndExit({
    code: "missing_template",
    message:
      "Place the Fidelity TOA template at local-dev/pdf-templates/fidelity-toa-template.pdf before running the dev-only demo pipeline.",
    templatePath: TEMPLATE_PATH,
  });
}

try {
  const fillSummary = runPipelineStep(STEPS[0]);
  const verificationSummary = runPipelineStep(STEPS[1]);
  const artifactSummary = runPipelineStep(STEPS[2]);
  const viewSummary = runPipelineStep(STEPS[3]);

  const finalSummary = {
    status:
      verificationSummary.status === "passed" &&
      artifactSummary.status === "passed" &&
      viewSummary.status === "passed" &&
      fillSummary.errorCount === 0
        ? "passed"
        : "failed",
    generatedPdfPath:
      artifactSummary.outputPdfPath ||
      fillSummary.outputPdfPath ||
      viewSummary.generatedPdfPath,
    reviewArtifactPath:
      artifactSummary.artifactPath || viewSummary.reviewJsonPath,
    verificationStatus: verificationSummary.status,
    filledFieldCount:
      artifactSummary.filledFieldCount ?? fillSummary.filledFieldCount,
    selectedOptionCount:
      viewSummary.fillTraceCounts?.optionsSelected ??
      countSelectedOptions(fillSummary),
    skippedFieldCount:
      artifactSummary.skippedFieldCount ?? fillSummary.skippedFieldCount,
    errorCount: fillSummary.errorCount ?? 0,
    devRouteUrl: DEV_ROUTE_URL,
    rawSensitiveValuesPrinted: false,
  };

  assertNoRawSensitiveValues(finalSummary);
  console.log(JSON.stringify(finalSummary, null, 2));
  process.exit(finalSummary.status === "passed" ? 0 : 1);
} catch (error) {
  if (error instanceof Error) {
    printErrorAndExit({
      code: "pipeline_failed",
      message: error.message,
    });
  }

  printErrorAndExit({
    code: "pipeline_failed",
    message: "The dev-only Fidelity TOA demo pipeline failed.",
  });
}

function runPipelineStep(step) {
  const [command, ...args] = step.command;
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";

  assertNoRawSensitiveValues(stdout);
  assertNoRawSensitiveValues(stderr);

  if (result.status !== 0) {
    throw new Error(
      `${step.name} failed. Run '${step.command.join(" ")}' for detailed safe diagnostics.`,
    );
  }

  const parsed = parseStepJson(stdout, step.name);
  assertNoRawSensitiveValues(parsed);
  return parsed;
}

function parseStepJson(stdout, stepName) {
  const trimmed = stdout.trim();

  if (!trimmed) {
    throw new Error(`${stepName} did not print a JSON summary.`);
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error(`${stepName} printed an unreadable JSON summary.`);
  }
}

function countSelectedOptions(fillSummary) {
  return Array.isArray(fillSummary.trace)
    ? fillSummary.trace.filter(
        (entry) => entry.status === "filled" && entry.selectedOption,
      ).length
    : 0;
}

function assertNoRawSensitiveValues(value) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);

  if (
    /\b\d{3}-\d{2}-\d{4}\b/.test(serialized) ||
    /\b\d{9,}\b/.test(serialized)
  ) {
    throw new Error("Pipeline output included raw fake sensitive values.");
  }
}

function printErrorAndExit(error) {
  console.error(
    JSON.stringify(
      {
        status: "error",
        ...error,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}
