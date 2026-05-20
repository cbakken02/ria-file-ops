import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);

if (
  !process.env.WORK_PACKETS_FILL_DEMO_REEXEC &&
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
        WORK_PACKETS_FILL_DEMO_REEXEC: "true",
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

if (!existsSync(JON_SMITH_FIDELITY_TOA_TEMPLATE_PATH)) {
  console.error(
    JSON.stringify(
      {
        status: "error",
        code: "missing_template",
        templatePath: JON_SMITH_FIDELITY_TOA_TEMPLATE_PATH,
        message:
          "Place the Fidelity TOA template at local-dev/pdf-templates/fidelity-toa-template.pdf before running this dev-only fill script.",
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const fieldInventory = await inspectPdfFieldInventoryFromFile(
  JON_SMITH_FIDELITY_TOA_TEMPLATE_PATH,
);
const demo = buildJonSmithFidelityToaDemo({ fieldInventory });
const result = await fillPdfFromCompletionPlan({
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

console.log(
  JSON.stringify(
    {
      status: result.errorCount === 0 ? "completed" : "completed_with_errors",
      templatePath: JON_SMITH_FIDELITY_TOA_TEMPLATE_PATH,
      outputPdfPath: result.outputPdfPath,
      fieldCount: fieldInventory.fields.length,
      filledFieldCount: result.filledFieldCount,
      skippedFieldCount: result.skippedFieldCount,
      errorCount: result.errorCount,
      trace: result.trace.map((entry) => ({
        destinationFieldName: entry.destinationFieldName,
        valueRefId: entry.valueRefId,
        maskedPreview: entry.maskedPreview?.display,
        selectedOption: entry.selectedOption
          ? {
              label: entry.selectedOption.label,
              exportValue: entry.selectedOption.exportValue,
            }
          : undefined,
        status: entry.status,
        reason: entry.reason,
      })),
    },
    null,
    2,
  ),
);
