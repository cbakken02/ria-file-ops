import type { Session } from "next-auth";
import {
  getAppPrincipalFromSession,
  getLegacyOwnerEmail,
  normalizeOwnerEmail,
  type AppPrincipal,
} from "@/lib/auth/principal";
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

type StorageConnectionReadOptions = {
  source?: string;
  readConnections?: (ownerEmail: string) => StorageConnection[];
};

type StorageConnectionReadResult = {
  connections: StorageConnection[];
  unavailable: boolean;
};

type ActiveStorageAuthorizationOptions = {
  getActiveStorageConnection?: (
    session: Session,
  ) => Promise<StorageConnection | null>;
  reconnectMessage?: string;
  signInMessage?: string;
};

export type ActiveStorageAuthorizationResult =
  | {
      ok: true;
      connection: StorageConnection;
      ownerEmail: string;
    }
  | {
      ok: false;
      error: string;
      ownerEmail: string | null;
      status: 401;
    };

export type StorageOAuthConnectionDecision =
  | {
      ok: true;
      mode: "connect" | "reconnect" | "replace";
      makePrimary: true;
    }
  | {
      ok: false;
      mode: "blocked_different_account";
      activeAccountLabel: string;
    };

export function storageConnectionHasWriteAccess(connection: StorageConnection | null) {
  if (!connection) {
    return false;
  }

  return connection.grantedScopes.includes(GOOGLE_DRIVE_WRITE_SCOPE);
}

export function getSafeStorageConnectionsByOwnerEmail(
  ownerEmail: string,
  options: StorageConnectionReadOptions = {},
) {
  return readStorageConnectionsByOwnerEmail(ownerEmail, options).connections;
}

export function getCachedActiveStorageConnectionForSession(
  session: Session,
  options: StorageConnectionReadOptions = {},
): StorageConnection | null {
  const principal = getPrincipalFromSessionOrNull(session);

  if (!principal) {
    return null;
  }

  return getCachedActiveStorageConnectionForPrincipal(principal, options);
}

export function getCachedActiveStorageConnectionForPrincipal(
  principal: AppPrincipal,
  options: StorageConnectionReadOptions = {},
): StorageConnection | null {
  return getPrimaryConnection(
    getSafeStorageConnectionsByOwnerEmail(getLegacyOwnerEmail(principal), {
      ...options,
      source: options.source ?? "cached-storage-connections",
    }),
  );
}

export function getCachedStorageConnectionsForSession(
  session: Session,
  options: StorageConnectionReadOptions = {},
): StorageConnection[] {
  const principal = getPrincipalFromSessionOrNull(session);
  if (!principal) {
    return [];
  }

  return getSafeStorageConnectionsByOwnerEmail(getLegacyOwnerEmail(principal), {
    ...options,
    source: options.source ?? "cached-storage-connections",
  });
}

export async function getActiveStorageConnectionForSession(
  session: Session,
): Promise<StorageConnection | null> {
  const principal = getPrincipalFromSessionOrNull(session);
  if (!principal) {
    return null;
  }

  return getActiveStorageConnectionForPrincipal(principal, session);
}

export async function getActiveStorageConnectionForPrincipal(
  principal: AppPrincipal,
  session?: Session,
): Promise<StorageConnection | null> {
  const connections = session
    ? getSessionStorageConnections(session, principal)
    : getSafeStorageConnectionsByOwnerEmail(getLegacyOwnerEmail(principal), {
        source: "principal-storage-connections",
      });
  const primary = getPrimaryConnection(connections);

  if (!primary) {
    return null;
  }

  const sessionAccessToken = session?.accessToken;

  if (session && shouldUseSessionStorageAccess(primary, session) && sessionAccessToken) {
    return {
      ...primary,
      accessToken: sessionAccessToken,
      grantedScopes: getSessionDriveScopes(session),
      status: session.authError ? "needs_reauth" : "connected",
    } satisfies StorageConnection;
  }

  return refreshStorageConnectionIfNeeded(primary);
}

export async function resolveActiveStorageAuthorizationForSession(
  session: Session | null | undefined,
  options: ActiveStorageAuthorizationOptions = {},
): Promise<ActiveStorageAuthorizationResult> {
  const principal = getPrincipalFromSessionOrNull(session);

  if (!session?.user || !principal) {
    return {
      ok: false,
      error: options.signInMessage ?? "Sign in before using storage.",
      ownerEmail: null,
      status: 401,
    };
  }

  const resolveConnection =
    options.getActiveStorageConnection ?? getActiveStorageConnectionForSession;
  const activeConnection = await resolveConnection(session);
  const ownerEmail = getLegacyOwnerEmail(principal);

  if (!activeConnection || activeConnection.status !== "connected") {
    return {
      ok: false,
      error:
        options.reconnectMessage ??
        "Reconnect the active storage connection before continuing.",
      ownerEmail,
      status: 401,
    };
  }

  return {
    ok: true,
    connection: activeConnection,
    ownerEmail,
  };
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
  const principal = getPrincipalFromSessionOrNull(session);
  if (!principal) {
    return [];
  }

  const connections = getSessionStorageConnections(session, principal);
  const primaryConnection = getPrimaryConnection(connections);
  const primary = primaryConnection
    ? await resolveUsableStorageConnection(primaryConnection, session)
    : null;

  return connections.map((connection) =>
    primary && connection.id === primary.id ? primary : connection,
  );
}

function getSessionStorageConnections(
  session: Session,
  principal: AppPrincipal,
) {
  return (
    syncSessionGoogleConnection(session, principal) ??
    getSafeStorageConnectionsByOwnerEmail(getLegacyOwnerEmail(principal), {
      source: "session-storage-connections",
    })
  );
}

