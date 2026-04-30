import { getFieldDefinition } from "@/lib/data-intelligence-v2/field-catalog";
import {
  assertNoUnsafeModelContent,
  sanitizeObjectForModel,
  sanitizeTextForModel,
} from "@/lib/data-intelligence-v2/safe-memory";
import type { V2AssistantResponse } from "@/lib/data-intelligence-v2/assistant-response";
import type {
  SafeConversationState,
  SecureRevealReference,
  V2SafeFact,
  V2ToolResult,
} from "@/lib/data-intelligence-v2/types";

const LIMITS = {
  clients: 5,
  accounts: 8,
  documents: 8,
  reveals: 8,
  missing: 10,
};

export function sanitizeSafeConversationState(
  state: unknown,
): SafeConversationState {
  if (!isRecord(state)) {
    return {};
  }

  const sanitized: SafeConversationState = {
    ...optionalStringField(state, "activeClientId"),
    ...optionalStringField(state, "activeHouseholdId"),
    ...optionalStringField(state, "activeWorkflow"),
    lastResolvedClients: readArray(state.lastResolvedClients, LIMITS.clients)
      .map(readResolvedClient)
      .filter(isDefined),
    lastMentionedAccounts: readArray(
      state.lastMentionedAccounts,
      LIMITS.accounts,
    )
      .map(readMentionedAccount)
      .filter(isDefined),
    lastMentionedDocuments: readArray(
      state.lastMentionedDocuments,
      LIMITS.documents,
    )
      .map(readMentionedDocument)
      .filter(isDefined),
    lastSensitiveReveals: readArray(
      state.lastSensitiveReveals,
      LIMITS.reveals,
    )
      .map(readSensitiveReveal)
      .filter(isDefined),
    missingItems: readArray(state.missingItems, LIMITS.missing)
      .map(readMissingItem)
      .filter(isDefined),
  };

  return sanitizeAndAssertState(sanitized);
}

export function deriveSafeConversationStateFromToolResults(args: {
  previousState?: SafeConversationState;
  toolResults: V2ToolResult[];
  assistantResponse?: V2AssistantResponse;
}): SafeConversationState {
  const previousState = sanitizeSafeConversationState(args.previousState);
  const derived: SafeConversationState = {};

  const clientEntries = args.toolResults.flatMap((result) =>
    result.toolName === "resolve_client" && result.status === "success"
      ? clientsFromFacts(result.facts)
      : [],
  );
  if (clientEntries.length > 0) {
    derived.lastResolvedClients = clientEntries.slice(0, LIMITS.clients);
    derived.activeClientId = clientEntries[0]?.clientId;
  }

  const accountEntries = args.toolResults.flatMap((result) =>
    ["get_accounts", "get_latest_statements"].includes(result.toolName)
      ? accountsFromFacts(result.facts)
      : [],
  );
  if (accountEntries.length > 0) {
    derived.lastMentionedAccounts = accountEntries.slice(0, LIMITS.accounts);
  }

  const documentEntries = args.toolResults.flatMap((result) =>
    ["get_latest_statements", "get_tax_documents"].includes(result.toolName)
      ? documentsFromResult(result)
      : [],
  );
  if (documentEntries.length > 0) {
    derived.lastMentionedDocuments = documentEntries.slice(0, LIMITS.documents);
  }

  const revealEntries = args.toolResults
    .flatMap((result) => result.secureRevealCards)
    .map((revealCard): SecureRevealReference | undefined => {
      const definition = getFieldDefinition(revealCard.fieldKey);
      if (!definition?.sensitiveField) {
        return undefined;
      }

      return {
        revealCardId: revealCard.revealCardId,
        ...(revealCard.clientId ? { clientId: revealCard.clientId } : {}),
        field: definition.sensitiveField,
        label: revealCard.label,
        actualValueWasNotShownToModel: true,
      };
    })
    .filter(isDefined);
  if (revealEntries.length > 0) {
    derived.lastSensitiveReveals = revealEntries.slice(0, LIMITS.reveals);
  }

  const missingItems = args.toolResults.flatMap((result) =>
    result.missing.map((item) => ({
      item: item.item,
      reason: item.reason,
      ...(item.suggestedNextStep
        ? { suggestedNextStep: item.suggestedNextStep }
        : {}),
    })),
  );
  if (missingItems.length > 0) {
    derived.missingItems = missingItems.slice(0, LIMITS.missing);
  }

  return mergeSafeConversationState({
    previousState,
    derivedState: derived,
    modelPatch: args.assistantResponse?.statePatch,
  });
}

