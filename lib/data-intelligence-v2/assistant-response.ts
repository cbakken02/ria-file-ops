import {
  assertNoUnsafeModelContent,
  containsUnsafeSensitivePattern,
  sanitizeTextForModel,
} from "@/lib/data-intelligence-v2/safe-memory";
import type {
  ModelSafeRevealCard,
  SafeConversationState,
  V2MissingDataItem,
  V2SourceRef,
  V2ToolResult,
} from "@/lib/data-intelligence-v2/types";

export type V2AssistantResponseType =
  | "task_assist"
  | "client_data_answer"
  | "missing_data"
  | "clarification_needed"
  | "general_guidance"
  | "error";

export type V2DraftNote = {
  audience: "advisor" | "client" | "internal";
  bodyMarkdown: string;
  containsSensitivePlaceholders: boolean;
};

export type V2AssistantSourceBackedFact = {
  fact: string;
  sourceRefs: V2SourceRef[];
  confidence: "high" | "medium" | "low";
};

export type V2AssistantResponse = {
  responseType: V2AssistantResponseType;
  answerMarkdown: string;
  sourceBackedFacts: V2AssistantSourceBackedFact[];
  missingOrUnverified: V2MissingDataItem[];
  recommendedSteps: string[];
  secureRevealCards: ModelSafeRevealCard[];
  draftNote?: V2DraftNote;
  followupSuggestions: string[];
  statePatch?: Partial<SafeConversationState>;
};

const RESPONSE_TYPES = new Set<V2AssistantResponseType>([
  "task_assist",
  "client_data_answer",
  "missing_data",
  "clarification_needed",
  "general_guidance",
  "error",
]);

const CONFIDENCE_VALUES = new Set(["high", "medium", "low"]);
const DRAFT_AUDIENCES = new Set(["advisor", "client", "internal"]);

export function createSafeErrorAssistantResponse(
  message = "I could not safely complete that request.",
): V2AssistantResponse {
  const response: V2AssistantResponse = {
    responseType: "error",
    answerMarkdown: sanitizeTextForModel(message),
    sourceBackedFacts: [],
    missingOrUnverified: [],
    recommendedSteps: [],
    secureRevealCards: [],
    followupSuggestions: [],
  };

  assertNoUnsafeModelContent(response);
  return response;
}

export function validateV2AssistantResponse(
  input: unknown,
): V2AssistantResponse {
  if (!isRecord(input)) {
    throw new Error("Invalid V2 assistant response.");
  }

  if (!RESPONSE_TYPES.has(input.responseType as V2AssistantResponseType)) {
    throw new Error("Invalid V2 assistant response type.");
  }

  if (typeof input.answerMarkdown !== "string") {
    throw new Error("Invalid V2 assistant answer.");
  }

  return {
    responseType: input.responseType as V2AssistantResponseType,
    answerMarkdown: input.answerMarkdown,
    sourceBackedFacts: parseSourceBackedFacts(input.sourceBackedFacts),
    missingOrUnverified: parseMissingItems(input.missingOrUnverified),
    recommendedSteps: parseStringArray(input.recommendedSteps),
    secureRevealCards: parseRevealCards(input.secureRevealCards),
    ...(input.draftNote !== undefined && input.draftNote !== null
      ? { draftNote: parseDraftNote(input.draftNote) }
      : {}),
    followupSuggestions: parseStringArray(input.followupSuggestions),
    ...(isRecord(input.statePatch) ? { statePatch: input.statePatch } : {}),
  };
}

export function sanitizeV2AssistantResponseForUser(
  input: V2AssistantResponse,
): V2AssistantResponse {
  if (containsUnsafeSensitivePattern(input)) {
    return createSafeErrorAssistantResponse(
      "I could not safely produce that response.",
    );
  }

  const sanitized: V2AssistantResponse = {
    responseType: input.responseType,
    answerMarkdown: sanitizeTextForModel(input.answerMarkdown),
    sourceBackedFacts: input.sourceBackedFacts.map((fact) => ({
      fact: sanitizeTextForModel(fact.fact),
      sourceRefs: sanitizeSourceRefs(fact.sourceRefs),
      confidence: fact.confidence,
    })),
    missingOrUnverified: sanitizeMissingItems(input.missingOrUnverified),
    recommendedSteps: input.recommendedSteps.map(sanitizeTextForModel),
    secureRevealCards: sanitizeRevealCards(input.secureRevealCards),
    ...(input.draftNote
      ? { draftNote: sanitizeDraftNote(input.draftNote) }
      : {}),
    followupSuggestions: input.followupSuggestions.map(sanitizeTextForModel),
    ...(input.statePatch ? { statePatch: input.statePatch } : {}),
  };

  assertNoUnsafeModelContent(sanitized);
  return sanitized;
}

