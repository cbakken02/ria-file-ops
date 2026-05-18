import {
  readPreviewSnapshot,
  type PreviewSnapshot,
} from "@/lib/preview-snapshot";
import { assertCanAccessPreviewSnapshot } from "@/lib/auth/resource-guards";
import {
  normalizeOwnerEmail,
  type AppPrincipal,
} from "@/lib/auth/principal";

type PreviewSnapshotReader = (
  ownerEmail?: string | null,
) => Promise<PreviewSnapshot | null>;

export async function previewFileSnapshotBelongsToOwner(input: {
  ownerEmail?: string | null;
  principal?: AppPrincipal;
  readSnapshot?: PreviewSnapshotReader;
  snapshotId: string;
}) {
  const ownerEmail = input.principal?.legacyOwnerEmail ?? normalizeLegacyOwnerEmail(
    input.ownerEmail,
  );
  const snapshotId = input.snapshotId.trim();

  if (!ownerEmail || !snapshotId) {
    return false;
  }

  const snapshot = await (input.readSnapshot ?? readPreviewSnapshot)(ownerEmail);
  if (input.principal) {
    try {
      assertCanAccessPreviewSnapshot(input.principal, snapshot);
    } catch {
      return false;
    }
  }

  return Boolean(
    snapshot?.items?.some((item) => item.previewSnapshotId === snapshotId),
  );
}

function normalizeLegacyOwnerEmail(ownerEmail?: string | null) {
  try {
    return normalizeOwnerEmail(ownerEmail ?? "");
  } catch {
    return "";
  }
}
