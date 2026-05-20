import "server-only";

import crypto from "node:crypto";
import {
  buildExecutionReviewViewModelFromArtifact,
  type ExecutionReviewViewModel,
} from "@/lib/work-packets/dev-demo/fidelity-toa-execution-review-view-model";
import {
  buildJonSmithFidelityToaReviewArtifact,
  assertJonSmithFidelityToaReviewArtifactIsSafe,
  type JonSmithFidelityToaReviewArtifact,
} from "@/lib/work-packets/dev-demo/fidelity-toa-review-artifact";
import {
  JonSmithFidelityToaVerificationError,
  verifyJonSmithFidelityToaOutputPdfBufferWithPdfLib,
} from "@/lib/work-packets/dev-demo/fidelity-toa-output-verification";
import {
  JON_SMITH_FIDELITY_TOA_TASK,
  buildJonSmithFidelityToaDemo,
  resolveJonSmithFidelityToaFakeValue,
} from "@/lib/work-packets/dev-demo/jon-smith-fidelity-toa";
import {
  fillPdfBufferFromCompletionPlan,
  PdfFillAdapterError,
  type PdfFillAdapterResult,
  writeFieldsToPdfBufferWithPdfLib,
} from "@/lib/work-packets/pdf-fill-adapter";
import type { FidelityToaTemplateMetadata } from "./execution-lab-template-storage";

export const WEBSITE_FIDELITY_TOA_DEMO_ARTIFACT_ID =
  "jon-smith-fidelity-toa";
export const WEBSITE_FIDELITY_TOA_DEMO_TEMPLATE_LABEL =
  "uploaded://fidelity-toa-template.pdf";
export const WEBSITE_FIDELITY_TOA_STORED_TEMPLATE_LABEL =
  "stored-template://fidelity-toa";
export const WEBSITE_FIDELITY_TOA_DEMO_REVIEW_JSON_REF =
  "temporary-demo://jon-smith-fidelity-toa-execution-review.json";
export const WEBSITE_FIDELITY_TOA_DEMO_PDF_ROUTE =
  `/dev/execution-lab/fidelity-toa/pdf/${WEBSITE_FIDELITY_TOA_DEMO_ARTIFACT_ID}`;

const MAX_TEMPLATE_BYTES = 20 * 1024 * 1024;
const STORE_TTL_MS = 1000 * 60 * 60 * 2;
const STORE_GLOBAL_KEY = "__riaFileOpsWebsiteFidelityToaDemoStore";

export type WebsiteFidelityToaDemoArtifactSummary = {
  id: typeof WEBSITE_FIDELITY_TOA_DEMO_ARTIFACT_ID;
  label: string;
  title: string;
  artifactPath: string;
  generatedPdfPath: string;
  openPdfHref: string;
  downloadPdfHref: string;
  status: JonSmithFidelityToaReviewArtifact["metadata"]["status"];
  createdAt: string;
  storage: "temporary_server_memory";
  templateSource:
    | JonSmithFidelityToaReviewArtifact["metadata"]["templateSource"]
    | undefined;
  templateId: string | undefined;
  templateSha256: string | undefined;
};

export type WebsiteFidelityToaDemoRunResult = {
  artifact: WebsiteFidelityToaDemoArtifactSummary;
  viewModel: ExecutionReviewViewModel;
  verificationStatus: "passed" | "failed";
  filledFieldCount: number;
  selectedOptionCount: number;
  skippedFieldCount: number;
  errorCount: number;
};

type StoredWebsiteFidelityToaDemoArtifact = {
  ownerEmail: string;
  artifact: JonSmithFidelityToaReviewArtifact;
  outputPdfBuffer: Buffer;
  createdAt: string;
  expiresAt: number;
  templateSha256: string;
};

type Store = Map<string, StoredWebsiteFidelityToaDemoArtifact>;

