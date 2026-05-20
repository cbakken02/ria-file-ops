import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
} from "pdf-lib";
import type {
  CompletionPlan,
  CompletionPlanField,
  DestinationFieldOption,
  MaskedValuePreview,
  ValueRef,
  ValueRefId,
} from "@/lib/work-packets/types";

const LOCAL_DEV_GENERATED_DIR = "local-dev/generated";

export type PdfFillTraceStatus =
  | "filled"
  | "skipped"
  | "error";

export type PdfFillTraceEntry = {
  destinationFieldName: string;
  destinationFieldId?: string;
  valueRefId?: ValueRefId;
  maskedPreview?: MaskedValuePreview;
  selectedOption?: DestinationFieldOption;
  status: PdfFillTraceStatus;
  reason: string;
};

export type PdfFillResolvedValue =
  | {
      status: "resolved";
      rawValue: string;
      maskedPreview?: MaskedValuePreview;
    }
  | {
      status: "not_found" | "denied" | "error";
      reason: string;
      maskedPreview?: MaskedValuePreview;
    };

export type PdfFillValueResolver = (
  valueRef: ValueRef,
  planField: CompletionPlanField,
) => Promise<PdfFillResolvedValue> | PdfFillResolvedValue;

export type PdfFieldWriterInput = {
  templatePdfPath: string;
  outputPdfPath: string;
  fields: Record<string, string>;
};

export type PdfFieldWriterResult = {
  writtenFields: string[];
  missingFields: string[];
};

export type PdfFieldWriter = (
  input: PdfFieldWriterInput,
) => Promise<PdfFieldWriterResult>;

export type PdfBufferFieldWriterInput = {
  templatePdfBuffer: Buffer;
  fields: Record<string, string>;
};

export type PdfBufferFieldWriterResult = PdfFieldWriterResult & {
  outputPdfBuffer: Buffer;
};

export type PdfBufferFieldWriter = (
  input: PdfBufferFieldWriterInput,
) => Promise<PdfBufferFieldWriterResult>;

export type FillPdfFromCompletionPlanArgs = {
  templatePdfPath: string;
  outputPdfPath: string;
  completionPlan: CompletionPlan;
  valueRefs: ValueRef[];
  resolveValue: PdfFillValueResolver;
  writeFieldsToPdf?: PdfFieldWriter;
};

export type FillPdfBufferFromCompletionPlanArgs = {
  templatePdfBuffer: Buffer;
  completionPlan: CompletionPlan;
  valueRefs: ValueRef[];
  resolveValue: PdfFillValueResolver;
  writeFieldsToPdfBuffer?: PdfBufferFieldWriter;
};

export type PdfFillAdapterResult = {
  outputPdfPath: string;
  trace: PdfFillTraceEntry[];
  filledFieldCount: number;
  skippedFieldCount: number;
  errorCount: number;
};

export type PdfFillBufferAdapterResult = Omit<
  PdfFillAdapterResult,
  "outputPdfPath"
> & {
  outputPdfBuffer: Buffer;
};

export class PdfFillAdapterError extends Error {
  readonly code: "missing_template" | "unsafe_output_path" | "writer_failed";

  constructor(
    message: string,
    code: "missing_template" | "unsafe_output_path" | "writer_failed",
  ) {
    super(message);
    this.name = "PdfFillAdapterError";
    this.code = code;
  }
}