export function mergeToolArtifactsIntoAssistantResponse(args: {
  response: V2AssistantResponse;
  toolResults: V2ToolResult[];
}): V2AssistantResponse {
  const revealCardsById = new Map<string, ModelSafeRevealCard>();
  for (const revealCard of args.response.secureRevealCards) {
    revealCardsById.set(revealCard.revealCardId, revealCard);
  }
  for (const result of args.toolResults) {
    for (const revealCard of result.secureRevealCards) {
      revealCardsById.set(revealCard.revealCardId, revealCard);
    }
  }

  const merged: V2AssistantResponse = {
    ...args.response,
    secureRevealCards: [...revealCardsById.values()],
    missingOrUnverified:
      args.response.missingOrUnverified.length > 0
        ? args.response.missingOrUnverified
        : args.toolResults.flatMap((result) => result.missing),
    recommendedSteps:
      args.response.recommendedSteps.length > 0
        ? args.response.recommendedSteps
        : defaultRecommendedStepsForToolResults(args.toolResults),
  };
  const normalized = normalizeAssistantResponseFromToolResults({
    response: merged,
    toolResults: args.toolResults,
  });

  try {
    assertNoUnsafeModelContent(normalized);
    return normalized;
  } catch {
    return createSafeErrorAssistantResponse(
      "I could not safely produce that response.",
    );
  }
}

function normalizeAssistantResponseFromToolResults(args: {
  response: V2AssistantResponse;
  toolResults: V2ToolResult[];
}): V2AssistantResponse {
  const hasWorkflowTool = args.toolResults.some(
    (result) => result.toolName === "check_workflow_requirements",
  );
  const shouldPreserveType = ["error", "clarification_needed"].includes(
    args.response.responseType,
  );

  let response: V2AssistantResponse = { ...args.response };

  if (hasWorkflowTool && !shouldPreserveType && hasWorkflowContext(args)) {
    response = {
      ...response,
      responseType: "task_assist",
    };
  } else if (!hasWorkflowTool && !shouldPreserveType && hasMissingData(args)) {
    response = {
      ...response,
      responseType: "missing_data",
    };
  }

  if (
    hasWorkflowTool &&
    response.responseType === "task_assist" &&
    !response.draftNote
  ) {
    response = {
      ...response,
      draftNote: createWorkflowDraftNote(response),
    };
  }

  assertNoUnsafeModelContent(response);
  return response;
}

function hasWorkflowContext(args: {
  response: V2AssistantResponse;
  toolResults: V2ToolResult[];
}) {
  return args.toolResults.some(
    (result) =>
      result.toolName === "check_workflow_requirements" &&
      (result.status === "success" ||
        result.status === "not_found" ||
        result.facts.length > 0 ||
        result.missing.length > 0 ||
        result.allowedClaims.length > 0),
  ) ||
    args.response.recommendedSteps.length > 0 ||
    args.response.missingOrUnverified.length > 0;
}

function hasMissingData(args: {
  response: V2AssistantResponse;
  toolResults: V2ToolResult[];
}) {
  const substantiveResults = args.toolResults.filter(
    (result) => result.toolName !== "resolve_client",
  );
  const hasMissingItems =
    args.response.missingOrUnverified.length > 0 ||
    args.toolResults.some((result) => result.missing.length > 0);
  const foundMissingToolResult = args.toolResults.some(
    (result) => result.status === "not_found" || result.missing.length > 0,
  );
  const allSubstantiveResultsNotFound =
    substantiveResults.length > 0 &&
    substantiveResults.every((result) => result.status === "not_found");

  return hasMissingItems && (foundMissingToolResult || allSubstantiveResultsNotFound);
}

