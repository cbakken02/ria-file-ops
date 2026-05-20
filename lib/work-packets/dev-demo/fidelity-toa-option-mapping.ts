import type { FieldInventory } from "@/lib/work-packets/types";
import type { PdfOptionMappingProbe } from "@/lib/work-packets/pdf-option-mapping";

export const JON_SMITH_FIDELITY_TOA_OPTION_MAPPING_OUTPUT_DIR =
  "local-dev/generated/option-mapping";

export type JonSmithFidelityToaOptionMappingTarget = {
  fieldName: "Type" | "Type2" | "Trans" | "NewAcct";
  sectionLabel: string;
  visibleSelection: string;
  expectedMainDemoBehavior:
    | "select_after_manual_confirmation"
    | "leave_blank";
  fallbackExportValues: string[];
  generateProbePdfs: boolean;
};

export type JonSmithFidelityToaConfirmedOptionMapping = {
  fieldName: "Type" | "Type2" | "Trans";
  exportValue: string;
  label: string;
  visibleSelection: string;
  confidence: "high";
  confirmedBy: "dev_visual_option_inspector";
};

export const JON_SMITH_FIDELITY_TOA_CONFIRMED_OPTION_MAPPINGS = {
  receivingTraditionalIra: {
    fieldName: "Type",
    exportValue: "7",
    label: "Traditional, SEP, or Rollover IRA",
    visibleSelection: "Receiving Fidelity Account Type",
    confidence: "high",
    confirmedBy: "dev_visual_option_inspector",
  },
  deliveringTraditionalIra: {
    fieldName: "Type2",
    exportValue: "7",
    label: "Traditional, SEP, or Rollover IRA",
    visibleSelection: "Delivering Firm Account Type",
    confidence: "high",
    confirmedBy: "dev_visual_option_inspector",
  },
  fullInKindTransfer: {
    fieldName: "Trans",
    exportValue: "1",
    label: "Transfer the entire account, in kind",
    visibleSelection: "Section 3.A option 1",
    confidence: "high",
    confirmedBy: "dev_visual_option_inspector",
  },
} satisfies Record<string, JonSmithFidelityToaConfirmedOptionMapping>;

export const JON_SMITH_FIDELITY_TOA_OPTION_MAPPING_TARGETS: JonSmithFidelityToaOptionMappingTarget[] =
  [
    {
      fieldName: "Type",
      sectionLabel: "Receiving Fidelity Account Type",
      visibleSelection: "Traditional, SEP, or Rollover IRA",
      expectedMainDemoBehavior: "select_after_manual_confirmation",
      fallbackExportValues: [
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "10",
        "11",
        "14",
        "12",
        "13",
      ],
      generateProbePdfs: true,
    },
    {
      fieldName: "Type2",
      sectionLabel: "Delivering Firm Account Type",
      visibleSelection: "Traditional, SEP, or Rollover IRA",
      expectedMainDemoBehavior: "select_after_manual_confirmation",
      fallbackExportValues: [
        "1",
        "2",
        "4",
        "5",
        "6",
        "14",
        "7",
        "8",
        "9",
        "10",
        "11",
        "3",
        "12",
        "13",
      ],
      generateProbePdfs: true,
    },
    {
      fieldName: "Trans",
      sectionLabel: "Section 3.A Brokerage or Trust Company Account Transfer",
      visibleSelection: "Option 1: Transfer the entire account, in kind.",
      expectedMainDemoBehavior: "select_after_manual_confirmation",
      fallbackExportValues: ["1", "2"],
      generateProbePdfs: true,
    },
    {
      fieldName: "NewAcct",
      sectionLabel: "New Fidelity account",
      visibleSelection: "Leave unchecked because Jon Smith has an existing Fidelity account number.",
      expectedMainDemoBehavior: "leave_blank",
      fallbackExportValues: ["3"],
      generateProbePdfs: false,
    },
  ];

export function buildJonSmithFidelityToaOptionMappingProbes(
  fieldInventory?: FieldInventory,
): PdfOptionMappingProbe[] {
  return JON_SMITH_FIDELITY_TOA_OPTION_MAPPING_TARGETS.flatMap((target) => {
    if (!target.generateProbePdfs) {
      return [];
    }

    return exportValuesForTarget(target, fieldInventory).map((exportValue) => ({
      fieldName: target.fieldName,
      exportValue,
      note: `${target.sectionLabel}: visually inspect whether this selects "${target.visibleSelection}".`,
    }));
  });
}

export function exportValuesForTarget(
  target: JonSmithFidelityToaOptionMappingTarget,
  fieldInventory?: FieldInventory,
): string[] {
  const inventoryField = fieldInventory?.fields.find(
    (field) => field.name === target.fieldName,
  );
  const inventoryExportValues =
    inventoryField?.options
      ?.map((option) => option.exportValue ?? option.label)
      .filter((value): value is string => Boolean(value)) ?? [];
  const values = inventoryExportValues.length > 0
    ? inventoryExportValues
    : target.fallbackExportValues;

  return Array.from(new Set(values));
}