export async function fillPdfFromCompletionPlan(
  args: FillPdfFromCompletionPlanArgs,
): Promise<PdfFillAdapterResult> {
  assertLocalDevGeneratedOutputPath(args.outputPdfPath);

  if (!existsSync(args.templatePdfPath)) {
    throw new PdfFillAdapterError(
      `Template PDF not found at ${args.templatePdfPath}.`,
      "missing_template",
    );
  }

  const outputDirectory = path.dirname(args.outputPdfPath);
  await mkdir(outputDirectory, { recursive: true });

  const { fieldsToWrite, trace } = await buildPdfFieldWritePlan(args);

  const writerResult = await (args.writeFieldsToPdf ?? writeFieldsWithPypdf)({
    templatePdfPath: args.templatePdfPath,
    outputPdfPath: args.outputPdfPath,
    fields: fieldsToWrite,
  }).catch((error) => {
    throw new PdfFillAdapterError(
      error instanceof Error ? error.message : "PDF writer failed.",
      "writer_failed",
    );
  });

  const finalTrace = finalizePdfFillTrace(trace, writerResult);

  return {
    outputPdfPath: args.outputPdfPath,
    trace: finalTrace,
    filledFieldCount: finalTrace.filter((entry) => entry.status === "filled").length,
    skippedFieldCount: finalTrace.filter((entry) => entry.status === "skipped").length,
    errorCount: finalTrace.filter((entry) => entry.status === "error").length,
  };
}

export async function fillPdfBufferFromCompletionPlan(
  args: FillPdfBufferFromCompletionPlanArgs,
): Promise<PdfFillBufferAdapterResult> {
  if (args.templatePdfBuffer.byteLength === 0) {
    throw new PdfFillAdapterError(
      "Template PDF buffer was empty.",
      "missing_template",
    );
  }

  const { fieldsToWrite, trace } = await buildPdfFieldWritePlan(args);
  const writerResult = await (
    args.writeFieldsToPdfBuffer ?? writeFieldsToPdfBufferWithPypdf
  )({
    templatePdfBuffer: args.templatePdfBuffer,
    fields: fieldsToWrite,
  }).catch((error) => {
    throw new PdfFillAdapterError(
      error instanceof Error ? error.message : "PDF writer failed.",
      "writer_failed",
    );
  });

  const finalTrace = finalizePdfFillTrace(trace, writerResult);

  return {
    outputPdfBuffer: writerResult.outputPdfBuffer,
    trace: finalTrace,
    filledFieldCount: finalTrace.filter((entry) => entry.status === "filled").length,
    skippedFieldCount: finalTrace.filter((entry) => entry.status === "skipped").length,
    errorCount: finalTrace.filter((entry) => entry.status === "error").length,
  };
}