export type WebsiteFidelityToaDemoErrorCode =
  | "missing_template"
  | "invalid_template"
  | "pdf_fill_runtime_unavailable"
  | "pdf_fill_failed"
  | "pdf_verify_runtime_unavailable"
  | "pdf_verify_failed"
  | "unsafe_artifact_id"
  | "unknown_artifact_id"
  | "missing_artifact"
  | "unsafe_artifact";

export class WebsiteFidelityToaDemoError extends Error {
  readonly code: WebsiteFidelityToaDemoErrorCode;
  readonly safeDiagnostic?: string;

  constructor(
    message: string,
    code: WebsiteFidelityToaDemoErrorCode,
    options: {
      safeDiagnostic?: string;
    } = {},
  ) {
    super(message);
    this.name = "WebsiteFidelityToaDemoError";
    this.code = code;
    this.safeDiagnostic = options.safeDiagnostic;
  }
}

export async function runWebsiteJonSmithFidelityToaDemo(input: {
  ownerEmail: string;
  templatePdfBuffer: Buffer;
  templateFileName?: string;
  templateMetadata?: FidelityToaTemplateMetadata;
  createdAt?: string;
}): Promise<WebsiteFidelityToaDemoRunResult> {
  assertValidTemplatePdfBuffer(input.templatePdfBuffer);

  const createdAt = input.createdAt ?? new Date().toISOString();
  const templateSha256 = input.templateMetadata?.sha256 ?? sha256(input.templatePdfBuffer);
  const templateSource = input.templateMetadata?.source ?? "upload_override";
  const demo = buildJonSmithFidelityToaDemo({ createdAt });
  let fillResult: Awaited<ReturnType<typeof fillPdfBufferFromCompletionPlan>>;

  try {
    fillResult = await fillPdfBufferFromCompletionPlan({
      templatePdfBuffer: input.templatePdfBuffer,
      completionPlan: demo.completionPlan,
      valueRefs: demo.valueRefs,
      writeFieldsToPdfBuffer: writeFieldsToPdfBufferWithPdfLib,
      resolveValue: (valueRef) => {
        const resolved = resolveJonSmithFidelityToaFakeValue(valueRef.valueRefId);

        if (resolved.status !== "resolved") {
          return {
            status: "not_found",
            reason: resolved.reason,
          };
        }

        return {
          status: "resolved",
          rawValue: resolved.rawValue,
          maskedPreview: resolved.maskedPreview,
        };
      },
    });
  } catch (error) {
    throw classifyWebsiteFidelityToaDemoRuntimeError(error, "fill");
  }

  const generatedOutputPdfPath = WEBSITE_FIDELITY_TOA_DEMO_PDF_ROUTE;
  let verificationSummary: Awaited<
    ReturnType<typeof verifyJonSmithFidelityToaOutputPdfBufferWithPdfLib>
  >;

  try {
    verificationSummary = await verifyJonSmithFidelityToaOutputPdfBufferWithPdfLib(
      fillResult.outputPdfBuffer,
      { outputPdfPath: generatedOutputPdfPath },
    );
  } catch (error) {
    throw classifyWebsiteFidelityToaDemoRuntimeError(error, "verify");
  }

  const artifact = buildJonSmithFidelityToaReviewArtifact({
    demo,
    fillResult: {
      outputPdfPath: generatedOutputPdfPath,
      trace: fillResult.trace,
      filledFieldCount: fillResult.filledFieldCount,
      skippedFieldCount: fillResult.skippedFieldCount,
      errorCount: fillResult.errorCount,
    } satisfies PdfFillAdapterResult,
    verificationSummary,
    templatePath:
      templateSource === "stored_template"
        ? WEBSITE_FIDELITY_TOA_STORED_TEMPLATE_LABEL
        : WEBSITE_FIDELITY_TOA_DEMO_TEMPLATE_LABEL,
    templateDocumentId:
      templateSource === "stored_template"
        ? "stored_demo_pdf_template_fidelity_toa"
        : "uploaded_demo_pdf_template_fidelity_toa",
    templateSource,
    templateId: input.templateMetadata?.templateId,
    templateSha256,
    generatedOutputPdfPath,
    createdAt,
  });
  const viewModel = buildExecutionReviewViewModelFromArtifact(artifact, {
    reviewJsonPath: WEBSITE_FIDELITY_TOA_DEMO_REVIEW_JSON_REF,
  });

  assertWebsiteFidelityToaDemoOutputIsSafe({
    artifact,
    viewModel,
    summary: verificationSummary,
  });

  storeWebsiteFidelityToaDemoArtifact({
    ownerEmail: input.ownerEmail,
    artifact,
    outputPdfBuffer: fillResult.outputPdfBuffer,
    createdAt,
    expiresAt: Date.now() + STORE_TTL_MS,
    templateSha256,
  });

  return {
    artifact: summarizeWebsiteArtifact(artifact),
    viewModel,
    verificationStatus: verificationSummary.status,
    filledFieldCount: fillResult.filledFieldCount,
    selectedOptionCount: fillResult.trace.filter(
      (entry) => entry.status === "filled" && entry.selectedOption,
    ).length,
    skippedFieldCount: fillResult.skippedFieldCount,
    errorCount: fillResult.errorCount,
  };
}

