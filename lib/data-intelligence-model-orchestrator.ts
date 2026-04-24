import type {
  DataIntelligenceAssistantRuntimeConfig,
} from "@/lib/data-intelligence-assistant-config";
import type {
  DataIntelligenceConversationState,
  DataIntelligenceConversationMessage,
} from "@/lib/data-intelligence-conversation";
import {
  type QueryAssistantDocumentFamily,
  type QueryAssistantFamilyScope,
  type QueryAssistantIntent,
  type QueryAssistantPresentationMode,
  type QueryAssistantQuestionType,
  type QueryAssistantResponseMode,
  type QueryAssistantResult,
  type QueryAssistantRetrievalPlan,
} from "@/lib/query-assistant";

type DataIntelligenceModelFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type ModelInterpretationResult = {
  retrievalPlan: QueryAssistantRetrievalPlan;
  standaloneQuestion: string | null;
};

type ModelCompositionResult = {
  answer: string | null;
  title: string | null;
  followUp: string | null;
  presentationMode: QueryAssistantPresentationMode | null;
};

export type DataIntelligenceModelStepDebug = {
  attempted: boolean;
  succeeded: boolean;
  failureReason: string | null;
  httpStatus?: number | null;
};

const MODEL_TIMEOUT_MS = 15_000;

const QUERY_ASSISTANT_INTENTS = new Set<QueryAssistantIntent>([
  "statement_existence",
  "statement_list",
  "account_identifier_lookup",
  "latest_account_snapshot",
  "latest_account_document",
  "latest_account_contact",
  "identity_document_existence",
  "latest_identity_document",
  "latest_identity_dob",
  "latest_identity_address",
  "latest_identity_expiration",
  "unexpired_driver_license_check",
]);

const DOCUMENT_FAMILIES = new Set<QueryAssistantDocumentFamily>([
  "account_statement",
  "identity_document",
  null,
]);

const FAMILY_SCOPES = new Set<QueryAssistantFamilyScope>([
  "statement",
  "bank_statement",
  "credit_card_statement",
  "identity_document",
  "driver_license",
  "state_id",
  null,
]);

const QUESTION_TYPES = new Set<QueryAssistantQuestionType>([
  "existence",
  "count_list",
  "account_identifier",
  "latest_document",
  "latest_snapshot",
  "latest_contact",
  "latest_fact",
  "status_check",
  "unsupported",
]);

const RESPONSE_MODES = new Set<QueryAssistantResponseMode>([
  "direct_answer",
  "summary_with_matches",
  "answer_with_follow_up",
  "clarifying_question",
  "bounded_failure",
]);

const ACCOUNT_TYPES = new Map<string, string>(
  [
    ["checking", "Checking"],
    ["savings", "Savings"],
    ["credit card", "Credit Card"],
    ["brokerage", "Brokerage"],
    ["roth ira", "Roth IRA"],
    ["traditional ira", "Traditional IRA"],
    ["rollover ira", "Rollover IRA"],
    ["sep ira", "SEP IRA"],
    ["simple ira", "SIMPLE IRA"],
    ["401(k)", "401(k)"],
    ["401k", "401(k)"],
    ["403(b)", "403(b)"],
    ["403b", "403(b)"],
    ["hsa", "HSA"],
    ["annuity", "Annuity"],
    ["variable annuity", "Variable Annuity"],
    ["fixed annuity", "Fixed Annuity"],
    ["fixed indexed annuity", "Fixed Indexed Annuity"],
    ["ira", "IRA"],
  ] as const,
);

const ACCOUNT_FIELD_REQUESTS = new Set<
  QueryAssistantRetrievalPlan["accountFieldRequest"]
>(["account_number", "routing_number", null]);
const CONTACT_PURPOSES = new Set<QueryAssistantRetrievalPlan["contactPurpose"]>([
  "rollover_support",
  "customer_service",
  null,
]);
const CONTACT_METHODS = new Set<QueryAssistantRetrievalPlan["contactMethod"]>([
  "phone",
  "website",
  null,
]);
const IDENTITY_KINDS = new Set<QueryAssistantRetrievalPlan["identityKind"]>([
  "driver_license",
  "state_id",
  null,
]);
const CLARIFICATION_TARGETS = new Set<
  QueryAssistantRetrievalPlan["clarificationTarget"]
>(["account_type", "identity_kind", null]);
const PRESENTATION_MODES = new Set<QueryAssistantPresentationMode>([
  "concise_answer",
  "concise_answer_with_source",
  "summary_answer",
  "ambiguity_prompt",
  "not_found",
  "unsupported",
]);