function createWorkflowDraftNote(response: V2AssistantResponse): V2DraftNote {
  const parts = [
    "I checked the available client records for this workflow.",
    "The source-backed items and any missing or unverified items are summarized above.",
    "I will proceed with the recommended next steps unless you prefer a different approach.",
  ];

  if (response.missingOrUnverified.length > 0) {
    parts.push("There are missing or unverified items to resolve before treating the workflow as complete.");
  }

  if (response.secureRevealCards.length > 0) {
    parts.push("Any sensitive values should be handled through secure reveal cards rather than written into notes.");
  }

  return {
    audience: "advisor",
    bodyMarkdown: sanitizeTextForModel(parts.join(" ")),
    containsSensitivePlaceholders: false,
  };
}

function defaultRecommendedStepsForToolResults(
  toolResults: V2ToolResult[],
): string[] {
  if (toolResults.length === 0) {
    return [];
  }

  if (toolResults.some((result) => result.missing.length > 0)) {
    return ["Review the missing items and confirm the next source to check."];
  }

  if (toolResults.some((result) => result.secureRevealCards.length > 0)) {
    return ["Use the secure reveal card only when the value is needed for the authorized task."];
  }

  return ["Review the source-backed facts before taking action."];
}

function parseSourceBackedFacts(input: unknown): V2AssistantSourceBackedFact[] {
  if (!Array.isArray(input)) {
    throw new Error("Invalid source-backed facts.");
  }

  return input.map((fact) => {
    if (!isRecord(fact) || typeof fact.fact !== "string") {
      throw new Error("Invalid source-backed fact.");
    }

    return {
      fact: fact.fact,
      sourceRefs: parseSourceRefs(fact.sourceRefs),
      confidence: parseConfidence(fact.confidence),
    };
  });
}

function parseSourceRefs(input: unknown): V2SourceRef[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.map((sourceRef) => {
    if (!isRecord(sourceRef) || typeof sourceRef.label !== "string") {
      throw new Error("Invalid source reference.");
    }

    return {
      sourceId:
        typeof sourceRef.sourceId === "string"
          ? sourceRef.sourceId
          : "unknown_source",
      sourceType: parseSourceType(sourceRef.sourceType),
      label: sourceRef.label,
      ...(typeof sourceRef.documentId === "string"
        ? { documentId: sourceRef.documentId }
        : {}),
      ...(typeof sourceRef.page === "number" ? { page: sourceRef.page } : {}),
      ...(typeof sourceRef.date === "string" ? { date: sourceRef.date } : {}),
      confidence: parseConfidence(sourceRef.confidence),
    };
  });
}

function parseMissingItems(input: unknown): V2MissingDataItem[] {
  if (!Array.isArray(input)) {
    throw new Error("Invalid missing items.");
  }

  return input.map((item) => {
    if (!isRecord(item) || typeof item.item !== "string") {
      throw new Error("Invalid missing item.");
    }

    return {
      item: item.item,
      checked: Array.isArray(item.checked)
        ? item.checked.filter((entry): entry is string => typeof entry === "string")
        : [],
      reason: typeof item.reason === "string" ? item.reason : "Not found.",
      ...(typeof item.suggestedNextStep === "string"
        ? { suggestedNextStep: item.suggestedNextStep }
        : {}),
    };
  });
}

function parseRevealCards(input: unknown): ModelSafeRevealCard[] {
  if (!Array.isArray(input)) {
    throw new Error("Invalid secure reveal cards.");
  }

  return input.map((card) => {
    if (
      !isRecord(card) ||
      typeof card.revealCardId !== "string" ||
      typeof card.fieldKey !== "string" ||
      typeof card.fieldLabel !== "string" ||
      typeof card.label !== "string" ||
      typeof card.status !== "string" ||
      typeof card.expiresAt !== "string" ||
      card.actualValueWasNotShownToModel !== true
    ) {
      throw new Error("Invalid secure reveal card.");
    }

    return {
      revealCardId: card.revealCardId,
      fieldKey: card.fieldKey as ModelSafeRevealCard["fieldKey"],
      fieldLabel: card.fieldLabel,
      ...(typeof card.clientId === "string" ? { clientId: card.clientId } : {}),
      ...(typeof card.accountId === "string"
        ? { accountId: card.accountId }
        : {}),
      ...(typeof card.documentId === "string"
        ? { documentId: card.documentId }
        : {}),
      label: card.label,
      ...(typeof card.maskedValue === "string"
        ? { maskedValue: card.maskedValue }
        : {}),
      status: card.status as ModelSafeRevealCard["status"],
      expiresAt: card.expiresAt,
      actualValueWasNotShownToModel: true,
    };
  });
}

