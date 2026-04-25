import type { Session } from "next-auth";
import {
  getStorageConnectionsByOwnerEmail,
  saveStorageConnectionForOwner,
  type StorageConnection,
} from "@/lib/db";
import {
  GOOGLE_DRIVE_READ_SCOPE,
  GOOGLE_DRIVE_WRITE_SCOPE,
  isGoogleDriveAccessFailure,
  verifyDriveBrowserAccess,
} from "@/lib/google-drive";

export function storageConnectionHasWriteAccess(connection: StorageConnection | null) {
  if (!connection) {
    return false;
  }

  return connection.grantedScopes.includes(GOOGLE_DRIVE_WRITE_SCOPE);
}

export function getCachedActiveStorageConnectionForSession(
  session: Session,
): StorageConnection | null {
  return getPrimaryConnection(getCachedStorageConnectionsForSession(session));
}

export function getCachedStorageConnectionsForSession(
  session: Session,
): StorageConnection[] {
  const ownerEmail = session.user?.email ?? "";
  if (!ownerEmail) {
    return [];
  }

  return getStorageConnectionsByOwnerEmail(ownerEmail);
}

export async function getActiveStorageConnectionForSession(
  session: Session,
): Promise<StorageConnection | null> {
  const ownerEmail = session.user?.email ?? "";
  if (!ownerEmail) {
    return null;
  }

  const connections = getSessionStorageConnections(session);
  const primary = getPrimaryConnection(connections);

  if (!primary) {
    return null;
  }

  const sessionAccessToken = session.accessToken;

  if (shouldUseSessionStorageAccess(primary, session) && sessionAccessToken) {
    return {
      ...primary,
      accessToken: sessionAccessToken,
      grantedScopes: getSessionDriveScopes(session),
      status: session.authError ? "needs_reauth" : "connected",
    } satisfies StorageConnection;
  }

  return refreshStorageConnectionIfNeeded(primary);
}

export async function getVerifiedActiveStorageConnectionForSession(
  session: Session,
): Promise<StorageConnection | null> {
  const activeConnection = await getActiveStorageConnectionForSession(session);

  if (!activeConnection || activeConnection.status !== "connected") {
    return null;
  }

  if (activeConnection.provider !== "google_drive") {
    return activeConnection;
  }

  try {
    await verifyDriveBrowserAccess(activeConnection.accessToken);
    return activeConnection;
  } catch (error) {
    if (isGoogleDriveAccessFailure(error)) {
      markStorageConnectionNeedsReauth(activeConnection);
    }

    return null;
  }
}

export async function getStorageConnectionsForSession(session: Session) {
  const ownerEmail = session.user?.email ?? "";
  if (!ownerEmail) {
    return [];
  }

  const connections = getSessionStorageConnections(session);
  const primaryConnection = getPrimaryConnection(connections);
  const primary = primaryConnection
    ? await resolveUsableStorageConnection(primaryConnection, session)
    : null;

  return connections.map((connection) =>
    primary && connection.id === primary.id ? primary : connection,
  );
}

function getSessionStorageConnections(session: Session) {
  return (
    syncSessionGoogleConnection(session) ??
    getStorageConnectionsByOwnerEmail(session.user?.email ?? "")
  );
}

function getPrimaryConnection(connections: StorageConnection[]) {
  return connections.find((connection) => connection.isPrimary) ?? connections[0] ?? null;
}

async function resolveUsableStorageConnection(
  connection: StorageConnection,
  session: Session,
) {
  const sessionAccessToken = session.accessToken;

  if (shouldUseSessionStorageAccess(connection, session) && sessionAccessToken) {
    return {
      ...connection,
      accessToken: sessionAccessToken,
      grantedScopes: getSessionDriveScopes(session),
      status: session.authError ? "needs_reauth" : "connected",
    } satisfies StorageConnection;
  }

  return refreshStorageConnectionIfNeeded(connection);
}

