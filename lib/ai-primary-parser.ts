import type {
  AnalysisProfile,
  ParsedDocumentResult,
  ParsedExtractedAccount,
  ParsedExtractedAccountParty,
  ParsedExtractedContact,
  ParsedExtractedDate,
  ParsedExtractedInstitution,
  ParsedExtractedParty,
  ParsedFieldOwnership,
} from "@/lib/ai-primary-parser-types";

export type AIPrimaryStatementPayload = {
  documentTypeId: "account_statement" | null;
  detectedClient: string | null;
  detectedClient2: string | null;
  ownershipType: "single" | "joint" | null;
  metadata: {
    custodian: string | null;
    accountType: string | null;
    accountLast4: string | null;
    documentDate: string | null;
  };
  confidence: {
    documentTypeId: number | null;
    detectedClient: number | null;
    detectedClient2: number | null;
    ownershipType: number | null;
    custodian: number | null;
    accountType: number | null;
    accountLast4: number | null;
    documentDate: number | null;
  };
  rawEvidenceSummary: string | null;
  parties: AIPrimaryStatementPartyPayload[];
  institutions: AIPrimaryStatementInstitutionPayload[];
  contacts: AIPrimaryStatementContactPayload[];
  accounts: AIPrimaryStatementAccountPayload[];
  accountParties: AIPrimaryStatementAccountPartyPayload[];
  dates: AIPrimaryStatementDatePayload[];
  documentFacts: AIPrimaryStatementDocumentFactsPayload;
};

export type AIPrimaryStatementPartyPayload = {
  id: string | null;
  name: string | null;
  roles: AIPrimaryStatementPartyRole[];
  address: string | null;
};

export type AIPrimaryStatementInstitutionPayload = {
  id: string | null;
  name: string | null;
};

export type AIPrimaryStatementContactMethod =
  | "phone"
  | "website"
  | "email"
  | "other";

export type AIPrimaryStatementContactPurpose =
  | "customer_service"
  | "general_support"
  | "rollover_support"
  | "beneficiary_services"
  | "other";

export type AIPrimaryStatementContactPayload = {
  id: string | null;
  institutionId: string | null;
  method: AIPrimaryStatementContactMethod | null;
  purpose: AIPrimaryStatementContactPurpose | null;
  value: string | null;
};

export type AIPrimaryStatementValuePayload = {
  kind: string | null;
  label: string | null;
  money: {
    amount: string | null;
    currency: string | null;
  } | null;
  dateId: string | null;
};

export type AIPrimaryStatementAccountPayload = {
  id: string | null;
  institutionIds: string[];
  accountNumber: string | null;
  maskedAccountNumber: string | null;
  accountLast4: string | null;
  accountType: string | null;
  registrationType: string | null;
  values: AIPrimaryStatementValuePayload[];
};

export type AIPrimaryStatementAccountPartyPayload = {
  id: string | null;
  accountId: string | null;
  partyId: string | null;
  roles: AIPrimaryStatementPartyRole[];
};

export type AIPrimaryStatementDateKind =
  | "document_date"
  | "statement_period_start"
  | "statement_period_end"
  | "as_of_date"
  | "other";

export type AIPrimaryStatementDateScope =
  | "document"
  | "account"
  | "party"
  | "institution"
  | "accountParty";

export type AIPrimaryStatementDatePayload = {
  id: string | null;
  kind: AIPrimaryStatementDateKind | null;
  value: string | null;
  scope: AIPrimaryStatementDateScope | null;
  entityId: string | null;
};

export type AIPrimaryStatementDocumentFactsPayload = {
  entityName: string | null;
  idType: string | null;
  taxYear: string | null;
};

export type AIPrimaryStatementPartyRole = "owner" | "joint_owner" | "other";

export type AIPrimaryParseContext = {
  contentSource: "pdf_text" | "pdf_ocr" | "image_ocr" | "metadata_only";
  diagnosticText: string | null;
  file: {
    id: string;
    mimeType: string;
    name: string;
  };
  normalizedText: string;
  pdfFields: Array<{ name: string; value: string }>;
};

