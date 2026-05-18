import {
  readPreviewSnapshot,
  type PreviewSnapshot,
} from "@/lib/preview-snapshot";

type PreviewSnapshotReader = (
  ownerEmail?: string | null,
) => Promise<PreviewSnapshot | null>;

export async function previewFileSnapshotBelongsToOwner(input: {
  ownerEmail?: string | null;
  readSnapshot?: PreviewSnapshotReader;
  snapshotId: string;
}) {
  const ownerEmail = input.ownerEmail?.trim().toLowerCase() ?? "";
  const snapshotId = input.snapshotId.trim();

  if (!ownerEmail || !snapshotId) {
    return false;
  }

  const snapshot = await (input.readSnapshot ?? readPreviewSnapshot)(ownerEmail);
  return Boolean(
    snapshot?.items?.some((item) => item.previewSnapshotId === snapshotId),
  );
}