function parseDraftNote(input: unknown): V2DraftNote {
  if (
    !isRecord(input) ||
    !DRAFT_AUDIENCES.has(input.audience as string) ||
    typeof input.bodyMarkdown !== "string" ||
    typeof input.containsSensitivePlaceholders !== "boolean"
  ) {
    throw new Error("Invalid draft note.");
  }

  return {
    audience: input.audience as V2DraftNote["audience"],
    bodyMarkdown: input.bodyMarkdown,
    containsSensitivePlaceholders: input.containsSensitivePlaceholders,
  };
}

function parseStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) {
    throw new Error("Invalid string array.");
  }

  return input.filter((entry): entry is string => typeof entry === "string");
}

function sanitizeSourceRefs(sourceRefs: V2SourceRef[]): V2SourceRef[] {
  return sourceRefs.map((sourceRef) => ({
    sourceId: sanitizeSourceId(sourceRef.sourceId),
    sourceType: sourceRef.sourceType,
    label: sanitizeTextForModel(sourceRef.label),
    ...(sourceRef.documentId
      ? { documentId: sanitizeTextForModel(sourceRef.documentId) }
      : {}),
    ...(sourceRef.page !== undefined ? { page: sourceRef.page } : {}),
    ...(sourceRef.date ? { date: sanitizeTextForModel(sourceRef.date) } : {}),
    confidence: sourceRef.confidence,
  }));
}

function sanitizeMissingItems(items: V2MissingDataItem[]): V2MissingDataItem[] {
  return items.map((item) => ({
    item: sanitizeTextForModel(item.item),
    checked: item.checked.map(sanitizeTextForModel),
    reason: sanitizeTextForModel(item.reason),
    ...(item.suggestedNextStep
      ? { suggestedNextStep: sanitizeTextForModel(item.suggestedNextStep) }
      : {}),
  }));
}

function sanitizeRevealCards(cards: ModelSafeRevealCard[]): ModelSafeRevealCard[] {
  return cards.map((card) => ({
    revealCardId: sanitizeTextForModel(card.revealCardId),
    fieldKey: card.fieldKey,
    fieldLabel: sanitizeTextForModel(card.fieldLabel),
    ...(card.clientId ? { clientId: sanitizeTextForModel(card.clientId) } : {}),
    ...(card.accountId
      ? { accountId: sanitizeTextForModel(card.accountId) }
      : {}),
    ...(card.documentId
      ? { documentId: sanitizeTextForModel(card.documentId) }
      : {}),
    label: sanitizeTextForModel(card.label),
    ...(card.maskedValue
      ? { maskedValue: sanitizeTextForModel(card.maskedValue) }
      : {}),
    status: card.status,
    expiresAt: sanitizeTextForModel(card.expiresAt),
    actualValueWasNotShownToModel: true,
  }));
}

function sanitizeDraftNote(draftNote: V2DraftNote): V2DraftNote {
  return {
    audience: draftNote.audience,
    bodyMarkdown: sanitizeTextForModel(draftNote.bodyMarkdown),
    containsSensitivePlaceholders: draftNote.containsSensitivePlaceholders,
  };
}

function parseConfidence(input: unknown): "high" | "medium" | "low" {
  return CONFIDENCE_VALUES.has(input as string)
    ? (input as "high" | "medium" | "low")
    : "low";
}

function parseSourceType(input: unknown): V2SourceRef["sourceType"] {
  const allowed: V2SourceRef["sourceType"][] = [
    "uploaded_document",
    "extracted_fact",
    "account_record",
    "identity_record",
    "tax_record",
    "system_record",
  ];

  return allowed.includes(input as V2SourceRef["sourceType"])
    ? (input as V2SourceRef["sourceType"])
    : "system_record";
}

function sanitizeSourceId(sourceId: string) {
  if (/drive|google|sourceFile|fileId/i.test(sourceId)) {
    return "[REDACTED]";
  }

  return sanitizeTextForModel(sourceId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