export type AIPrimaryParseAttempt = {
  parsedResult: ParsedDocumentResult | null;
  debug: NonNullable<ParsedDocumentResult["debug"]>;
};

type AIPrimaryCompletionRequest = {
  promptVersion: string;
  systemPrompt: string;
  userPrompt: string;
};

type AIPrimaryCompletionResponse = {
  model: string | null;
  rawText: string;
};

type AIPrimaryCompletionAdapter = (
  request: AIPrimaryCompletionRequest,
) => Promise<AIPrimaryCompletionResponse>;

const ACCOUNT_STATEMENT_AI_PROMPT_VERSION =
  "2026-04-14-account-statement-phase1-v1";
const DEFAULT_AI_PRIMARY_PARSER_API_URL =
  "https://api.openai.com/v1/chat/completions";
const DEFAULT_AI_PRIMARY_PARSER_TIMEOUT_MS = 30_000;
const DEFAULT_AI_PRIMARY_PARSER_MAX_ATTEMPTS = 2;
const ACCOUNT_STATEMENT_AI_SYSTEM_PROMPT = [
  "You map extracted document evidence into structured data from likely account statements.",
  "Return valid JSON only. No markdown fences. No commentary.",
  "If you are not confident this is an account statement, set documentTypeId to null.",
  "Never invent values. Prefer null or omission when unsure.",
  "PDF form fields are high-authority evidence. Use their field names and values to map facts into the schema.",
  "Do not override exact PDF form-field values such as account numbers, owner names, account types, or document dates unless the value is clearly unusable.",
  "Preserve the current flat Phase 1 fields and also return richer raw entities when supported by the text.",
  "Use simple stable local ids like party-1, institution-1, contact-1, account-1, date-1 when you can link related objects.",
  "detectedClient and detectedClient2 must be personal client names, not advisor or institution names.",
  "ownershipType should be joint only when the text supports two owners.",
  "accountLast4 should be only the final four digits when reasonably supported.",
  "documentDate and all date values must be YYYY-MM-DD when confidently inferable, otherwise null.",
  "Use parties, institutions, contacts, accounts, accountParties, dates, and documentFacts only when the flattened statement text supports them.",
].join(" ");
const ACCOUNT_STATEMENT_AI_RESPONSE_SCHEMA = {
  documentTypeId: "account_statement | null",
  detectedClient: "string | null",
  detectedClient2: "string | null",
  ownershipType: "single | joint | null",
  metadata: {
    custodian: "string | null",
    accountType: "string | null",
    accountLast4: "string | null",
    documentDate: "YYYY-MM-DD | null",
  },
  confidence: {
    documentTypeId: "number 0-1 | null",
    detectedClient: "number 0-1 | null",
    detectedClient2: "number 0-1 | null",
    ownershipType: "number 0-1 | null",
    custodian: "number 0-1 | null",
    accountType: "number 0-1 | null",
    accountLast4: "number 0-1 | null",
    documentDate: "number 0-1 | null",
  },
  rawEvidenceSummary: "string | null",
  parties: [
    {
      id: "string | null",
      name: "string | null",
      roles: ["owner | joint_owner | other"],
      address: "string | null",
    },
  ],
  institutions: [
    {
      id: "string | null",
      name: "string | null",
    },
  ],
  contacts: [
    {
      id: "string | null",
      institutionId: "string | null",
      method: "phone | website | email | other | null",
      purpose:
        "customer_service | general_support | rollover_support | beneficiary_services | other | null",
      value: "string | null",
    },
  ],
  accounts: [
    {
      id: "string | null",
      institutionIds: ["string"],
      accountNumber: "string | null",
      maskedAccountNumber: "string | null",
      accountLast4: "string | null",
      accountType: "string | null",
      registrationType: "string | null",
      values: [
        {
          kind: "string | null",
          label: "string | null",
          money: {
            amount: "string | null",
            currency: "string | null",
          },
          dateId: "string | null",
        },
      ],
    },
  ],
  accountParties: [
    {
      id: "string | null",
      accountId: "string | null",
      partyId: "string | null",
      roles: ["owner | joint_owner | other"],
    },
  ],
  dates: [
    {
      id: "string | null",
      kind:
        "document_date | statement_period_start | statement_period_end | as_of_date | other | null",
      value: "YYYY-MM-DD | null",
      scope: "document | account | party | institution | accountParty | null",
      entityId: "string | null",
    },
  ],
  documentFacts: {
    entityName: "string | null",
    idType: "string | null",
    taxYear: "string | null",
  },
} as const;

