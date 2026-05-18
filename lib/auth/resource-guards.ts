import "server-only";

import type { StorageConnection } from "@/lib/db";
import type { PreviewSnapshot } from "@/lib/preview-snapshot";
import {
  AppPrincipalError,
  normalizeOwnerEmail,
  type AppPrincipal,
} from "@/lib/auth/principal";

type OwnerScopedResource = {
  ownerEmail?: string | null;
  ownerKey?: string | null;
};

export function isSameOwner(principal: AppPrincipal, ownerKey?: string | null) {
  if (!ownerKey) {
    return false;
  }

  try {
    return principal.ownerKey === normalizeOwnerEmail(ownerKey);
  } catch {
    return false;
  }
}

export function requireOwnerScopedResource(
  principal: AppPrincipal,
  resourceOwnerKey?: string | null,
) {
  if (!isSameOwner(principal, resourceOwnerKey)) {
    throw new AppPrincipalError("Forbidden", 403);
  }

  return principal;
}

export function assertCanUseStorageConnection(
  principal: AppPrincipal,
  connection: StorageConnection | null | undefined,
) {
  if (!connection) {
    throw new AppPrincipalError("Storage connection not found.", 403);
  }

  requireOwnerScopedResource(principal, connection.ownerEmail);
}

export function assertCanAccessPreviewSnapshot(
  principal: AppPrincipal,
  snapshot: PreviewSnapshot | null | undefined,
) {
  if (!snapshot?.ownerEmail) {
    throw new AppPrincipalError("Preview snapshot not found.", 403);
  }

  requireOwnerScopedResource(principal, snapshot.ownerEmail);
}

export function assertCanAccessPreviewFile(
  principal: AppPrincipal,
  previewFileRecordOrSnapshot: OwnerScopedResource | null | undefined,
) {
  const resourceOwnerKey =
    previewFileRecordOrSnapshot?.ownerKey ??
    previewFileRecordOrSnapshot?.ownerEmail;

  if (!resourceOwnerKey) {
    throw new AppPrincipalError("Preview file not found.", 403);
  }

  requireOwnerScopedResource(principal, resourceOwnerKey);
}
