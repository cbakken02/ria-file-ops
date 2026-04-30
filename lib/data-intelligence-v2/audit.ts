import { randomUUID } from "node:crypto";
import {
  assertNoUnsafeModelContent,
  sanitizeObjectForModel,
  sanitizeTextForModel,
} from "@/lib/data-intelligence-v2/safe-memory";
import type { RevealAuditEvent } from "@/lib/data-intelligence-v2/reveal-audit";
import type {
  DataIntelligenceV2AuthContext,
  V2ToolName,
} from "@/lib/data-intelligence-v2/types";

export type V2AuditEventCategory =
  | "reveal"
  | "chat"
  | "tool"
  | "model"
  | "safety"
  | "config"
  | "system";

export type V2AuditEventType =
  | "reveal_card_created"
  | "reveal_card_denied"
  | "reveal_card_expired"
  | "reveal_card_consumed"
  | "sensitive_value_revealed"
  | "sensitive_value_reveal_denied"
  | "chat_request_received"
  | "chat_request_denied"
  | "chat_request_completed"
  | "chat_request_error"
  | "tool_call_started"
  | "tool_call_completed"
  | "tool_call_denied"
  | "tool_call_error"
  | "model_adapter_unavailable"
  | "model_adapter_error"
  | "model_adapter_completed"
  | "safety_validation_failed"
  | "config_warning"
  | "system_error";

export type V2AuditEvent = {
  auditEventId?: string;
  eventType: V2AuditEventType;
  eventCategory: V2AuditEventCategory;
  ownerEmail?: string;
  userEmail?: string;
  userId?: string;
  firmId?: string;
  role?: DataIntelligenceV2AuthContext["role"];
  conversationId?: string;
  messageId?: string;
  revealCardId?: string;
  clientId?: string;
  accountId?: string;
  documentId?: string;
  sourceId?: string;
  toolName?: V2ToolName | string;
  modelName?: string;
  status?: string;
  allowed?: boolean;
  reason?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
};

export interface V2AuditSink {
  record(event: V2AuditEvent): Promise<void>;
}

const EVENT_CATEGORIES = new Set<V2AuditEventCategory>([
  "reveal",
  "chat",
  "tool",
  "model",
  "safety",
  "config",
  "system",
]);

const EVENT_TYPES = new Set<V2AuditEventType>([
  "reveal_card_created",
  "reveal_card_denied",
  "reveal_card_expired",
  "reveal_card_consumed",
  "sensitive_value_revealed",
  "sensitive_value_reveal_denied",
  "chat_request_received",
  "chat_request_denied",
  "chat_request_completed",
  "chat_request_error",
  "tool_call_started",
  "tool_call_completed",
  "tool_call_denied",
  "tool_call_error",
  "model_adapter_unavailable",
  "model_adapter_error",
  "model_adapter_completed",
  "safety_validation_failed",
  "config_warning",
  "system_error",
]);

const ALLOWED_ROLES = new Set([
  "admin",
  "advisor",
  "csa",
  "ops",
  "readonly",
]);

const FORBIDDEN_METADATA_KEYS = new Set([
  "args",
  "assistantMessage",
  "assistantText",
  "body",
  "error",
  "input",
  "message",
  "messages",
  "modelPayload",
  "openaiRequest",
  "openaiResponse",
  "output",
  "prompt",
  "providerState",
  "rawAssistantMessage",
  "rawMessage",
  "rawModelResponse",
  "rawOpenAiRequest",
  "rawOpenAiResponse",
  "rawPrompt",
  "rawResponse",
  "rawToolOutput",
  "rawValue",
  "request",
  "requestBody",
  "response",
  "responseBody",
  "revealedValue",
  "stack",
  "toolOutput",
  "toolResult",
  "toolResults",
  "value",
]);

export class NoopV2AuditSink implements V2AuditSink {
  async record(): Promise<void> {
    return;
  }
}

export class InMemoryV2AuditSink implements V2AuditSink {
  readonly events: V2AuditEvent[] = [];

  async record(event: V2AuditEvent): Promise<void> {
    this.events.push(sanitizeV2AuditEvent(event));
  }
}

export function createV2AuditEventId(): string {
  return `aud_${randomUUID()
    .split("-")
    .map((part) => `x${part}`)
    .join("_")}`;
}