let testCompletionAdapter: AIPrimaryCompletionAdapter | null = null;

export function isAIAssistedAnalysisProfile(
  profile: AnalysisProfile | null | undefined,
) {
  return profile === "ai_assisted" || profile === "preview_ai_primary";
}

export function isDeterministicFallbackAnalysisProfile(
  profile: AnalysisProfile | null | undefined,
) {
  return profile === "deterministic_fallback" || profile === "legacy";
}

export function setAIPrimaryCompletionAdapterForTests(
  adapter: AIPrimaryCompletionAdapter | null,
) {
  testCompletionAdapter = adapter;
}

export function isAIPrimaryParserEnabled() {
  const raw = process.env.AI_PRIMARY_PARSER;
  if (raw !== undefined) {
    return envFlag("AI_PRIMARY_PARSER");
  }

  return Boolean(process.env.OPENAI_API_KEY);
}

export function isAIPrimaryAccountStatementOnlyEnabled() {
  const raw = process.env.AI_PRIMARY_ACCOUNT_STATEMENT_ONLY;
  if (raw === undefined) {
    return true;
  }

  return envFlag("AI_PRIMARY_ACCOUNT_STATEMENT_ONLY");
}

export function resolveAnalysisProfileForMode(
  mode: "default" | "preview" = "default",
): AnalysisProfile {
  if (
    mode === "preview" &&
    isAIPrimaryParserEnabled() &&
    isAIPrimaryAccountStatementOnlyEnabled()
  ) {
    return "ai_assisted";
  }

  return "deterministic_fallback";
}

export async function parseAccountStatementWithAI(
  context: AIPrimaryParseContext,
): Promise<AIPrimaryParseAttempt> {
  const baseDebug: NonNullable<ParsedDocumentResult["debug"]> = {
    aiEnabled: true,
    aiAttempted: false,
    aiUsed: false,
    aiFailureReason: null,
    aiModel: null,
    aiPromptVersion: ACCOUNT_STATEMENT_AI_PROMPT_VERSION,
    aiRawSummary: null,
  };

  const adapter = getCompletionAdapter();
  if (!adapter) {
    return {
      parsedResult: null,
      debug: {
        ...baseDebug,
        aiFailureReason: "AI provider is not configured.",
      },
    };
  }

  const completionRequest = buildAccountStatementAICompletionRequest(context);

  try {
    const response = await adapter(completionRequest);
    const payload = parseAccountStatementPayload(response.rawText);
    const parsedResult = buildParsedResultFromPayload(payload, response.model);

    return {
      parsedResult,
      debug: {
        ...baseDebug,
        aiAttempted: true,
        aiUsed: payload.documentTypeId === "account_statement",
        aiModel: response.model,
        aiRawSummary: payload.rawEvidenceSummary,
      },
    };
  } catch (error) {
    return {
      parsedResult: null,
      debug: {
        ...baseDebug,
        aiAttempted: true,
        aiFailureReason:
          error instanceof Error ? error.message : "AI parsing failed unexpectedly.",
      },
    };
  }
}

export function buildAccountStatementAICompletionRequest(
  context: AIPrimaryParseContext,
): AIPrimaryCompletionRequest {
  return {
    promptVersion: ACCOUNT_STATEMENT_AI_PROMPT_VERSION,
    systemPrompt: ACCOUNT_STATEMENT_AI_SYSTEM_PROMPT,
    userPrompt: JSON.stringify(
      {
        task:
          "Extract narrow account statement fields for preview parsing while also returning richer raw statement entities from the same flattened normalized text.",
        schema: ACCOUNT_STATEMENT_AI_RESPONSE_SCHEMA,
        file: context.file,
        contentSource: context.contentSource,
        pdfFields: (context.pdfFields ?? []).slice(0, 200),
        normalizedText: (context.diagnosticText ?? context.normalizedText).slice(
          0,
          14000,
        ),
      },
      null,
      2,
    ),
  };
}

