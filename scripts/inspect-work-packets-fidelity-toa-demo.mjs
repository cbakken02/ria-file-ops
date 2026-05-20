import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);

if (
  !process.env.WORK_PACKETS_DEMO_REEXEC &&
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
        WORK_PACKETS_DEMO_REEXEC: "true",
      },
      stdio: "inherit",
    },
  );
  process.exit(result.status ?? 1);
}

const {
  JON_SMITH_FIDELITY_TOA_TEMPLATE_PATH,
  buildJonSmithFidelityToaDemo,
} = await import("../lib/work-packets/dev-demo/jon-smith-fidelity-toa.ts");
const { inspectPdfFieldInventoryFromFile } = await import(
  "../lib/work-packets/pdf-field-inventory.ts"
);

const templatePresent = existsSync(JON_SMITH_FIDELITY_TOA_TEMPLATE_PATH);
const fieldInventory = templatePresent
  ? await inspectPdfFieldInventoryFromFile(JON_SMITH_FIDELITY_TOA_TEMPLATE_PATH)
  : undefined;
const demo = buildJonSmithFidelityToaDemo({ fieldInventory });
const valueRefsById = new Map(
  demo.valueRefs.map((valueRef) => [valueRef.valueRefId, valueRef]),
);

console.log(
  JSON.stringify(
    {
      templatePath: JON_SMITH_FIDELITY_TOA_TEMPLATE_PATH,
      templatePresent,
      fieldCount: fieldInventory?.fields.length ?? 0,
      packetId: demo.packet.id,
      runId: demo.run.id,
      completionPlanStatus: demo.completionPlan.status,
      mappedFields: demo.completionPlan.fields.map((field) => ({
        planFieldId: field.planFieldId,
        destinationFieldId: field.destinationFieldId,
        action: field.action,
        valueKind: field.plannedValue.valueKind,
        valueRefId:
          "valueRefId" in field.plannedValue
            ? field.plannedValue.valueRefId
            : undefined,
        valueFieldKey:
          "valueRefId" in field.plannedValue && field.plannedValue.valueRefId
            ? valueRefsById.get(field.plannedValue.valueRefId)?.fieldKey
            : undefined,
        destinationFieldName: field.destinationField?.name,
        confidence: field.confidence,
        reviewFlagCount: field.reviewFlags?.length ?? 0,
        reviewFlagIds: field.reviewFlags?.map((flag) => flag.reviewFlagId) ?? [],
      })),
      missingItems: demo.completionPlan.missingItems?.map((item) => ({
        id: item.missingItemId,
        severity: item.severity,
        status: item.status,
        suggestedNextStep: item.suggestedNextStep,
      })),
      resolverPreviews: demo.resolverPreviews.map((preview) => ({
        valueRefId: preview.valueRefId,
        fieldKey: preview.fieldKey,
        display: preview.maskedPreview.display,
        rawValueWasNotReturned: preview.rawValueWasNotReturned,
      })),
    },
    null,
    2,
  ),
);
