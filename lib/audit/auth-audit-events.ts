import "server-only";

import crypto from "node:crypto";
import {
  appendAuthAuditEvent,
  getAuthAuditEventsByOwnerEmail,
  type AuthAuditEvent,
  type AuthAuditEventType,
} from "@/lib/db";
import {
  buildWorkspaceIdFromOwnerKey,
  normalizeOwnerEmail,
  type AppPrincipal,
} from "@/lib/auth/principal";

export type AuthAuditStatus = "allowed" | "denied" | "failed" | "succeeded";

export type AuthAuditInput = {
  actorEmail?: string | null;
  actorOwnerKey?: string | null;
  actorWorkspaceId?: string | null;
  eventType: AuthAuditEventType;
  metadata?: Record<string, unknown> | null;
  principal?: AppPrincipal | null;
  provider?: string | null;
  reason?: string | null;
  requestId?: string | null;
  resourceId?: string | null;
  resourceIdHash?: string | null;
  resourceType?: string | null;
  status?: AuthAuditStatus | string | null;
};

export type AuthAuditEventStore = {
  append(event: AuthAuditEvent): AuthAuditEvent | null;
  listByOwner(ownerKey: string): AuthAuditEvent[];
};

export type AuthAuditWriteResult =
  | { event: AuthAuditEvent; ok: true }
  | { error: string; event: AuthAuditEvent; ok: false };

const SECRET_KEY_PATTERNS = [
  /access.?token/i,
  /refresh.?token/i,
  /^token$/i,
  /session.?token/i,
  /session.?id.?hash/i,
  /authorization/i,
  /cookie/i,
  /secret/i,
  /client.?secret/i,
  /api.?key/i,
  /password/i,
  /code.?verifier/i,
];

const defaultStore: AuthAuditEventStore = {
  append(event) {
    return shouldUseNoopAuditStoreForTests() ? event : appendAuthAuditEvent(event);
  },
  listByOwner(ownerKey) {
    return shouldUseNoopAuditStoreForTests()
      ? []
      : getAuthAuditEventsByOwnerEmail(ownerKey);
  },
};

let testStore: AuthAuditEventStore | null = null;

export function recordAuthAuditEvent(
  input: AuthAuditInput,
  options: {
    now?: Date;
    store?: AuthAuditEventStore;
    throwOnFailure?: boolean;
  } = {},
): AuthAuditWriteResult {
  const event = buildAuthAuditEvent(input, options.now);
  const store = options.store ?? testStore ?? defaultStore;

  try {
    const persisted = store.append(event);
    if (!persisted) {
      throw new Error("Audit event was not persisted.");
    }

    return { event: persisted, ok: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Audit event persistence failed.";
    if (options.throwOnFailure) {
      throw error;
    }

    const log = process.env.NODE_ENV === "production" ? console.error : console.warn;
    log("[auth-audit] append failed", {
      eventType: event.eventType,
      reason: message,
    });

    return { error: message, event, ok: false };
  }
}

export function getAuthAuditEventsForPrincipal(
  principal: AppPrincipal,
  options: { store?: AuthAuditEventStore } = {},
) {
  const store = options.store ?? testStore ?? defaultStore;
  return store.listByOwner(principal.ownerKey);
}

export function buildAuthAuditEvent(
  input: AuthAuditInput,
  now = new Date(),
): AuthAuditEvent {
  const actorOwnerKey = resolveOwnerKey(input);
  const actorWorkspaceId =
    input.principal?.workspaceId ??
    input.actorWorkspaceId ??
    (actorOwnerKey ? buildWorkspaceIdFromOwnerKey(actorOwnerKey) : null);
  const actorEmail =
    input.principal?.email ?? input.actorEmail ?? input.actorOwnerKey ?? null;

  return {
    id: crypto.randomUUID(),
    actorEmailHash: actorEmail ? hashAuditIdentifier(actorEmail) : null,
    actorOwnerKey,
    actorWorkspaceId,
    createdAt: now.toISOString(),
    eventType: input.eventType,
    metadataJson: JSON.stringify(sanitizeAuditMetadata(input.metadata ?? {})),
    provider: normalizeOptionalString(input.provider),
    reason: normalizeOptionalString(input.reason),
    requestId: normalizeOptionalString(input.requestId),
    resourceIdHash:
      normalizeOptionalString(input.resourceIdHash) ??
      (input.resourceId ? hashAuditIdentifier(input.resourceId) : null),
    resourceType: normalizeOptionalString(input.resourceType),
    status: normalizeOptionalString(input.status),
  };
}

export function sanitizeAuditMetadata(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeValue(value, new WeakSet());
  return isPlainObject(sanitized) ? sanitized : {};
}

export function hashAuditIdentifier(value: string) {
  return crypto
    .createHash("sha256")
    .update(value.trim().toLowerCase())
    .digest("hex");
}

export function setAuthAuditEventStoreForTests(
  store: AuthAuditEventStore | null,
) {
  testStore = store;
}

function resolveOwnerKey(input: AuthAuditInput) {
  const ownerKey =
    input.principal?.ownerKey ?? input.actorOwnerKey ?? input.actorEmail ?? null;
  if (!ownerKey) {
    return null;
  }

  try {
    return normalizeOwnerEmail(ownerKey);
  } catch {
    return null;
  }
}

function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value == null) {
    return value;
  }

  if (typeof value === "string") {
    return redactSensitiveString(value);
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, seen));
  }

  if (!isPlainObject(value)) {
    return String(value);
  }

  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      output[key] = "[REDACTED]";
      continue;
    }

    output[key] = sanitizeValue(entry, seen);
  }

  seen.delete(value);
  return output;
}

function isSensitiveKey(key: string) {
  return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function redactSensitiveString(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/ya29\.[A-Za-z0-9._~+/=-]+/g, "[REDACTED_GOOGLE_TOKEN]");
}

function normalizeOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function shouldUseNoopAuditStoreForTests() {
  return (
    process.env.NODE_ENV === "test" ||
    process.argv.some((arg) => arg.endsWith(".test.mjs"))
  );
}
