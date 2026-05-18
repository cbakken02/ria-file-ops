import "server-only";

import type { Session } from "next-auth";
import {
  getAppSessionActivityByIdHash,
  type AppSessionActivity,
  type StorageConnection,
} from "@/lib/db";
import type { AppPrincipal } from "@/lib/auth/principal";
import {
  SESSION_ABSOLUTE_TIMEOUT_MS,
  SESSION_IDLE_TIMEOUT_MS,
} from "@/lib/auth/session-activity";
import { getCachedActiveStorageConnectionForSession } from "@/lib/storage-connections";

export const SESSION_IDLE_WARNING_THRESHOLD_MS = 10 * 60 * 1000;

export type SafeAccountSessionStatus = {
  user: {
    email: string;
    role: AppPrincipal["role"];
    workspaceId: string;
  };
  session: {
    absoluteExpiresAt: string;
    idleExpiresAt: string;
    idleWarningStartsAt: string;
    lastActivityAt: string;
    status: "active" | "idle_warning" | "expired";
  };
  storage: {
    accountIdentifier: string | null;
    needsReconnect: boolean;
    provider: string | null;
    providerLabel: string;
    status: "connected" | "needs_reconnect" | "not_connected";
  };
};

type BuildStatusInput = {
  activity: AppSessionActivity | null;
  activeConnection: StorageConnection | null;
  now?: Date;
  principal: AppPrincipal;
  session: Pick<Session, "appSessionCreatedAt" | "appSessionIdHash">;
};

type ReadStatusOptions = {
  now?: Date;
  readActivity?: (sessionIdHash: string) => AppSessionActivity | null;
  readStorageConnection?: (session: Session) => StorageConnection | null;
};

export async function getAccountSessionStatusForSession(
  session: Session,
  principal: AppPrincipal,
  options: ReadStatusOptions = {},
): Promise<SafeAccountSessionStatus> {
  const sessionIdHash = readSessionIdHash(session);
  const activity = sessionIdHash
    ? (options.readActivity ?? getAppSessionActivityByIdHash)(sessionIdHash)
    : null;
  const activeConnection = (options.readStorageConnection ??
    getCachedActiveStorageConnectionForSession)(session);

  return buildAccountSessionStatus({
    activity,
    activeConnection,
    now: options.now,
    principal,
    session,
  });
}

export function buildAccountSessionStatus({
  activity,
  activeConnection,
  now = new Date(),
  principal,
  session,
}: BuildStatusInput): SafeAccountSessionStatus {
  const sessionCreatedAt =
    parseIsoTimestamp(session.appSessionCreatedAt) ?? now;
  const lastActivityAt =
    parseIsoTimestamp(activity?.lastActivityAt) ?? sessionCreatedAt;
  const absoluteExpiresAt = new Date(
    sessionCreatedAt.getTime() + SESSION_ABSOLUTE_TIMEOUT_MS,
  );
  const idleExpiresAt = new Date(
    lastActivityAt.getTime() + SESSION_IDLE_TIMEOUT_MS,
  );
  const idleWarningStartsAt = new Date(
    idleExpiresAt.getTime() - SESSION_IDLE_WARNING_THRESHOLD_MS,
  );
  const sessionStatus =
    activity?.invalidatedAt ||
    now.getTime() >= idleExpiresAt.getTime() ||
    now.getTime() >= absoluteExpiresAt.getTime()
      ? "expired"
      : now.getTime() >= idleWarningStartsAt.getTime()
        ? "idle_warning"
        : "active";

  return {
    user: {
      email: principal.email,
      role: principal.role,
      workspaceId: principal.workspaceId,
    },
    session: {
      absoluteExpiresAt: absoluteExpiresAt.toISOString(),
      idleExpiresAt: idleExpiresAt.toISOString(),
      idleWarningStartsAt: idleWarningStartsAt.toISOString(),
      lastActivityAt: lastActivityAt.toISOString(),
      status: sessionStatus,
    },
    storage: getSafeStorageStatus(activeConnection),
  };
}

function getSafeStorageStatus(connection: StorageConnection | null) {
  if (!connection) {
    return {
      accountIdentifier: null,
      needsReconnect: false,
      provider: null,
      providerLabel: "Storage",
      status: "not_connected" as const,
    };
  }

  const needsReconnect = connection.status === "needs_reauth";

  return {
    accountIdentifier:
      connection.accountEmail ??
      connection.accountName ??
      connection.externalAccountId,
    needsReconnect,
    provider: connection.provider,
    providerLabel: getProviderLabel(connection.provider),
    status: needsReconnect
      ? ("needs_reconnect" as const)
      : ("connected" as const),
  };
}

function getProviderLabel(provider: string | null | undefined) {
  switch (provider) {
    case "google_drive":
      return "Google Drive";
    case "sharefile":
      return "Progress ShareFile";
    case "sharepoint":
      return "Microsoft SharePoint";
    case "dropbox":
      return "Dropbox";
    default:
      return "Storage";
  }
}

function readSessionIdHash(
  session: Pick<Session, "appSessionIdHash"> | null | undefined,
) {
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
