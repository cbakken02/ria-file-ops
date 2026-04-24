import { analyzeTextContent } from "../lib/document-intelligence.ts";
import { resolveAnalysisProfileForMode } from "../lib/ai-primary-parser.ts";
import {
  buildDocumentFilenamePlan,
  getDefaultNamingRules,
} from "../lib/naming-rules.ts";

export async function analyzeSyntheticDocument(input) {
  const file = {
    id: input.id,
    name: input.name,
    mimeType: input.mimeType,
    modifiedTime: input.modifiedTime ?? "2026-04-12T10:00:00.000Z",
  };

  const insight = await analyzeTextContent(
    file,
    input.text,
    input.fields ?? {},
    input.contentSource ?? defaultContentSourceForMimeType(input.mimeType),
    undefined,
    [],
    undefined,
    null,
    {
      analysisProfile:
        input.analysisProfile ??
        resolveAnalysisProfileForMode(input.analysisMode ?? "default"),
    },
  );

  return {
    file,
    insight,
    filename: buildDefaultFilename(file, insight, input.householdFolder),
  };
}

function buildDefaultFilename(file, insight, householdFolder = "Bakken_Christopher") {
  return buildDocumentFilenamePlan({
    rules: getDefaultNamingRules(),
    accountLast4: insight.metadata.accountLast4,
    accountType: insight.metadata.accountType,
    clientName: insight.detectedClient,
    clientName2: insight.detectedClient2,
    custodian: insight.metadata.custodian,
    detectedClient: insight.detectedClient,
    detectedClient2: insight.detectedClient2,
    documentDate: insight.metadata.documentDate,
    documentTypeId: insight.documentTypeId,
    documentTypeLabel: insight.documentLabel,
    entityName: insight.metadata.entityName,
    extension: file.name.includes(".")
      ? file.name.slice(file.name.lastIndexOf("."))
      : undefined,
    fallbackName: file.name,
    householdFolder,
    idType: insight.metadata.idType,
    ownershipType: insight.ownershipType,
    sourceName: file.name,
    taxYear: insight.metadata.taxYear,
  });
}

function defaultContentSourceForMimeType(mimeType) {
  return mimeType.startsWith("image/") ? "image_ocr" : "pdf_text";
}
