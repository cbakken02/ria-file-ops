import "server-only";

import crypto from "node:crypto";
import type { Session } from "next-auth";
import {
  getAppSessionActivityByIdHash,
  invalidateAppSessionActivity,
  upsertAppSessionActivity,
  type AppSessionActivity,
} from "@/lib/db";
import type { AppPrincipal } from "@/lib/auth/principal";

export const SESSION_IDLE_TIMEOUT_MS = 60 * 60 * 1000;
export const SESSION_ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000;
export const SESSION_ACTIVITY_UPDATE_THROTTLE_MS = 5 * 60 * 1000;

export type SessionActivityDenialReason =
  | "missing_session_identifier"
  | "missing_session_created_at"
  | "invalidated"
  | "idle_timeout"
  | "absolute_timeout"
  | "verification_failed";

export type SessionActivityCheck = {
  absoluteExpiresAt: string;
  idleExpiresAt: string;
  record: AppSessionActivity;
  touched: boolean;
};

export type SessionActivityStore = {
  get(sessionIdHash: string): AppSessionActivity | null;
  invalidate(input: {
    invalidatedAt: string;
    ownerEmail: string;
    sessionIdHash: string;
    userId: string;
    workspaceId: string;
  }): AppSessionActivity | null;
  upsert(input: {
    createdAt: string;
    lastActivityAt: string;
    ownerEmail: string;
    sessionIdHash: string;
    updatedAt: string;
    userId: string;
    workspaceId: string;
  }): AppSessionActivity | null;
};

type SessionActivitySession =
  | Pick<Session, "appSessionCreatedAt" | "appSessionIdHash">
  | {
      appSessionCreatedAt?: string | null;
      appSessionIdHash?: string | null;
    }
  | null
  | undefined;

type SessionActivityOptions = {
  now?: Date;
  store?: SessionActivityStore;
  touch?: boolean;
};

const defaultStore: SessionActivityStore = {
  get: getAppSessionActivityByIdHash,
  invalidate: invalidateAppSessionActivity,
  upsert: upsertAppSessionActivity,
};

let testStore: SessionActivityStore | null = null;

export class SessionActivityError extends Error {
  readonly reason: SessionActivityDenialReason;
  readonly status = 401 as const;

  constructor(reason: SessionActivityDenialReason, message = "Session expired.") {
    super(message);
    this.name = "SessionActivityError";
    this.reason = reason;
  }
}

export function hashSessionIdentifier(identifier: string) {
  return crypto.createHash("sha256").update(identifier).digest("hex");
}

export async function enforceSessionActivity(
  session: SessionActivitySession,
  principal: AppPrincipal,
  options: SessionActivityOptions = {},
): Promise<SessionActivityCheck> {
  const now = options.now ?? new Date();
  const store = options.store ?? testStore ?? defaultStore;
  const sessionIdHash = readSessionIdHash(session);
  const sessionCreatedAt = parseIsoTimestamp(session?.appSessionCreatedAt);

  if (!sessionIdHash) {
    throw new SessionActivityError("missing_session_identifier");
  }

  if (!sessionCreatedAt) {
    throw new SessionActivityError("missing_session_created_at");
  }

  try {
    const existing = store.get(sessionIdHash);
    if (existing?.invalidatedAt) {
      throw new SessionActivityError("invalidated");
    }

    const absoluteExpiresAt = new Date(
      sessionCreatedAt.getTime() + SESSION_ABSOLUTE_TIMEOUT_MS,
    );
    if (now.getTime() >= absoluteExpiresAt.getTime()) {
      throw new SessionActivityError("absolute_timeout");
    }

    const readOnly = options.touch === false;
    const lastActivityAt = existing
      ? parseStoredTimestamp(existing.lastActivityAt, "lastActivityAt")
      : readOnly
        ? sessionCreatedAt
        : now;
    const idleExpiresAt = new Date(
      lastActivityAt.getTime() + SESSION_IDLE_TIMEOUT_MS,
    );
    if (now.getTime() >= idleExpiresAt.getTime()) {
      throw new SessionActivityError("idle_timeout");
    }

    const canTouch = !readOnly;
    const shouldTouch =
      canTouch &&
      (!existing ||
        now.getTime() - lastActivityAt.getTime() >=
          SESSION_ACTIVITY_UPDATE_THROTTLE_MS);
    const record = shouldTouch
      ? store.upsert({
          createdAt: sessionCreatedAt.toISOString(),
          lastActivityAt: now.toISOString(),
          ownerEmail: principal.ownerKey,
          sessionIdHash,
          updatedAt: now.toISOString(),
          userId: principal.userId,
          workspaceId: principal.workspaceId,
        })
      : existing ?? {
          createdAt: sessionCreatedAt.toISOString(),
          invalidatedAt: null,
          lastActivityAt: sessionCreatedAt.toISOString(),
          ownerEmail: principal.ownerKey,
          sessionIdHash,
          updatedAt: sessionCreatedAt.toISOString(),
          userId: principal.userId,
          workspaceId: principal.workspaceId,
        };

    if (!record) {
      throw new SessionActivityError("verification_failed");
    }

    return {
      absoluteExpiresAt: absoluteExpiresAt.toISOString(),
      idleExpiresAt: new Date(
        parseStoredTimestamp(record.lastActivityAt, "lastActivityAt").getTime() +
          SESSION_IDLE_TIMEOUT_MS,
      ).toISOString(),
      record,
      touched: shouldTouch,
    };
  } catch (error) {
    if (error instanceof SessionActivityError) {
      throw error;
    }

    throw new SessionActivityError(
      "verification_failed",
      "Session verification failed.",
    );
  }
}

export async function invalidateSessionActivityForSession(
  session: SessionActivitySession,
  principal: AppPrincipal,
  options: SessionActivityOptions = {},
) {
  const now = options.now ?? new Date();
  const store = options.store ?? testStore ?? defaultStore;
  const sessionIdHash = readSessionIdHash(session);

  if (!sessionIdHash) {
    return null;
  }

  return store.invalidate({
    invalidatedAt: now.toISOString(),
    ownerEmail: principal.ownerKey,
    sessionIdHash,
    userId: principal.userId,
    workspaceId: principal.workspaceId,
  });
}

export function setSessionActivityStoreForTests(
  store: SessionActivityStore | null,
) {
  testStore = store;
}

function readSessionIdHash(session: SessionActivitySession) {
  const value = session?.appSessionIdHash?.trim();
  return value && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
}

function parseIsoTimestamp(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseStoredTimestamp(
  value: string,
  fieldName: "createdAt" | "lastActivityAt" | "updatedAt",
) {
  const parsed = parseIsoTimestamp(value);
  if (!parsed) {
    throw new SessionActivityError(
      "verification_failed",
      `Session ${fieldName} is invalid.`,
    );
  }

  return parsed;
}
