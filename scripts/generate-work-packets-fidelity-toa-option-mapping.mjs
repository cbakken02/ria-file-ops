import { spawnSync } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);

if (
  !process.env.WORK_PACKETS_OPTION_MAPPING_REEXEC &&
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
        WORK_PACKETS_OPTION_MAPPING_REEXEC: "true",
      },
      stdio: "inherit",
    },
  );
  process.exit(result.status ?? 1);
}

const { JON_SMITH_FIDELITY_TOA_TEMPLATE_PATH } = await import(
  "../lib/work-packets/dev-demo/jon-smith-fidelity-toa.ts"
);
const {
  JON_SMITH_FIDELITY_TOA_OPTION_MAPPING_OUTPUT_DIR,
  JON_SMITH_FIDELITY_TOA_OPTION_MAPPING_TARGETS,
  buildJonSmithFidelityToaOptionMappingProbes,
  exportValuesForTarget,
} = await import("../lib/work-packets/dev-demo/fidelity-toa-option-mapping.ts");
const {
  generatePdfOptionMappingProbes,
} = await import("../lib/work-packets/pdf-option-mapping.ts");
const { assertLocalDevGeneratedOutputPath } = await import(
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
          "Place the Fidelity TOA template at local-dev/pdf-templates/fidelity-toa-template.pdf before running this dev-only option mapping script.",
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

await mkdir(JON_SMITH_FIDELITY_TOA_OPTION_MAPPING_OUTPUT_DIR, {
  recursive: true,
});

const blankControlPdfPath = path.join(
  JON_SMITH_FIDELITY_TOA_OPTION_MAPPING_OUTPUT_DIR,
  "blank-control.pdf",
);
assertLocalDevGeneratedOutputPath(blankControlPdfPath);
await copyFile(JON_SMITH_FIDELITY_TOA_TEMPLATE_PATH, blankControlPdfPath);

const fieldInventory = await inspectPdfFieldInventoryFromFile(
  JON_SMITH_FIDELITY_TOA_TEMPLATE_PATH,
);
const probes = buildJonSmithFidelityToaOptionMappingProbes(fieldInventory);
const results = await generatePdfOptionMappingProbes({
  templatePdfPath: JON_SMITH_FIDELITY_TOA_TEMPLATE_PATH,
  outputDirectory: JON_SMITH_FIDELITY_TOA_OPTION_MAPPING_OUTPUT_DIR,
  probes,
});
const generated = results.filter((result) => result.status === "generated");
const errors = results.filter((result) => result.status === "error");

console.log(
  JSON.stringify(
    {
      status: errors.length === 0 ? "completed" : "completed_with_errors",
      templatePath: JON_SMITH_FIDELITY_TOA_TEMPLATE_PATH,
      outputDirectory: JON_SMITH_FIDELITY_TOA_OPTION_MAPPING_OUTPUT_DIR,
      blankControlPdfPath,
      fieldCount: fieldInventory.fields.length,
      generatedPdfCount: generated.length,
      generatedPdfPaths: generated.map((result) => result.outputPdfPath),
      targets: JON_SMITH_FIDELITY_TOA_OPTION_MAPPING_TARGETS.map((target) => {
        const targetResults = results.filter(
          (result) => result.fieldName === target.fieldName,
        );

        return {
          fieldName: target.fieldName,
          sectionLabel: target.sectionLabel,
          visibleSelection: target.visibleSelection,
          expectedMainDemoBehavior: target.expectedMainDemoBehavior,
          candidateExportValues: exportValuesForTarget(target, fieldInventory),
          generatedPdfPaths: targetResults.map((result) => result.outputPdfPath),
          status: target.generateProbePdfs
            ? "needs_manual_visual_confirmation"
            : "intentionally_left_blank_for_demo",
          notes: targetResults.map((result) => ({
            exportValue: result.exportValue,
            status: result.status,
            matchedAppearanceState: result.matchedAppearanceState,
            warnings: result.warnings ?? [],
          })),
        };
      }),
      instructions: [
        "Open blank-control.pdf first to compare against untouched checkboxes.",
        "For Type, open each type-value-*.pdf and record which numeric export value checks Traditional, SEP, or Rollover IRA.",
        "For Type2, open each type2-value-*.pdf and record which numeric export value checks Traditional, SEP, or Rollover IRA.",
        "For Trans, open trans-value-1.pdf and trans-value-2.pdf and record which numeric export value checks Section 3.A Option 1, Transfer the entire account in kind.",
        "Do not update the main Jon Smith fill until those visual mappings are manually confirmed.",
      ],
      errors: errors.map((result) => ({
        fieldName: result.fieldName,
        exportValue: result.exportValue,
        outputPdfPath: result.outputPdfPath,
        reason: result.reason,
      })),
    },
    null,
    2,
  ),
);

process.exit(errors.length === 0 ? 0 : 1);
