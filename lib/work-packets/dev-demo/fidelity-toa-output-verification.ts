import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  JON_SMITH_FIDELITY_TOA_FILLED_OUTPUT_PATH,
} from "@/lib/work-packets/dev-demo/jon-smith-fidelity-toa";

export type JonSmithFidelityToaPdfFieldValues = Record<string, string | null | undefined>;

export type JonSmithFidelityToaVerificationIssue = {
  fieldName: string;
  expectation:
    | "filled_text"
    | "selected_option"
    | "blank";
  safeMessage: string;
};

export type JonSmithFidelityToaVerificationSummary = {
  status: "passed" | "failed";
  outputPdfPath: string;
  checked: {
    filledTextFields: string[];
    selectedOptions: Array<{
      fieldName: string;
      expectedExportValue: string;
    }>;
    blankFields: string[];
  };
  counts: {
    filledTextFieldsExpected: number;
    selectedOptionsExpected: number;
    blankFieldsExpected: number;
    issues: number;
  };
  issues: JonSmithFidelityToaVerificationIssue[];
  rawSensitiveValuesWereNotPrinted: true;
};

export class JonSmithFidelityToaVerificationError extends Error {
  readonly code: "missing_output_pdf" | "pdf_reader_failed";

  constructor(
    message: string,
    code: "missing_output_pdf" | "pdf_reader_failed",
  ) {
    super(message);
    this.name = "JonSmithFidelityToaVerificationError";
    this.code = code;
  }
}

const EXPECTED_TEXT_FIELD_VALUES: Record<string, string> = {
  AcctOwner: "Jon Smith",
  "Social Security or Taxpayer ID Number": "000126789",
  AcctNumber: "900012345",
  AcctNumber2: "234567890",
  FirmName: "Ameriprise",
  FirmAddress: "100 Ameriprise Demo Way",
  FirmCity: "Minneapolis",
  StateProvince: "MN",
  FirmZIP: "55402",
  FirmPhone: "8005550199",
  PrintAcctOwner: "Jon Smith",
};

const EXPECTED_OPTION_VALUES: Record<string, string> = {
  Type: "7",
  Type2: "7",
  Trans: "1",
};

export const JON_SMITH_FIDELITY_TOA_EXPECTED_BLANK_FIELDS = [
  "NewAcct",
  "Date MM DD YYYY",
  "AddAcctOwner",
  "AddSocial Security or Taxpayer ID Number",
  "AcctOwner2",
  "PrintAcctOwner2",
  "Other1",
  "Other2",
  "CashAmmt",
  "Security1",
  "Security2",
  "Security3",
  "Security4",
  "Security5",
  "Security6",
  "Shares1",
  "Shares2",
  "Shares3",
  "Shares4",
  "Shares5",
  "Shares6",
  "AnnuityAmmt1",
  "AnnuityDate",
  "AnnuityShares",
  "CDDate",
] as const;

export async function verifyJonSmithFidelityToaOutputPdf(
  outputPdfPath = JON_SMITH_FIDELITY_TOA_FILLED_OUTPUT_PATH,
): Promise<JonSmithFidelityToaVerificationSummary> {
  const fieldValues = await readPdfFieldValuesWithPypdf(outputPdfPath);
  return verifyJonSmithFidelityToaFieldValues(fieldValues, { outputPdfPath });
}