async function buildPdfFieldWritePlan(args: {
  completionPlan: CompletionPlan;
  valueRefs: ValueRef[];
  resolveValue: PdfFillValueResolver;
}): Promise<{
  fieldsToWrite: Record<string, string>;
  trace: PdfFillTraceEntry[];
}> {
  const valueRefsById = new Map(
    args.valueRefs.map((valueRef) => [valueRef.valueRefId, valueRef]),
  );
  const trace: PdfFillTraceEntry[] = [];
  const fieldsToWrite: Record<string, string> = {};

  for (const planField of args.completionPlan.fields) {
    const fieldName = planField.destinationField?.name;
    const fieldId = planField.destinationFieldId;
    const plannedValue = planField.plannedValue;

    if (!fieldName) {
      trace.push({
        destinationFieldName: "(unknown)",
        destinationFieldId: fieldId,
        status: "skipped",
        reason: "No destination PDF field name was available.",
      });
      continue;
    }

    if (plannedValue.valueKind === "intentionally_blank") {
      trace.push({
        destinationFieldName: fieldName,
        destinationFieldId: fieldId,
        status: "skipped",
        reason: plannedValue.reason,
      });
      continue;
    }

    if (plannedValue.valueKind === "manual_review_required") {
      trace.push({
        destinationFieldName: fieldName,
        destinationFieldId: fieldId,
        status: "skipped",
        reason: plannedValue.reason,
      });
      continue;
    }

    if (plannedValue.valueKind === "select_option") {
      const exportValue = plannedValue.selectedOption.exportValue;

      if (!exportValue) {
        trace.push({
          destinationFieldName: fieldName,
          destinationFieldId: fieldId,
          valueRefId: plannedValue.valueRefId,
          selectedOption: plannedValue.selectedOption,
          status: "error",
          reason: "Selected PDF option did not include an export value.",
        });
        continue;
      }

      const valueRef = plannedValue.valueRefId
        ? valueRefsById.get(plannedValue.valueRefId)
        : undefined;

      fieldsToWrite[fieldName] = exportValue;
      trace.push({
        destinationFieldName: fieldName,
        destinationFieldId: fieldId,
        valueRefId: plannedValue.valueRefId,
        maskedPreview: valueRef?.maskedPreview,
        selectedOption: plannedValue.selectedOption,
        status: "filled",
        reason: "Selected confirmed PDF option export value.",
      });
      continue;
    }

    if (plannedValue.valueKind === "checkbox_state") {
      if (!plannedValue.checked) {
        trace.push({
          destinationFieldName: fieldName,
          destinationFieldId: fieldId,
          valueRefId: plannedValue.valueRefId,
          selectedOption: plannedValue.selectedOption,
          status: "skipped",
          reason: "Checkbox planned state is unchecked.",
        });
        continue;
      }

      const exportValue = plannedValue.selectedOption?.exportValue;

      if (!exportValue) {
        trace.push({
          destinationFieldName: fieldName,
          destinationFieldId: fieldId,
          valueRefId: plannedValue.valueRefId,
          selectedOption: plannedValue.selectedOption,
          status: "error",
          reason: "Checked PDF option did not include an export value.",
        });
        continue;
      }

      const valueRef = plannedValue.valueRefId
        ? valueRefsById.get(plannedValue.valueRefId)
        : undefined;

      fieldsToWrite[fieldName] = exportValue;
      trace.push({
        destinationFieldName: fieldName,
        destinationFieldId: fieldId,
        valueRefId: plannedValue.valueRefId,
        maskedPreview: valueRef?.maskedPreview,
        selectedOption: plannedValue.selectedOption,
        status: "filled",
        reason: "Selected confirmed PDF checkbox export value.",
      });
      continue;
    }

    if (plannedValue.valueKind !== "value_ref") {
      trace.push({
        destinationFieldName: fieldName,
        destinationFieldId: fieldId,
        status: "skipped",
        reason: `Unsupported planned value kind for dev-only PDF fill: ${plannedValue.valueKind}.`,
      });
      continue;
    }

    const valueRef = valueRefsById.get(plannedValue.valueRefId);

    if (!valueRef) {
      trace.push({
        destinationFieldName: fieldName,
        destinationFieldId: fieldId,
        valueRefId: plannedValue.valueRefId,
        maskedPreview: plannedValue.maskedPreview,
        status: "error",
        reason: "Value ref was not present in the run value-ref list.",
      });
      continue;
    }

    const resolved = await args.resolveValue(valueRef, planField);
    const maskedPreview = resolved.maskedPreview ?? valueRef.maskedPreview;

    if (resolved.status !== "resolved") {
      trace.push({
        destinationFieldName: fieldName,
        destinationFieldId: fieldId,
        valueRefId: valueRef.valueRefId,
        maskedPreview,
        status: "error",
        reason: resolved.reason,
      });
      continue;
    }

    fieldsToWrite[fieldName] = resolved.rawValue;
    trace.push({
      destinationFieldName: fieldName,
      destinationFieldId: fieldId,
      valueRefId: valueRef.valueRefId,
      maskedPreview,
      status: "filled",
      reason: "Resolved through app-layer fake resolver and written to copied PDF.",
    });
  }

  return { fieldsToWrite, trace };
}

function finalizePdfFillTrace(
  trace: PdfFillTraceEntry[],
  writerResult: PdfFieldWriterResult,
): PdfFillTraceEntry[] {
  const missingWrittenFields = new Set(writerResult.missingFields);
  return trace.map((entry) =>
    entry.status === "filled" && missingWrittenFields.has(entry.destinationFieldName)
      ? {
          ...entry,
          status: "error" as const,
          reason: "Destination field was not found by the PDF writer.",
        }
      : entry,
  );
}