const VALUE_PREFERENCES = new Set([
  "market_value",
  "ending_balance",
  "available_balance",
  "current_balance",
  "cash_value",
  "vested_balance",
  "loan_balance",
  "beginning_balance",
  "contribution_balance",
  "other",
  null,
]);

export async function interpretDataIntelligenceQuestionWithModel(input: {
  question: string;
  history: DataIntelligenceConversationMessage[];
  conversationState: DataIntelligenceConversationState | null;
  fallbackPlan: QueryAssistantRetrievalPlan;
  config: DataIntelligenceAssistantRuntimeConfig;
  fetchImpl?: DataIntelligenceModelFetch;
  debug?: DataIntelligenceModelStepDebug;
}): Promise<ModelInterpretationResult | null> {
  markStepAttempted(input.debug);
  const payload = await requestModelJson({
    config: input.config,
    fetchImpl: input.fetchImpl,
    debug: input.debug,
    messages: [
      {
        role: "system",
        content: buildInterpretationSystemPrompt(),
      },
      {
        role: "user",
        content: JSON.stringify({
          currentQuestion: input.question,
          recentHistory: input.history,
          structuredConversationState: input.conversationState,
          deterministicFallbackPlan: input.fallbackPlan,
        }),
      },
    ],
  });

  const parsed = parseInterpretationPayload(payload, input.fallbackPlan);
  if (parsed) {
    markStepSucceeded(input.debug);
  } else if (input.debug?.attempted && !input.debug.failureReason) {
    input.debug.failureReason = "invalid_structured_output";
  }

  return parsed;
}

export async function composeDataIntelligenceAnswerWithModel(input: {
  question: string;
  history: DataIntelligenceConversationMessage[];
  result: QueryAssistantResult;
  config: DataIntelligenceAssistantRuntimeConfig;
  fetchImpl?: DataIntelligenceModelFetch;
  debug?: DataIntelligenceModelStepDebug;
}): Promise<ModelCompositionResult | null> {
  markStepAttempted(input.debug);
  const payload = await requestModelJson({
    config: input.config,
    fetchImpl: input.fetchImpl,
    debug: input.debug,
    messages: [
      {
        role: "system",
        content: buildCompositionSystemPrompt(),
      },
      {
        role: "user",
        content: JSON.stringify({
          currentQuestion: input.question,
          recentHistory: input.history,
          deterministicResult: sanitizeResultForComposition(input.result),
        }),
      },
    ],
  });
  const composition = parseCompositionPayload(payload);
  if (!composition) {
    if (input.debug?.attempted && !input.debug.failureReason) {
      input.debug.failureReason = "invalid_structured_output";
    }
    return null;
  }

  if (violatesSensitiveAccountNumberPolicy(composition, input.result)) {
    if (input.debug) {
      input.debug.failureReason = "sensitive_account_number_policy";
    }
    return null;
  }

  markStepSucceeded(input.debug);
  return composition;
}

export function applyDataIntelligenceComposition(
  result: QueryAssistantResult,
  composition: ModelCompositionResult | null,
): QueryAssistantResult {
  if (!composition) {
    return result;
  }

  return {
    ...result,
    title: composition.title ?? result.title,
    answer: composition.answer ?? result.answer,
    presentation: {
      ...result.presentation,
      mode: composition.presentationMode ?? result.presentation.mode,
      followUp: composition.followUp ?? result.presentation.followUp,
    },
  };
}