export function sanitizeV2AuditEvent(event: V2AuditEvent): V2AuditEvent {
  const sanitized: V2AuditEvent = {
    auditEventId: optionalText(event.auditEventId) ?? createV2AuditEventId(),
    eventType: safeEventType(event.eventType),
    eventCategory: safeEventCategory(event.eventCategory),
    ownerEmail: optionalText(event.ownerEmail),
    userEmail: optionalText(event.userEmail),
    userId: optionalText(event.userId),
    firmId: optionalText(event.firmId),
    role: safeRole(event.role),
    conversationId: optionalText(event.conversationId),
    messageId: optionalText(event.messageId),
    revealCardId: optionalText(event.revealCardId),
    clientId: optionalText(event.clientId),
    accountId: optionalText(event.accountId),
    documentId: optionalText(event.documentId),
    sourceId: optionalText(event.sourceId),
    toolName: optionalText(event.toolName),
    modelName: optionalText(event.modelName),
    status: optionalText(event.status),
    allowed:
      typeof event.allowed === "boolean" ? event.allowed : undefined,
    reason: optionalText(event.reason),
    metadata: sanitizeMetadata(event.metadata),
    createdAt: isoString(event.createdAt ?? new Date().toISOString()),
  };

  assertSafeV2AuditEvent(sanitized);
  return compactUndefined(sanitized);
}

export function assertSafeV2AuditEvent(event: V2AuditEvent): void {
  assertNoUnsafeModelContent(event);
  if (event.metadata && !isPlainRecord(event.metadata)) {
    throw new Error("V2 audit metadata must be a safe object.");
  }
}

export function mapRevealAuditEventToV2AuditEvent(
  event: RevealAuditEvent,
): V2AuditEvent {
  return {
    eventType: event.eventType,
    eventCategory: "reveal",
    revealCardId: event.revealCardId,
    ownerEmail: event.ownerEmail,
    userEmail: event.userEmail,
    userId: event.userId,
    firmId: event.firmId,
    role: event.role,
    clientId: event.clientId,
    accountId: event.accountId,
    documentId: event.documentId,
    sourceId: event.sourceId,
    status: event.allowed ? "success" : "denied",
    allowed: event.allowed,
    reason: event.reason,
    metadata: {
      fieldKey: event.fieldKey,
      purpose: event.purpose,
      hasClientId: Boolean(event.clientId),
      hasAccountId: Boolean(event.accountId),
      hasDocumentId: Boolean(event.documentId),
      hasSourceId: Boolean(event.sourceId),
    },
    createdAt: event.createdAt,
  };
}

function sanitizeMetadata(metadata: unknown): Record<string, unknown> {
  if (!isPlainRecord(metadata)) {
    return {};
  }

  const safeMetadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_METADATA_KEYS.has(key)) {
      safeMetadata[key] = "[REDACTED]";
      continue;
    }
    safeMetadata[sanitizeTextForModel(key)] = sanitizeMetadataValue(value);
  }

  return sanitizeObjectForModel(safeMetadata) as Record<string, unknown>;
}

function sanitizeMetadataValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return sanitizeTextForModel(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeMetadataValue(item));
  }

  if (isPlainRecord(value)) {
    const sanitized: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value)) {
      if (FORBIDDEN_METADATA_KEYS.has(key)) {
        sanitized[key] = "[REDACTED]";
      } else {
        sanitized[sanitizeTextForModel(key)] = sanitizeMetadataValue(entryValue);
      }
    }
    return sanitized;
  }

  return null;
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = sanitizeTextForModel(value).trim();
  return trimmed ? trimmed : undefined;
}

function isoString(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
}

function safeEventType(value: unknown): V2AuditEventType {
  return EVENT_TYPES.has(value as V2AuditEventType)
    ? (value as V2AuditEventType)
    : "system_error";
}

function safeEventCategory(value: unknown): V2AuditEventCategory {
  return EVENT_CATEGORIES.has(value as V2AuditEventCategory)
    ? (value as V2AuditEventCategory)
    : "system";
}

function safeRole(
  role: unknown,
): DataIntelligenceV2AuthContext["role"] | undefined {
  return ALLOWED_ROLES.has(role as string)
    ? (role as DataIntelligenceV2AuthContext["role"])
    : undefined;
}

function compactUndefined<T extends Record<string, unknown>>(input: T): T {
  const compacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      compacted[key] = value;
    }
  }
  return compacted as T;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