async function refreshStorageConnectionIfNeeded(connection: StorageConnection) {
  if (connection.provider !== "google_drive") {
    return connection;
  }

  if (
    typeof connection.expiresAt === "number" &&
    Date.now() < (connection.expiresAt - 60) * 1000
  ) {
    return connection;
  }

  if (!connection.refreshToken) {
    return saveStorageConnectionForOwner({
      ownerEmail: connection.ownerEmail,
      provider: connection.provider,
      accountEmail: connection.accountEmail,
      accountName: connection.accountName,
      accountImage: connection.accountImage,
      externalAccountId: connection.externalAccountId,
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      expiresAt: connection.expiresAt,
      grantedScopes: connection.grantedScopes,
      status: "needs_reauth",
      makePrimary: connection.isPrimary,
    });
  }

  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID ?? "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
        grant_type: "refresh_token",
        refresh_token: connection.refreshToken,
      }),
    });

    const refreshed = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      scope?: string;
    };

    if (!response.ok || !refreshed.access_token) {
      return saveStorageConnectionForOwner({
        ownerEmail: connection.ownerEmail,
        provider: connection.provider,
        accountEmail: connection.accountEmail,
        accountName: connection.accountName,
        accountImage: connection.accountImage,
        externalAccountId: connection.externalAccountId,
        accessToken: connection.accessToken,
        refreshToken: connection.refreshToken,
        expiresAt: connection.expiresAt,
        grantedScopes: connection.grantedScopes,
        status: "needs_reauth",
        makePrimary: connection.isPrimary,
      });
    }

    return saveStorageConnectionForOwner({
      ownerEmail: connection.ownerEmail,
      provider: connection.provider,
      accountEmail: connection.accountEmail,
      accountName: connection.accountName,
      accountImage: connection.accountImage,
      externalAccountId: connection.externalAccountId,
      accessToken: refreshed.access_token,
      refreshToken: connection.refreshToken,
      expiresAt:
        typeof refreshed.expires_in === "number"
          ? Math.floor(Date.now() / 1000) + refreshed.expires_in
          : connection.expiresAt,
      grantedScopes:
        typeof refreshed.scope === "string"
          ? refreshed.scope.split(" ")
          : connection.grantedScopes,
      status: "connected",
      makePrimary: connection.isPrimary,
    });
  } catch {
    return saveStorageConnectionForOwner({
      ownerEmail: connection.ownerEmail,
      provider: connection.provider,
      accountEmail: connection.accountEmail,
      accountName: connection.accountName,
      accountImage: connection.accountImage,
      externalAccountId: connection.externalAccountId,
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      expiresAt: connection.expiresAt,
      grantedScopes: connection.grantedScopes,
      status: "needs_reauth",
      makePrimary: connection.isPrimary,
    });
  }
}

function syncSessionGoogleConnection(session: Session) {
  const ownerEmail = session.user?.email ?? "";

  if (!ownerEmail || !session.accessToken || !session.driveConnected) {
    return null;
  }

  const connections = getStorageConnectionsByOwnerEmail(ownerEmail);
  const existingConnection = connections.find((connection) =>
    matchesCurrentSession(connection, session),
  );
  const sessionDriveScopes = getSessionDriveScopes(session);
  const nextStatus = session.authError ? "needs_reauth" : "connected";
  const hasPrimaryConnection = connections.some((connection) => connection.isPrimary);

  if (
    existingConnection &&
    existingConnection.status === nextStatus &&
    (hasPrimaryConnection || existingConnection.isPrimary) &&
    haveSameScopes(existingConnection.grantedScopes, sessionDriveScopes)
  ) {
    return connections;
  }

  const savedConnection = saveStorageConnectionForOwner({
    ownerEmail,
    provider: "google_drive",
    accountEmail: session.user?.email ?? null,
    accountName: session.user?.name ?? null,
    accountImage: session.user?.image ?? null,
    externalAccountId: session.user?.id ?? session.user?.email ?? null,
    accessToken: session.accessToken,
    refreshToken: null,
    expiresAt: null,
    grantedScopes: sessionDriveScopes,
    status: nextStatus,
    makePrimary: !hasPrimaryConnection,
  });

  if (!savedConnection) {
    return connections;
  }

  return getStorageConnectionsByOwnerEmail(ownerEmail);
}

export function markStorageConnectionNeedsReauth(connection: StorageConnection) {
  return saveStorageConnectionForOwner({
    ownerEmail: connection.ownerEmail,
    provider: connection.provider,
    accountEmail: connection.accountEmail,
    accountName: connection.accountName,
    accountImage: connection.accountImage,
    externalAccountId: connection.externalAccountId,
    accessToken: connection.accessToken,
    refreshToken: connection.refreshToken,
    expiresAt: connection.expiresAt,
    grantedScopes: connection.grantedScopes,
    status: "needs_reauth",
    makePrimary: connection.isPrimary,
  });
}

function matchesCurrentSession(connection: StorageConnection, session: Session) {
  const sessionUserId = session.user?.id ?? null;
  const sessionEmail = session.user?.email ?? null;

  return (
    connection.provider === "google_drive" &&
    ((sessionUserId && connection.externalAccountId === sessionUserId) ||
      (sessionEmail && connection.accountEmail === sessionEmail))
  );
}

function shouldUseSessionStorageAccess(
  connection: StorageConnection,
  session: Session,
) {
  if (!matchesCurrentSession(connection, session) || !session.accessToken) {
    return false;
  }

  const sessionDriveScopes = getSessionDriveScopes(session);
  if (!sessionDriveScopes.length) {
    return false;
  }

  const hasPersistedStorageSession =
    Boolean(connection.refreshToken) || typeof connection.expiresAt === "number";

  return !hasPersistedStorageSession;
}

function getSessionDriveScopes(session: Session) {
  return session.grantedScopes.filter(
    (scope) =>
      scope === GOOGLE_DRIVE_READ_SCOPE || scope === GOOGLE_DRIVE_WRITE_SCOPE,
  );
}

function haveSameScopes(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  const rightScopes = new Set(right);
  return left.every((scope) => rightScopes.has(scope));
}