function readStorageConnectionsByOwnerEmail(
  ownerEmail: string,
  options: StorageConnectionReadOptions = {},
): StorageConnectionReadResult {
  let normalizedOwnerEmail: string;
  try {
    normalizedOwnerEmail = normalizeOwnerEmail(ownerEmail);
  } catch {
    return { connections: [], unavailable: false };
  }

  try {
    return {
      connections: (options.readConnections ?? getStorageConnectionsByOwnerEmail)(
        normalizedOwnerEmail,
      ),
      unavailable: false,
    };
  } catch (error) {
    logStorageConnectionPersistenceFailure(
      error,
      options.source ?? "storage-connections",
      "read",
    );
    return { connections: [], unavailable: true };
  }
}

function getPrimaryConnection(connections: StorageConnection[]) {
  return connections.find((connection) => connection.isPrimary) ?? null;
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

function syncSessionGoogleConnection(session: Session, principal: AppPrincipal) {
  const ownerEmail = getLegacyOwnerEmail(principal);

  if (!ownerEmail || !session.accessToken || !session.driveConnected) {
    return null;
  }

  const readResult = readStorageConnectionsByOwnerEmail(ownerEmail, {
    source: "sync-session-google-connection",
  });
  const connections = readResult.connections;

  if (readResult.unavailable) {
    return connections;
  }

  const existingConnection = connections.find((connection) =>
    matchesCurrentSession(connection, session),
  );
  const activeConnection = getPrimaryConnection(connections);
  const sessionDriveScopes = getSessionDriveScopes(session);
  const nextStatus = session.authError ? "needs_reauth" : "connected";
  const canSyncSessionConnection =
    !activeConnection ||
    (existingConnection ? activeConnection.id === existingConnection.id : false);

  if (!canSyncSessionConnection) {
    return connections;
  }

  if (
    existingConnection &&
    existingConnection.status === nextStatus &&
    existingConnection.isPrimary &&
    haveSameScopes(existingConnection.grantedScopes, sessionDriveScopes)
  ) {
    return connections;
  }

  let savedConnection: StorageConnection | null = null;
  try {
    savedConnection = saveStorageConnectionForOwner({
      ownerEmail,
      provider: "google_drive",
      accountEmail: principal.email,
      accountName: session.user?.name ?? null,
      accountImage: session.user?.image ?? null,
      externalAccountId: session.user?.id ?? principal.email,
      accessToken: session.accessToken,
      refreshToken: null,
      expiresAt: null,
      grantedScopes: sessionDriveScopes,
      status: nextStatus,
      makePrimary: !activeConnection || existingConnection?.isPrimary === true,
    });
  } catch (error) {
    logStorageConnectionPersistenceFailure(
      error,
      "sync-session-google-connection",
      "write",
    );
    return connections;
  }

  if (!savedConnection) {
    return connections;
  }

  return getSafeStorageConnectionsByOwnerEmail(ownerEmail, {
    source: "sync-session-google-connection-after-save",
  });
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

export function resolveStorageOAuthConnectionDecision(input: {
  activeConnection: StorageConnection | null | undefined;
  candidate: {
    accountEmail?: string | null;
    externalAccountId?: string | null;
    provider: string;
  };
  replaceRequested?: boolean;
}): StorageOAuthConnectionDecision {
  const activeConnection = input.activeConnection ?? null;

  if (!activeConnection) {
    return { ok: true, makePrimary: true, mode: "connect" };
  }

  if (matchesStorageAccount(activeConnection, input.candidate)) {
    return { ok: true, makePrimary: true, mode: "reconnect" };
  }

  if (input.replaceRequested) {
    return { ok: true, makePrimary: true, mode: "replace" };
  }

  return {
    ok: false,
    activeAccountLabel:
      activeConnection.accountEmail ??
      activeConnection.accountName ??
      "the current storage account",
    mode: "blocked_different_account",
  };
}

function matchesCurrentSession(connection: StorageConnection, session: Session) {
  const principal = getPrincipalFromSessionOrNull(session);

  if (!principal) {
    return false;
  }

  return matchesStorageAccount(connection, {
    accountEmail: principal.email,
    externalAccountId: session.user?.id ?? principal.email,
    provider: "google_drive",
  });
}

function matchesStorageAccount(
  connection: StorageConnection,
  candidate: {
    accountEmail?: string | null;
    externalAccountId?: string | null;
    provider: string;
  },
) {
  if (connection.provider !== candidate.provider) {
    return false;
  }

  const candidateExternalAccountId = candidate.externalAccountId?.trim() ?? "";
  if (
    candidateExternalAccountId &&
    connection.externalAccountId === candidateExternalAccountId
  ) {
    return true;
  }

  const connectionEmail = connection.accountEmail?.trim().toLowerCase() ?? "";
  const candidateEmail = candidate.accountEmail?.trim().toLowerCase() ?? "";
  return Boolean(connectionEmail && candidateEmail && connectionEmail === candidateEmail);
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

function logStorageConnectionPersistenceFailure(
  error: unknown,
  source: string,
  operation: "read" | "write",
) {
  console.warn("[storage-connections] persistence failure", {
    message: getErrorMessage(error),
    operation,
    source,
  });
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown storage persistence error";
}

function getPrincipalFromSessionOrNull(
  session: Session | null | undefined,
): AppPrincipal | null {
  try {
    return getAppPrincipalFromSession(session);
  } catch {
    return null;
  }
}
