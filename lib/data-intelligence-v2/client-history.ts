import type {
  V2AssistantResponse,
  V2DraftNote,
  V2AssistantSourceBackedFact,
} from "@/lib/data-intelligence-v2/assistant-response";
import { sanitizeSafeConversationState } from "@/lib/data-intelligence-v2/conversation-state";
import {
  assertNoUnsafeModelContent,
  sanitizeObjectForModel,
  sanitizeTextForModel,
} from "@/lib/data-intelligence-v2/safe-memory";
import type {
  ModelSafeRevealCard,
  SafeConversationState,
  V2MissingDataItem,
  V2SourceRef,
  VisibleConversationMessage,
} from "@/lib/data-intelligence-v2/types";

export type V2ClientChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  response?: V2AssistantResponse;
};

export type V2ChatApiRequestBody = {
  message: string;
  history: VisibleConversationMessage[];
  conversationState: SafeConversationState;
};

const DEFAULT_MAX_HISTORY_MESSAGES = 8;

export function createV2ClientMessageId(): string {
  const randomId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return `v2_msg_${randomId}`;
}

export function buildV2VisibleHistoryForApi(args: {
  messages: V2ClientChatMessage[];
  maxMessages?: number;
}): VisibleConversationMessage[] {
  const maxMessages = Math.max(
    0,
    args.maxMessages ?? DEFAULT_MAX_HISTORY_MESSAGES,
  );

  const history = args.messages
    .slice(-maxMessages)
    .map(stripRevealedValuesFromClientMessage)
    .map((message): VisibleConversationMessage => ({
      role: message.role,
      content: sanitizeTextForModel(message.content),
      createdAt: sanitizeTextForModel(message.createdAt),
      ...(message.response
        ? { structuredResponse: sanitizeAssistantResponseForHistory(message.response) }
        : {}),
    }));

  assertNoRevealedValuesInChatPayload(history);
  return history;
}

export function buildV2ChatApiRequestBody(args: {
  message: string;
  messages: V2ClientChatMessage[];
  conversationState?: SafeConversationState;
  maxHistoryMessages?: number;
}): V2ChatApiRequestBody {
  const payload: V2ChatApiRequestBody = {
    message: sanitizeTextForModel(args.message),
    history: buildV2VisibleHistoryForApi({
      messages: args.messages,
      maxMessages: args.maxHistoryMessages,
    }),
    conversationState: sanitizeSafeConversationState(args.conversationState),
  };

  assertNoRevealedValuesInChatPayload(payload);
  return payload;
}

export function stripRevealedValuesFromClientMessage(
  message: V2ClientChatMessage,
): V2ClientChatMessage {
  const stripped: V2ClientChatMessage = {
    id: sanitizeTextForModel(message.id),
    role: message.role,
    content: sanitizeTextForModel(message.content),
    createdAt: sanitizeTextForModel(message.createdAt),
    ...(message.response
      ? { response: sanitizeAssistantResponseForHistory(message.response) }
      : {}),
  };

  assertNoRevealedValuesInChatPayload(stripped);
  return stripped;
}

export function assertNoRevealedValuesInChatPayload(payload: unknown): void {
  assertNoUnsafeModelContent(payload);
}

function sanitizeAssistantResponseForHistory(
  response: V2AssistantResponse,
): V2AssistantResponse {
  const safeResponse: V2AssistantResponse = {
    responseType: response.responseType,
    answerMarkdown: sanitizeTextForModel(response.answerMarkdown),
    sourceBackedFacts: sanitizeSourceBackedFacts(response.sourceBackedFacts),
    missingOrUnverified: sanitizeMissingItems(response.missingOrUnverified),
    recommendedSteps: response.recommendedSteps.map(sanitizeTextForModel),
    secureRevealCards: response.secureRevealCards.map(sanitizeRevealCard),
    ...(response.draftNote
      ? { draftNote: sanitizeDraftNote(response.draftNote) }
      : {}),
    followupSuggestions: response.followupSuggestions.map(sanitizeTextForModel),
    ...(response.statePatch
      ? { statePatch: sanitizeSafeConversationState(response.statePatch) }
      : {}),
  };

  assertNoUnsafeModelContent(safeResponse);
  return safeResponse;
}

function sanitizeSourceBackedFacts(
  facts: V2AssistantSourceBackedFact[],
): V2AssistantSourceBackedFact[] {
  return facts.map((fact) => ({
    fact: sanitizeTextForModel(fact.fact),
    sourceRefs: fact.sourceRefs.map(sanitizeSourceRef),
    confidence: fact.confidence,
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

function sanitizeDraftNote(draftNote: V2DraftNote): V2DraftNote {
  return {
    audience: draftNote.audience,
    bodyMarkdown: sanitizeTextForModel(draftNote.bodyMarkdown),
    containsSensitivePlaceholders: Boolean(
      draftNote.containsSensitivePlaceholders,
    ),
  };
}

function sanitizeRevealCard(card: ModelSafeRevealCard): ModelSafeRevealCard {
  return {
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
  };
}

function sanitizeSourceRef(sourceRef: V2SourceRef): V2SourceRef {
  const sanitized = sanitizeObjectForModel({
    sourceId: sourceRef.sourceId,
    sourceType: sourceRef.sourceType,
    label: sourceRef.label,
    documentId: sourceRef.documentId,
    page: sourceRef.page,
    date: sourceRef.date,
    confidence: sourceRef.confidence,
  }) as V2SourceRef;

  return {
    sourceId: sanitized.sourceId,
    sourceType: sanitized.sourceType,
    label: sanitized.label,
    ...(sanitized.documentId ? { documentId: sanitized.documentId } : {}),
    ...(typeof sanitized.page === "number" ? { page: sanitized.page } : {}),
    ...(sanitized.date ? { date: sanitized.date } : {}),
    confidence: sanitized.confidence,
  };
}