function buildParsedResultFromPayload(
  payload: AIPrimaryStatementPayload,
  model: string | null,
): ParsedDocumentResult {
  return {
    values: {
      documentTypeId: payload.documentTypeId,
      detectedClient: normalizeOptionalString(payload.detectedClient),
      detectedClient2: normalizeOptionalString(payload.detectedClient2),
      ownershipType: payload.ownershipType,
      metadata: {
        custodian: normalizeOptionalString(payload.metadata.custodian),
        accountType: normalizeOptionalString(payload.metadata.accountType),
        accountLast4: normalizeOptionalString(payload.metadata.accountLast4),
        documentDate: normalizeOptionalString(payload.metadata.documentDate),
      },
    },
    extracted: {
      parties: payload.parties,
      institutions: payload.institutions,
      contacts: payload.contacts,
      accounts: payload.accounts,
      accountParties: payload.accountParties,
      dates: payload.dates,
      documentFacts: payload.documentFacts,
    },
    ownership: {
      documentTypeId: buildOwnership(
        payload.documentTypeId,
        payload.confidence.documentTypeId,
      ),
      detectedClient: buildOwnership(
        payload.detectedClient,
        payload.confidence.detectedClient,
      ),
      detectedClient2: buildOwnership(
        payload.detectedClient2,
        payload.confidence.detectedClient2,
      ),
      ownershipType: buildOwnership(
        payload.ownershipType,
        payload.confidence.ownershipType,
      ),
      custodian: buildOwnership(
        payload.metadata.custodian,
        payload.confidence.custodian,
      ),
      accountType: buildOwnership(
        payload.metadata.accountType,
        payload.confidence.accountType,
      ),
      accountLast4: buildOwnership(
        payload.metadata.accountLast4,
        payload.confidence.accountLast4,
      ),
      documentDate: buildOwnership(
        payload.metadata.documentDate,
        payload.confidence.documentDate,
      ),
    },
    debug: {
      aiEnabled: true,
      aiAttempted: true,
      aiUsed: payload.documentTypeId === "account_statement",
      aiFailureReason: null,
      aiModel: model,
      aiPromptVersion: ACCOUNT_STATEMENT_AI_PROMPT_VERSION,
      aiRawSummary: payload.rawEvidenceSummary,
    },
  };
}

function buildOwnership(
  rawValue: string | number | null | undefined,
  confidence: number | null | undefined,
): ParsedFieldOwnership | undefined {
  if (rawValue === null || rawValue === undefined || rawValue === "") {
    return undefined;
  }

  return {
    owner: "ai",
    source: "account_statement_phase1_ai",
    confidence: normalizeConfidence(confidence),
    raw: String(rawValue),
  };
}

