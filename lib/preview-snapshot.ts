import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isSupabasePersistence } from "@/lib/persistence/backend";
import { queryPostgres } from "@/lib/postgres/server";
import type { PreviewItem } from "@/lib/processing-preview";

export type PreviewSnapshot = {
  generatedAt: string;
  sourceFolder: string | null;
  destinationRoot: string | null;
  reviewPosture: string;
  readyCount: number;
  reviewCount: number;
  items: Array<{
    sourceName: string;
    contentSource: PreviewItem["contentSource"];
    detectedDocumentType: string;
    detectedDocumentSubtype: string | null;
    detectedClient: string | null;
    resolvedClientFolder: string | null;
    suggestedClientFolder: string | null;
    clientMatchReason: string;
    proposedTopLevelFolder: string;
    proposedFilename: string;
    pdfFields: Array<{ name: string; value: string }>;
    debug: PreviewItem["debug"];
    extractedAccountLast4: string | null;
    extractedAccountType: string | null;
    extractedCustodian: string | null;
    extractedDocumentDate: string | null;
    extractedEntityName: string | null;
    extractedIdType: string | null;
    extractedTaxYear: string | null;
    phase1ReviewFlags: PreviewItem["phase1ReviewFlags"];
    phase1ReviewPriority: PreviewItem["phase1ReviewPriority"];
    confidenceLabel: PreviewItem["confidenceLabel"];
    confidenceScore: number;
    status: PreviewItem["status"];
    reasons: string[];
    textExcerpt: string | null;
  }>;
};

type PreviewSnapshotRow = {
  id: string;
  ownerEmail: string;
  generatedAt: string;
  sourceFolder: string | null;
  destinationRoot: string | null;
  reviewPosture: string;
  readyCount: number;
  reviewCount: number;
  snapshotJson: unknown;
  createdAt: string;
  updatedAt: string;
};

export async function writePreviewSnapshot(input: {
  ownerEmail?: string | null;
  destinationRoot: string | null;
  reviewPosture: string;
  sourceFolder: string | null;
  items: PreviewItem[];
  readyCount: number;
  reviewCount: number;
}) {
  const payload: PreviewSnapshot = {
    generatedAt: new Date().toISOString(),
    sourceFolder: input.sourceFolder,
    destinationRoot: input.destinationRoot,
    reviewPosture: input.reviewPosture,
    readyCount: input.readyCount,
    reviewCount: input.reviewCount,
    items: input.items.map((item) => ({
      sourceName: item.sourceName,
      contentSource: item.contentSource,
      detectedDocumentType: item.detectedDocumentType,
      detectedDocumentSubtype: item.detectedDocumentSubtype,
      detectedClient: item.detectedClient,
      resolvedClientFolder: item.resolvedClientFolder,
      suggestedClientFolder: item.suggestedClientFolder,
      clientMatchReason: item.clientMatchReason,
      proposedTopLevelFolder: item.proposedTopLevelFolder,
      proposedFilename: item.proposedFilename,
      pdfFields: item.pdfFields,
      debug: item.debug,
      extractedAccountLast4: item.extractedAccountLast4,
      extractedAccountType: item.extractedAccountType,
      extractedCustodian: item.extractedCustodian,
      extractedDocumentDate: item.extractedDocumentDate,
      extractedEntityName: item.extractedEntityName,
      extractedIdType: item.extractedIdType,
      extractedTaxYear: item.extractedTaxYear,
      phase1ReviewFlags: item.phase1ReviewFlags,
      phase1ReviewPriority: item.phase1ReviewPriority,
      confidenceLabel: item.confidenceLabel,
      confidenceScore: item.confidenceScore,
      status: item.status,
      reasons: item.reasons,
      textExcerpt: item.textExcerpt,
    })),
  };

  if (!isSupabasePersistence()) {
    const targetPath = path.join(process.cwd(), "data", "latest-preview.json");
    await fs.writeFile(targetPath, JSON.stringify(payload, null, 2));
    return;
  }

  const ownerEmail = input.ownerEmail?.trim().toLowerCase();
  if (!ownerEmail) {
    throw new Error(
      "writePreviewSnapshot requires ownerEmail when PERSISTENCE_BACKEND=supabase.",
    );
  }

  const now = new Date().toISOString();
  await queryPostgres(
    `
      INSERT INTO public.preview_snapshots (
        id,
        owner_email,
        generated_at,
        source_folder,
        destination_root,
        review_posture,
        ready_count,
        review_count,
        snapshot_json,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $10
      )
      ON CONFLICT (owner_email)
      DO UPDATE SET
        generated_at = EXCLUDED.generated_at,
        source_folder = EXCLUDED.source_folder,
        destination_root = EXCLUDED.destination_root,
        review_posture = EXCLUDED.review_posture,
        ready_count = EXCLUDED.ready_count,
        review_count = EXCLUDED.review_count,
        snapshot_json = EXCLUDED.snapshot_json,
        updated_at = EXCLUDED.updated_at
    `,
    [
      crypto.randomUUID(),
      ownerEmail,
      payload.generatedAt,
      payload.sourceFolder,
      payload.destinationRoot,
      payload.reviewPosture,
      payload.readyCount,
      payload.reviewCount,
      JSON.stringify(payload),
      now,
    ],
  );
}

export async function readPreviewSnapshot(ownerEmail?: string | null) {
  if (!isSupabasePersistence()) {
    const targetPath = path.join(process.cwd(), "data", "latest-preview.json");

    try {
      const raw = await fs.readFile(targetPath, "utf8");
      return JSON.parse(raw) as PreviewSnapshot;
    } catch {
      return null;
    }
  }

  const normalizedOwnerEmail = ownerEmail?.trim().toLowerCase();
  if (!normalizedOwnerEmail) {
    return null;
  }

  const result = await queryPostgres<PreviewSnapshotRow>(
    `
      SELECT
        id,
        owner_email AS "ownerEmail",
        generated_at AS "generatedAt",
        source_folder AS "sourceFolder",
        destination_root AS "destinationRoot",
        review_posture AS "reviewPosture",
        ready_count AS "readyCount",
        review_count AS "reviewCount",
        snapshot_json AS "snapshotJson",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM public.preview_snapshots
      WHERE owner_email = $1
      LIMIT 1
    `,
    [normalizedOwnerEmail],
  );

  return normalizeSnapshotValue(result.rows[0]?.snapshotJson);
}

function normalizeSnapshotValue(value: unknown): PreviewSnapshot | null {
  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value) as PreviewSnapshot;
    } catch {
      return null;
    }
  }

  return value as PreviewSnapshot;
}
