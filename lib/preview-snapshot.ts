import fs from "node:fs/promises";
import path from "node:path";
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
    confidenceLabel: PreviewItem["confidenceLabel"];
    confidenceScore: number;
    status: PreviewItem["status"];
    reasons: string[];
    textExcerpt: string | null;
  }>;
};

export async function writePreviewSnapshot(input: {
  destinationRoot: string | null;
  reviewPosture: string;
  sourceFolder: string | null;
  items: PreviewItem[];
  readyCount: number;
  reviewCount: number;
}) {
  const targetPath = path.join(process.cwd(), "data", "latest-preview.json");
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
      confidenceLabel: item.confidenceLabel,
      confidenceScore: item.confidenceScore,
      status: item.status,
      reasons: item.reasons,
      textExcerpt: item.textExcerpt,
    })),
  };

  await fs.writeFile(targetPath, JSON.stringify(payload, null, 2));
}

export async function readPreviewSnapshot() {
  const targetPath = path.join(process.cwd(), "data", "latest-preview.json");

  try {
    const raw = await fs.readFile(targetPath, "utf8");
    return JSON.parse(raw) as PreviewSnapshot;
  } catch {
    return null;
  }
}