export function assertLocalDevGeneratedOutputPath(outputPdfPath: string): void {
  const repoRoot = process.cwd();
  const resolvedOutputPath = path.resolve(repoRoot, outputPdfPath);
  const resolvedGeneratedDir = path.resolve(repoRoot, LOCAL_DEV_GENERATED_DIR);
  const relative = path.relative(resolvedGeneratedDir, resolvedOutputPath);

  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !resolvedOutputPath.toLowerCase().endsWith(".pdf")
  ) {
    throw new PdfFillAdapterError(
      `Output PDF path must be under ${LOCAL_DEV_GENERATED_DIR} and end in .pdf.`,
      "unsafe_output_path",
    );
  }
}

async function writeFieldsWithPypdf(
  input: PdfFieldWriterInput,
): Promise<PdfFieldWriterResult> {
  const { stdout, stderr } = await runPythonFillScript(input);

  if (stderr.trim()) {
    throw new Error(stderr.trim());
  }

  return JSON.parse(stdout) as PdfFieldWriterResult;
}

async function writeFieldsToPdfBufferWithPypdf(
  input: PdfBufferFieldWriterInput,
): Promise<PdfBufferFieldWriterResult> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "ria-file-ops-pdf-fill-"));
  const templatePdfPath = path.join(tempDir, "template.pdf");
  const outputPdfPath = path.join(tempDir, "filled.pdf");

  try {
    await writeFile(templatePdfPath, input.templatePdfBuffer);
    const writerResult = await writeFieldsWithPypdf({
      templatePdfPath,
      outputPdfPath,
      fields: input.fields,
    });
    const outputPdfBuffer = await readFile(outputPdfPath);

    return {
      ...writerResult,
      outputPdfBuffer,
    };
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

export async function writeFieldsToPdfBufferWithPdfLib(
  input: PdfBufferFieldWriterInput,
): Promise<PdfBufferFieldWriterResult> {
  const pdfDocument = await PDFDocument.load(new Uint8Array(input.templatePdfBuffer));
  const form = pdfDocument.getForm();
  const existingFields = new Set(form.getFields().map((field) => field.getName()));
  const writtenFields: string[] = [];
  const missingFields: string[] = [];

  for (const [fieldName, value] of Object.entries(input.fields)) {
    if (!existingFields.has(fieldName)) {
      missingFields.push(fieldName);
      continue;
    }

    const field = form.getFieldMaybe(fieldName);

    if (!field) {
      missingFields.push(fieldName);
      continue;
    }

    if (field instanceof PDFTextField) {
      field.setText(value);
      writtenFields.push(fieldName);
      continue;
    }

    if (field instanceof PDFRadioGroup) {
      if (!field.getOptions().includes(value)) {
        missingFields.push(fieldName);
        continue;
      }

      field.select(value);
      writtenFields.push(fieldName);
      continue;
    }

    if (field instanceof PDFCheckBox) {
      if (!selectPdfLibButtonExportValue(field, value)) {
        missingFields.push(fieldName);
        continue;
      }

      writtenFields.push(fieldName);
      continue;
    }

    if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      if (!field.getOptions().includes(value)) {
        missingFields.push(fieldName);
        continue;
      }

      field.select(value);
      writtenFields.push(fieldName);
      continue;
    }

    missingFields.push(fieldName);
  }

  const outputPdfBuffer = Buffer.from(await pdfDocument.save());

  return {
    outputPdfBuffer,
    writtenFields: writtenFields.sort(),
    missingFields: missingFields.sort(),
  };
}