export function parseAccountStatementPayload(
  rawText: string,
): AIPrimaryStatementPayload {
  const parsed = JSON.parse(rawText) as Partial<AIPrimaryStatementPayload>;
  const metadata = (parsed.metadata ?? {}) as Partial<
    AIPrimaryStatementPayload["metadata"]
  >;
  const confidence = (parsed.confidence ?? {}) as Partial<
    AIPrimaryStatementPayload["confidence"]
  >;

  return {
    documentTypeId:
      parsed.documentTypeId === "account_statement" ? "account_statement" : null,
    detectedClient: normalizeOptionalString(parsed.detectedClient),
    detectedClient2: normalizeOptionalString(parsed.detectedClient2),
    ownershipType:
      parsed.ownershipType === "joint" || parsed.ownershipType === "single"
        ? parsed.ownershipType
        : null,
    metadata: {
      custodian: normalizeOptionalString(metadata.custodian),
      accountType: normalizeOptionalString(metadata.accountType),
      accountLast4: normalizeOptionalString(metadata.accountLast4),
      documentDate: normalizeOptionalString(metadata.documentDate),
    },
    confidence: {
      documentTypeId: normalizeConfidence(confidence.documentTypeId),
      detectedClient: normalizeConfidence(confidence.detectedClient),
      detectedClient2: normalizeConfidence(confidence.detectedClient2),
      ownershipType: normalizeConfidence(confidence.ownershipType),
      custodian: normalizeConfidence(confidence.custodian),
      accountType: normalizeConfidence(confidence.accountType),
      accountLast4: normalizeConfidence(confidence.accountLast4),
      documentDate: normalizeConfidence(confidence.documentDate),
    },
    rawEvidenceSummary: normalizeOptionalString(parsed.rawEvidenceSummary),
    parties: normalizeStatementParties(parsed.parties),
    institutions: normalizeStatementInstitutions(parsed.institutions),
    contacts: normalizeStatementContacts(parsed.contacts),
    accounts: normalizeStatementAccounts(parsed.accounts),
    accountParties: normalizeStatementAccountParties(parsed.accountParties),
    dates: normalizeStatementDates(parsed.dates),
    documentFacts: normalizeStatementDocumentFacts(parsed.documentFacts),
  } satisfies AIPrimaryStatementPayload;
}

function getCompletionAdapter() {
  if (testCompletionAdapter) {
    return testCompletionAdapter;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.AI_PRIMARY_PARSER_MODEL;

  if (!apiKey || !model) {
    return null;
  }

  return async (request: AIPrimaryCompletionRequest) => {
    return requestAIPrimaryCompletion({
      apiKey,
      endpoint:
        process.env.AI_PRIMARY_PARSER_API_URL ??
        DEFAULT_AI_PRIMARY_PARSER_API_URL,
      model,
      request,
    });
  };
}

async function requestAIPrimaryCompletion(input: {
  apiKey: string;
  endpoint: string;
  model: string;
  request: AIPrimaryCompletionRequest;
}): Promise<AIPrimaryCompletionResponse> {
  const timeoutMs = parsePositiveInteger(
    process.env.AI_PRIMARY_PARSER_TIMEOUT_MS,
    DEFAULT_AI_PRIMARY_PARSER_TIMEOUT_MS,
  );
  const requestBody = JSON.stringify({
    model: input.model,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: input.request.systemPrompt,
      },
      {
        role: "user",
        content: input.request.userPrompt,
      },
    ],
    temperature: 0,
  });

  let lastError: Error | null = null;
  for (
    let attemptNumber = 1;
    attemptNumber <= DEFAULT_AI_PRIMARY_PARSER_MAX_ATTEMPTS;
    attemptNumber += 1
  ) {
    try {
      const response = await fetch(input.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json",
        },
        body: requestBody,
        signal:
          typeof AbortSignal !== "undefined" &&
          typeof AbortSignal.timeout === "function"
            ? AbortSignal.timeout(timeoutMs)
            : undefined,
      });

      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(
          `AI provider request failed with status ${response.status} ${response.statusText || ""} at ${input.endpoint}.${responseText.trim() ? ` Response: ${summarizeAIProviderText(responseText)}` : ""}`,
        );
      }

      const parsed = parseAIProviderResponse(responseText, input.endpoint);
      const content = parsed.choices?.[0]?.message?.content;
      const rawText = Array.isArray(content)
        ? content
            .map((part) => (typeof part?.text === "string" ? part.text : ""))
            .join("")
        : typeof content === "string"
          ? content
          : "";

      if (!rawText.trim()) {
        throw new Error("AI provider returned an empty response.");
      }

      return {
        rawText,
        model: parsed.model ?? input.model,
      };
    } catch (error) {
      const providerError = buildAIProviderRequestError(error, {
        endpoint: input.endpoint,
        promptVersion: input.request.promptVersion,
        requestBodyLength: requestBody.length,
        timeoutMs,
        attemptNumber,
        maxAttempts: DEFAULT_AI_PRIMARY_PARSER_MAX_ATTEMPTS,
      });
      lastError = providerError;

      if (
        attemptNumber < DEFAULT_AI_PRIMARY_PARSER_MAX_ATTEMPTS &&
        isRetryableAIProviderError(error)
      ) {
        await sleep(300 * attemptNumber);
        continue;
      }

      throw providerError;
    }
  }

  throw lastError ?? new Error("AI provider request failed unexpectedly.");
}