export function classifyWebsiteFidelityToaDemoRuntimeError(
  error: unknown,
  stage: "fill" | "verify",
): WebsiteFidelityToaDemoError {
  const safeDiagnostic = safeDiagnosticMessage(error);
  const runtimeUnavailable = isPdfPythonRuntimeUnavailable(error);

  if (stage === "fill") {
    return new WebsiteFidelityToaDemoError(
      runtimeUnavailable
        ? "The PDF fill runtime is unavailable in this environment."
        : "The uploaded PDF could not be filled by the demo PDF writer.",
      runtimeUnavailable ? "pdf_fill_runtime_unavailable" : "pdf_fill_failed",
      { safeDiagnostic },
    );
  }

  return new WebsiteFidelityToaDemoError(
    runtimeUnavailable
      ? "The PDF verification runtime is unavailable in this environment."
      : "The filled PDF could not be verified by the demo PDF reader.",
    runtimeUnavailable ? "pdf_verify_runtime_unavailable" : "pdf_verify_failed",
    { safeDiagnostic },
  );
}

export function getWebsiteFidelityToaDemoStatusForError(error: unknown) {
  if (error instanceof WebsiteFidelityToaDemoError) {
    return error.code;
  }

  return "run_failed";
}

export function logWebsiteFidelityToaDemoRunFailure(error: unknown): void {
  const status = getWebsiteFidelityToaDemoStatusForError(error);

  console.error("[execution-lab-demo] Jon Smith Fidelity TOA run failed", {
    status,
    errorName: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : "Unknown error",
    safeDiagnostic:
      error instanceof WebsiteFidelityToaDemoError
        ? error.safeDiagnostic
        : safeDiagnosticMessage(error),
  });
}

export function listWebsiteFidelityToaDemoArtifacts(input: {
  ownerEmail: string;
}): WebsiteFidelityToaDemoArtifactSummary[] {
  pruneExpiredWebsiteDemoArtifacts();

  const stored = readStoredWebsiteArtifact(input.ownerEmail);
  return stored ? [summarizeWebsiteArtifact(stored.artifact)] : [];
}