export async function verifyJonSmithFidelityToaOutputPdfBuffer(
  outputPdfBuffer: Buffer,
  options: {
    outputPdfPath?: string;
  } = {},
): Promise<JonSmithFidelityToaVerificationSummary> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "ria-file-ops-toa-verify-"));
  const outputPdfPath = path.join(tempDir, "filled.pdf");

  try {
    await writeFile(outputPdfPath, outputPdfBuffer);
    const fieldValues = await readPdfFieldValuesWithPypdf(outputPdfPath);

    return verifyJonSmithFidelityToaFieldValues(fieldValues, {
      outputPdfPath:
        options.outputPdfPath ?? "website-demo://jon-smith-fidelity-toa-filled.pdf",
    });
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

export function verifyJonSmithFidelityToaFieldValues(
  fieldValues: JonSmithFidelityToaPdfFieldValues,
  options: {
    outputPdfPath?: string;
  } = {},
): JonSmithFidelityToaVerificationSummary {
  const outputPdfPath = options.outputPdfPath ?? JON_SMITH_FIDELITY_TOA_FILLED_OUTPUT_PATH;
  const issues: JonSmithFidelityToaVerificationIssue[] = [];

  for (const [fieldName, expectedValue] of Object.entries(EXPECTED_TEXT_FIELD_VALUES)) {
    if (normalizeTextFieldValue(fieldValues[fieldName]) !== expectedValue) {
      issues.push({
        fieldName,
        expectation: "filled_text",
        safeMessage: `${fieldName} did not match the expected fake fixture value.`,
      });
    }
  }

  for (const [fieldName, expectedExportValue] of Object.entries(EXPECTED_OPTION_VALUES)) {
    if (normalizePdfFieldValue(fieldValues[fieldName]) !== expectedExportValue) {
      issues.push({
        fieldName,
        expectation: "selected_option",
        safeMessage: `${fieldName} did not have the expected confirmed option export value.`,
      });
    }
  }

  for (const fieldName of JON_SMITH_FIDELITY_TOA_EXPECTED_BLANK_FIELDS) {
    if (normalizePdfFieldValue(fieldValues[fieldName]) !== null) {
      issues.push({
        fieldName,
        expectation: "blank",
        safeMessage: `${fieldName} was expected to remain blank.`,
      });
    }
  }

  return {
    status: issues.length === 0 ? "passed" : "failed",
    outputPdfPath,
    checked: {
      filledTextFields: Object.keys(EXPECTED_TEXT_FIELD_VALUES),
      selectedOptions: Object.entries(EXPECTED_OPTION_VALUES).map(
        ([fieldName, expectedExportValue]) => ({
          fieldName,
          expectedExportValue,
        }),
      ),
      blankFields: [...JON_SMITH_FIDELITY_TOA_EXPECTED_BLANK_FIELDS],
    },
    counts: {
      filledTextFieldsExpected: Object.keys(EXPECTED_TEXT_FIELD_VALUES).length,
      selectedOptionsExpected: Object.keys(EXPECTED_OPTION_VALUES).length,
      blankFieldsExpected: JON_SMITH_FIDELITY_TOA_EXPECTED_BLANK_FIELDS.length,
      issues: issues.length,
    },
    issues,
    rawSensitiveValuesWereNotPrinted: true,
  };
}

export async function readPdfFieldValuesWithPypdf(
  outputPdfPath: string,
): Promise<JonSmithFidelityToaPdfFieldValues> {
  if (!existsSync(outputPdfPath)) {
    throw new JonSmithFidelityToaVerificationError(
      `Generated PDF not found at ${outputPdfPath}. Run scripts/fill-work-packets-fidelity-toa-demo.mjs first.`,
      "missing_output_pdf",
    );
  }

  const { stdout, stderr } = await runPythonReadFieldsScript(outputPdfPath);

  if (stderr.trim()) {
    throw new JonSmithFidelityToaVerificationError(
      stderr.trim(),
      "pdf_reader_failed",
    );
  }

  return JSON.parse(stdout) as JonSmithFidelityToaPdfFieldValues;
}

function normalizeTextFieldValue(value: string | null | undefined): string | null {
  const normalized = normalizePdfFieldValue(value);
  return normalized === null ? null : normalized;
}

function normalizePdfFieldValue(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  const trimmed = String(value).trim();

  if (!trimmed || trimmed === "None" || trimmed === "/Off" || trimmed === "Off") {
    return null;
  }

  return trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
}

function runPythonReadFieldsScript(outputPdfPath: string): Promise<{
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["-c", PYPDF_READ_FIELDS_SCRIPT], {
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
        reject(new JonSmithFidelityToaVerificationError(
          stderr.trim() || `python3 exited with code ${code}`,
          "pdf_reader_failed",
        ));
        return;
      }

      resolve({ stdout, stderr });
    });

    child.stdin.end(JSON.stringify({ outputPdfPath }));
  });
}

const PYPDF_READ_FIELDS_SCRIPT = String.raw`
import json
import sys
from pathlib import Path
from pypdf import PdfReader

payload = json.load(sys.stdin)
output_path = Path(payload["outputPdfPath"])
reader = PdfReader(str(output_path))
fields = reader.get_fields() or {}
values = {}

for name, field in fields.items():
    value = field.get("/V")
    values[str(name)] = None if value is None else str(value)

print(json.dumps(values, sort_keys=True))
`;
