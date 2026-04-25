import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { AnalysisProfile } from "@/lib/ai-primary-parser-types";
import {
  projectCanonicalToPreviewSafePersistedShape,
  projectCanonicalToRedactedDebugShape,
  type RedactedCanonicalDebugShape,
} from "@/lib/canonical-persistence";
import type { CanonicalExtractedDocument } from "@/lib/canonical-extracted-document";
import type { DocumentInsight } from "@/lib/document-intelligence";
import { DOCUMENT_ANALYSIS_VERSION } from "@/lib/document-intelligence";
import type { GoogleDriveFile } from "@/lib/google-drive";
import { isSupabasePersistence } from "@/lib/persistence/backend";
import { queryPostgres } from "@/lib/postgres/server";

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

type PreviewAnalysisCacheRow = {
  id: string;
  ownerEmail: string;
  analysisProfile: AnalysisProfile;
  analysisVersion: string;
  analysisRanAt: string;
  fileId: string;
  sourceName: string;
  mimeType: string;
  modifiedTime: string | null;
  driveSize: string | null;
  insightJson: unknown;
  canonicalJson: unknown;
  canonicalDebugJson: unknown;
  previewSnapshotId: string | null;
  createdAt: string;
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
  if (!isSupabasePersistence()) {
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

  const result = await queryPostgres<PreviewAnalysisCacheRow>(
    `
      SELECT
        id,
        owner_email AS "ownerEmail",
        analysis_profile AS "analysisProfile",
        analysis_version AS "analysisVersion",
        analysis_ran_at AS "analysisRanAt",
        file_id AS "fileId",
        source_name AS "sourceName",
        mime_type AS "mimeType",
        modified_time AS "modifiedTime",
        drive_size AS "driveSize",
        insight_json AS "insightJson",
        canonical_json AS "canonicalJson",
        canonical_debug_json AS "canonicalDebugJson",
        preview_snapshot_id AS "previewSnapshotId",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM public.preview_analysis_cache
      WHERE owner_email = $1
        AND analysis_profile = $2
        AND file_id = $3
      LIMIT 1
    `,
    [input.ownerEmail, input.analysisProfile, input.file.id],
  );

  const entry = mapPreviewAnalysisCacheRow(result.rows[0]);
  return entry && matchesFile(entry, input.file, input.analysisProfile)
    ? entry
    : null;
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
  if (!isSupabasePersistence()) {
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
      analysisRanAt:
        input.analysisRanAt ?? existing?.analysisRanAt ?? existing?.createdAt ?? now,
      canonical: input.canonical !== undefined ? structuredClone(input.canonical) : existing?.canonical ?? null,
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

  const now = new Date().toISOString();
  const previewSafeCanonical =
    input.canonical !== undefined
      ? projectCanonicalToPreviewSafePersistedShape(input.canonical)
      : null;
  const redactedCanonicalDebug =
    input.canonical !== undefined
      ? projectCanonicalToRedactedDebugShape(input.canonical)
      : null;

  const result = await queryPostgres<PreviewAnalysisCacheRow>(
    `
      INSERT INTO public.preview_analysis_cache (
        id,
        owner_email,
        analysis_profile,
        analysis_version,
        analysis_ran_at,
        file_id,
        source_name,
        mime_type,
        modified_time,
        drive_size,
        insight_json,
        canonical_json,
        canonical_debug_json,
        preview_snapshot_id,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14, $15, $15
      )
      ON CONFLICT (owner_email, analysis_profile, file_id)
      DO UPDATE SET
        analysis_version = EXCLUDED.analysis_version,
        analysis_ran_at = EXCLUDED.analysis_ran_at,
        source_name = EXCLUDED.source_name,
        mime_type = EXCLUDED.mime_type,
        modified_time = EXCLUDED.modified_time,
        drive_size = EXCLUDED.drive_size,
        insight_json = EXCLUDED.insight_json,
        canonical_json = COALESCE(EXCLUDED.canonical_json, public.preview_analysis_cache.canonical_json),
        canonical_debug_json = COALESCE(EXCLUDED.canonical_debug_json, public.preview_analysis_cache.canonical_debug_json),
        preview_snapshot_id = EXCLUDED.preview_snapshot_id,
        updated_at = EXCLUDED.updated_at
      RETURNING
        id,
        owner_email AS "ownerEmail",
        analysis_profile AS "analysisProfile",
        analysis_version AS "analysisVersion",
        analysis_ran_at AS "analysisRanAt",
        file_id AS "fileId",
        source_name AS "sourceName",
        mime_type AS "mimeType",
        modified_time AS "modifiedTime",
        drive_size AS "driveSize",
        insight_json AS "insightJson",
        canonical_json AS "canonicalJson",
        canonical_debug_json AS "canonicalDebugJson",
        preview_snapshot_id AS "previewSnapshotId",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
    [
      crypto.randomUUID(),
      input.ownerEmail,
      input.analysisProfile,
      DOCUMENT_ANALYSIS_VERSION,
      input.analysisRanAt ?? now,
      input.file.id,
      input.file.name,
      input.file.mimeType,
      input.file.modifiedTime ?? null,
      input.file.size ?? null,
      JSON.stringify(input.insight),
      previewSafeCanonical ? JSON.stringify(previewSafeCanonical) : null,
      redactedCanonicalDebug ? JSON.stringify(redactedCanonicalDebug) : null,
      input.previewSnapshotId,
      now,
    ],
  );

  const entry = mapPreviewAnalysisCacheRow(result.rows[0]);
  if (!entry) {
    throw new Error("Preview analysis cache write did not return a persisted row.");
  }

  return entry;
}

export async function clearPreviewAnalysisCacheForFiles(input: {
  ownerEmail: string;
  files: GoogleDriveFile[];
}) {
  if (!isSupabasePersistence()) {
    await ensureCacheDir();

    await Promise.all(
      input.files.map((file) =>
        fs.unlink(getCachePath(input.ownerEmail, file.id)).catch(() => {}),
      ),
    );
    return;
  }

  const fileIds = input.files.map((file) => file.id).filter(Boolean);
  if (fileIds.length === 0) {
    return;
  }

  await queryPostgres(
    `
      DELETE FROM public.preview_analysis_cache
      WHERE owner_email = $1
        AND file_id = ANY($2::text[])
    `,
    [input.ownerEmail, fileIds],
  );
}

export async function clearPreviewAnalysisCacheForOwner(ownerEmail: string) {
  if (!isSupabasePersistence()) {
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
    return;
  }

  await queryPostgres(
    `
      DELETE FROM public.preview_analysis_cache
      WHERE owner_email = $1
    `,
    [ownerEmail],
  );
}

function mapPreviewAnalysisCacheRow(
  row: PreviewAnalysisCacheRow | undefined,
): PreviewAnalysisCacheEntry | null {
  if (!row) {
    return null;
  }

  return {
    analysisProfile: row.analysisProfile,
    analysisVersion: row.analysisVersion,
    analysisRanAt: row.analysisRanAt,
    canonical: null,
    canonicalDebug: normalizeJsonValue<RedactedCanonicalDebugShape>(row.canonicalDebugJson),
    createdAt: row.createdAt,
    fileId: row.fileId,
    insight: normalizeJsonValue<DocumentInsight>(row.insightJson) ?? ({} as DocumentInsight),
    mimeType: row.mimeType,
    modifiedTime: row.modifiedTime ?? null,
    ownerEmail: row.ownerEmail,
    previewSnapshotId: row.previewSnapshotId ?? null,
    sourceName: row.sourceName,
    driveSize: row.driveSize ?? null,
    updatedAt: row.updatedAt,
  };
}

function normalizeJsonValue<T>(value: unknown): T | null {
  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  return value as T;
}
