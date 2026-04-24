import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { AnalysisProfile } from "@/lib/ai-primary-parser-types";
import {
  persistCanonicalForPreviewAnalysisCache,
  projectCanonicalToRedactedDebugShape,
  type RedactedCanonicalDebugShape,
} from "@/lib/canonical-persistence";
import type { CanonicalExtractedDocument } from "@/lib/canonical-extracted-document";
import type { DocumentInsight } from "@/lib/document-intelligence";
import { DOCUMENT_ANALYSIS_VERSION } from "@/lib/document-intelligence";
import type { GoogleDriveFile } from "@/lib/google-drive";

export type PreviewAnalysisCacheEntry = {
  analysisProfile: AnalysisProfile;
  analysisVersion: string;
  analysisRanAt: string;
  canonical: CanonicalExtractedDocument | null;
  canonicalDebug: RedactedCanonicalDebugShape | null;
  createdAt: string;
  fileId: string;
  insight: DocumentInsight;
  mimeType: string;
  modifiedTime: string | null;
  ownerEmail: string;
  previewSnapshotId: string | null;
  sourceName: string;
  driveSize: string | null;
  updatedAt: string;
};

const CACHE_DIR = path.join(process.cwd(), "data", "preview-analysis-cache");

function getCachePath(ownerEmail: string, fileId: string) {
  const cacheKey = crypto
    .createHash("sha1")
    .update(`${ownerEmail}:${fileId}`)
    .digest("hex");

  return path.join(CACHE_DIR, `${cacheKey}.json`);
}

async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

function matchesFile(
  entry: PreviewAnalysisCacheEntry,
  file: GoogleDriveFile,
  analysisProfile: AnalysisProfile,
) {
  return (
    entry.analysisProfile === analysisProfile &&
    entry.analysisVersion === DOCUMENT_ANALYSIS_VERSION &&
    entry.fileId === file.id &&
    entry.sourceName === file.name &&
    entry.mimeType === file.mimeType &&
    (entry.modifiedTime ?? null) === (file.modifiedTime ?? null) &&
    (entry.driveSize ?? null) === (file.size ?? null)
  );
}

export async function readPreviewAnalysisCache(input: {
  analysisProfile: AnalysisProfile;
  ownerEmail: string;
  file: GoogleDriveFile;
}) {
  await ensureCacheDir();

  try {
    const raw = await fs.readFile(
      getCachePath(input.ownerEmail, input.file.id),
      "utf8",
    );
    const entry = JSON.parse(raw) as PreviewAnalysisCacheEntry;

    return matchesFile(entry, input.file, input.analysisProfile) ? entry : null;
  } catch {
    return null;
  }
}

export async function writePreviewAnalysisCache(input: {
  analysisProfile: AnalysisProfile;
  ownerEmail: string;
  file: GoogleDriveFile;
  insight: DocumentInsight;
  canonical?: CanonicalExtractedDocument | null;
  previewSnapshotId: string | null;
  analysisRanAt?: string | null;
}) {
  await ensureCacheDir();

  const existing = await readPreviewAnalysisCache({
    analysisProfile: input.analysisProfile,
    ownerEmail: input.ownerEmail,
    file: input.file,
  });
  const now = new Date().toISOString();
  const payload: PreviewAnalysisCacheEntry = {
    analysisProfile: input.analysisProfile,
    analysisVersion: DOCUMENT_ANALYSIS_VERSION,
    analysisRanAt: input.analysisRanAt ?? existing?.analysisRanAt ?? existing?.createdAt ?? now,
    canonical:
      input.canonical !== undefined
        ? persistCanonicalForPreviewAnalysisCache(input.canonical)
        : existing?.canonical ?? null,
    canonicalDebug:
      input.canonical !== undefined
        ? projectCanonicalToRedactedDebugShape(input.canonical)
        : existing?.canonicalDebug ?? null,
    createdAt: existing?.createdAt ?? now,
    fileId: input.file.id,
    insight: input.insight,
    mimeType: input.file.mimeType,
    modifiedTime: input.file.modifiedTime ?? null,
    ownerEmail: input.ownerEmail,
    previewSnapshotId: input.previewSnapshotId,
    sourceName: input.file.name,
    driveSize: input.file.size ?? null,
    updatedAt: now,
  };

  await fs.writeFile(
    getCachePath(input.ownerEmail, input.file.id),
    JSON.stringify(payload),
  );

  return payload;
}

export async function clearPreviewAnalysisCacheForFiles(input: {
  ownerEmail: string;
  files: GoogleDriveFile[];
}) {
  await ensureCacheDir();

  await Promise.all(
    input.files.map((file) =>
      fs.unlink(getCachePath(input.ownerEmail, file.id)).catch(() => {}),
    ),
  );
}

export async function clearPreviewAnalysisCacheForOwner(ownerEmail: string) {
  await ensureCacheDir();

  const entries = await fs.readdir(CACHE_DIR).catch(() => []);

  await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map(async (entry) => {
        const filePath = path.join(CACHE_DIR, entry);

        try {
          const raw = await fs.readFile(filePath, "utf8");
          const parsed = JSON.parse(raw) as PreviewAnalysisCacheEntry;

          if (parsed.ownerEmail !== ownerEmail) {
            return;
          }

          await fs.unlink(filePath).catch(() => {});
        } catch {
          // Ignore malformed cache entries during a manual refresh sweep.
        }
      }),
  );
}