function parseAIProviderResponse(
  responseText: string,
  endpoint: string,
): {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  model?: string;
} {
  try {
    return JSON.parse(responseText) as {
      choices?: Array<{
        message?: {
          content?: string | Array<{ type?: string; text?: string }>;
        };
      }>;
      model?: string;
    };
  } catch (error) {
    throw new Error(
      `AI provider returned invalid JSON at ${endpoint}: ${summarizeAIProviderText(responseText)}${formatErrorCauseSuffix(error)}`,
    );
  }
}

function buildAIProviderRequestError(
  error: unknown,
  details: {
    endpoint: string;
    promptVersion: string;
    requestBodyLength: number;
    timeoutMs: number;
    attemptNumber: number;
    maxAttempts: number;
  },
) {
  const runtime = `node ${process.version}`;
  const summary = summarizeAIProviderTransportError(error, details.timeoutMs);
  return new Error(
    `AI provider request failed on attempt ${details.attemptNumber}/${details.maxAttempts} at ${details.endpoint} (${runtime}, prompt=${details.promptVersion}, bodyBytes=${details.requestBodyLength}): ${summary}`,
  );
}

function summarizeAIProviderTransportError(
  error: unknown,
  timeoutMs: number,
) {
  if (!(error instanceof Error)) {
    return "Unknown provider error.";
  }

  if (error.name === "AbortError") {
    return `Request timed out after ${timeoutMs}ms.`;
  }

  const causeName = readErrorDetail(error, "name");
  const causeCode = readErrorDetail(error, "code");
  const causeMessage = readErrorDetail(error, "message");
  const details = [
    error.name && error.name !== "Error" ? error.name : null,
    error.message || null,
    causeCode ? `code=${causeCode}` : null,
    causeName && causeName !== error.name ? `cause=${causeName}` : null,
    causeMessage && causeMessage !== error.message ? causeMessage : null,
  ].filter(Boolean);

  return details.join(" | ") || "Unknown provider error.";
}

function isRetryableAIProviderError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  if (error.name === "AbortError") {
    return true;
  }

  const message = [error.message, readErrorDetail(error, "message")]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();
  const code = (readErrorDetail(error, "code") ?? "").toUpperCase();

  return (
    message.includes("fetch failed") ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("socket hang up") ||
    message.includes("other side closed") ||
    [
      "ABORT_ERR",
      "ECONNRESET",
      "ECONNREFUSED",
      "EAI_AGAIN",
      "ENETUNREACH",
      "ENOTFOUND",
      "ETIMEDOUT",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_SOCKET",
    ].includes(code)
  );
}

function readErrorDetail(error: Error, key: "name" | "code" | "message") {
  const cause = "cause" in error ? error.cause : null;
  if (!cause || typeof cause !== "object" || !(key in cause)) {
    return null;
  }

  const value = (cause as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function summarizeAIProviderText(value: string, maxLength = 240) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

function formatErrorCauseSuffix(error: unknown) {
  if (!(error instanceof Error) || !error.message) {
    return "";
  }

  return ` (${error.message})`;
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

async function sleep(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function normalizeOptionalStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeOptionalString(entry))
    .filter((entry): entry is string => entry !== null);
}

function normalizeEnum<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
): T | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return allowedValues.includes(normalized as T) ? (normalized as T) : null;
}

function normalizeStatementParties(value: unknown): AIPrimaryStatementPartyPayload[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const candidate = entry as Record<string, unknown>;
      return {
        id: normalizeOptionalString(candidate.id),
        name: normalizeOptionalString(candidate.name),
        roles: normalizeStatementPartyRoles(candidate.roles),
        address: normalizeOptionalString(candidate.address),
      } satisfies AIPrimaryStatementPartyPayload;
    })
    .filter(
      (entry): entry is AIPrimaryStatementPartyPayload =>
        entry !== null && hasMeaningfulStatementParty(entry),
    );
}

