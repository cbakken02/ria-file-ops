import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type PreviewFileSnapshotMeta = {
  id: string;
  sourceFileId: string;
  sourceName: string;
  mimeType: string;
  byteLength: number;
  createdAt: string;
};

const SNAPSHOT_DIR = path.join(os.tmpdir(), "ria-file-ops-preview-files");
const SNAPSHOT_TTL_MS = 1000 * 60 * 60 * 24;

function getSnapshotBufferPath(snapshotId: string) {
  return path.join(SNAPSHOT_DIR, `${snapshotId}.bin`);
}

function getSnapshotMetaPath(snapshotId: string) {
  return path.join(SNAPSHOT_DIR, `${snapshotId}.json`);
}

function isSafeSnapshotId(snapshotId: string) {
  return /^[A-Za-z0-9-]+$/.test(snapshotId);
}

async function ensureSnapshotDir() {
  await fs.mkdir(SNAPSHOT_DIR, { recursive: true });
}

async function removeSnapshot(snapshotId: string) {
  await Promise.all([
    fs.unlink(getSnapshotBufferPath(snapshotId)).catch(() => {}),
    fs.unlink(getSnapshotMetaPath(snapshotId)).catch(() => {}),
  ]);
}

async function pruneExpiredSnapshots() {
  const now = Date.now();
  const entries = await fs.readdir(SNAPSHOT_DIR).catch(() => []);

  await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map(async (entry) => {
        const snapshotId = entry.replace(/\.json$/, "");
        const metaPath = getSnapshotMetaPath(snapshotId);

        try {
          const raw = await fs.readFile(metaPath, "utf8");
          const meta = JSON.parse(raw) as PreviewFileSnapshotMeta;
          const createdAt = new Date(meta.createdAt).getTime();

          if (!Number.isFinite(createdAt) || now - createdAt > SNAPSHOT_TTL_MS) {
            await removeSnapshot(snapshotId);
          }
        } catch {
          await removeSnapshot(snapshotId);
        }
      }),
  );
}

export async function createPreviewFileSnapshot(input: {
  buffer: Buffer;
  fileId: string;
  sourceName: string;
  mimeType: string;
}) {
  await ensureSnapshotDir();
  await pruneExpiredSnapshots();

  const snapshotId = crypto.randomUUID();
  const meta: PreviewFileSnapshotMeta = {
    id: snapshotId,
    sourceFileId: input.fileId,
    sourceName: input.sourceName,
    mimeType: input.mimeType,
    byteLength: input.buffer.byteLength,
    createdAt: new Date().toISOString(),
  };

  await Promise.all([
    fs.writeFile(getSnapshotBufferPath(snapshotId), input.buffer),
    fs.writeFile(getSnapshotMetaPath(snapshotId), JSON.stringify(meta)),
  ]);

  return meta;
}

export async function readPreviewFileSnapshot(snapshotId: string) {
  if (!isSafeSnapshotId(snapshotId)) {
    return null;
  }

  await ensureSnapshotDir();

  try {
    const [rawMeta, buffer] = await Promise.all([
      fs.readFile(getSnapshotMetaPath(snapshotId), "utf8"),
      fs.readFile(getSnapshotBufferPath(snapshotId)),
    ]);
    const meta = JSON.parse(rawMeta) as PreviewFileSnapshotMeta;
    const createdAt = new Date(meta.createdAt).getTime();

    if (!Number.isFinite(createdAt) || Date.now() - createdAt > SNAPSHOT_TTL_MS) {
      await removeSnapshot(snapshotId);
      return null;
    }

    return { meta, buffer };
  } catch {
    return null;
  }
}
