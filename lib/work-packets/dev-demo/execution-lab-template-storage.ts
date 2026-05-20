import "server-only";

import crypto from "node:crypto";

export const EXECUTION_LAB_TEMPLATE_BUCKET = "execution-lab-templates";
export const FIDELITY_TOA_STORED_TEMPLATE_ID = "fidelity-toa";
export const FIDELITY_TOA_STORED_TEMPLATE_OBJECT_PATH =
  "templates/fidelity/toa/current/fidelity-toa-template.pdf";
export const FIDELITY_TOA_TEMPLATE_SOURCE_FIELD = "templateSource";
export const FIDELITY_TOA_UPLOAD_FIELD = "templatePdf";

const MAX_TEMPLATE_BYTES = 20 * 1024 * 1024;

export type FidelityToaTemplateSource =
  | "stored_template"
  | "upload_override";

export type FidelityToaTemplateMetadata = {
  source: FidelityToaTemplateSource;
  templateId?: typeof FIDELITY_TOA_STORED_TEMPLATE_ID;
  sha256?: string;
};

export type FidelityToaTemplateRunInput = {
  templatePdfBuffer: Buffer;
  templateMetadata: FidelityToaTemplateMetadata;
};

export type StoredExecutionLabTemplateErrorCode =
  | "stored_template_not_configured"
  | "stored_template_missing"
  | "stored_template_download_failed"
  | "stored_template_invalid_pdf"
  | "stored_template_runtime_error";

export class StoredExecutionLabTemplateError extends Error {
  readonly code: StoredExecutionLabTemplateErrorCode;
  readonly safeDiagnostic?: string;

  constructor(
    message: string,
    code: StoredExecutionLabTemplateErrorCode,
    options: {
      safeDiagnostic?: string;
    } = {},
  ) {
    super(message);
    this.name = "StoredExecutionLabTemplateError";
    this.code = code;
    this.safeDiagnostic = options.safeDiagnostic;
  }
}

type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    cache?: "no-store";
  },
) => Promise<Response>;

export async function resolveFidelityToaTemplateForWebsiteRun(input: {
  formData: FormData;
  loadStoredTemplate?: () => Promise<FidelityToaTemplateRunInput>;
}): Promise<FidelityToaTemplateRunInput> {
  const source = normalizeFidelityToaTemplateSource(
    input.formData.get(FIDELITY_TOA_TEMPLATE_SOURCE_FIELD),
  );

  if (source === "upload_override") {
    const template = input.formData.get(FIDELITY_TOA_UPLOAD_FIELD);

    if (!(template instanceof File) || template.size === 0) {
      throw new StoredExecutionLabTemplateError(
        "Upload the Fidelity TOA PDF template before running the upload override.",
        "stored_template_invalid_pdf",
      );
    }

    const templatePdfBuffer = Buffer.from(await template.arrayBuffer());
    assertStoredTemplatePdfBuffer(templatePdfBuffer);

    return {
      templatePdfBuffer,
      templateMetadata: {
        source: "upload_override",
        sha256: sha256(templatePdfBuffer),
      },
    };
  }

  const loadStoredTemplate =
    input.loadStoredTemplate ?? loadStoredFidelityToaTemplate;
  return loadStoredTemplate();
}