function normalizeStatementInstitutions(
  value: unknown,
): AIPrimaryStatementInstitutionPayload[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const candidate = entry as Record<string, unknown>;
      return {
        id: normalizeOptionalString(candidate.id),
        name: normalizeOptionalString(candidate.name),
      } satisfies AIPrimaryStatementInstitutionPayload;
    })
    .filter(
      (entry): entry is AIPrimaryStatementInstitutionPayload =>
        entry !== null && hasMeaningfulStatementInstitution(entry),
    );
}

function normalizeStatementContacts(
  value: unknown,
): AIPrimaryStatementContactPayload[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const candidate = entry as Record<string, unknown>;
      return {
        id: normalizeOptionalString(candidate.id),
        institutionId: normalizeOptionalString(candidate.institutionId),
        method: normalizeEnum(candidate.method, [
          "phone",
          "website",
          "email",
          "other",
        ] satisfies readonly AIPrimaryStatementContactMethod[]),
        purpose: normalizeEnum(candidate.purpose, [
          "customer_service",
          "general_support",
          "rollover_support",
          "beneficiary_services",
          "other",
        ] satisfies readonly AIPrimaryStatementContactPurpose[]),
        value: normalizeOptionalString(candidate.value),
      } satisfies AIPrimaryStatementContactPayload;
    })
    .filter(
      (entry): entry is AIPrimaryStatementContactPayload =>
        entry !== null && hasMeaningfulStatementContact(entry),
    );
}

function normalizeStatementAccounts(
  value: unknown,
): AIPrimaryStatementAccountPayload[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const candidate = entry as Record<string, unknown>;
      return {
        id: normalizeOptionalString(candidate.id),
        institutionIds: normalizeOptionalStringArray(candidate.institutionIds),
        accountNumber: normalizeOptionalString(candidate.accountNumber),
        maskedAccountNumber: normalizeOptionalString(candidate.maskedAccountNumber),
        accountLast4: normalizeOptionalString(candidate.accountLast4),
        accountType: normalizeOptionalString(candidate.accountType),
        registrationType: normalizeOptionalString(candidate.registrationType),
        values: normalizeStatementAccountValues(candidate.values),
      } satisfies AIPrimaryStatementAccountPayload;
    })
    .filter(
      (entry): entry is AIPrimaryStatementAccountPayload =>
        entry !== null && hasMeaningfulStatementAccount(entry),
    );
}

function normalizeStatementAccountValues(
  value: unknown,
): AIPrimaryStatementValuePayload[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const candidate = entry as Record<string, unknown>;
      const money =
        candidate.money && typeof candidate.money === "object"
          ? normalizeStatementMoney(candidate.money as Record<string, unknown>)
          : null;

      return {
        kind: normalizeOptionalString(candidate.kind),
        label: normalizeOptionalString(candidate.label),
        money,
        dateId: normalizeOptionalString(candidate.dateId),
      } satisfies AIPrimaryStatementValuePayload;
    })
    .filter(
      (entry): entry is AIPrimaryStatementValuePayload =>
        entry !== null && hasMeaningfulStatementValue(entry),
    );
}

function normalizeStatementMoney(value: Record<string, unknown>) {
  const amount = normalizeOptionalString(value.amount);
  const currency = normalizeOptionalString(value.currency);
  if (!amount && !currency) {
    return null;
  }

  return {
    amount,
    currency,
  };
}

function normalizeStatementAccountParties(
  value: unknown,
): AIPrimaryStatementAccountPartyPayload[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const candidate = entry as Record<string, unknown>;
      return {
        id: normalizeOptionalString(candidate.id),
        accountId: normalizeOptionalString(candidate.accountId),
        partyId: normalizeOptionalString(candidate.partyId),
        roles: normalizeStatementPartyRoles(candidate.roles),
      } satisfies AIPrimaryStatementAccountPartyPayload;
    })
    .filter(
      (entry): entry is AIPrimaryStatementAccountPartyPayload =>
        entry !== null && hasMeaningfulStatementAccountParty(entry),
    );
}

