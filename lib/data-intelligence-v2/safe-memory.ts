import {
  getFieldDefinitionByAlias,
  maskValueForModel,
} from "@/lib/data-intelligence-v2/field-catalog";
import type {
  LLMSafeConversationMessage,
  VisibleConversationMessage,
} from "@/lib/data-intelligence-v2/types";

const REDACTION_MARKERS = new Set([
  "[REDACTED]",
  "[MASKED]",
  "[SSN_REDACTED]",
  "[TAX_ID_REDACTED]",
  "[ACCOUNT_NUMBER_REDACTED]",
  "[PHONE_REDACTED]",
  "[EMAIL_REDACTED]",
  "[DOB_REDACTED]",
  "[ADDRESS_REDACTED]",
  "[DATE_ON_FILE_REDACTED]",
]);

const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const ssnPattern = /\b\d{3}-\d{2}-\d{4}\b/g;
const taxIdPattern =
  /\b(?:(?:EIN|TIN|tax\s*(?:id|identifier))\s*[:#-]?\s*)?\d{2}-\d{7}\b/gi;
const phonePattern =
  /(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\b\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const dobContextPattern =
  /\b(?:DOB|date\s+of\s+birth|birth\s+date|born)\b\s*(?:is|:|-)?\s*(?:on\s*)?(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}|[A-Z][a-z]+\s+\d{1,2},\s*\d{4})/g;
const longAccountNumberPattern = /\b\d{8,}\b/g;
const sourceFileIdPattern =
  /\b(?:drive_file|source_file|google_drive_file)[A-Za-z0-9_-]+\b|\b(?:googleDriveFileId|driveFileId|sourceFileId)\s*[:=]\s*[A-Za-z0-9_-]+\b/g;
const streetAddressPattern =
  /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Blvd|Boulevard|Way|Ct|Court|Cir|Circle|Pl|Place|Pkwy|Parkway)\b(?:[,\s]+[A-Za-z.'-]+){0,4}(?:\s+\d{5}(?:-\d{4})?)?/gi;

export function sanitizeTextForModel(input: string): string {
  return input
    .replace(emailPattern, "[EMAIL_REDACTED]")
    .replace(ssnPattern, "[SSN_REDACTED]")
    .replace(taxIdPattern, "[TAX_ID_REDACTED]")
    .replace(dobContextPattern, (match) => {
      const label = match.match(
        /\b(?:DOB|date\s+of\s+birth|birth\s+date|born)\b/i,
      )?.[0];

      return `${label ?? "DOB"} [DOB_REDACTED]`;
    })
    .replace(streetAddressPattern, "[ADDRESS_REDACTED]")
    .replace(phonePattern, "[PHONE_REDACTED]")
    .replace(sourceFileIdPattern, "[SOURCE_FILE_ID_REDACTED]")
    .replace(longAccountNumberPattern, "[ACCOUNT_NUMBER_REDACTED]");
}

export function sanitizeObjectForModel<T = unknown>(input: T): T {
  return sanitizeValueForModel(input) as T;
}

export function sanitizeConversationMessagesForModel(
  messages: VisibleConversationMessage[],
  options: { maxMessages?: number } = {},
): LLMSafeConversationMessage[] {
  const maxMessages = Math.max(0, options.maxMessages ?? 8);
  const visibleMessages = messages.slice(-maxMessages);

  return visibleMessages.map((message) => {
    const contentParts = [
      message.content,
      message.text,
      summarizeSecureRevealCards(message.structuredResponse),
    ].filter((part): part is string => Boolean(part?.trim()));

    return {
      role: message.role,
      content: sanitizeTextForModel(contentParts.join("\n")),
    };
  });
}

export function assertNoUnsafeModelContent(input: unknown): void {
  if (containsUnsafeSensitivePattern(input)) {
    throw new Error(
      "Unsafe sensitive content remains in model-bound payload.",
    );
  }
}

export function containsUnsafeSensitivePattern(input: unknown): boolean {
  return containsUnsafeValue(input);
}

function sanitizeValueForModel(value: unknown, key?: string): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  const definition = key ? getFieldDefinitionByAlias(key) : undefined;
  if (definition) {
    if (
      definition.classification === "never_expose" ||
      definition.classification === "reveal_card_only_never_to_model" ||
      definition.classification === "masked_only_to_model"
    ) {
      return maskValueForModel(definition.fieldKey, value);
    }
  }

  if (typeof value === "string") {
    return sanitizeTextForModel(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValueForModel(item));
  }

  if (typeof value === "object") {
    if (isSecureRevealCardLike(value)) {
      return {
        revealCardId: sanitizeTextForModel(String(value.revealCardId)),
        label: sanitizeTextForModel(String(value.label ?? "sensitive value")),
        actualValueWasNotShownToModel: true,
      };
    }

    const sanitized: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      sanitized[entryKey] = sanitizeValueForModel(entryValue, entryKey);
    }

    return sanitized;
  }

  return null;
}

function containsUnsafeValue(value: unknown, key?: string): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  const definition = key ? getFieldDefinitionByAlias(key) : undefined;
  if (definition) {
    if (definition.classification === "never_expose") {
      return !isHiddenValue(value);
    }

    if (definition.classification === "reveal_card_only_never_to_model") {
      return !isSafeMaskedOrRedactedValue(value);
    }
  }

  if (typeof value === "string") {
    return containsUnsafeStringPattern(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((item) => containsUnsafeValue(item));
  }

  if (typeof value === "object") {
    return Object.entries(value).some(([entryKey, entryValue]) =>
      containsUnsafeValue(entryValue, entryKey),
    );
  }

  return false;
}

function containsUnsafeStringPattern(value: string): boolean {
  return (
    resetAndTest(emailPattern, value) ||
    resetAndTest(ssnPattern, value) ||
    resetAndTest(taxIdPattern, value) ||
    resetAndTest(phonePattern, value) ||
    resetAndTest(dobContextPattern, value) ||
    resetAndTest(streetAddressPattern, value) ||
    resetAndTest(sourceFileIdPattern, value) ||
    resetAndTest(longAccountNumberPattern, value)
  );
}

function resetAndTest(pattern: RegExp, value: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(value);
}

function isSafeMaskedOrRedactedValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value !== "string") {
    return false;
  }

  const trimmed = value.trim();
  return (
    REDACTION_MARKERS.has(trimmed) ||
    /^\*{2,}[A-Za-z0-9]{0,4}$/.test(trimmed) ||
    /^[xX]{2,}[A-Za-z0-9]{0,4}$/.test(trimmed)
  );
}

function isHiddenValue(value: unknown): boolean {
  return value === null || value === undefined || value === "[REDACTED]";
}

function summarizeSecureRevealCards(input: unknown): string {
  const revealLabels = findSecureRevealLabels(input);

  return revealLabels
    .map(
      (label) =>
        `Displayed secure reveal card for ${label}. Actual value was not exposed to the model.`,
    )
    .join("\n");
}

function findSecureRevealLabels(input: unknown): string[] {
  if (input === null || input === undefined) {
    return [];
  }

  if (Array.isArray(input)) {
    return input.flatMap((item) => findSecureRevealLabels(item));
  }

  if (typeof input !== "object") {
    return [];
  }

  if (isSecureRevealCardLike(input)) {
    return [sanitizeTextForModel(String(input.label ?? "sensitive value"))];
  }

  return Object.values(input).flatMap((value) => findSecureRevealLabels(value));
}

function isSecureRevealCardLike(
  value: object,
): value is { revealCardId: unknown; label?: unknown } {
  return (
    "revealCardId" in value &&
    ("actualValueWasNotShownToModel" in value ||
      "secureRevealCard" in value ||
      "revealCard" in value)
  );
}