export function mergeSafeConversationState(args: {
  previousState?: SafeConversationState;
  derivedState?: SafeConversationState;
  modelPatch?: Partial<SafeConversationState>;
}): SafeConversationState {
  const previousState = sanitizeSafeConversationState(args.previousState);
  const derivedState = sanitizeSafeConversationState(args.derivedState);
  const modelPatch = sanitizeSafeConversationState(args.modelPatch);

  const merged: SafeConversationState = {
    ...previousState,
    ...safeScalarPatch(modelPatch),
    ...safeScalarPatch(derivedState),
    lastResolvedClients: boundedMerge(
      derivedState.lastResolvedClients,
      modelPatch.lastResolvedClients,
      previousState.lastResolvedClients,
      LIMITS.clients,
      (item) => item.clientId,
    ),
    lastMentionedAccounts: boundedMerge(
      derivedState.lastMentionedAccounts,
      modelPatch.lastMentionedAccounts,
      previousState.lastMentionedAccounts,
      LIMITS.accounts,
      (item) => item.accountId,
    ),
    lastMentionedDocuments: boundedMerge(
      derivedState.lastMentionedDocuments,
      modelPatch.lastMentionedDocuments,
      previousState.lastMentionedDocuments,
      LIMITS.documents,
      (item) => item.documentId,
    ),
    lastSensitiveReveals: boundedMerge(
      derivedState.lastSensitiveReveals,
      previousState.lastSensitiveReveals,
      [],
      LIMITS.reveals,
      (item) => item.revealCardId,
    ),
    missingItems: boundedMerge(
      derivedState.missingItems,
      modelPatch.missingItems,
      previousState.missingItems,
      LIMITS.missing,
      (item) => `${item.item}:${item.reason}`,
    ),
  };

  return sanitizeAndAssertState(merged);
}

function clientsFromFacts(facts: V2SafeFact[]) {
  const byClientId = new Map<string, { clientId: string; displayName: string }>();
  for (const fact of facts) {
    const match = fact.factId.match(/^client:([^:]+):(.+)$/);
    if (!match) {
      continue;
    }
    const clientId = sanitizeTextForModel(match[1] ?? "");
    const entry = byClientId.get(clientId) ?? {
      clientId,
      displayName: "Resolved client",
    };
    if (fact.fieldKey === "client.name" && typeof fact.value === "string") {
      entry.displayName = sanitizeTextForModel(fact.value);
    }
    byClientId.set(clientId, entry);
  }
  return [...byClientId.values()];
}

function accountsFromFacts(facts: V2SafeFact[]) {
  const byAccountId = new Map<
    string,
    {
      accountId: string;
      label: string;
      custodian?: string;
      accountType?: string;
      last4?: string;
    }
  >();

  for (const fact of facts) {
    const match = fact.factId.match(/^account:([^:]+):(.+)$/);
    if (!match) {
      continue;
    }
    const accountId = sanitizeTextForModel(match[1] ?? "");
    const entry = byAccountId.get(accountId) ?? {
      accountId,
      label: "Account",
    };
    if (fact.fieldKey === "account.custodian" && typeof fact.value === "string") {
      entry.custodian = sanitizeTextForModel(fact.value);
    }
    if (fact.fieldKey === "account.type" && typeof fact.value === "string") {
      entry.accountType = sanitizeTextForModel(fact.value);
    }
    if (fact.fieldKey === "account.last4" && typeof fact.value === "string") {
      entry.last4 = sanitizeTextForModel(fact.value);
    }
    if (entry.custodian || entry.accountType || entry.last4) {
      entry.label = [entry.custodian, entry.accountType, entry.last4]
        .filter(Boolean)
        .join(" ");
    }
    byAccountId.set(accountId, entry);
  }

  return [...byAccountId.values()];
}

function documentsFromResult(result: V2ToolResult) {
  return result.sourceRefs
    .filter((sourceRef) => sourceRef.documentId)
    .map((sourceRef) => ({
      documentId: sanitizeTextForModel(sourceRef.documentId ?? sourceRef.sourceId),
      label: sanitizeTextForModel(sourceRef.label),
      documentType:
        result.toolName === "get_tax_documents" ? "tax_document" : "statement",
      ...(sourceRef.date ? { date: sanitizeTextForModel(sourceRef.date) } : {}),
    }));
}