function buildInterpretationSystemPrompt() {
  return [
    "You interpret Data Intelligence questions for a deterministic RIA document retrieval system.",
    "Return valid JSON only. Do not answer the user.",
    "The model must not query data, invent facts, or choose sources.",
    "Use structuredConversationState first, then recentHistory, to resolve follow-up references like 'that one', 'what about checking', or 'the latest one'.",
    "When safe, inherit activeClientName from structuredConversationState for follow-ups that omit the full client name.",
    "Keep activeClientName in scope across turns until the user clearly introduces a different client/entity.",
    "If the user asks a client-scoped question without naming a client, use activeClientName when structuredConversationState provides one.",
    "If the user clearly introduces a new client/entity, do not force the old activeClientName into standaloneQuestion.",
    "Treat 'what about X?' as a refinement of the prior family/question type when structuredConversationState shows a recent statement or identity-document result.",
    "Treat 'that one', 'that statement', and 'the latest one' as references to lastPrimarySource only when the current question clearly asks about that prior result.",
    "For statement follow-ups, prefer activeStatementSource as the current statement/document and alternateStatementSources for phrases like 'the other bank statement'.",
    "When the user asks 'the savings statement' or 'the checking statement', use the matching statement source/accountType from structuredConversationState when present.",
    "When the user says 'what about on X' after asking for an account value, keep lastRequestedField=value unless the new question asks for a different field.",
    "If structuredConversationState includes lastPrimarySource with institutionName/accountType/accountLast4, include those cues in standaloneQuestion when they help disambiguate.",
    "Return this exact shape:",
    JSON.stringify({
      standaloneQuestion: "string|null",
      retrievalPlan: {
        intent: Array.from(QUERY_ASSISTANT_INTENTS),
        documentFamily: ["account_statement", "identity_document", null],
        questionType: Array.from(QUESTION_TYPES),
        familyScope: ["statement", "bank_statement", "credit_card_statement", "identity_document", "driver_license", "state_id", null],
        accountType: ["Checking", "Savings", "Credit Card", "Brokerage", "Roth IRA", "Traditional IRA", "Rollover IRA", "SEP IRA", "SIMPLE IRA", "401(k)", "403(b)", "HSA", "Annuity", null],
        accountFieldRequest: ["account_number", "routing_number", null],
        contactPurpose: ["rollover_support", "customer_service", null],
        contactMethod: ["phone", "website", null],
        identityKind: ["driver_license", "state_id", null],
        valuePreference: ["market_value", "ending_balance", "available_balance", "current_balance", "cash_value", "vested_balance", "loan_balance", "beginning_balance", "contribution_balance", "other", null],
        clarificationTarget: ["account_type", "identity_kind", null],
        preferredResponseMode: Array.from(RESPONSE_MODES),
      },
    }),
    "Prefer null over guessing. If unsupported, set intent to null is not allowed; instead follow the deterministicFallbackPlan when possible.",
  ].join("\n");
}

function buildCompositionSystemPrompt() {
  return [
    "You rewrite deterministic Data Intelligence retrieval results into concise, natural answers.",
    "Return valid JSON only.",
    "Do not add facts that are not present in deterministicResult.",
    "Do not change status, intent, sources, source metadata, account-number policy, ambiguity, or not-found outcomes.",
    "Keep the answer short and operational.",
    "Return this exact shape:",
    JSON.stringify({
      answer: "string|null",
      title: "string|null",
      followUp: "string|null",
      presentationMode: ["concise_answer", "concise_answer_with_source", "summary_answer", "ambiguity_prompt", "not_found", "unsupported", null],
    }),
  ].join("\n");
}