export function loadWebsiteFidelityToaDemoViewModelById(input: {
  ownerEmail: string;
  id: string | string[] | undefined;
}): {
  artifact: WebsiteFidelityToaDemoArtifactSummary;
  viewModel: ExecutionReviewViewModel;
} {
  const id = normalizeWebsiteFidelityToaDemoArtifactId(input.id);
  const stored = readStoredWebsiteArtifact(input.ownerEmail, id);

  if (!stored) {
    throw new WebsiteFidelityToaDemoError(
      "Temporary website demo artifact was not found. Upload the Fidelity TOA template and run the demo again.",
      "missing_artifact",
    );
  }

  const viewModel = buildExecutionReviewViewModelFromArtifact(stored.artifact, {
    reviewJsonPath: WEBSITE_FIDELITY_TOA_DEMO_REVIEW_JSON_REF,
  });

  return {
    artifact: summarizeWebsiteArtifact(stored.artifact),
    viewModel,
  };
}

export function readWebsiteFidelityToaDemoPdf(input: {
  ownerEmail: string;
  id: string | string[] | undefined;
}): {
  artifact: WebsiteFidelityToaDemoArtifactSummary;
  buffer: Buffer;
} {
  const id = normalizeWebsiteFidelityToaDemoArtifactId(input.id);
  const stored = readStoredWebsiteArtifact(input.ownerEmail, id);

  if (!stored) {
    throw new WebsiteFidelityToaDemoError(
      "Temporary website demo PDF was not found.",
      "missing_artifact",
    );
  }

  return {
    artifact: summarizeWebsiteArtifact(stored.artifact),
    buffer: stored.outputPdfBuffer,
  };
}

export function normalizeWebsiteFidelityToaDemoArtifactId(
  value: string | string[] | undefined,
): typeof WEBSITE_FIDELITY_TOA_DEMO_ARTIFACT_ID {
  const selected = Array.isArray(value) ? value[0] : value;
  const id = selected?.trim() || WEBSITE_FIDELITY_TOA_DEMO_ARTIFACT_ID;

  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new WebsiteFidelityToaDemoError(
      "Website demo artifact id must be a stable id, not a path.",
      "unsafe_artifact_id",
    );
  }

  if (id !== WEBSITE_FIDELITY_TOA_DEMO_ARTIFACT_ID) {
    throw new WebsiteFidelityToaDemoError(
      "Unknown website demo artifact id.",
      "unknown_artifact_id",
    );
  }

  return WEBSITE_FIDELITY_TOA_DEMO_ARTIFACT_ID;
}

export function assertValidTemplatePdfBuffer(templatePdfBuffer: Buffer): void {
  if (templatePdfBuffer.byteLength === 0) {
    throw new WebsiteFidelityToaDemoError(
      "Upload the Fidelity TOA PDF template before running the demo.",
      "missing_template",
    );
  }

  if (templatePdfBuffer.byteLength > MAX_TEMPLATE_BYTES) {
    throw new WebsiteFidelityToaDemoError(
      "The uploaded PDF template is too large for this dev-only demo.",
      "invalid_template",
    );
  }

  if (!templatePdfBuffer.subarray(0, 8).toString("latin1").includes("%PDF")) {
    throw new WebsiteFidelityToaDemoError(
      "The uploaded template must be a PDF file.",
      "invalid_template",
    );
  }
}

export function assertWebsiteFidelityToaDemoOutputIsSafe(value: unknown): void {
  const serialized = JSON.stringify(value);

  if (
    /\b000126789\b/.test(serialized) ||
    /\b900012345\b/.test(serialized) ||
    /\b234567890\b/.test(serialized) ||
    /\b8005550199\b/.test(serialized) ||
    /\b6175550184\b/.test(serialized) ||
    /\b\d{3}-\d{2}-\d{4}\b/.test(serialized) ||
    /jon\.smith@example\.test/i.test(serialized) ||
    /123 Demo Lane/i.test(serialized) ||
    /100 Ameriprise Demo Way/i.test(serialized) ||
    /\bMinneapolis\b/i.test(serialized) ||
    /\b55402\b/.test(serialized)
  ) {
    throw new WebsiteFidelityToaDemoError(
      "Website demo output included raw fake sensitive values.",
      "unsafe_artifact",
    );
  }
}

