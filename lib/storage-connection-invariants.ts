import crypto from "node:crypto";
import type { StorageConnection } from "@/lib/db";

export type ActiveStorageDuplicateDiagnostic = {
  activeCount: number;
  activeConnections: Array<{
    accountIdentifierHash: string | null;
    id: string;
    ownerEmail: string;
    provider: string;
  }>;
  normalizedOwnerKey: string;
  ownerEmailVariants: string[];
  reasons: string[];
};

export function normalizeStorageOwnerKey(ownerEmail: string) {
  return ownerEmail.trim().toLowerCase();
}

export function findDuplicateActiveStorageConnections(
  connections: StorageConnection[],
): ActiveStorageDuplicateDiagnostic[] {
  const activeByOwnerKey = new Map<string, StorageConnection[]>();

  for (const connection of connections) {
    if (!connection.isPrimary) {
      continue;
    }

    const ownerKey = normalizeStorageOwnerKey(connection.ownerEmail);
    if (!ownerKey) {
      continue;
    }

    const existing = activeByOwnerKey.get(ownerKey) ?? [];
    existing.push(connection);
    activeByOwnerKey.set(ownerKey, existing);
  }

  return [...activeByOwnerKey.entries()]
    .filter(([, activeConnections]) => activeConnections.length > 1)
    .map(([normalizedOwnerKey, activeConnections]) =>
      buildDuplicateDiagnostic(normalizedOwnerKey, activeConnections),
    );
}

export function summarizeStorageInvariantDiagnostics(
  diagnostics: ActiveStorageDuplicateDiagnostic[],
) {
  return diagnostics.map((diagnostic) => ({
    activeCount: diagnostic.activeCount,
    activeConnectionIds: diagnostic.activeConnections.map(
      (connection) => connection.id,
    ),
    normalizedOwnerKey: diagnostic.normalizedOwnerKey,
    ownerEmailVariants: diagnostic.ownerEmailVariants,
    reasons: diagnostic.reasons,
  }));
}

function buildDuplicateDiagnostic(
  normalizedOwnerKey: string,
  activeConnections: StorageConnection[],
): ActiveStorageDuplicateDiagnostic {
  const ownerEmailVariants = uniqueSorted(
    activeConnections.map((connection) => connection.ownerEmail),
  );
  const accountFingerprints = uniqueSorted(
    activeConnections.map((connection) =>
      [
        connection.provider,
        connection.externalAccountId ?? "",
        connection.accountEmail?.trim().toLowerCase() ?? "",
      ].join(":"),
    ),
  );
  const reasons = ["multiple_active_connections"];

  if (ownerEmailVariants.length > 1) {
    reasons.push("owner_email_case_or_whitespace_variants");
  }

  if (accountFingerprints.length > 1) {
    reasons.push("different_provider_or_account_active");
  } else {
    reasons.push("duplicate_primary_for_same_provider_account");
  }

  return {
    activeConnections: activeConnections.map((connection) => ({
      accountIdentifierHash: hashStorageDiagnosticIdentifier(
        connection.externalAccountId ?? connection.accountEmail,
      ),
      id: connection.id,
      ownerEmail: connection.ownerEmail,
      provider: connection.provider,
    })),
    activeCount: activeConnections.length,
    normalizedOwnerKey,
    ownerEmailVariants,
    reasons,
  };
}

function hashStorageDiagnosticIdentifier(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  return crypto.createHash("sha256").update(normalized).digest("hex");
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