function normalizeStatementPartyRoles(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) =>
      normalizeEnum(entry, [
        "owner",
        "joint_owner",
        "other",
      ] satisfies readonly AIPrimaryStatementPartyRole[]),
    )
    .filter((entry): entry is AIPrimaryStatementPartyRole => entry !== null);
}

function normalizeStatementDates(
  value: unknown,
): AIPrimaryStatementDatePayload[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const candidate = entry as Record<string, unknown>;
      return {
        id: normalizeOptionalString(candidate.id),
        kind: normalizeEnum(candidate.kind, [
          "document_date",
          "statement_period_start",
          "statement_period_end",
          "as_of_date",
          "other",
        ] satisfies readonly AIPrimaryStatementDateKind[]),
        value: normalizeOptionalISODateString(candidate.value),
        scope: normalizeEnum(candidate.scope, [
          "document",
          "account",
          "party",
          "institution",
          "accountParty",
        ] satisfies readonly AIPrimaryStatementDateScope[]),
        entityId: normalizeOptionalString(candidate.entityId),
      } satisfies AIPrimaryStatementDatePayload;
    })
    .filter(
      (entry): entry is AIPrimaryStatementDatePayload =>
        entry !== null && hasMeaningfulStatementDate(entry),
    );
}

function normalizeStatementDocumentFacts(
  value: unknown,
): AIPrimaryStatementDocumentFactsPayload {
  if (!value || typeof value !== "object") {
    return {
      entityName: null,
      idType: null,
      taxYear: null,
    };
  }

  const candidate = value as Record<string, unknown>;
  return {
    entityName: normalizeOptionalString(candidate.entityName),
    idType: normalizeOptionalString(candidate.idType),
    taxYear: normalizeOptionalTaxYear(candidate.taxYear),
  };
}

function hasMeaningfulStatementParty(value: ParsedExtractedParty) {
  return Boolean(value.id || value.name || value.address || value.roles.length > 0);
}

function hasMeaningfulStatementInstitution(value: ParsedExtractedInstitution) {
  return Boolean(value.id || value.name);
}

function hasMeaningfulStatementContact(value: ParsedExtractedContact) {
  return Boolean(
    value.id ||
      value.institutionId ||
      value.method ||
      value.purpose ||
      value.value,
  );
}

function hasMeaningfulStatementAccount(value: ParsedExtractedAccount) {
  return Boolean(
    value.id ||
      value.institutionIds.length > 0 ||
      value.accountNumber ||
      value.maskedAccountNumber ||
      value.accountLast4 ||
      value.accountType ||
      value.registrationType ||
      value.values.length > 0,
  );
}

function hasMeaningfulStatementValue(value: ParsedExtractedAccount["values"][number]) {
  return Boolean(value.kind || value.label || value.money || value.dateId);
}

function hasMeaningfulStatementAccountParty(value: ParsedExtractedAccountParty) {
  return Boolean(
    value.id || value.accountId || value.partyId || value.roles.length > 0,
  );
}

function hasMeaningfulStatementDate(value: ParsedExtractedDate) {
  return Boolean(value.id || value.kind || value.value || value.scope || value.entityId);
}

function normalizeOptionalISODateString(value: unknown) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }

  const [yearRaw, monthRaw, dayRaw] = normalized.split("-");
  const year = Number.parseInt(yearRaw, 10);
  const month = Number.parseInt(monthRaw, 10);
  const day = Number.parseInt(dayRaw, 10);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(candidate.getTime()) ||
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return normalized;
}

function normalizeOptionalTaxYear(value: unknown) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return null;
  }

  return /^\d{4}$/.test(normalized) ? normalized : null;
}

function normalizeConfidence(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  if (value < 0) {
    return 0;
  }

  if (value > 1) {
    return 1;
  }

  return value;
}

function envFlag(name: string) {
  const value = process.env[name];
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}