export async function loadStoredFidelityToaTemplate(
  options: {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: FetchLike;
  } = {},
): Promise<FidelityToaTemplateRunInput> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const supabaseUrl = env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new StoredExecutionLabTemplateError(
      "Stored Fidelity TOA template loading is not configured.",
      "stored_template_not_configured",
      {
        safeDiagnostic:
          "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the server environment.",
      },
    );
  }

  let response: Response;

  try {
    response = await fetchImpl(buildStoredTemplateDownloadUrl(supabaseUrl), {
      method: "GET",
      cache: "no-store",
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
      },
    });
  } catch (error) {
    throw new StoredExecutionLabTemplateError(
      "Stored Fidelity TOA template could not be downloaded.",
      "stored_template_runtime_error",
      { safeDiagnostic: safeDiagnosticMessage(error) },
    );
  }

  if (response.status === 404) {
    throw new StoredExecutionLabTemplateError(
      "Stored Fidelity TOA template was not found.",
      "stored_template_missing",
      { safeDiagnostic: "Supabase Storage returned HTTP 404." },
    );
  }

  if (!response.ok) {
    throw new StoredExecutionLabTemplateError(
      "Stored Fidelity TOA template download failed.",
      "stored_template_download_failed",
      { safeDiagnostic: `Supabase Storage returned HTTP ${response.status}.` },
    );
  }

  let templatePdfBuffer: Buffer;

  try {
    templatePdfBuffer = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    throw new StoredExecutionLabTemplateError(
      "Stored Fidelity TOA template response could not be read.",
      "stored_template_runtime_error",
      { safeDiagnostic: safeDiagnosticMessage(error) },
    );
  }

  try {
    assertStoredTemplatePdfBuffer(templatePdfBuffer);
  } catch (error) {
    if (error instanceof StoredExecutionLabTemplateError) {
      throw error;
    }

    throw new StoredExecutionLabTemplateError(
      "Stored Fidelity TOA template is not a valid PDF.",
      "stored_template_invalid_pdf",
      { safeDiagnostic: safeDiagnosticMessage(error) },
    );
  }

  return {
    templatePdfBuffer,
    templateMetadata: {
      source: "stored_template",
      templateId: FIDELITY_TOA_STORED_TEMPLATE_ID,
      sha256: sha256(templatePdfBuffer),
    },
  };
}

export function getStoredExecutionLabTemplateStatusForError(error: unknown) {
  if (error instanceof StoredExecutionLabTemplateError) {
    return error.code;
  }

  return null;
}

export function logStoredExecutionLabTemplateFailure(error: unknown): void {
  const status = getStoredExecutionLabTemplateStatusForError(error);

  if (!status) {
    return;
  }

  console.error("[execution-lab-template] Stored Fidelity TOA template failed", {
    status,
    errorName: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : "Unknown error",
    safeDiagnostic:
      error instanceof StoredExecutionLabTemplateError
        ? error.safeDiagnostic
        : safeDiagnosticMessage(error),
  });
}

export function normalizeFidelityToaTemplateSource(
  value: FormDataEntryValue | null,
): FidelityToaTemplateSource {
  return value === "upload_override" ? "upload_override" : "stored_template";
}

function assertStoredTemplatePdfBuffer(templatePdfBuffer: Buffer): void {
  if (templatePdfBuffer.byteLength === 0) {
    throw new StoredExecutionLabTemplateError(
      "Stored Fidelity TOA template is empty.",
      "stored_template_invalid_pdf",
    );
  }

  if (templatePdfBuffer.byteLength > MAX_TEMPLATE_BYTES) {
    throw new StoredExecutionLabTemplateError(
      "Stored Fidelity TOA template exceeds the demo size limit.",
      "stored_template_invalid_pdf",
    );
  }

  if (!templatePdfBuffer.subarray(0, 8).toString("latin1").includes("%PDF")) {
    throw new StoredExecutionLabTemplateError(
      "Stored Fidelity TOA template must be a PDF file.",
      "stored_template_invalid_pdf",
    );
  }
}

function buildStoredTemplateDownloadUrl(supabaseUrl: string) {
  return `${supabaseUrl}/storage/v1/object/${encodePathPart(
    EXECUTION_LAB_TEMPLATE_BUCKET,
  )}/${encodeObjectPath(FIDELITY_TOA_STORED_TEMPLATE_OBJECT_PATH)}`;
}

function encodeObjectPath(objectPath: string) {
  return objectPath.split("/").map(encodePathPart).join("/");
}

function encodePathPart(value: string) {
  return encodeURIComponent(value);
}

function sha256(buffer: Buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function safeDiagnosticMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Unknown error";
  }

  return error.message.split("\n").slice(0, 3).join("\n").slice(0, 500);
}