async function requestModelJson(input: {
  config: DataIntelligenceAssistantRuntimeConfig;
  messages: Array<{ role: "system" | "user"; content: string }>;
  fetchImpl?: DataIntelligenceModelFetch;
  debug?: DataIntelligenceModelStepDebug;
}) {
  if (
    !input.config.aiEnabled ||
    !input.config.providerConfigured ||
    !input.config.apiKey ||
    !input.config.model
  ) {
    if (input.debug) {
      input.debug.failureReason = !input.config.aiEnabled
        ? "ai_disabled"
        : "provider_not_configured";
    }
    return null;
  }

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), MODEL_TIMEOUT_MS);
  const fetchImpl = input.fetchImpl ?? globalThis.fetch.bind(globalThis);

  try {
    const response = await fetchImpl(input.config.apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.config.model,
        messages: input.messages,
        response_format: { type: "json_object" },
        temperature: 0,
      }),
      signal: abortController.signal,
    });

    if (!response.ok) {
      if (input.debug) {
        input.debug.httpStatus = response.status;
        input.debug.failureReason = `http_${response.status}`;
      }
      return null;
    }

    const responsePayload = (await response.json()) as unknown;
    const content = readModelContent(responsePayload);
    if (!content) {
      if (input.debug) {
        input.debug.failureReason = "missing_model_content";
      }
      return null;
    }

    const parsed = safeParseObject(content);
    if (!parsed && input.debug) {
      input.debug.failureReason = "invalid_json";
    }
    return parsed;
  } catch {
    if (input.debug) {
      input.debug.failureReason = "request_failed";
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function markStepAttempted(debug: DataIntelligenceModelStepDebug | undefined) {
  if (!debug) {
    return;
  }

  debug.attempted = true;
}

function markStepSucceeded(debug: DataIntelligenceModelStepDebug | undefined) {
  if (!debug) {
    return;
  }

  debug.succeeded = true;
  debug.failureReason = null;
}

function readModelContent(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const choices = (value as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) {
    return null;
  }

  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== "object") {
    return null;
  }

  const message = (firstChoice as { message?: unknown }).message;
  if (!message || typeof message !== "object") {
    return null;
  }

  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

function safeParseObject(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseInterpretationPayload(
  value: Record<string, unknown> | null,
  fallbackPlan: QueryAssistantRetrievalPlan,
): ModelInterpretationResult | null {
  if (!value) {
    return null;
  }

  const rawPlan = readObject(value.retrievalPlan);
  if (!rawPlan) {
    return null;
  }

  const intent = readEnum(rawPlan.intent, QUERY_ASSISTANT_INTENTS);
  if (!intent) {
    return null;
  }

  const plan: QueryAssistantRetrievalPlan = {
    intent,
    documentFamily:
      readEnum(rawPlan.documentFamily, DOCUMENT_FAMILIES) ??
      fallbackPlan.documentFamily,
    questionType:
      readEnum(rawPlan.questionType, QUESTION_TYPES) ?? fallbackPlan.questionType,
    familyScope:
      readEnum(rawPlan.familyScope, FAMILY_SCOPES) ?? fallbackPlan.familyScope,
    accountType:
      normalizeAccountType(rawPlan.accountType) ?? fallbackPlan.accountType,
    accountFieldRequest:
      readEnum(rawPlan.accountFieldRequest, ACCOUNT_FIELD_REQUESTS) ??
      fallbackPlan.accountFieldRequest,
    contactPurpose:
      readEnum(rawPlan.contactPurpose, CONTACT_PURPOSES) ??
      fallbackPlan.contactPurpose,
    contactMethod:
      readEnum(rawPlan.contactMethod, CONTACT_METHODS) ??
      fallbackPlan.contactMethod,
    identityKind:
      readEnum(rawPlan.identityKind, IDENTITY_KINDS) ?? fallbackPlan.identityKind,
    valuePreference:
      readEnum(rawPlan.valuePreference, VALUE_PREFERENCES) ??
      fallbackPlan.valuePreference,
    clarificationTarget:
      readEnum(rawPlan.clarificationTarget, CLARIFICATION_TARGETS) ??
      fallbackPlan.clarificationTarget,
    preferredResponseMode:
      readEnum(rawPlan.preferredResponseMode, RESPONSE_MODES) ??
      fallbackPlan.preferredResponseMode,
  };

  return {
    retrievalPlan: plan,
    standaloneQuestion: readBoundedString(value.standaloneQuestion, 500),
  };
}

function parseCompositionPayload(
  value: Record<string, unknown> | null,
): ModelCompositionResult | null {
  if (!value) {
    return null;
  }

  const answer = readBoundedString(value.answer, 1_000);
  const title = readBoundedString(value.title, 160);
  const followUp = readBoundedString(value.followUp, 300);
  const presentationMode = readEnum(value.presentationMode, PRESENTATION_MODES);

  if (!answer && !title && !followUp && !presentationMode) {
    return null;
  }

  return {
    answer,
    title,
    followUp,
    presentationMode,
  };
}

function sanitizeResultForComposition(result: QueryAssistantResult): QueryAssistantResult {
  return {
    ...result,
    sources: result.sources.map((source) => ({
      ...source,
      accountNumber:
        result.intent === "account_identifier_lookup"
          ? source.accountNumber ?? null
          : null,
    })),
  };
}

function violatesSensitiveAccountNumberPolicy(
  composition: ModelCompositionResult,
  deterministicResult: QueryAssistantResult,
) {
  if (deterministicResult.intent === "account_identifier_lookup") {
    return false;
  }

  const candidateText = [
    composition.answer,
    composition.title,
    composition.followUp,
  ].join("\n");

  return deterministicResult.sources.some((source) => {
    const accountNumber = source.accountNumber?.trim();
    return Boolean(
      accountNumber &&
        !deterministicResult.answer.includes(accountNumber) &&
        candidateText.includes(accountNumber),
    );
  });
}

function readObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readEnum<T extends string | null>(
  value: unknown,
  allowedValues: Set<T>,
) {
  return allowedValues.has(value as T) ? (value as T) : null;
}

function readBoundedString(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function normalizeAccountType(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.toLowerCase().replace(/\s+/g, " ").trim();
  return ACCOUNT_TYPES.get(normalized) ?? null;
}