function storeWebsiteFidelityToaDemoArtifact(
  artifact: StoredWebsiteFidelityToaDemoArtifact,
): void {
  const store = getStore();
  pruneExpiredWebsiteDemoArtifacts();
  store.set(storeKey(artifact.ownerEmail), artifact);
}

function readStoredWebsiteArtifact(
  ownerEmail: string,
  id = WEBSITE_FIDELITY_TOA_DEMO_ARTIFACT_ID,
): StoredWebsiteFidelityToaDemoArtifact | null {
  normalizeWebsiteFidelityToaDemoArtifactId(id);
  pruneExpiredWebsiteDemoArtifacts();

  const stored = getStore().get(storeKey(ownerEmail));
  if (!stored) {
    return null;
  }

  assertJonSmithFidelityToaReviewArtifactIsSafe(stored.artifact);
  return stored;
}

function summarizeWebsiteArtifact(
  artifact: JonSmithFidelityToaReviewArtifact,
): WebsiteFidelityToaDemoArtifactSummary {
  assertJonSmithFidelityToaReviewArtifactIsSafe(artifact);

  return {
    id: WEBSITE_FIDELITY_TOA_DEMO_ARTIFACT_ID,
    label: "Jon Smith Fidelity TOA",
    title: "Jon Smith Fidelity TOA execution review",
    artifactPath: WEBSITE_FIDELITY_TOA_DEMO_REVIEW_JSON_REF,
    generatedPdfPath: artifact.metadata.generatedOutputPdfPath,
    openPdfHref: WEBSITE_FIDELITY_TOA_DEMO_PDF_ROUTE,
    downloadPdfHref: `${WEBSITE_FIDELITY_TOA_DEMO_PDF_ROUTE}?download=1`,
    status: artifact.metadata.status,
    createdAt: artifact.metadata.createdAt,
    storage: "temporary_server_memory",
    templateSource: artifact.metadata.templateSource,
    templateId: artifact.metadata.templateId,
    templateSha256: artifact.metadata.templateSha256,
  };
}

function pruneExpiredWebsiteDemoArtifacts(): void {
  const now = Date.now();

  for (const [key, artifact] of getStore()) {
    if (artifact.expiresAt <= now) {
      getStore().delete(key);
    }
  }
}

function getStore(): Store {
  const globalWithStore = globalThis as typeof globalThis & {
    [STORE_GLOBAL_KEY]?: Store;
  };

  if (!globalWithStore[STORE_GLOBAL_KEY]) {
    globalWithStore[STORE_GLOBAL_KEY] = new Map();
  }

  return globalWithStore[STORE_GLOBAL_KEY];
}

function storeKey(ownerEmail: string) {
  return `${ownerEmail.trim().toLowerCase()}:${WEBSITE_FIDELITY_TOA_DEMO_ARTIFACT_ID}`;
}

function sha256(buffer: Buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function isPdfPythonRuntimeUnavailable(error: unknown): boolean {
  if (
    error instanceof PdfFillAdapterError &&
    error.code === "writer_failed" &&
    isPythonRuntimeDiagnostic(error.message)
  ) {
    return true;
  }

  if (
    error instanceof JonSmithFidelityToaVerificationError &&
    error.code === "pdf_reader_failed" &&
    isPythonRuntimeDiagnostic(error.message)
  ) {
    return true;
  }

  return false;
}

function isPythonRuntimeDiagnostic(message: string): boolean {
  return (
    /ModuleNotFoundError:\s+No module named ['"]pypdf['"]/.test(message) ||
    /\bspawn python3 ENOENT\b/.test(message) ||
    /\bpython3 exited with code 127\b/.test(message)
  );
}

function safeDiagnosticMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Unknown error";
  }

  return error.message.split("\n").slice(0, 6).join("\n").slice(0, 1000);
}

export const WEBSITE_FIDELITY_TOA_DEMO_TASK = JON_SMITH_FIDELITY_TOA_TASK;