function safeScalarPatch(state: SafeConversationState): SafeConversationState {
  return {
    ...(state.activeClientId ? { activeClientId: state.activeClientId } : {}),
    ...(state.activeHouseholdId
      ? { activeHouseholdId: state.activeHouseholdId }
      : {}),
    ...(state.activeWorkflow ? { activeWorkflow: state.activeWorkflow } : {}),
  };
}

function boundedMerge<T>(
  first: T[] | undefined,
  second: T[] | undefined,
  third: T[] | undefined,
  limit: number,
  keyFor: (item: T) => string,
): T[] | undefined {
  const seen = new Set<string>();
  const merged: T[] = [];

  for (const item of [...(first ?? []), ...(second ?? []), ...(third ?? [])]) {
    const key = keyFor(item);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(item);
    }
  }

  return merged.length > 0 ? merged.slice(0, limit) : undefined;
}

function readArray(value: unknown, limit: number): unknown[] {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

function readResolvedClient(value: unknown) {
  if (!isRecord(value) || typeof value.clientId !== "string") {
    return undefined;
  }
  return {
    clientId: sanitizeTextForModel(value.clientId),
    displayName:
      typeof value.displayName === "string"
        ? sanitizeTextForModel(value.displayName)
        : "Resolved client",
    ...(typeof value.householdId === "string"
      ? { householdId: sanitizeTextForModel(value.householdId) }
      : {}),
  };
}

function readMentionedAccount(value: unknown) {
  if (!isRecord(value) || typeof value.accountId !== "string") {
    return undefined;
  }
  return {
    accountId: sanitizeTextForModel(value.accountId),
    label:
      typeof value.label === "string"
        ? sanitizeTextForModel(value.label)
        : "Account",
    ...(typeof value.custodian === "string"
      ? { custodian: sanitizeTextForModel(value.custodian) }
      : {}),
    ...(typeof value.accountType === "string"
      ? { accountType: sanitizeTextForModel(value.accountType) }
      : {}),
    ...(typeof value.last4 === "string"
      ? { last4: sanitizeTextForModel(value.last4) }
      : {}),
  };
}

function readMentionedDocument(value: unknown) {
  if (!isRecord(value) || typeof value.documentId !== "string") {
    return undefined;
  }
  return {
    documentId: sanitizeTextForModel(value.documentId),
    label:
      typeof value.label === "string"
        ? sanitizeTextForModel(value.label)
        : "Document",
    ...(typeof value.documentType === "string"
      ? { documentType: sanitizeTextForModel(value.documentType) }
      : {}),
    ...(typeof value.date === "string"
      ? { date: sanitizeTextForModel(value.date) }
      : {}),
  };
}

function readSensitiveReveal(value: unknown) {
  if (
    !isRecord(value) ||
    typeof value.revealCardId !== "string" ||
    typeof value.field !== "string" ||
    typeof value.label !== "string"
  ) {
    return undefined;
  }
  return {
    revealCardId: sanitizeTextForModel(value.revealCardId),
    ...(typeof value.clientId === "string"
      ? { clientId: sanitizeTextForModel(value.clientId) }
      : {}),
    field: value.field as SecureRevealReference["field"],
    label: sanitizeTextForModel(value.label),
    actualValueWasNotShownToModel: true as const,
  };
}

function readMissingItem(value: unknown) {
  if (!isRecord(value) || typeof value.item !== "string") {
    return undefined;
  }
  return {
    item: sanitizeTextForModel(value.item),
    reason:
      typeof value.reason === "string"
        ? sanitizeTextForModel(value.reason)
        : "Missing.",
    ...(typeof value.suggestedNextStep === "string"
      ? { suggestedNextStep: sanitizeTextForModel(value.suggestedNextStep) }
      : {}),
  };
}

function optionalStringField(
  source: Record<string, unknown>,
  key: "activeClientId" | "activeHouseholdId" | "activeWorkflow",
) {
  return typeof source[key] === "string"
    ? { [key]: sanitizeTextForModel(source[key]) }
    : {};
}

function sanitizeAndAssertState(state: SafeConversationState) {
  sanitizeObjectForModel({
    ...state,
    lastSensitiveReveals: undefined,
  });
  assertNoUnsafeModelContent(state);
  return state;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
