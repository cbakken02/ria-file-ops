import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { assertLocalDevGeneratedOutputPath } from "@/lib/work-packets/pdf-fill-adapter";

export type PdfOptionMappingProbe = {
  fieldName: string;
  exportValue: string;
  outputPdfPath?: string;
  note?: string;
};

export type PdfOptionProbeWriterInput = {
  templatePdfPath: string;
  outputPdfPath: string;
  fieldName: string;
  exportValue: string;
};

export type PdfOptionProbeWriterResult = {
  status: "generated" | "missing_field";
  reason?: string;
  matchedAppearanceState?: boolean;
  warnings?: string[];
};

export type PdfOptionProbeWriter = (
  input: PdfOptionProbeWriterInput,
) => Promise<PdfOptionProbeWriterResult>;

export type PdfOptionMappingProbeResult = PdfOptionMappingProbe & {
  outputPdfPath: string;
  status: "generated" | "missing_field" | "error";
  reason: string;
  matchedAppearanceState?: boolean;
  warnings?: string[];
};

export type GeneratePdfOptionMappingProbesArgs = {
  templatePdfPath: string;
  outputDirectory: string;
  probes: PdfOptionMappingProbe[];
  writeOptionProbePdf?: PdfOptionProbeWriter;
};

export class PdfOptionMappingError extends Error {
  readonly code: "missing_template" | "unsafe_output_path" | "writer_failed";

  constructor(
    message: string,
    code: "missing_template" | "unsafe_output_path" | "writer_failed",
  ) {
    super(message);
    this.name = "PdfOptionMappingError";
    this.code = code;
  }
}

export async function generatePdfOptionMappingProbes(
  args: GeneratePdfOptionMappingProbesArgs,
): Promise<PdfOptionMappingProbeResult[]> {
  if (!existsSync(args.templatePdfPath)) {
    throw new PdfOptionMappingError(
      `Template PDF not found at ${args.templatePdfPath}.`,
      "missing_template",
    );
  }

  await mkdir(args.outputDirectory, { recursive: true });
  const writer = args.writeOptionProbePdf ?? writeOptionProbeWithPypdf;
  const results: PdfOptionMappingProbeResult[] = [];
  const seen = new Set<string>();

  for (const probe of args.probes) {
    const key = `${probe.fieldName}\u0000${probe.exportValue}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    const outputPdfPath =
      probe.outputPdfPath ??
      buildPdfOptionMappingProbePath(
        args.outputDirectory,
        probe.fieldName,
        probe.exportValue,
      );
    assertLocalDevGeneratedOutputPath(outputPdfPath);

    try {
      const writerResult = await writer({
        templatePdfPath: args.templatePdfPath,
        outputPdfPath,
        fieldName: probe.fieldName,
        exportValue: probe.exportValue,
      });

      results.push({
        ...probe,
        outputPdfPath,
        status: writerResult.status,
        reason:
          writerResult.reason ??
          (writerResult.status === "generated"
            ? "Generated an isolated option probe PDF for manual visual inspection."
            : "PDF field was not found in the template."),
        matchedAppearanceState: writerResult.matchedAppearanceState,
        warnings: writerResult.warnings,
      });
    } catch (error) {
      results.push({
        ...probe,
        outputPdfPath,
        status: "error",
        reason: error instanceof Error ? error.message : "PDF option probe writer failed.",
      });
    }
  }

  return results;
}

export function buildPdfOptionMappingProbePath(
  outputDirectory: string,
  fieldName: string,
  exportValue: string,
): string {
  return path.join(
    outputDirectory,
    `${slugifyPdfOptionPart(fieldName)}-value-${slugifyPdfOptionPart(exportValue)}.pdf`,
  );
}

function slugifyPdfOptionPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "unknown";
}

async function writeOptionProbeWithPypdf(
  input: PdfOptionProbeWriterInput,
): Promise<PdfOptionProbeWriterResult> {
  const { stdout, stderr } = await runPythonOptionProbeScript(input);
  const result = JSON.parse(stdout) as PdfOptionProbeWriterResult;
  const stderrWarnings = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    ...result,
    warnings: [...(result.warnings ?? []), ...stderrWarnings],
  };
}

function runPythonOptionProbeScript(input: PdfOptionProbeWriterInput): Promise<{
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["-c", PYPDF_OPTION_PROBE_SCRIPT], {
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
        reject(new PdfOptionMappingError(
          stderr.trim() || `python3 exited with code ${code}`,
          "writer_failed",
        ));
        return;
      }

      resolve({ stdout, stderr });
    });

    child.stdin.end(JSON.stringify(input));
  });
}

const PYPDF_OPTION_PROBE_SCRIPT = String.raw`
import json
import sys
from pathlib import Path
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject

payload = json.load(sys.stdin)
template_path = Path(payload["templatePdfPath"])
output_path = Path(payload["outputPdfPath"])
field_name = str(payload["fieldName"])
export_value = str(payload["exportValue"])
selected_state = NameObject("/" + export_value.lstrip("/"))
off_state = NameObject("/Off")

reader = PdfReader(str(template_path))
writer = PdfWriter()
writer.append(reader)

try:
    writer.set_need_appearances_writer(True)
except Exception:
    pass

def iter_field_objects(objects):
    for item in objects or []:
        field = item.get_object()
        yield field
        for child in iter_field_objects(field.get("/Kids") or []):
            yield child

acro_form = writer._root_object.get("/AcroForm")
if hasattr(acro_form, "get_object"):
    acro_form = acro_form.get_object()
fields = acro_form.get("/Fields") if acro_form else []
target = None

for field in iter_field_objects(fields):
    title = field.get("/T")
    if title is not None and str(title) == field_name:
        target = field
        break

if target is None:
    print(json.dumps({
        "status": "missing_field",
        "reason": f"PDF field {field_name} was not found.",
        "matchedAppearanceState": False,
    }))
    sys.exit(0)

matched = False
targets = target.get("/Kids") or [target]

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

output_path.parent.mkdir(parents=True, exist_ok=True)
with output_path.open("wb") as handle:
    writer.write(handle)

warnings = []
if not matched:
    warnings.append(
        f"Export value {export_value} was written to {field_name}, but no matching appearance state was found."
    )

print(json.dumps({
    "status": "generated",
    "reason": "Generated an isolated option probe PDF for manual visual inspection.",
    "matchedAppearanceState": matched,
    "warnings": warnings,
}))
`;