function selectPdfLibButtonExportValue(
  field: PDFCheckBox,
  exportValue: string,
): boolean {
  const selectedState = PDFName.of(exportValue.replace(/^\//, ""));
  const offState = PDFName.of("Off");
  const acroField = field.acroField;
  const widgets = acroField.getWidgets();
  let matched = false;

  for (const widget of widgets) {
    const onValue = widget.getOnValue();

    if (onValue && pdfNameToValue(onValue) === pdfNameToValue(selectedState)) {
      widget.setAppearanceState(selectedState);
      matched = true;
    } else {
      widget.setAppearanceState(offState);
    }
  }

  if (!matched) {
    acroField.setValue(offState);
    return false;
  }

  acroField.dict.set(PDFName.of("V"), selectedState);
  return true;
}

function pdfNameToValue(name: PDFName): string {
  return name.decodeText().replace(/^\//, "");
}

function runPythonFillScript(input: PdfFieldWriterInput): Promise<{
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["-c", PYPDF_FILL_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");

      if (code !== 0) {
        reject(new Error(stderr.trim() || `python3 exited with code ${code}`));
        return;
      }

      resolve({ stdout, stderr });
    });

    child.stdin.end(JSON.stringify(input));
  });
}

const PYPDF_FILL_SCRIPT = String.raw`
import json
import sys
from pathlib import Path
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject

payload = json.load(sys.stdin)
template_path = Path(payload["templatePdfPath"])
output_path = Path(payload["outputPdfPath"])
fields = payload.get("fields") or {}

reader = PdfReader(str(template_path))
writer = PdfWriter()
writer.append(reader)

try:
    writer.set_need_appearances_writer(True)
except Exception:
    pass

existing_fields = set((reader.get_fields() or {}).keys())
fields_to_write = {
    key: str(value)
    for key, value in fields.items()
    if key in existing_fields
}
reader_fields = reader.get_fields() or {}
button_fields = {
    key
    for key, field in reader_fields.items()
    if str(field.get("/FT")) == "/Btn"
}
text_fields_to_write = {
    key: value
    for key, value in fields_to_write.items()
    if key not in button_fields
}

for page in writer.pages:
    writer.update_page_form_field_values(page, text_fields_to_write)

def iter_field_objects(objects):
    for item in objects or []:
        field = item.get_object()
        yield field
        for child in iter_field_objects(field.get("/Kids") or []):
            yield child

acro_form = writer._root_object.get("/AcroForm")
if hasattr(acro_form, "get_object"):
    acro_form = acro_form.get_object()
acro_fields = acro_form.get("/Fields") if acro_form else []
field_objects_by_name = {}

for field in iter_field_objects(acro_fields):
    title = field.get("/T")
    if title is not None:
        field_objects_by_name[str(title)] = field

button_fields_written = set()

for key, value in fields_to_write.items():
    if key not in button_fields:
        continue

    target = field_objects_by_name.get(key)
    if target is None:
        continue

    selected_state = NameObject("/" + str(value).lstrip("/"))
    off_state = NameObject("/Off")
    targets = target.get("/Kids") or [target]
    matched = False

    target[NameObject("/V")] = selected_state

    for target_ref in targets:
        widget = target_ref.get_object() if hasattr(target_ref, "get_object") else target_ref
        normal_appearance = (widget.get("/AP") or {}).get("/N") or {}

        if hasattr(normal_appearance, "get_object"):
            normal_appearance = normal_appearance.get_object()

        states = set(normal_appearance.keys()) if hasattr(normal_appearance, "keys") else set()

        if selected_state in states:
            widget[NameObject("/AS")] = selected_state
            matched = True
        elif off_state in states:
            widget[NameObject("/AS")] = off_state

    if matched:
        button_fields_written.add(key)

output_path.parent.mkdir(parents=True, exist_ok=True)
with output_path.open("wb") as handle:
    writer.write(handle)

print(json.dumps({
    "writtenFields": sorted(set(text_fields_to_write.keys()) | button_fields_written),
    "missingFields": sorted((set(fields.keys()) - existing_fields) | (button_fields - button_fields_written - (button_fields - set(fields_to_write.keys())))),
}))
`;
