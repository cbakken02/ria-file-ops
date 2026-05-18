import { createHash } from "node:crypto";

const MAX_LOG_MESSAGE_LENGTH = 240;

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted-token]"],
  [/postgres(?:ql)?:\/\/[^"'\s]+/gi, "[redacted-db-url]"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted-private-key]"],
  [/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted-secret]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{8,})?\b/g, "[redacted-jwt]"],
  [
    /\b(access[_-]?token|refresh[_-]?token|id[_-]?token|token|authorization|cookie|session|jwt|secret|service[_-]?role|password|api[_-]?key|client[_-]?secret)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;&}]+)/gi,
    "$1=[redacted]",
  ],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]"],
];

export type SafeErrorMetadataOptions = {
  fallbackMessage?: string;
  includeMessage?: boolean;
};

export function redactSensitiveLogText(value: unknown) {
  const source = String(value ?? "");
  const redacted = SECRET_PATTERNS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    source,
  );

  return redacted.length > MAX_LOG_MESSAGE_LENGTH
    ? `${redacted.slice(0, MAX_LOG_MESSAGE_LENGTH)}...`
    : redacted;
}

export function getSafeErrorMetadata(
  error: unknown,
  options: SafeErrorMetadataOptions = {},
) {
  const metadata: {
    errorName: string;
    message?: string;
  } = {
    errorName: error instanceof Error ? error.name : typeof error,
  };

  if (options.includeMessage !== false) {
    metadata.message = redactSensitiveLogText(
      error instanceof Error
        ? error.message
        : options.fallbackMessage ?? "Unknown error.",
    );
  }

  return metadata;
}

export function hashLogIdentifier(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  return createHash("sha256").update(normalized).digest("hex").slice(0, 12);
}
