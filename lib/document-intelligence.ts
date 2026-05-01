import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  parseAccountStatementWithAI,
  type AIPrimaryParseContext,
} from "@/lib/ai-primary-parser";
import type {
  AnalysisProfile,
  ParsedDocumentResult,
  ParsedExtractedContactPurpose,
  ParsedFieldKey,
  ParsedFieldOwnership,
} from "@/lib/ai-primary-parser-types";
import {
  detectRawAccountStatementInstitutionName,
  normalizeAccountStatementAccountType,
  normalizeAccountStatementCustodian,
  normalizeAccountStatementValueKind,
} from "@/lib/account-statement-ai-normalization";
import { adaptCanonicalToLegacyDocumentInsight } from "@/lib/canonical-document-legacy-adapter";
import {
  finalizeCanonicalExtractedDocument,
  type CanonicalAccountPartyRole,
  type CanonicalContact,
  type CanonicalExtractedDocument,
  type CanonicalExtractedDocumentDraft,
  type CanonicalFieldProvenance,
  type CanonicalNormalizationRecord,
  type CanonicalSourceRef,
  type CanonicalTaxFact,
} from "@/lib/canonical-extracted-document";
import {
  extractAccountStatement,
  type AccountStatementClientSource,
} from "@/lib/document-extractors/account-statement";
import { extractIdentityDocument } from "@/lib/document-extractors/identity-document";
import { extractMoneyMovementForm } from "@/lib/document-extractors/money-movement-form";
import {
  extractTaxDocument,
  type TaxDocumentTaxIdentifier,
} from "@/lib/document-extractors/tax-document";
import {
  collectAnchoredLines,
  extractFirstPageText,
  getHeaderZoneLines,
} from "@/lib/document-extractors/shared-text-zones";
import type { GoogleDriveFile } from "@/lib/google-drive";
import {
  detectTaxDocumentSubtype,
  getTaxDocumentSubtypeLabel,
  normalizeTaxDocumentSubtype,
} from "@/lib/tax-document-types";

export type DocumentInsight = {
  documentTypeId:
    | "default"
    | "account_statement"
    | "money_movement_form"
    | "tax_document"
    | "identity_document"
    | "planning_document"
    | "legal_document";
  textExcerpt: string | null;
  diagnosticText: string | null;
  pdfFields: Array<{ name: string; value: string }>;
  detectedClient: string | null;
  detectedClient2: string | null;
  ownershipType: "single" | "joint";
  documentLabel: string;
  documentSubtype: string | null;
  filenameLabel: string;
  topLevelFolder: string;
  confidence: number;
  reasons: string[];
  contentSource: "pdf_text" | "pdf_ocr" | "image_ocr" | "metadata_only";
  debug: {
    parserVersion: string;
    parserConflictSummary: string | null;
    documentSignal: string | null;
    statementClientSource: AccountStatementClientSource | null;
    statementClientCandidate: string | null;
    aiModel: string | null;
    aiPromptVersion: string | null;
    aiRawSummary: string | null;
    aiRawDetectedClient: string | null;
    aiRawDetectedClient2: string | null;
    aiRawCustodian: string | null;
    aiRawAccountType: string | null;
    aiEnabled: boolean;
    aiAttempted: boolean;
    aiUsed: boolean;
    aiFailureReason: string | null;
    custodianWasNormalized: boolean;
    accountTypeWasNormalized: boolean;
    custodianNormalizationRule: string | null;
    accountTypeNormalizationRule: string | null;
    fieldOwnership: Partial<Record<ParsedFieldKey, ParsedFieldOwnership>>;
    ownershipClientCandidate: string | null;
    accountContextCandidate: string | null;
    accountLooseCandidate: string | null;
    taxKeywordDetected: boolean;
    yearCandidates: string[];
    downloadByteLength: number | null;
    downloadSha1: string | null;
    pdfFieldReaders: string[];
    pdfExtractionAttempts: PdfExtractionAttempt[];
  };
  metadata: {
    accountLast4: string | null;
    accountType: string | null;
    custodian: string | null;
    documentDate: string | null;
    entityName: string | null;
    idType: string | null;
    taxYear: string | null;
  };
};

export type PdfExtractionAttempt = {
  extractor: "pdfjs" | "pdf-parse" | "pypdf" | "pdfkit" | "ocr";
  status: "succeeded" | "empty" | "skipped" | "failed";
  detail: string | null;
  textLength: number | null;
  fieldCount: number | null;
};

const execFileAsync = promisify(execFile);
const PARSER_VERSION = "2026-04-28-tax-document-v2-facts-1";
export const DOCUMENT_ANALYSIS_VERSION = PARSER_VERSION;

type AnalysisExecutionOptions = {
  analysisProfile?: AnalysisProfile;
  pdfExtractionAttempts?: PdfExtractionAttempt[];
};

type DownloadFingerprint = {
  byteLength: number;
  sha1: string;
};

type TextAnalysisContext = {
  file: GoogleDriveFile;
  rawText: string;
  fields: Record<string, string>;
  contentSource: DocumentInsight["contentSource"];
  metadataFallback: DocumentInsight;
  normalizedText: string;
  lowerText: string;
  pdfFields: Array<{ name: string; value: string }>;
  reasons: string[];
  textExcerpt: string | null;
  diagnosticText: string | null;
  ownershipClientCandidate: string | null;
  accountContextCandidate: string | null;
  accountLooseCandidate: string | null;
  yearCandidates: string[];
  taxKeywordDetected: boolean;
  pdfFieldReaders: string[];
  pdfExtractionAttempts: PdfExtractionAttempt[];
  downloadFingerprint?: DownloadFingerprint | null;
  parserConflictSummary: string | null;
};

type TextAnalysisClassification = {
  documentTypeId: DocumentInsight["documentTypeId"];
  documentLabel: string;
  documentSubtype: string | null;
  filenameLabel: string;
  topLevelFolder: string;
  confidence: number;
  documentSignal: string | null;
};

type TextAnalysisExtraction = {
  detectedClient: string | null;
  detectedClient2: string | null;
  ownershipType: "single" | "joint";
  metadata: DocumentInsight["metadata"];
  statementClientSource: AccountStatementClientSource | null;
  statementClientCandidate: string | null;
};

export type TextAnalysisResultEnvelope = {
  canonical: CanonicalExtractedDocument | null;
  legacyInsight: DocumentInsight;
};

type StatementDateEvidence = {
  id: string;
  kind: "statement_period_start" | "statement_period_end" | "document_date";
  rawValue: string | null;
  value: string | null;
  entityType: "document";
  entityId: null;
};

type StatementValueEvidence = {
  kind:
    | "beginning_balance"
    | "ending_balance"
    | "available_balance"
    | "current_balance"
    | "market_value"
    | "cash_value";
  label: string;
  rawAmount: string | null;
  amount: string | null;
  currency: string | null;
};

type StatementAccountEvidence = {
  key: string;
  extractedId: string;
  normalizedId: string;
  rawAccountNumber: string | null;
  normalizedAccountNumber: string | null;
  maskedAccountNumber: string | null;
  accountLast4: string | null;
  rawAccountType: string | null;
  normalizedAccountType: string | null;
  registrationType: string | null;
  statementStartDateId: string | null;
  statementEndDateId: string | null;
  values: StatementValueEvidence[];
};

type StatementContactEvidence = {
  id: string;
  method: "phone" | "website";
  purpose: "customer_service" | "general_support";
  label: string | null;
  rawValue: string | null;
  normalizedValue: string | null;
};

type StatementPartyAddressEvidence = {
  rawAddress: {
    kind: "identity";
    rawText: string | null;
    lines: string[];
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string | null;
  } | null;
  normalizedAddress: {
    kind: "identity";
    rawText: string | null;
    lines: string[];
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string | null;
  } | null;
};

type StatementCanonicalEnrichmentEvidence = {
  normalizedAccounts: StatementAccountEvidence[];
  extractedAccounts: StatementAccountEvidence[];
  normalizedContacts: StatementContactEvidence[];
  extractedContacts: StatementContactEvidence[];
  normalizedDates: StatementDateEvidence[];
  extractedDates: StatementDateEvidence[];
  partyAddress: StatementPartyAddressEvidence;
};

export async function analyzeDocument(
  file: GoogleDriveFile,
  getFileBuffer: () => Promise<Buffer>,
  options: AnalysisExecutionOptions = {},
) {
  const envelope = await analyzeDocumentWithEnvelope(file, getFileBuffer, options);
  return envelope.legacyInsight;
}

export async function analyzeDocumentWithEnvelope(
  file: GoogleDriveFile,
  getFileBuffer: () => Promise<Buffer>,
  options: AnalysisExecutionOptions = {},
): Promise<TextAnalysisResultEnvelope> {
  if (file.mimeType === "application/pdf") {
    const buffer = await getFileBuffer();
    const fingerprint = describeDownloadedBuffer(buffer);
    let pdfExtractionAttempts: PdfExtractionAttempt[] = [];

    try {
      const extraction = await extractPdfData(buffer);
      pdfExtractionAttempts = extraction.attempts;
      if (hasUsefulText(extraction.text) || Object.keys(extraction.fields).length > 0) {
        const baseEnvelope = await analyzeTextContentWithEnvelope(
          file,
          extraction.text,
          extraction.fields,
          "pdf_text",
          extraction.fieldEntries,
          extraction.fieldReaders,
          fingerprint,
          extraction.parserConflictSummary,
          {
            ...options,
            pdfExtractionAttempts,
          },
        );

        if (
          shouldSupplementPdfInsight(baseEnvelope.legacyInsight, extraction.fields) &&
          !isVercelRuntime()
        ) {
          try {
            const ocrText = await extractVisualText(buffer, "pdf");
            const ocrAttempt = buildTextExtractionAttempt("ocr", ocrText);
            if (hasUsefulText(ocrText)) {
              const supplementedAttempts = [...pdfExtractionAttempts, ocrAttempt];
              const mergedEnvelope = await analyzeTextContentWithEnvelope(
                file,
                `${extraction.text}\n${ocrText}`,
                extraction.fields,
                "pdf_text",
                extraction.fieldEntries,
                extraction.fieldReaders,
                fingerprint,
                extraction.parserConflictSummary,
                {
                  ...options,
                  pdfExtractionAttempts: supplementedAttempts,
                },
              );

              return preferSupplementedPdfEnvelope(baseEnvelope, mergedEnvelope);
            }
            pdfExtractionAttempts = [...pdfExtractionAttempts, ocrAttempt];
          } catch {
            // Keep the base PDF insight if supplemental OCR fails.
          }
        }

        return baseEnvelope;
      }
    } catch (error) {
      pdfExtractionAttempts = [
        ...pdfExtractionAttempts,
        buildFailedExtractionAttempt(
          "pdfjs",
          `PDF extraction crashed before fallback classification: ${safeDiagnosticMessage(error)}`,
        ),
      ];
      // Fall through to OCR.
    }

    if (isVercelRuntime()) {
      pdfExtractionAttempts = [
        ...pdfExtractionAttempts,
        buildSkippedExtractionAttempt(
          "ocr",
          "Skipped in Vercel runtime; OCR/Swift fallbacks are local-only for now.",
        ),
      ];
    } else {
      try {
        const ocrText = await extractVisualText(buffer, "pdf");
        const ocrAttempt = buildTextExtractionAttempt("ocr", ocrText);
        pdfExtractionAttempts = [...pdfExtractionAttempts, ocrAttempt];
        if (hasUsefulText(ocrText)) {
          return analyzeTextContentWithEnvelope(
            file,
            ocrText,
            {},
            "pdf_ocr",
            [],
            [],
            fingerprint,
            null,
            {
              ...options,
              pdfExtractionAttempts,
            },
          );
        }
      } catch (error) {
        pdfExtractionAttempts = [
          ...pdfExtractionAttempts,
          buildFailedExtractionAttempt("ocr", safeDiagnosticMessage(error)),
        ];
        // Fall through to metadata.
      }
    }

    return {
      canonical: null,
      legacyInsight: analyzeFromMetadata(file, {
        downloadFingerprint: fingerprint,
        extraReasons: [
          "PDF text extraction and OCR did not return enough usable content, so this file fell back to metadata-only classification.",
        ],
        metadataOnlyDiagnosticText:
          buildPdfMetadataOnlyDiagnostic(pdfExtractionAttempts),
        pdfExtractionAttempts,
      }),
    };
  }

  if (file.mimeType.startsWith("image/")) {
    const buffer = await getFileBuffer();
    const fingerprint = describeDownloadedBuffer(buffer);
    try {
      const ocrText = await extractVisualText(buffer, "image");
      if (hasUsefulText(ocrText)) {
        return analyzeTextContentWithEnvelope(
          file,
          ocrText,
          {},
          "image_ocr",
          [],
          [],
          fingerprint,
          null,
          options,
        );
      }
    } catch {
      // Fall through to metadata.
    }

    return {
      canonical: null,
      legacyInsight: analyzeFromMetadata(file, {
        downloadFingerprint: fingerprint,
        extraReasons: [
          "Image OCR did not return enough usable text, so this item is still using metadata only.",
        ],
      }),
    };
  }

  return {
    canonical: null,
    legacyInsight: analyzeFromMetadata(file, {
      extraReasons: [
        "The current pipeline only performs OCR on images and PDFs, so this item is still using metadata only.",
      ],
    }),
  };
}

async function extractPdfData(buffer: Buffer) {
  const tempPath = path.join(os.tmpdir(), `ria-file-ops-${crypto.randomUUID()}.pdf`);
  await fs.writeFile(tempPath, buffer);

  try {
    let text = "";
    let fields: Record<string, string> = {};
    let fieldEntries: Array<{ name: string; value: string }> = [];
    const fieldReaders: string[] = [];
    const attempts: PdfExtractionAttempt[] = [];
    let parserConflictSummary: string | null = null;
    let pythonError: Error | null = null;
    let pythonFields: Record<string, string> = {};

    const textExtractors = isVercelRuntime()
      ? [
          ["pdfjs", extractPdfTextWithPdfJs] as const,
          ["pdf-parse", extractPdfTextWithPdfParse] as const,
        ]
      : [
          ["pdf-parse", extractPdfTextWithPdfParse] as const,
          ["pdfjs", extractPdfTextWithPdfJs] as const,
        ];

    for (const [extractor, extractText] of textExtractors) {
      if (hasUsefulText(text)) {
        break;
      }

      try {
        const extractedText = await extractText(buffer);
        attempts.push(buildTextExtractionAttempt(extractor, extractedText));
        if (hasUsefulText(extractedText)) {
          text = extractedText;
        }
      } catch (error) {
        attempts.push(
          buildFailedExtractionAttempt(extractor, safeDiagnosticMessage(error)),
        );
      }
    }

    if (isVercelRuntime()) {
      try {
        const pdfJsFieldExtraction = await extractPdfFieldsWithPdfJs(buffer);
        fields = mergePdfFieldMaps(fields, pdfJsFieldExtraction.fields);
        fieldEntries = [...fieldEntries, ...pdfJsFieldExtraction.fieldEntries];
        if (Object.keys(pdfJsFieldExtraction.fields).length > 0) {
          fieldReaders.push("pdfjs");
        }
        attempts.push(
          buildPdfFieldExtractionAttempt(
            "pdfjs",
            "",
            pdfJsFieldExtraction.fields,
          ),
        );
      } catch (error) {
        attempts.push(
          buildFailedExtractionAttempt(
            "pdfjs",
            `PDF form fields: ${safeDiagnosticMessage(error)}`,
          ),
        );
      }
      attempts.push(
        buildSkippedExtractionAttempt(
          "pypdf",
          "Skipped in Vercel runtime; Python PDF extraction is local-only.",
        ),
      );
      attempts.push(
        buildSkippedExtractionAttempt(
          "pdfkit",
          "Skipped in Vercel runtime; Swift/PDFKit form-field fallback is local-only. PDF.js form-field extraction was attempted first.",
        ),
      );
    } else {
      try {
        const pythonExtraction = await extractPdfDataWithPyPdf(tempPath);
        if (!hasUsefulText(text)) {
          text = pythonExtraction.text;
        }
        fields = pythonExtraction.fields;
        pythonFields = pythonExtraction.fields;
        fieldEntries = pythonExtraction.fieldEntries;
        fieldReaders.push("pypdf");
        attempts.push(
          buildPdfFieldExtractionAttempt(
            "pypdf",
            pythonExtraction.text,
            pythonExtraction.fields,
          ),
        );
      } catch (error) {
        pythonError =
          error instanceof Error
            ? error
            : new Error("Python PDF extraction failed unexpectedly.");
        attempts.push(
          buildFailedExtractionAttempt("pypdf", safeDiagnosticMessage(error)),
        );
      }

      try {
        const pdfKitExtraction = await extractPdfFieldsWithPdfKit(tempPath);
        parserConflictSummary = summarizeParserConflicts(
          pythonFields,
          pdfKitExtraction.fields,
        );
        fields = mergePdfFieldMaps(fields, pdfKitExtraction.fields, true);
        fieldEntries = [...fieldEntries, ...pdfKitExtraction.fieldEntries];
        fieldReaders.push("pdfkit");
        attempts.push(
          buildPdfFieldExtractionAttempt("pdfkit", "", pdfKitExtraction.fields),
        );
      } catch (error) {
        attempts.push(
          buildFailedExtractionAttempt("pdfkit", safeDiagnosticMessage(error)),
        );
        // Keep the primary parser result if PDFKit fallback is unavailable.
      }
    }

    if (pythonError && fieldReaders.length === 0 && !hasUsefulText(text)) {
      throw pythonError;
    }

    return {
      text,
      fields,
      fieldEntries,
      fieldReaders,
      parserConflictSummary,
      attempts,
    };
  } finally {
    await fs.unlink(tempPath).catch(() => {});
  }
}

async function extractPdfTextWithPdfParse(buffer: Buffer) {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();
    return result.text ?? "";
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function extractPdfTextWithPdfJs(buffer: Buffer) {
  installPdfJsNodePolyfills();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  await configurePdfJsNodeWorker(pdfjs);
  const documentParams = {
    data: new Uint8Array(buffer),
    disableFontFace: true,
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
  } as Parameters<typeof pdfjs.getDocument>[0] & { disableWorker: boolean };
  const loadingTask = pdfjs.getDocument(documentParams);
  const pdf = await loadingTask.promise;

  try {
    const pageTexts: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
        .filter(Boolean)
        .join(" ");

      if (text) {
        pageTexts.push(text);
      }

      page.cleanup();
    }

    return pageTexts.join("\n");
  } finally {
    await pdf.destroy();
  }
}

type PdfJsFieldSource = Record<string, unknown>;

async function extractPdfFieldsWithPdfJs(buffer: Buffer) {
  installPdfJsNodePolyfills();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  await configurePdfJsNodeWorker(pdfjs);
  const documentParams = {
    data: new Uint8Array(buffer),
    disableFontFace: true,
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
  } as Parameters<typeof pdfjs.getDocument>[0] & { disableWorker: boolean };
  const loadingTask = pdfjs.getDocument(documentParams);
  const pdf = await loadingTask.promise;

  try {
    const fields: Record<string, string> = {};
    const fieldEntries: Array<{ name: string; value: string }> = [];
    const fieldObjects = await pdf.getFieldObjects().catch(() => null);

    if (fieldObjects && typeof fieldObjects === "object") {
      for (const [fieldName, objects] of Object.entries(fieldObjects)) {
        const fieldObjectList = Array.isArray(objects) ? objects : [objects];

        for (const fieldObject of fieldObjectList) {
          collectPdfJsField(
            fields,
            fieldEntries,
            fieldName,
            asPdfJsFieldSource(fieldObject),
          );
        }
      }
    }

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);

      try {
        const annotations = await page.getAnnotations({ intent: "display" });
        annotations.forEach((annotation, index) => {
          const source = asPdfJsFieldSource(annotation);
          const name =
            cleanPdfJsFieldText(source.fieldName) ||
            cleanPdfJsFieldText(source.fullName) ||
            cleanPdfJsFieldText(source.id) ||
            `Page ${pageNumber} field ${index + 1}`;
          collectPdfJsField(fields, fieldEntries, name, source);
        });
      } finally {
        page.cleanup();
      }
    }

    return { fields, fieldEntries };
  } finally {
    await pdf.destroy();
  }
}

function asPdfJsFieldSource(value: unknown): PdfJsFieldSource {
  return value && typeof value === "object" ? (value as PdfJsFieldSource) : {};
}

function collectPdfJsField(
  fields: Record<string, string>,
  fieldEntries: Array<{ name: string; value: string }>,
  rawName: string,
  source: PdfJsFieldSource,
) {
  const name = cleanPdfJsFieldText(rawName);
  if (!name) {
    return;
  }

  const value = collectPdfJsFieldValueCandidates(source)
    .map(cleanPdfJsFieldText)
    .find(Boolean);

  if (!value) {
    return;
  }

  const preferred = choosePreferredPdfFieldValue(name, fields[name], value);
  if (!preferred) {
    return;
  }

  fields[name] = preferred;
  fieldEntries.push({ name, value: preferred });
}

function collectPdfJsFieldValueCandidates(source: PdfJsFieldSource): unknown[] {
  return [
    source.value,
    source.fieldValue,
    source.defaultValue,
    source.buttonValue,
    source.exportValue,
    source.alternativeText,
    source.contents,
  ];
}

function cleanPdfJsFieldText(value: unknown): string {
  if (Array.isArray(value)) {
    return normalizeWhitespace(
      value
        .map((item) => cleanPdfJsFieldText(item))
        .filter(Boolean)
        .join(" "),
    );
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (typeof value !== "string") {
    return "";
  }

  return normalizeWhitespace(value)
    .replace(/\u0000/g, "")
    .replace(/^\s*(Off|No|false)\s*$/i, "")
    .trim();
}

async function configurePdfJsNodeWorker(
  pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.mjs"),
) {
  if (typeof process !== "object" || process + "" !== "[object process]") {
    return;
  }

  const globalObject = globalThis as typeof globalThis & {
    pdfjsWorker?: unknown;
  };

  if (!globalObject.pdfjsWorker) {
    globalObject.pdfjsWorker = await import(
      "pdfjs-dist/legacy/build/pdf.worker.mjs"
    );
  }

  pdfjs.GlobalWorkerOptions.workerSrc ||= "./pdf.worker.mjs";
}

type Matrix2DLike = {
  a?: number;
  b?: number;
  c?: number;
  d?: number;
  e?: number;
  f?: number;
};

class NodePdfDomMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  is2D = true;

  static fromFloat32Array(array32: Float32Array) {
    return new NodePdfDomMatrix(array32);
  }

  static fromFloat64Array(array64: Float64Array) {
    return new NodePdfDomMatrix(array64);
  }

  static fromMatrix(other?: Matrix2DLike) {
    return new NodePdfDomMatrix(other);
  }

  constructor(init?: Matrix2DLike | number[] | Float32Array | Float64Array | string) {
    if (typeof init === "string") {
      this.a = 1;
      this.b = 0;
      this.c = 0;
      this.d = 1;
      this.e = 0;
      this.f = 0;
      return;
    }

    if (Array.isArray(init) || init instanceof Float32Array || init instanceof Float64Array) {
      this.a = Number(init[0] ?? 1);
      this.b = Number(init[1] ?? 0);
      this.c = Number(init[2] ?? 0);
      this.d = Number(init[3] ?? 1);
      this.e = Number(init[4] ?? 0);
      this.f = Number(init[5] ?? 0);
      return;
    }

    this.a = Number(init?.a ?? 1);
    this.b = Number(init?.b ?? 0);
    this.c = Number(init?.c ?? 0);
    this.d = Number(init?.d ?? 1);
    this.e = Number(init?.e ?? 0);
    this.f = Number(init?.f ?? 0);
  }

  get m11() {
    return this.a;
  }

  set m11(value: number) {
    this.a = value;
  }

  get m12() {
    return this.b;
  }

  set m12(value: number) {
    this.b = value;
  }

  get m21() {
    return this.c;
  }

  set m21(value: number) {
    this.c = value;
  }

  get m22() {
    return this.d;
  }

  set m22(value: number) {
    this.d = value;
  }

  get m41() {
    return this.e;
  }

  set m41(value: number) {
    this.e = value;
  }

  get m42() {
    return this.f;
  }

  set m42(value: number) {
    this.f = value;
  }

  multiplySelf(other?: Matrix2DLike) {
    const matrix = new NodePdfDomMatrix(other);
    const a = this.a * matrix.a + this.c * matrix.b;
    const b = this.b * matrix.a + this.d * matrix.b;
    const c = this.a * matrix.c + this.c * matrix.d;
    const d = this.b * matrix.c + this.d * matrix.d;
    const e = this.a * matrix.e + this.c * matrix.f + this.e;
    const f = this.b * matrix.e + this.d * matrix.f + this.f;

    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
    return this;
  }

  preMultiplySelf(other?: Matrix2DLike) {
    const matrix = new NodePdfDomMatrix(other);
    return matrix.multiplySelf(this).copyTo(this);
  }

  translateSelf(tx = 0, ty = 0) {
    this.e += Number(tx);
    this.f += Number(ty);
    return this;
  }

  scaleSelf(scaleX = 1, scaleY = scaleX) {
    this.a *= Number(scaleX);
    this.b *= Number(scaleX);
    this.c *= Number(scaleY);
    this.d *= Number(scaleY);
    return this;
  }

  invertSelf() {
    const determinant = this.a * this.d - this.b * this.c;

    if (determinant === 0) {
      this.a = Number.NaN;
      this.b = Number.NaN;
      this.c = Number.NaN;
      this.d = Number.NaN;
      this.e = Number.NaN;
      this.f = Number.NaN;
      return this;
    }

    const a = this.d / determinant;
    const b = -this.b / determinant;
    const c = -this.c / determinant;
    const d = this.a / determinant;
    const e = (this.c * this.f - this.d * this.e) / determinant;
    const f = (this.b * this.e - this.a * this.f) / determinant;

    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
    return this;
  }

  toFloat32Array() {
    return new Float32Array([
      this.a,
      this.b,
      0,
      0,
      this.c,
      this.d,
      0,
      0,
      0,
      0,
      1,
      0,
      this.e,
      this.f,
      0,
      1,
    ]);
  }

  private copyTo(target: NodePdfDomMatrix) {
    target.a = this.a;
    target.b = this.b;
    target.c = this.c;
    target.d = this.d;
    target.e = this.e;
    target.f = this.f;
    return target;
  }
}

function installPdfJsNodePolyfills() {
  const globalObject = globalThis as typeof globalThis & {
    DOMMatrix?: unknown;
  };

  if (!globalObject.DOMMatrix) {
    globalObject.DOMMatrix = NodePdfDomMatrix as unknown as typeof DOMMatrix;
  }
}

function isVercelRuntime() {
  return Boolean(process.env.VERCEL);
}

function buildTextExtractionAttempt(
  extractor: PdfExtractionAttempt["extractor"],
  text: string,
): PdfExtractionAttempt {
  const textLength = normalizeWhitespace(text).length;
  return {
    extractor,
    status: hasUsefulText(text) ? "succeeded" : "empty",
    detail: hasUsefulText(text) ? null : "No usable selectable text was returned.",
    textLength,
    fieldCount: null,
  };
}

function buildPdfFieldExtractionAttempt(
  extractor: PdfExtractionAttempt["extractor"],
  text: string,
  fields: Record<string, string>,
): PdfExtractionAttempt {
  const textLength = normalizeWhitespace(text).length;
  const fieldCount = Object.keys(fields).length;
  const hasData = hasUsefulText(text) || fieldCount > 0;
  return {
    extractor,
    status: hasData ? "succeeded" : "empty",
    detail: hasData ? null : "No usable text or PDF form fields were returned.",
    textLength,
    fieldCount,
  };
}

function buildSkippedExtractionAttempt(
  extractor: PdfExtractionAttempt["extractor"],
  detail: string,
): PdfExtractionAttempt {
  return {
    extractor,
    status: "skipped",
    detail,
    textLength: null,
    fieldCount: null,
  };
}

function buildFailedExtractionAttempt(
  extractor: PdfExtractionAttempt["extractor"],
  detail: string,
): PdfExtractionAttempt {
  return {
    extractor,
    status: "failed",
    detail,
    textLength: null,
    fieldCount: null,
  };
}

function safeDiagnosticMessage(error: unknown) {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown extraction error.";
  const normalized = normalizeWhitespace(raw).replace(/[^\S\r\n]+/g, " ");
  return normalized.slice(0, 240);
}

async function extractPdfDataWithPyPdf(tempPath: string) {
  const { stdout } = await execFileAsync("python3", [
    path.join(process.cwd(), "scripts", "extract_pdf_content.py"),
    tempPath,
  ]);
  const parsed = JSON.parse(stdout) as {
    error?: string;
    text?: string;
    fields?: Record<string, string>;
    field_entries?: Array<{ name?: string; value?: string }>;
  };

  if (parsed.error) {
    throw new Error(parsed.error);
  }

  return {
    text: parsed.text ?? "",
    fields: parsed.fields ?? {},
    fieldEntries: Array.isArray(parsed.field_entries)
      ? parsed.field_entries
          .map((entry) => ({
            name: String(entry.name ?? ""),
            value: String(entry.value ?? ""),
          }))
          .filter((entry) => entry.name && entry.value)
      : [],
  };
}

async function extractPdfFieldsWithPdfKit(tempPath: string) {
  const binaryPath = await ensurePdfFormFieldBinary();
  const { stdout } = await execFileAsync(binaryPath, [tempPath]);
  const parsed = JSON.parse(stdout) as {
    error?: string;
    fields?: Record<string, string>;
    field_entries?: Array<{ name?: string; value?: string }>;
  };

  if (parsed.error) {
    throw new Error(parsed.error);
  }

  return {
    fields: parsed.fields ?? {},
    fieldEntries: Array.isArray(parsed.field_entries)
      ? parsed.field_entries
          .map((entry) => ({
            name: String(entry.name ?? ""),
            value: String(entry.value ?? ""),
          }))
          .filter((entry) => entry.name && entry.value)
      : [],
  };
}

async function extractVisualText(buffer: Buffer, kind: "pdf" | "image") {
  const extension = kind === "pdf" ? ".pdf" : ".png";
  const binaryPath = await ensureVisualOCRBinary();
  const tempPath = path.join(
    os.tmpdir(),
    `ria-file-ops-ocr-${crypto.randomUUID()}${extension}`,
  );
  await fs.writeFile(tempPath, buffer);

  try {
    const { stdout } = await execFileAsync(binaryPath, [tempPath]);
    const parsed = JSON.parse(stdout) as {
      error?: string;
      text?: string;
    };

    if (parsed.error) {
      throw new Error(parsed.error);
    }

    return parsed.text ?? "";
  } finally {
    await fs.unlink(tempPath).catch(() => {});
  }
}

async function ensureVisualOCRBinary() {
  return ensureSwiftBinary("extract_visual_text.swift", "ria-file-ops-visual-ocr");
}

async function ensurePdfFormFieldBinary() {
  return ensureSwiftBinary(
    "extract_pdf_form_fields.swift",
    "ria-file-ops-pdf-form-fields",
  );
}

async function ensureSwiftBinary(sourceFilename: string, binaryName: string) {
  const moduleCachePath = path.join(os.tmpdir(), "ria-file-ops-swift-module-cache");
  const sourcePath = path.join(process.cwd(), "scripts", sourceFilename);
  const binaryPath = path.join(os.tmpdir(), binaryName);

  await fs.mkdir(moduleCachePath, { recursive: true });

  const [sourceStats, binaryStats] = await Promise.all([
    fs.stat(sourcePath),
    fs.stat(binaryPath).catch(() => null),
  ]);

  if (binaryStats && binaryStats.mtimeMs >= sourceStats.mtimeMs) {
    return binaryPath;
  }

  await execFileAsync("swiftc", ["-o", binaryPath, sourcePath], {
    env: {
      ...process.env,
      CLANG_MODULE_CACHE_PATH: moduleCachePath,
      SWIFT_MODULECACHE_PATH: moduleCachePath,
    },
  });

  return binaryPath;
}

export async function analyzeTextContent(
  file: GoogleDriveFile,
  text: string,
  fields: Record<string, string>,
  contentSource: DocumentInsight["contentSource"],
  diagnosticFieldEntries?: Array<{ name: string; value: string }>,
  pdfFieldReaders: string[] = [],
  downloadFingerprint?: DownloadFingerprint | null,
  parserConflictSummary: string | null = null,
  options: AnalysisExecutionOptions = {},
) {
  const envelope = await analyzeTextContentWithEnvelope(
    file,
    text,
    fields,
    contentSource,
    diagnosticFieldEntries,
    pdfFieldReaders,
    downloadFingerprint,
    parserConflictSummary,
    options,
  );

  return envelope.legacyInsight;
}

export async function analyzeTextContentWithEnvelope(
  file: GoogleDriveFile,
  text: string,
  fields: Record<string, string>,
  contentSource: DocumentInsight["contentSource"],
  diagnosticFieldEntries?: Array<{ name: string; value: string }>,
  pdfFieldReaders: string[] = [],
  downloadFingerprint?: DownloadFingerprint | null,
  parserConflictSummary: string | null = null,
  options: AnalysisExecutionOptions = {},
): Promise<TextAnalysisResultEnvelope> {
  const context = buildTextAnalysisContext(
    file,
    text,
    fields,
    contentSource,
    diagnosticFieldEntries,
    pdfFieldReaders,
    downloadFingerprint,
    parserConflictSummary,
    options.pdfExtractionAttempts ?? [],
  );
  const legacyClassification = classifyTextAnalysisContext(context);
  const legacyExtraction = runTextAnalysisExtraction(context, legacyClassification);

  const taxCanonical = buildCanonicalTaxDocument({
    context,
    legacyClassification,
    legacyExtraction,
    analysisProfile: options.analysisProfile ?? "legacy",
  });

  if (taxCanonical) {
    return {
      canonical: taxCanonical,
      legacyInsight: adaptCanonicalToLegacyDocumentInsight(taxCanonical),
    };
  }

  if (
    options.analysisProfile === "preview_ai_primary" &&
    shouldAttemptAIPrimaryAccountStatement(context, legacyClassification)
  ) {
    const aiAttempt = await parseAccountStatementWithAI(
      buildAIPrimaryParseContext(context),
    );
    if (isUsableAIPrimaryStatementResult(aiAttempt.parsedResult)) {
      return validateAndFinalizeParsedResult(
        context,
        legacyExtraction,
        aiAttempt.parsedResult,
      );
    }

    return {
      canonical: null,
      legacyInsight: finalizeTextAnalysisInsight(
        context,
        legacyClassification,
        legacyExtraction,
        buildAITraceDebug(aiAttempt.debug),
      ),
    };
  }

  const identityCanonical = buildCanonicalIdentityDocument({
    context,
    legacyClassification,
    legacyExtraction,
    analysisProfile: options.analysisProfile ?? "legacy",
  });

  if (identityCanonical) {
    return {
      canonical: identityCanonical,
      legacyInsight: adaptCanonicalToLegacyDocumentInsight(identityCanonical),
    };
  }

  if (options.analysisProfile === "preview_ai_primary") {
    return {
      canonical: null,
      legacyInsight: finalizeTextAnalysisInsight(
        context,
        legacyClassification,
        legacyExtraction,
        {
          aiEnabled: true,
          aiAttempted: false,
          aiUsed: false,
          aiFailureReason:
            "Skipped: Phase 1 AI parser only runs for likely account statements with usable text.",
        },
      ),
    };
  }

  return {
    canonical: null,
    legacyInsight: finalizeTextAnalysisInsight(
      context,
      legacyClassification,
      legacyExtraction,
    ),
  };
}

function buildTextAnalysisContext(
  file: GoogleDriveFile,
  text: string,
  fields: Record<string, string>,
  contentSource: DocumentInsight["contentSource"],
  diagnosticFieldEntries?: Array<{ name: string; value: string }>,
  pdfFieldReaders: string[] = [],
  downloadFingerprint?: DownloadFingerprint | null,
  parserConflictSummary: string | null = null,
  pdfExtractionAttempts: PdfExtractionAttempt[] = [],
): TextAnalysisContext {
  const metadataFallback = analyzeFromMetadata(file, {
    downloadFingerprint,
  });
  const rawText = text ?? "";
  const combinedFieldText = Object.entries(fields)
    .map(([key, value]) => `${key} ${value}`)
    .join(" ");
  const normalizedText = normalizeWhitespace(`${rawText} ${combinedFieldText}`);
  const reasons = [...metadataFallback.reasons];

  if (contentSource === "pdf_ocr") {
    reasons.unshift("OCR was used because the PDF appears to be scanned or image-based.");
  }

  if (contentSource === "image_ocr") {
    reasons.unshift("Text was read directly from image OCR.");
  }

  return {
    file,
    rawText,
    fields,
    contentSource,
    metadataFallback,
    normalizedText,
    lowerText: normalizedText.toLowerCase(),
    pdfFields: formatPdfFieldsForDiagnostics(fields, diagnosticFieldEntries),
    reasons,
    textExcerpt: normalizedText.slice(0, 260) || null,
    diagnosticText: normalizedText.slice(0, 12000) || null,
    ownershipClientCandidate: extractOwnershipClientCandidate(normalizedText),
    accountContextCandidate: extractContextualAccountNumberDigits(rawText),
    accountLooseCandidate: extractLooseAccountNumberDigits(rawText),
    yearCandidates: [...normalizedText.matchAll(/\b(20\d{2})\b/g)].map(
      (match) => match[1],
    ),
    taxKeywordDetected:
      /\btax return\b/i.test(normalizedText) ||
      /\b1099\b/i.test(normalizedText) ||
      /\bw-?2\b/i.test(normalizedText) ||
      /\b1040\b/i.test(normalizedText) ||
      /\birs\b/i.test(normalizedText) ||
      /\btaxpayer\b/i.test(normalizedText) ||
      /\bform\s+1040\b/i.test(normalizedText),
    pdfFieldReaders,
    pdfExtractionAttempts,
    downloadFingerprint,
    parserConflictSummary,
  };
}

function classifyTextAnalysisContext(
  context: TextAnalysisContext,
): TextAnalysisClassification {
  let documentLabel = context.metadataFallback.documentLabel;
  let documentSubtype = context.metadataFallback.documentSubtype;
  let documentTypeId = context.metadataFallback.documentTypeId;
  let filenameLabel = context.metadataFallback.filenameLabel;
  let topLevelFolder = context.metadataFallback.topLevelFolder;
  let confidence = Math.max(context.metadataFallback.confidence, 0.58);
  let documentSignal = context.metadataFallback.debug.documentSignal;

  if (
    includesAny(context.lowerText, [
      "standing payment",
      "wire instructions",
      "money movement",
      "electronic funds transfer",
      "journal request",
      "ach authorization",
    ])
  ) {
    documentLabel = "Money movement form";
    documentSubtype = null;
    documentTypeId = "money_movement_form";
    filenameLabel = "Money_Movement";
    topLevelFolder = "Money Movement";
    confidence = 0.88;
    documentSignal = "Matched money movement keywords in document text.";
    context.reasons.unshift(
      "Actual document text suggests this is a money movement or transfer form.",
    );
  } else if (
    includesAny(context.lowerText, [
      "account statement",
      "account summary",
      "portfolio summary",
      "statement period",
      "ending value",
      "beginning value",
      "schwab",
      "fidelity",
      "pershing",
      "statement",
    ]) &&
    !hasStrongTaxDocumentSignal(context.lowerText)
  ) {
    documentLabel = "Account statement";
    documentSubtype = null;
    documentTypeId = "account_statement";
    filenameLabel = "Account_Statement";
    topLevelFolder = "Accounts";
    confidence = 0.85;
    documentSignal = "Matched account statement keywords in document text.";
    context.reasons.unshift("Actual document text suggests this is an account statement.");
  } else if (
    includesAny(context.lowerText, [
      "tax",
      "tax return",
      "1099",
      "w-2",
      "w2",
      "taxpayer",
      "capital gains",
      "qualified dividends",
      "form 1040",
      "u.s. individual income tax return",
      "extension",
      "estimated tax",
      "schedule k-1",
    ])
  ) {
    const taxSubtype = detectTaxDocumentSubtype(
      context.normalizedText,
      context.file.name,
    );
    const specificTaxDocumentLabel = getTaxDocumentSubtypeLabel(taxSubtype);
    documentLabel = "Tax document";
    documentSubtype = taxSubtype;
    documentTypeId = "tax_document";
    filenameLabel = specificTaxDocumentLabel ?? "Tax_Document";
    topLevelFolder = "Tax";
    confidence = taxSubtype !== "unknown_tax_document" ? 0.84 : 0.8;
    documentSignal = specificTaxDocumentLabel
      ? `Matched tax-document text: ${specificTaxDocumentLabel}.`
      : "Matched tax-document keywords in document text.";
    context.reasons.unshift(
      specificTaxDocumentLabel
        ? `Actual document text suggests this is a ${specificTaxDocumentLabel} tax document.`
        : "Actual document text suggests this is a tax document.",
    );
  } else if (isLikelyIdentityDocumentText(context.lowerText)) {
    documentLabel = "Identity document";
    documentSubtype = null;
    documentTypeId = "identity_document";
    filenameLabel = "Client_ID";
    topLevelFolder = "Client Info";
    confidence = 0.82;
    documentSignal = "Matched identity-document keywords in document text.";
    context.reasons.unshift(
      "Actual document text suggests this is a personal identity or client document.",
    );
  } else if (
    includesAny(context.lowerText, [
      "meeting notes",
      "financial plan",
      "retirement analysis",
      "recommendation",
      "action items",
    ])
  ) {
    documentLabel = "Planning / advice document";
    documentSubtype = null;
    documentTypeId = "planning_document";
    filenameLabel = "Planning_Document";
    topLevelFolder = "Planning";
    confidence = 0.78;
    context.reasons.unshift(
      "Actual document text suggests this is a planning or advice document.",
    );
  } else {
    context.reasons.unshift(
      "Document text was read, but the document type is still somewhat ambiguous.",
    );
  }

  return {
    documentTypeId,
    documentLabel,
    documentSubtype,
    filenameLabel,
    topLevelFolder,
    confidence,
    documentSignal,
  };
}

function runTextAnalysisExtraction(
  context: TextAnalysisContext,
  classification: TextAnalysisClassification,
): TextAnalysisExtraction {
  const jointClientsFromFields = extractJointClientNamesFromFields(context.fields);
  let detectedClient = extractClientNameFromFields(context.fields);
  const jointClients =
    jointClientsFromFields ?? extractJointClientNames(context.normalizedText);

  if (jointClients) {
    detectedClient = jointClients.primary;
  }

  if (!detectedClient) {
    detectedClient = extractClientNameFromText(context.normalizedText);
  }

  if (!detectedClient) {
    detectedClient = context.metadataFallback.detectedClient;
  }

  const detectedClient2 =
    jointClients?.secondary ?? context.metadataFallback.detectedClient2;

  const genericMetadata = {
    accountLast4:
      extractAccountLast4(context.rawText, context.fields) ??
      context.metadataFallback.metadata.accountLast4,
    accountType:
      extractAccountType(
        context.normalizedText,
        context.file.name,
        context.fields,
        classification.documentTypeId,
      ) ?? context.metadataFallback.metadata.accountType,
    custodian:
      extractCustodian(context.normalizedText, context.file.name) ??
      context.metadataFallback.metadata.custodian,
    documentDate: extractDocumentDate(context.normalizedText),
    entityName:
      extractEntityName(context.normalizedText) ??
      context.metadataFallback.metadata.entityName,
    idType:
      extractIdType(context.normalizedText, context.file.name) ??
      context.metadataFallback.metadata.idType,
    taxYear:
      extractTaxYear(context.normalizedText, context.file.name) ??
      context.metadataFallback.metadata.taxYear,
  } satisfies DocumentInsight["metadata"];

  const accountStatementOverlay =
    classification.documentTypeId === "account_statement"
      ? extractAccountStatement({
          file: context.file,
          rawText: context.rawText,
          normalizedText: context.normalizedText,
          fields: context.fields,
          metadata: genericMetadata,
          helpers: {
            extractClientNameFromFields,
            extractClientNameFromText,
            extractJointClientNamesFromFields,
            extractJointClientNames,
            extractAccountType,
            extractAccountLast4,
            normalizeWhitespace,
          },
        })
      : null;
  const moneyMovementOverlay =
    classification.documentTypeId === "money_movement_form"
      ? extractMoneyMovementForm({
          file: context.file,
          rawText: context.rawText,
          normalizedText: context.normalizedText,
          fields: context.fields,
          metadata: genericMetadata,
          helpers: {
            extractClientNameFromFields,
            extractClientNameFromText,
            extractJointClientNamesFromFields,
            extractJointClientNames,
            normalizeWhitespace,
          },
        })
      : null;
  const identityDocumentOverlay =
    classification.documentTypeId === "identity_document"
      ? extractIdentityDocument({
          file: context.file,
          rawText: context.rawText,
          normalizedText: context.normalizedText,
          fields: context.fields,
          metadata: genericMetadata,
          helpers: {
            extractClientNameFromFields,
            extractClientNameFromText,
            normalizeWhitespace,
          },
        })
      : null;
  const taxDocumentOverlay =
    classification.documentTypeId === "tax_document"
      ? extractTaxDocument({
          file: context.file,
          rawText: context.rawText,
          normalizedText: context.normalizedText,
          fields: context.fields,
          metadata: genericMetadata,
          helpers: {
            extractClientNameFromFields,
            extractClientNameFromText,
            extractCustodian,
            extractTaxYear,
            extractDocumentDate,
            normalizeWhitespace,
          },
        })
      : null;

  const resolvedClient =
    accountStatementOverlay?.detectedClient ??
    moneyMovementOverlay?.detectedClient ??
    identityDocumentOverlay?.detectedClient ??
    taxDocumentOverlay?.detectedClient ??
    detectedClient;
  const resolvedClient2 =
    accountStatementOverlay?.detectedClient2 ??
    moneyMovementOverlay?.detectedClient2 ??
    detectedClient2;
  const resolvedMetadata = {
    accountLast4:
      accountStatementOverlay?.accountLast4 ??
      moneyMovementOverlay?.accountLast4 ??
      genericMetadata.accountLast4,
    accountType:
      accountStatementOverlay?.accountType ??
      moneyMovementOverlay?.accountType ??
      genericMetadata.accountType,
    custodian:
      accountStatementOverlay?.custodian ??
      moneyMovementOverlay?.custodian ??
      taxDocumentOverlay?.custodian ??
      genericMetadata.custodian,
    documentDate:
      accountStatementOverlay?.documentDate ??
      taxDocumentOverlay?.documentDate ??
      genericMetadata.documentDate,
    entityName: genericMetadata.entityName,
    idType:
      classification.documentTypeId === "account_statement"
        ? null
        : identityDocumentOverlay?.idType ?? genericMetadata.idType,
    taxYear: taxDocumentOverlay?.taxYear ?? genericMetadata.taxYear,
  } satisfies DocumentInsight["metadata"];
  const hasSpecializedJointOwners =
    classification.documentTypeId === "account_statement" &&
    hasMeaningfulSecondaryClient(resolvedClient, resolvedClient2);
  const hasInvalidSpecializedSecondaryClient =
    classification.documentTypeId === "account_statement" &&
    Boolean(normalizeWhitespace(resolvedClient2 ?? "")) &&
    !hasSpecializedJointOwners;
  const ownershipType = hasSpecializedJointOwners
    ? ("joint" as const)
    : hasInvalidSpecializedSecondaryClient
      ? ("single" as const)
      : detectOwnershipType(
          context.normalizedText,
          context.file.name,
          jointClients,
          resolvedMetadata.accountType,
        );

  return {
    detectedClient: resolvedClient,
    detectedClient2: resolvedClient2,
    ownershipType,
    metadata: resolvedMetadata,
    statementClientSource: accountStatementOverlay?.statementClientSource ?? null,
    statementClientCandidate:
      accountStatementOverlay?.statementClientCandidate ?? null,
  };
}

function shouldAttemptAIPrimaryAccountStatement(
  context: TextAnalysisContext,
  legacyClassification: TextAnalysisClassification,
) {
  if (context.contentSource === "metadata_only") {
    return false;
  }

  if (!hasUsefulText(context.rawText)) {
    return false;
  }

  return legacyClassification.documentTypeId === "account_statement";
}

function buildAIPrimaryParseContext(
  context: TextAnalysisContext,
): AIPrimaryParseContext {
  return {
    contentSource: context.contentSource,
    diagnosticText: context.diagnosticText,
    file: {
      id: context.file.id,
      mimeType: context.file.mimeType,
      name: context.file.name,
    },
    normalizedText: context.normalizedText,
  };
}

function isUsableAIPrimaryStatementResult(
  parsedResult: ParsedDocumentResult | null,
): parsedResult is ParsedDocumentResult {
  return parsedResult?.values.documentTypeId === "account_statement";
}

function validateAndFinalizeParsedResult(
  context: TextAnalysisContext,
  legacyExtraction: TextAnalysisExtraction,
  parsedResult: ParsedDocumentResult,
): TextAnalysisResultEnvelope {
  const ownership = { ...parsedResult.ownership };
  const aiMetadata = parsedResult.values.metadata ?? {};
  const rawAIDetectedClient = normalizeAIName(parsedResult.values.detectedClient);
  const rawAIDetectedClient2 = normalizeAIName(parsedResult.values.detectedClient2);
  const detectedClient = legacyExtraction.detectedClient;
  const detectedClient2 = legacyExtraction.detectedClient2;
  if (detectedClient || rawAIDetectedClient) {
    ownership.detectedClient = {
      owner: "logic",
      source: "legacy_client_name_authority",
      confidence: parsedResult.ownership.detectedClient?.confidence ?? null,
      raw: rawAIDetectedClient,
    };
  }
  if (detectedClient2 || rawAIDetectedClient2) {
    ownership.detectedClient2 = {
      owner: "logic",
      source: "legacy_client_name_authority",
      confidence: parsedResult.ownership.detectedClient2?.confidence ?? null,
      raw: rawAIDetectedClient2,
    };
  }
  const normalizedAccountType = normalizeAccountStatementAccountType(
    normalizeAIFreeText(aiMetadata.accountType),
  );
  const normalizedCustodian = normalizeAccountStatementCustodian(
    normalizeAIFreeText(aiMetadata.custodian),
  );
  const accountLast4 = resolveAIPrimaryFieldValue({
    field: "accountLast4",
    aiValue: sanitizeAIAccountLast4(aiMetadata.accountLast4),
    legacyValue: legacyExtraction.metadata.accountLast4,
    ownership,
    aiRawValue: aiMetadata.accountLast4 ?? null,
    validatorSource: "validated_account_last4",
  });
  const accountType = resolveAIPrimaryFieldValue({
    field: "accountType",
    aiValue: normalizedAccountType.finalValue,
    legacyValue: legacyExtraction.metadata.accountType,
    ownership,
    aiRawValue: normalizedAccountType.rawValue,
    validatorSource: normalizedAccountType.changed
      ? `normalized_account_type:${normalizedAccountType.ruleId ?? "rule"}`
      : undefined,
  });
  const custodian = resolveAIPrimaryFieldValue({
    field: "custodian",
    aiValue: normalizedCustodian.finalValue,
    legacyValue: legacyExtraction.metadata.custodian,
    ownership,
    aiRawValue: normalizedCustodian.rawValue,
    validatorSource: normalizedCustodian.changed
      ? `normalized_custodian:${normalizedCustodian.ruleId ?? "rule"}`
      : undefined,
  });
  const documentDate = resolveAIPrimaryFieldValue({
    field: "documentDate",
    aiValue: sanitizeAIDocumentDate(aiMetadata.documentDate),
    legacyValue: legacyExtraction.metadata.documentDate,
    ownership,
    aiRawValue: aiMetadata.documentDate ?? null,
    validatorSource: "validated_document_date",
  });

  const ownershipTypeCandidate = resolveAIPrimaryFieldValue({
    field: "ownershipType",
    aiValue:
      parsedResult.values.ownershipType === "joint" ||
      parsedResult.values.ownershipType === "single"
        ? parsedResult.values.ownershipType
        : null,
    legacyValue: legacyExtraction.ownershipType,
    ownership,
  });
  let ownershipType: "single" | "joint" =
    ownershipTypeCandidate === "joint" || ownershipTypeCandidate === "single"
      ? ownershipTypeCandidate
      : legacyExtraction.ownershipType;

  if (
    ownershipType === "joint" &&
    !hasMeaningfulSecondaryClient(detectedClient, detectedClient2)
  ) {
    const validatedOwnership = detectOwnershipType(
      context.normalizedText,
      context.file.name,
      null,
      accountType,
    );
    if (validatedOwnership !== "joint") {
      ownershipType = validatedOwnership;
      ownership.ownershipType = {
        owner: "logic",
        source: "validated_joint_without_secondary",
        confidence: parsedResult.ownership.ownershipType?.confidence ?? null,
        raw: parsedResult.values.ownershipType ?? null,
      };
    }
  }

  context.reasons.unshift(
    "AI primary parser handled the Phase 1 account statement fields for this preview analysis.",
  );

  const canonical = buildCanonicalAIPrimaryStatementDocument({
    context,
    parsedResult,
    ownership,
    rawAIDetectedClient,
    rawAIDetectedClient2,
    normalizedCustodian,
    normalizedAccountType,
    detectedClient,
    detectedClient2,
    ownershipType,
    accountLast4,
    accountType,
    custodian,
    documentDate,
    legacyExtraction,
  });

  return {
    canonical,
    legacyInsight: adaptCanonicalToLegacyDocumentInsight(canonical),
  };
}

function buildCanonicalAIPrimaryStatementDocument(input: {
  context: TextAnalysisContext;
  parsedResult: ParsedDocumentResult;
  ownership: Partial<Record<ParsedFieldKey, ParsedFieldOwnership>>;
  rawAIDetectedClient: string | null;
  rawAIDetectedClient2: string | null;
  normalizedCustodian: {
    rawValue: string | null;
    finalValue: string | null;
    changed: boolean;
    ruleId: string | null;
  };
  normalizedAccountType: {
    rawValue: string | null;
    finalValue: string | null;
    changed: boolean;
    ruleId: string | null;
  };
  detectedClient: string | null;
  detectedClient2: string | null;
  ownershipType: "single" | "joint";
  accountLast4: string | null;
  accountType: string | null;
  custodian: string | null;
  documentDate: string | null;
  legacyExtraction: TextAnalysisExtraction;
}) {
  const parsedExtracted = getParsedStatementExtracted(input.parsedResult);
  const enrichment = extractStatementCanonicalEnrichment({
    context: input.context,
    detectedClient: input.detectedClient,
    rawAIDetectedClient: input.rawAIDetectedClient,
    normalizedAccountType: input.accountType,
    rawAccountType: input.normalizedAccountType.rawValue,
    normalizedAccountLast4: input.accountLast4,
    normalizedDocumentDate: input.documentDate,
  });
  const institutions = buildCanonicalStatementInstitutions({
    parsedInstitutions: parsedExtracted.institutions,
    statementText: input.context.rawText,
    fallbackRawCustodian: input.normalizedCustodian.rawValue ?? input.custodian,
    finalCustodian: input.custodian,
  });
  const parties = buildCanonicalStatementParties({
    parsedParties: parsedExtracted.parties,
    rawAIDetectedClient: input.rawAIDetectedClient,
    rawAIDetectedClient2: input.rawAIDetectedClient2,
    detectedClient: input.detectedClient,
    detectedClient2: input.detectedClient2,
    fallbackPartyAddress: enrichment.partyAddress,
  });
  const dates = buildCanonicalStatementDates({
    parsedDates: parsedExtracted.dates,
    fallbackDates: enrichment,
    parties: parties.extracted,
    institutions: institutions.extracted,
  });
  const accounts = buildCanonicalStatementAccounts({
    parsedAccounts: parsedExtracted.accounts,
    fallbackAccounts: enrichment,
    extractedDates: dates.extracted,
    normalizedDates: dates.normalized,
    institutions,
    finalAccountType: input.accountType,
    rawPrimaryAccountType: input.normalizedAccountType.rawValue,
    finalPrimaryAccountLast4: input.accountLast4,
  });
  const accountParties = buildCanonicalStatementAccountParties({
    parsedAccountParties: parsedExtracted.accountParties,
    extractedAccounts: accounts.extracted,
    normalizedAccounts: accounts.normalized,
    extractedParties: parties.extracted,
    normalizedParties: parties.normalized,
    ownershipType: input.ownershipType,
    extractedOwnershipType:
      input.parsedResult.values.ownershipType === "joint" ? "joint" : "single",
  });
  const documentFacts = buildCanonicalStatementDocumentFacts(
    parsedExtracted.documentFacts,
  );
  const extractedContacts = buildCanonicalStatementContacts({
    parsedContacts: parsedExtracted.contacts,
    fallbackContacts: enrichment.extractedContacts,
    institutions: institutions.extracted,
    normalizeValues: false,
  });
  const normalizedContacts = buildCanonicalStatementContacts({
    parsedContacts: parsedExtracted.contacts,
    fallbackContacts: enrichment.normalizedContacts,
    institutions: institutions.normalized,
    normalizeValues: true,
  });
  const sourceRefs: CanonicalSourceRef[] = [];
  const rawClientSourceRefId = pushSourceRef(sourceRefs, {
    kind: "ai_field",
    fieldPath: "extracted.parties[0].displayName",
    label: "AI detected client",
    value: input.rawAIDetectedClient,
  });
  const rawClient2SourceRefId = pushSourceRef(sourceRefs, {
    kind: "ai_field",
    fieldPath: "extracted.parties[1].displayName",
    label: "AI detected client 2",
    value: input.rawAIDetectedClient2,
  });
  const rawCustodianSourceRefId = pushSourceRef(sourceRefs, {
    kind: "ai_field",
    fieldPath: "extracted.institutions[0].name",
    label: "AI custodian",
    value:
      institutions.extracted[0]?.rawName ??
      institutions.extracted[0]?.name ??
      input.normalizedCustodian.rawValue,
  });
  const rawAccountTypeSourceRefId = pushSourceRef(sourceRefs, {
    kind: "ai_field",
    fieldPath: "extracted.accounts[0].accountType",
    label: "AI account type",
    value: accounts.extracted[0]?.accountType ?? input.normalizedAccountType.rawValue,
  });
  const rawAccountLast4SourceRefId = pushSourceRef(sourceRefs, {
    kind: "ai_field",
    fieldPath: "extracted.accounts[0].accountLast4",
    label: "AI account last4",
    value:
      accounts.extracted[0]?.accountLast4 ??
      input.parsedResult.values.metadata?.accountLast4 ??
      null,
  });
  const rawDocumentDateSourceRefId = pushSourceRef(sourceRefs, {
    kind: "ai_field",
    fieldPath: "extracted.dates[0].value",
    label: "AI document date",
    value:
      dates.extracted.find((date) => date.kind === "document_date")?.rawValue ??
      dates.extracted.find((date) => date.kind === "statement_period_end")?.rawValue ??
      input.parsedResult.values.metadata?.documentDate ??
      null,
  });
  pushSourceRef(sourceRefs, {
    kind: "ai_summary",
    fieldPath: null,
    label: "AI raw evidence summary",
    value: input.parsedResult.debug?.aiRawSummary ?? null,
  });
  const logicClientSourceRefId = pushSourceRef(sourceRefs, {
    kind: "logic_field",
    fieldPath: "normalized.parties[0].displayName",
    label: "Legacy client-name authority",
    value: input.detectedClient,
  });
  const logicClient2SourceRefId = pushSourceRef(sourceRefs, {
    kind: "logic_field",
    fieldPath: "normalized.parties[1].displayName",
    label: "Legacy client-name authority (secondary)",
    value: input.detectedClient2,
  });
  const rawAddressSourceRefId = pushSourceRef(sourceRefs, {
    kind: "logic_field",
    fieldPath: "normalized.parties[0].addresses[0].rawText",
    label: "Statement owner address",
    value:
      parties.extracted[0]?.addresses[0]?.rawText ??
      enrichment.partyAddress.rawAddress?.rawText ??
      null,
  });
  const contactSourceRefIdsByIndex = buildCanonicalStatementContactRefIds(
    sourceRefs,
    extractedContacts,
  );
  const accountNumberSourceRefIds = accounts.extracted.map((account, index) =>
    pushSourceRef(sourceRefs, {
      kind: "logic_field",
      fieldPath: `normalized.accounts[${index}].accountNumber`,
      label: `Statement account number ${index + 1}`,
      value: account.accountNumber,
    }),
  );
  const dateSourceRefIds = dates.extracted.map((date, index) =>
    pushSourceRef(sourceRefs, {
      kind: "logic_field",
      fieldPath: `normalized.dates[${index}].value`,
      label: `Statement date ${date.kind}`,
      value: date.rawValue,
    }),
  );

  const normalization = buildCanonicalNormalizationRecords({
    normalizedCustodian: input.normalizedCustodian,
    normalizedAccountType: input.normalizedAccountType,
    rawAccountLast4: input.parsedResult.values.metadata?.accountLast4 ?? null,
    finalAccountLast4: input.accountLast4,
    rawDocumentDate: input.parsedResult.values.metadata?.documentDate ?? null,
    finalDocumentDate: input.documentDate,
    rawCustodianSourceRefId,
    rawAccountTypeSourceRefId,
    rawAccountLast4SourceRefId,
    rawDocumentDateSourceRefId,
  });

  const canonicalDraft: CanonicalExtractedDocumentDraft = {
    source: {
      file: {
        fileId: input.context.file.id,
        sourceName: input.context.file.name,
        mimeType: input.context.file.mimeType,
        modifiedTime: input.context.file.modifiedTime ?? null,
        driveSize: input.context.file.size ?? null,
        downloadByteLength: input.context.downloadFingerprint?.byteLength ?? null,
        downloadSha1: input.context.downloadFingerprint?.sha1 ?? null,
      },
      extraction: {
        contentSource: input.context.contentSource,
        pdfFields: input.context.pdfFields,
        pdfFieldReaders: input.context.pdfFieldReaders,
        pdfExtractionAttempts: input.context.pdfExtractionAttempts,
      },
    },
    classification: {
      extracted: {
        documentTypeId: input.parsedResult.values.documentTypeId ?? null,
        documentSubtype: null,
      },
      normalized: {
        documentTypeId: "account_statement",
        documentSubtype: null,
      },
    },
    extracted: {
      parties: parties.extracted,
      accounts: accounts.extracted,
      accountParties: accountParties.extracted,
      institutions: institutions.extracted,
      contacts: extractedContacts,
      dates: dates.extracted,
      documentFacts: documentFacts.extracted,
    },
    normalized: {
      parties: parties.normalized,
      accounts: accounts.normalized,
      accountParties: accountParties.normalized,
      institutions: institutions.normalized,
      contacts: normalizedContacts,
      dates: dates.normalized,
      documentFacts: documentFacts.normalized,
    },
    provenance: {
      fields: buildCanonicalFieldProvenance({
        ownership: input.ownership,
        logicClientSourceRefId,
        logicClient2SourceRefId,
        rawClientSourceRefId,
        rawClient2SourceRefId,
        rawCustodianSourceRefId,
        rawAccountTypeSourceRefId,
        rawAccountLast4SourceRefId,
        rawDocumentDateSourceRefId,
      }),
      normalization,
      sourceRefs,
    },
    diagnostics: {
      parserVersion: PARSER_VERSION,
      parserConflictSummary: input.context.parserConflictSummary,
      documentSignal:
        "AI primary parser accepted this as an account statement for the Phase 1 preview path.",
      reasons: [...input.context.reasons],
      textExcerpt: input.context.textExcerpt,
      diagnosticText: input.context.diagnosticText,
      statementClientSource: input.legacyExtraction.statementClientSource,
      statementClientCandidate: input.legacyExtraction.statementClientCandidate,
      ownershipClientCandidate: input.context.ownershipClientCandidate,
      accountContextCandidate: input.context.accountContextCandidate,
      accountLooseCandidate: input.context.accountLooseCandidate,
      taxKeywordDetected: input.context.taxKeywordDetected,
      yearCandidates: input.context.yearCandidates,
      ai: {
        enabled: input.parsedResult.debug?.aiEnabled ?? true,
        attempted: input.parsedResult.debug?.aiAttempted ?? true,
        used: input.parsedResult.debug?.aiUsed ?? true,
        model: input.parsedResult.debug?.aiModel ?? null,
        promptVersion: input.parsedResult.debug?.aiPromptVersion ?? null,
        failureReason: input.parsedResult.debug?.aiFailureReason ?? null,
        rawSummary: input.parsedResult.debug?.aiRawSummary ?? null,
      },
    },
  };

  if (parties.normalized[0]?.addresses[0]?.rawText) {
    assignCanonicalFieldProvenance(
      canonicalDraft.provenance.fields,
      "normalized.parties[0].addresses[0].rawText",
      {
        owner: "logic",
        source: parsedExtracted.parties[0]?.address
          ? "validated_ai_party_address"
          : "statement_owner_address_block",
        confidence: null,
        raw:
          parties.extracted[0]?.addresses[0]?.rawText ??
          enrichment.partyAddress.rawAddress?.rawText ??
          null,
      },
      [rawAddressSourceRefId],
    );
  }

  accounts.normalized.forEach((account, accountIndex) => {
    if (account.accountNumber) {
      assignCanonicalFieldProvenance(
        canonicalDraft.provenance.fields,
        `normalized.accounts[${accountIndex}].accountNumber`,
        {
          owner: "logic",
          source: "statement_account_number",
          confidence: null,
          raw: accounts.extracted[accountIndex]?.accountNumber ?? null,
        },
        [accountNumberSourceRefIds[accountIndex] ?? null],
      );
    }

    account.values.forEach((value, valueIndex) => {
      if (!value.money?.amount) {
        return;
      }

      assignCanonicalFieldProvenance(
        canonicalDraft.provenance.fields,
        `normalized.accounts[${accountIndex}].values[${valueIndex}].money.amount`,
        {
          owner: "logic",
          source: "statement_account_value",
          confidence: null,
          raw:
            accounts.extracted[accountIndex]?.values[valueIndex]?.money?.amount ??
            null,
        },
      );
    });
  });

  canonicalDraft.normalized.contacts.forEach((contact, contactIndex) => {
    if (!contact.value) {
      return;
    }

      assignCanonicalFieldProvenance(
        canonicalDraft.provenance.fields,
        `normalized.contacts[${contactIndex}].value`,
        {
          owner: "logic",
          source: "statement_service_contact",
          confidence: null,
          raw: canonicalDraft.extracted.contacts[contactIndex]?.value ?? null,
        },
      [contactSourceRefIdsByIndex[contactIndex] ?? null],
    );
  });

  canonicalDraft.normalized.dates.forEach((date, dateIndex) => {
    assignCanonicalFieldProvenance(
      canonicalDraft.provenance.fields,
      `normalized.dates[${dateIndex}].value`,
      {
        owner: "logic",
        source: "statement_period_date",
        confidence: null,
        raw: canonicalDraft.extracted.dates[dateIndex]?.rawValue ?? null,
      },
      [dateSourceRefIds[dateIndex] ?? null],
    );
  });

  return finalizeCanonicalExtractedDocument(canonicalDraft);
}

function getParsedStatementExtracted(parsedResult: ParsedDocumentResult) {
  return (
    parsedResult.extracted ?? {
      parties: [],
      institutions: [],
      contacts: [],
      accounts: [],
      accountParties: [],
      dates: [],
      documentFacts: {
        entityName: null,
        idType: null,
        taxYear: null,
      },
    }
  );
}

type CanonicalIdentitySubtype = "driver_license" | "state_id";

type CanonicalIdentityEvidence = {
  subtype: CanonicalIdentitySubtype;
  idType: "Driver License" | "State ID";
  rawName: string;
  displayName: string;
  address: NonNullable<
    CanonicalExtractedDocumentDraft["normalized"]["parties"][number]["addresses"][number]
  > | null;
  governmentIdValue: string | null;
  maskedGovernmentId: string | null;
  issuingAuthority: string | null;
  birthDate: {
    present: boolean;
    value: string | null;
    rawValue: string | null;
  };
  issueDate: {
    present: boolean;
    value: string | null;
    rawValue: string | null;
  };
  expirationDate: {
    present: boolean;
    value: string | null;
    rawValue: string | null;
  };
};

function buildCanonicalIdentityDocument(input: {
  context: TextAnalysisContext;
  legacyClassification: TextAnalysisClassification;
  legacyExtraction: TextAnalysisExtraction;
  analysisProfile: AnalysisProfile;
}): CanonicalExtractedDocument | null {
  const identityEvidence = extractCanonicalIdentityEvidence(input.context);
  if (!identityEvidence) {
    return null;
  }

  const sourceRefs: CanonicalSourceRef[] = [];
  const rawNameSourceRefId = pushSourceRef(sourceRefs, {
    kind: "logic_field",
    fieldPath: "extracted.parties[0].rawName",
    label: "Identity document name block",
    value: identityEvidence.rawName,
  });
  const rawAddressSourceRefId = pushSourceRef(sourceRefs, {
    kind: "logic_field",
    fieldPath: "extracted.parties[0].addresses[0].rawText",
    label: "Identity document address block",
    value: identityEvidence.address?.rawText ?? null,
  });
  const rawGovernmentIdSourceRefId = pushSourceRef(sourceRefs, {
    kind: "logic_field",
    fieldPath: "extracted.parties[0].governmentIds[0].value",
    label: "Identity document government ID",
    value: identityEvidence.governmentIdValue,
  });
  const rawBirthDateSourceRefId = pushSourceRef(sourceRefs, {
    kind: "logic_field",
    fieldPath: "extracted.dates[1].rawValue",
    label: "Identity document birth date",
    value: identityEvidence.birthDate.rawValue,
  });
  const rawIssueDateSourceRefId = pushSourceRef(sourceRefs, {
    kind: "logic_field",
    fieldPath: "extracted.dates[0].rawValue",
    label: "Identity document issue/document date",
    value: identityEvidence.issueDate.rawValue,
  });
  const rawExpirationDateSourceRefId = pushSourceRef(sourceRefs, {
    kind: "logic_field",
    fieldPath: "extracted.dates[3].rawValue",
    label: "Identity document expiration date",
    value: identityEvidence.expirationDate.rawValue,
  });

  const extractedDates = buildCanonicalIdentityDates(identityEvidence);
  const normalizedDates = extractedDates.map((date) => ({ ...date }));
  const governmentId = {
    kind: identityEvidence.subtype,
    value: identityEvidence.governmentIdValue,
    maskedValue: identityEvidence.maskedGovernmentId,
    issuingAuthority: identityEvidence.issuingAuthority,
    expirationDateId:
      extractedDates.find((date) => date.kind === "expiration_date")?.id ?? null,
  };
  const extractedParty = {
    id: "party-1",
    kind: "person" as const,
    displayName: identityEvidence.rawName,
    rawName: identityEvidence.rawName,
    addresses: identityEvidence.address ? [{ ...identityEvidence.address }] : [],
    birthDateId: extractedDates.find((date) => date.kind === "birth_date")?.id ?? null,
    taxIdentifiers: [],
    governmentIds: [governmentId],
  };
  const normalizedParty = {
    id: "party-1",
    kind: "person" as const,
    displayName: identityEvidence.displayName,
    rawName: identityEvidence.rawName,
    addresses: identityEvidence.address ? [{ ...identityEvidence.address }] : [],
    birthDateId: normalizedDates.find((date) => date.kind === "birth_date")?.id ?? null,
    taxIdentifiers: [],
    governmentIds: [{ ...governmentId }],
  };
  const aiEnabled = input.analysisProfile === "preview_ai_primary";
  const canonicalDraft: CanonicalExtractedDocumentDraft = {
    source: {
      file: {
        fileId: input.context.file.id,
        sourceName: input.context.file.name,
        mimeType: input.context.file.mimeType,
        modifiedTime: input.context.file.modifiedTime ?? null,
        driveSize: input.context.file.size ?? null,
        downloadByteLength: input.context.downloadFingerprint?.byteLength ?? null,
        downloadSha1: input.context.downloadFingerprint?.sha1 ?? null,
      },
      extraction: {
        contentSource: input.context.contentSource,
        pdfFields: input.context.pdfFields,
        pdfFieldReaders: input.context.pdfFieldReaders,
        pdfExtractionAttempts: input.context.pdfExtractionAttempts,
      },
    },
    classification: {
      extracted: {
        documentTypeId: "identity_document",
        documentSubtype: identityEvidence.subtype,
      },
      normalized: {
        documentTypeId: "identity_document",
        documentSubtype: identityEvidence.subtype,
      },
    },
    extracted: {
      parties: [extractedParty],
      accounts: [],
      accountParties: [],
      institutions: [],
      contacts: [],
      dates: extractedDates,
      documentFacts: {
        entityName: null,
        idType: identityEvidence.idType,
        taxYear: null,
      },
    },
    normalized: {
      parties: [normalizedParty],
      accounts: [],
      accountParties: [],
      institutions: [],
      contacts: [],
      dates: normalizedDates,
      documentFacts: {
        entityName: null,
        idType: identityEvidence.idType,
        taxYear: null,
      },
    },
    provenance: {
      fields: {},
      normalization: identityEvidence.rawName !== identityEvidence.displayName
        ? [
            {
              fieldPath: "normalized.parties[0].displayName",
              source: "identity_display_name_normalization",
              ruleId: "identity_display_name_title_case",
              rawValue: identityEvidence.rawName,
              finalValue: identityEvidence.displayName,
              sourceRefId: rawNameSourceRefId,
            },
          ]
        : [],
      sourceRefs,
    },
    diagnostics: {
      parserVersion: PARSER_VERSION,
      parserConflictSummary: input.context.parserConflictSummary,
      documentSignal:
        input.legacyClassification.documentSignal ??
        `Clean identity-document canonical path recognized a ${identityEvidence.idType}.`,
      reasons: [
        ...input.context.reasons,
        `Clean identity-document canonical path recognized a ${identityEvidence.idType}.`,
      ],
      textExcerpt: input.context.textExcerpt,
      diagnosticText: input.context.diagnosticText,
      statementClientSource: null,
      statementClientCandidate: null,
      ownershipClientCandidate: input.context.ownershipClientCandidate,
      accountContextCandidate: input.context.accountContextCandidate,
      accountLooseCandidate: input.context.accountLooseCandidate,
      taxKeywordDetected: input.context.taxKeywordDetected,
      yearCandidates: input.context.yearCandidates,
      ai: {
        enabled: aiEnabled,
        attempted: false,
        used: false,
        model: null,
        promptVersion: null,
        failureReason: aiEnabled
          ? "Skipped: Phase 1 AI parser only runs for likely account statements with usable text."
          : null,
        rawSummary: null,
      },
    },
  };

  assignCanonicalFieldProvenance(
    canonicalDraft.provenance.fields,
    "classification.normalized.documentTypeId",
    {
      owner: "logic",
      source: "identity_document_canonical_path",
      confidence: 0.93,
      raw: identityEvidence.idType,
    },
  );
  canonicalDraft.provenance.fields["classification.normalized.documentSubtype"] = {
    owner: "logic",
    source: "identity_document_subtype",
    confidence: 0.9,
    raw: identityEvidence.subtype,
    sourceRefIds: [],
  };
  assignCanonicalFieldProvenance(
    canonicalDraft.provenance.fields,
    "normalized.parties[0].displayName",
    {
      owner: "logic",
      source: "identity_document_name_block",
      confidence: 0.92,
      raw: identityEvidence.rawName,
    },
    [rawNameSourceRefId],
  );
  if (identityEvidence.address?.rawText) {
    assignCanonicalFieldProvenance(
      canonicalDraft.provenance.fields,
      "normalized.parties[0].addresses[0].rawText",
      {
        owner: "logic",
        source: "identity_document_address_block",
        confidence: 0.9,
        raw: identityEvidence.address.rawText,
      },
      [rawAddressSourceRefId],
    );
  }
  if (identityEvidence.governmentIdValue) {
    canonicalDraft.provenance.fields["normalized.parties[0].governmentIds[0].value"] = {
      owner: "logic",
      source: "identity_document_government_id",
      confidence: 0.9,
      raw: identityEvidence.governmentIdValue,
      sourceRefIds: [rawGovernmentIdSourceRefId].filter(
        (value): value is string => Boolean(value),
      ),
    };
  }
  assignCanonicalFieldProvenance(
    canonicalDraft.provenance.fields,
    "normalized.documentFacts.idType",
    {
      owner: "logic",
      source: "identity_document_id_type",
      confidence: 0.92,
      raw: identityEvidence.idType,
    },
  );

  canonicalDraft.normalized.dates.forEach((date, index) => {
    const sourceRefId =
      date.kind === "document_date" || date.kind === "issue_date"
        ? rawIssueDateSourceRefId
        : date.kind === "birth_date"
          ? rawBirthDateSourceRefId
          : date.kind === "expiration_date"
            ? rawExpirationDateSourceRefId
            : null;

    canonicalDraft.provenance.fields[`normalized.dates[${index}].value`] = {
      owner: "logic",
      source: "identity_document_date",
      confidence: date.value ? 0.9 : 0.74,
      raw: canonicalDraft.extracted.dates[index]?.rawValue ?? null,
      sourceRefIds: sourceRefId ? [sourceRefId] : [],
    };
  });

  return finalizeCanonicalExtractedDocument(canonicalDraft);
}

type CanonicalTaxEvidence = {
  subtype: string;
  subtypeLabel: string;
  rawClient: string | null;
  displayClient: string | null;
  rawCustodian: string | null;
  normalizedCustodian: string | null;
  taxYear: string | null;
  documentDate: string | null;
  taxIdentifier: TaxDocumentTaxIdentifier | null;
  taxFacts: CanonicalTaxFact[];
};

function buildCanonicalTaxDocument(input: {
  context: TextAnalysisContext;
  legacyClassification: TextAnalysisClassification;
  legacyExtraction: TextAnalysisExtraction;
  analysisProfile: AnalysisProfile;
}): CanonicalExtractedDocument | null {
  if (input.legacyClassification.documentTypeId !== "tax_document") {
    return null;
  }

  const taxEvidence = extractCanonicalTaxEvidence(input);
  const sourceRefs: CanonicalSourceRef[] = [];
  const subtypeSourceRefId = pushSourceRef(sourceRefs, {
    kind: "logic_field",
    fieldPath: "classification.normalized.documentSubtype",
    label: "Tax document subtype",
    value: taxEvidence.subtypeLabel,
  });
  const rawClientSourceRefId = pushSourceRef(sourceRefs, {
    kind: "logic_field",
    fieldPath: "extracted.parties[0].rawName",
    label: "Tax document client",
    value: taxEvidence.rawClient,
  });
  const rawCustodianSourceRefId = pushSourceRef(sourceRefs, {
    kind: "logic_field",
    fieldPath: "extracted.institutions[0].rawName",
    label: "Tax document payer or issuer",
    value: taxEvidence.rawCustodian,
  });
  const rawTaxYearSourceRefId = pushSourceRef(sourceRefs, {
    kind: "logic_field",
    fieldPath: "extracted.documentFacts.taxYear",
    label: "Tax year",
    value: taxEvidence.taxYear,
  });
  const rawDocumentDateSourceRefId = pushSourceRef(sourceRefs, {
    kind: "logic_field",
    fieldPath: "extracted.dates[0].rawValue",
    label: "Tax document date",
    value: taxEvidence.documentDate,
  });
  const rawTaxIdentifierSourceRefId = pushSourceRef(sourceRefs, {
    kind: "logic_field",
    fieldPath: "extracted.parties[0].taxIdentifiers[0].value",
    label: "Tax document taxpayer identifier",
    value: taxEvidence.taxIdentifier?.value ?? null,
  });
  const taxFactSourceRefIds = taxEvidence.taxFacts.map((fact, index) =>
    pushSourceRef(sourceRefs, {
      kind: "logic_field",
      fieldPath: `extracted.taxFacts[${index}].rawValue`,
      label: `${fact.form ?? "Tax"} ${fact.label}`,
      value: fact.rawValue,
    }),
  );

  const extractedDates = taxEvidence.documentDate
    ? [
        {
          id: "date-1",
          kind: "document_date" as const,
          value: taxEvidence.documentDate,
          rawValue: taxEvidence.documentDate,
          entityType: "document" as const,
          entityId: null,
        },
      ]
    : [];
  const extractedParties = taxEvidence.rawClient
    ? [
        {
          id: "party-1",
          kind: "person" as const,
          displayName: taxEvidence.rawClient,
          rawName: taxEvidence.rawClient,
          addresses: [],
          birthDateId: null,
          taxIdentifiers: taxEvidence.taxIdentifier ? [taxEvidence.taxIdentifier] : [],
          governmentIds: [],
        },
      ]
    : [];
  const normalizedParties = taxEvidence.displayClient
    ? [
        {
          id: "party-1",
          kind: "person" as const,
          displayName: taxEvidence.displayClient,
          rawName: taxEvidence.rawClient,
          addresses: [],
          birthDateId: null,
          taxIdentifiers: taxEvidence.taxIdentifier ? [taxEvidence.taxIdentifier] : [],
          governmentIds: [],
        },
      ]
    : [];
  const extractedInstitutions = taxEvidence.rawCustodian
    ? [
        {
          id: "institution-1",
          name: taxEvidence.rawCustodian,
          rawName: taxEvidence.rawCustodian,
          addresses: [],
        },
      ]
    : [];
  const normalizedInstitutions = taxEvidence.normalizedCustodian
    ? [
        {
          id: "institution-1",
          name: taxEvidence.normalizedCustodian,
          rawName: taxEvidence.rawCustodian,
          addresses: [],
        },
      ]
    : [];
  const canonicalDraft: CanonicalExtractedDocumentDraft = {
    source: {
      file: {
        fileId: input.context.file.id,
        sourceName: input.context.file.name,
        mimeType: input.context.file.mimeType,
        modifiedTime: input.context.file.modifiedTime ?? null,
        driveSize: input.context.file.size ?? null,
        downloadByteLength: input.context.downloadFingerprint?.byteLength ?? null,
        downloadSha1: input.context.downloadFingerprint?.sha1 ?? null,
      },
      extraction: {
        contentSource: input.context.contentSource,
        pdfFields: input.context.pdfFields,
        pdfFieldReaders: input.context.pdfFieldReaders,
        pdfExtractionAttempts: input.context.pdfExtractionAttempts,
      },
    },
    classification: {
      extracted: {
        documentTypeId: "tax_document",
        documentSubtype: taxEvidence.subtype,
      },
      normalized: {
        documentTypeId: "tax_document",
        documentSubtype: taxEvidence.subtype,
      },
    },
    extracted: {
      parties: extractedParties,
      accounts: [],
      accountParties: [],
      institutions: extractedInstitutions,
      contacts: [],
      dates: extractedDates,
      documentFacts: {
        entityName: null,
        idType: taxEvidence.subtypeLabel,
        taxYear: taxEvidence.taxYear,
      },
      taxFacts: taxEvidence.taxFacts,
    },
    normalized: {
      parties: normalizedParties,
      accounts: [],
      accountParties: [],
      institutions: normalizedInstitutions,
      contacts: [],
      dates: extractedDates.map((date) => ({ ...date })),
      documentFacts: {
        entityName: null,
        idType: taxEvidence.subtypeLabel,
        taxYear: taxEvidence.taxYear,
      },
      taxFacts: taxEvidence.taxFacts.map((fact) => ({ ...fact })),
    },
    provenance: {
      fields: {},
      normalization: [],
      sourceRefs,
    },
    diagnostics: {
      parserVersion: PARSER_VERSION,
      parserConflictSummary: input.context.parserConflictSummary,
      documentSignal:
        input.legacyClassification.documentSignal ??
        `Tax document canonical path recognized ${taxEvidence.subtypeLabel}.`,
      reasons: [
        ...input.context.reasons,
        `Tax document canonical path recognized ${taxEvidence.subtypeLabel}.`,
      ],
      textExcerpt: input.context.textExcerpt,
      diagnosticText: input.context.diagnosticText,
      statementClientSource: null,
      statementClientCandidate: null,
      ownershipClientCandidate: input.context.ownershipClientCandidate,
      accountContextCandidate: input.context.accountContextCandidate,
      accountLooseCandidate: input.context.accountLooseCandidate,
      taxKeywordDetected: input.context.taxKeywordDetected,
      yearCandidates: input.context.yearCandidates,
      ai: {
        enabled: input.analysisProfile === "preview_ai_primary",
        attempted: false,
        used: false,
        model: null,
        promptVersion: null,
        failureReason:
          input.analysisProfile === "preview_ai_primary"
            ? "Skipped: Phase 1 AI parser only runs for likely account statements with usable text."
            : null,
        rawSummary: null,
      },
    },
  };

  assignCanonicalFieldProvenance(
    canonicalDraft.provenance.fields,
    "classification.normalized.documentTypeId",
    {
      owner: "logic",
      source: "tax_document_canonical_path",
      confidence: 0.9,
      raw: "tax_document",
    },
  );
  assignCanonicalFieldProvenance(
    canonicalDraft.provenance.fields,
    "classification.normalized.documentSubtype",
    {
      owner: "logic",
      source: "tax_document_subtype",
      confidence: taxEvidence.subtype === "unknown_tax_document" ? 0.72 : 0.9,
      raw: taxEvidence.subtypeLabel,
    },
    [subtypeSourceRefId],
  );
  if (taxEvidence.rawClient) {
    assignCanonicalFieldProvenance(
      canonicalDraft.provenance.fields,
      "normalized.parties[0].displayName",
      {
        owner: "logic",
        source: "tax_document_client",
        confidence: 0.84,
        raw: taxEvidence.rawClient,
      },
      [rawClientSourceRefId],
    );
  }
  if (taxEvidence.normalizedCustodian) {
    assignCanonicalFieldProvenance(
      canonicalDraft.provenance.fields,
      "normalized.institutions[0].name",
      {
        owner: "logic",
        source: "tax_document_payer_or_issuer",
        confidence: 0.82,
        raw: taxEvidence.rawCustodian,
      },
      [rawCustodianSourceRefId],
    );
  }
  if (taxEvidence.taxYear) {
    assignCanonicalFieldProvenance(
      canonicalDraft.provenance.fields,
      "normalized.documentFacts.taxYear",
      {
        owner: "logic",
        source: "tax_document_tax_year",
        confidence: 0.9,
        raw: taxEvidence.taxYear,
      },
      [rawTaxYearSourceRefId],
    );
  }
  assignCanonicalFieldProvenance(
    canonicalDraft.provenance.fields,
    "normalized.documentFacts.idType",
    {
      owner: "logic",
      source: "tax_document_subtype_label",
      confidence: 0.86,
      raw: taxEvidence.subtypeLabel,
    },
    [subtypeSourceRefId],
  );
  if (taxEvidence.documentDate) {
    assignCanonicalFieldProvenance(
      canonicalDraft.provenance.fields,
      "normalized.dates[0].value",
      {
        owner: "logic",
        source: "tax_document_date",
        confidence: 0.82,
        raw: taxEvidence.documentDate,
      },
      [rawDocumentDateSourceRefId],
    );
  }
  if (taxEvidence.taxIdentifier) {
    assignCanonicalFieldProvenance(
      canonicalDraft.provenance.fields,
      "normalized.parties[0].taxIdentifiers[0].value",
      {
        owner: "logic",
        source: "tax_document_taxpayer_identifier",
        confidence: 0.82,
        raw: taxEvidence.taxIdentifier.value,
      },
      [rawTaxIdentifierSourceRefId],
    );
  }
  taxEvidence.taxFacts.forEach((fact, index) => {
    assignCanonicalFieldProvenance(
      canonicalDraft.provenance.fields,
      `normalized.taxFacts[${index}].value`,
      {
        owner: "logic",
        source: "tax_document_line_or_box_fact",
        confidence: fact.value ? 0.84 : 0.72,
        raw: fact.rawValue,
      },
      [taxFactSourceRefIds[index] ?? null],
    );

    if (fact.money?.amount) {
      assignCanonicalFieldProvenance(
        canonicalDraft.provenance.fields,
        `normalized.taxFacts[${index}].money.amount`,
        {
          owner: "logic",
          source: "tax_document_line_or_box_fact",
          confidence: 0.84,
          raw: fact.rawValue,
        },
        [taxFactSourceRefIds[index] ?? null],
      );
    }
  });

  return finalizeCanonicalExtractedDocument(canonicalDraft);
}

function extractCanonicalTaxEvidence(input: {
  context: TextAnalysisContext;
  legacyClassification: TextAnalysisClassification;
  legacyExtraction: TextAnalysisExtraction;
}): CanonicalTaxEvidence {
  const taxOverlay = extractTaxDocument({
    file: input.context.file,
    rawText: input.context.rawText,
    normalizedText: input.context.normalizedText,
    fields: input.context.fields,
    metadata: input.legacyExtraction.metadata,
    helpers: {
      extractClientNameFromFields,
      extractClientNameFromText,
      extractCustodian,
      extractTaxYear,
      extractDocumentDate,
      normalizeWhitespace,
    },
  });
  const subtype =
    normalizeTaxDocumentSubtype(input.legacyClassification.documentSubtype) ??
    detectTaxDocumentSubtype(input.context.normalizedText, input.context.file.name);
  const subtypeLabel = getTaxDocumentSubtypeLabel(subtype) ?? "Tax Document";
  const rawClient =
    normalizeAIFreeText(taxOverlay.detectedClient) ??
    normalizeAIFreeText(input.legacyExtraction.detectedClient) ??
    null;
  const displayClient = rawClient ? toTitleCaseWords(rawClient) : null;
  const rawCustodian =
    normalizeAIFreeText(taxOverlay.custodian) ??
    normalizeAIFreeText(input.legacyExtraction.metadata.custodian) ??
    null;
  const normalizedCustodian = normalizeAccountStatementCustodian(rawCustodian);
  const documentDate =
    sanitizeAIDocumentDate(taxOverlay.documentDate) ??
    sanitizeAIDocumentDate(input.legacyExtraction.metadata.documentDate) ??
    null;

  return {
    subtype,
    subtypeLabel,
    rawClient,
    displayClient,
    rawCustodian,
    normalizedCustodian: normalizedCustodian.finalValue ?? rawCustodian,
    taxYear: taxOverlay.taxYear ?? input.legacyExtraction.metadata.taxYear ?? null,
    documentDate,
    taxIdentifier: taxOverlay.taxIdentifier ?? null,
    taxFacts: taxOverlay.taxFacts ?? [],
  };
}

function extractCanonicalIdentityEvidence(
  context: TextAnalysisContext,
): CanonicalIdentityEvidence | null {
  const firstPageText = extractFirstPageText(context.rawText);
  const lines = extractCanonicalIdentityRelevantLines(firstPageText);
  if (lines.length < 6) {
    return null;
  }

  const labelValues = collectCanonicalIdentityLabelValues(lines);
  const subtype = detectCanonicalIdentitySubtype(lines, labelValues.idType);
  if (!subtype) {
    return null;
  }

  const nameAddress = extractCanonicalIdentityNameAddress(lines);
  if (!nameAddress) {
    return null;
  }

  const rawName = nameAddress.rawName;
  const displayName = toTitleCaseWords(rawName);
  const governmentIdValue = sanitizeCanonicalIdentityGovernmentId(
    labelValues.governmentId,
  );
  const issueDate = buildCanonicalIdentityDateValue(labelValues.issueDate);
  const birthDate = buildCanonicalIdentityDateValue(labelValues.birthDate);
  const expirationDate = buildCanonicalIdentityDateValue(labelValues.expirationDate);

  const strongCueCount = [
    labelValues.governmentId,
    labelValues.birthDate,
    labelValues.issueDate,
    labelValues.expirationDate,
  ].filter(Boolean).length;
  if (strongCueCount < 3) {
    return null;
  }

  return {
    subtype,
    idType: subtype === "driver_license" ? "Driver License" : "State ID",
    rawName,
    displayName,
    address: nameAddress.address,
    governmentIdValue,
    maskedGovernmentId: maskCanonicalIdentityGovernmentId(governmentIdValue),
    issuingAuthority:
      normalizeCanonicalIdentityAuthority(labelValues.jurisdiction) ??
      nameAddress.address?.state ??
      null,
    birthDate,
    issueDate,
    expirationDate,
  };
}

function extractCanonicalIdentityRelevantLines(firstPageText: string) {
  const stopPatterns = [
    /^document notes$/i,
    /^synthetic identity document\b/i,
    /^--\s*\d+\s+of\s+\d+\s*--$/i,
  ];

  const lines: string[] = [];
  for (const rawLine of firstPageText.replace(/\r/g, "").split("\n")) {
    const line = normalizeWhitespace(rawLine);
    if (!line) {
      continue;
    }

    if (stopPatterns.some((pattern) => pattern.test(line))) {
      break;
    }

    lines.push(line);
  }

  return lines;
}

function detectCanonicalIdentitySubtype(
  lines: string[],
  idTypeValue: string | null,
): CanonicalIdentitySubtype | null {
  const source = lines.join("\n");
  const normalizedIdType = normalizeWhitespace(idTypeValue ?? "").toLowerCase();

  if (/\bpassport\b/i.test(source)) {
    return null;
  }

  if (
    /\bdriver license\b/i.test(source) ||
    /\boperator license\b/i.test(source) ||
    normalizedIdType === "driver license"
  ) {
    return "driver_license";
  }

  if (
    /\bstate identification card\b/i.test(source) ||
    /\bidentification card\b/i.test(source) ||
    normalizedIdType === "state id"
  ) {
    return "state_id";
  }

  return null;
}

function extractCanonicalIdentityNameAddress(lines: string[]) {
  for (let index = 0; index < lines.length - 2; index += 1) {
    const nameLine = lines[index] ?? "";
    const streetLine = lines[index + 1] ?? "";
    const cityStateZipLine = lines[index + 2] ?? "";

    if (!looksLikeCanonicalIdentityName(nameLine)) {
      continue;
    }

    if (
      !looksLikeCanonicalStreetAddress(streetLine) ||
      !looksLikeCanonicalCityStateZip(cityStateZipLine)
    ) {
      continue;
    }

    const parsedCityStateZip = parseCanonicalCityStateZip(cityStateZipLine);
    return {
      rawName: nameLine,
      address: {
        kind: "identity" as const,
        rawText: `${streetLine}, ${cityStateZipLine}`,
        lines: [streetLine, cityStateZipLine],
        city: parsedCityStateZip.city,
        state: parsedCityStateZip.state,
        postalCode: parsedCityStateZip.postalCode,
        country:
          parsedCityStateZip.city || parsedCityStateZip.state || parsedCityStateZip.postalCode
            ? "US"
            : null,
      },
    };
  }

  return null;
}

function looksLikeCanonicalIdentityName(value: string) {
  if (!value || /\d/.test(value) || !/[A-Z]/.test(value)) {
    return false;
  }

  const normalized = normalizeWhitespace(value);
  if (looksLikeCanonicalCityStateZip(normalized) || looksLikeCanonicalStreetAddress(normalized)) {
    return false;
  }

  const tokens = normalized
    .split(/\s+/)
    .map((token) => token.replace(/[^A-Za-z'-]/g, ""))
    .filter(Boolean);

  if (tokens.length < 2 || tokens.length > 5) {
    return false;
  }

  const blockedTokens = new Set([
    "department",
    "transportation",
    "revenue",
    "secretary",
    "state",
    "driver",
    "license",
    "operator",
    "identification",
    "card",
    "front",
    "photo",
    "document",
    "notes",
    "class",
    "jurisdiction",
    "synthetic",
    "clean",
    "expired",
    "renewed",
    "current",
  ]);

  return tokens.every((token) => !blockedTokens.has(token.toLowerCase()));
}

function collectCanonicalIdentityLabelValues(lines: string[]) {
  return {
    idType: readCanonicalIdentityLabelValue(lines, [
      /^id type$/i,
    ]),
    governmentId: readCanonicalIdentityLabelValue(lines, [
      /^dln$/i,
      /^id no$/i,
      /^id number$/i,
      /^license no$/i,
      /^license number$/i,
    ]),
    birthDate: readCanonicalIdentityLabelValue(lines, [/^dob$/i, /^date of birth$/i]),
    issueDate: readCanonicalIdentityLabelValue(lines, [/^iss$/i, /^issue date$/i]),
    expirationDate: readCanonicalIdentityLabelValue(lines, [
      /^exp$/i,
      /^expiration$/i,
      /^expiration date$/i,
      /^expires$/i,
    ]),
    jurisdiction: readCanonicalIdentityLabelValue(lines, [
      /^jurisdiction$/i,
      /^issuing authority$/i,
    ]),
  };
}

function readCanonicalIdentityLabelValue(lines: string[], patterns: RegExp[]) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    for (const pattern of patterns) {
      const patternSource = pattern.source.replace(/^\^/, "").replace(/\$$/, "");
      const fullMatch = line.match(
        new RegExp(`^${patternSource}\\s+(.+)$`, pattern.flags),
      );
      if (fullMatch?.[1]) {
        return normalizeWhitespace(fullMatch[1]);
      }

      if (!pattern.test(line)) {
        continue;
      }

      const nextLine = lines[index + 1] ?? null;
      if (nextLine && !looksLikeCanonicalIdentityLabel(nextLine)) {
        return nextLine;
      }

      return null;
    }
  }

  return null;
}

function looksLikeCanonicalIdentityLabel(value: string) {
  return [
    /^id type$/i,
    /^dln$/i,
    /^id no$/i,
    /^id number$/i,
    /^license no$/i,
    /^license number$/i,
    /^dob$/i,
    /^date of birth$/i,
    /^iss$/i,
    /^issue date$/i,
    /^exp$/i,
    /^expiration$/i,
    /^expiration date$/i,
    /^expires$/i,
    /^jurisdiction$/i,
    /^issuing authority$/i,
  ].some((pattern) => pattern.test(value));
}

function buildCanonicalIdentityDateValue(value: string | null) {
  const rawValue = normalizeWhitespace(value ?? "");
  if (!rawValue || /\b(?:not shown|missing|unreadable|unknown)\b/i.test(rawValue)) {
    return {
      present: Boolean(rawValue),
      value: null,
      rawValue: null,
    };
  }

  return {
    present: true,
    value: normalizeCanonicalSlashDate(rawValue),
    rawValue,
  };
}

function sanitizeCanonicalIdentityGovernmentId(value: string | null) {
  const normalized = normalizeWhitespace(value ?? "");
  if (!normalized || /\?/.test(normalized)) {
    return null;
  }

  const cleaned = normalized.toUpperCase();
  return /[A-Z0-9]/.test(cleaned) && cleaned.length >= 6 ? cleaned : null;
}

function maskCanonicalIdentityGovernmentId(value: string | null) {
  if (!value) {
    return null;
  }

  if (value.length <= 4) {
    return value;
  }

  return `${"x".repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}

function normalizeCanonicalIdentityAuthority(value: string | null) {
  const normalized = normalizeWhitespace(value ?? "").toUpperCase();
  return /^[A-Z]{2,4}$/.test(normalized) ? normalized : null;
}

function normalizeCanonicalSlashDate(value: string) {
  const match = normalizeWhitespace(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return null;
  }

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(year) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function buildCanonicalIdentityDates(
  evidence: CanonicalIdentityEvidence,
): CanonicalExtractedDocumentDraft["extracted"]["dates"] {
  const dates: CanonicalExtractedDocumentDraft["extracted"]["dates"] = [];

  if (evidence.issueDate.present) {
    dates.push({
      id: "date-document",
      kind: "document_date",
      value: evidence.issueDate.value,
      rawValue: evidence.issueDate.rawValue,
      entityType: "document",
      entityId: null,
    });
  }

  if (evidence.birthDate.present) {
    dates.push({
      id: "date-birth",
      kind: "birth_date",
      value: evidence.birthDate.value,
      rawValue: evidence.birthDate.rawValue,
      entityType: "party",
      entityId: "party-1",
    });
  }

  if (evidence.issueDate.present) {
    dates.push({
      id: "date-issue",
      kind: "issue_date",
      value: evidence.issueDate.value,
      rawValue: evidence.issueDate.rawValue,
      entityType: "party",
      entityId: "party-1",
    });
  }

  if (evidence.expirationDate.present) {
    dates.push({
      id: "date-expiration",
      kind: "expiration_date",
      value: evidence.expirationDate.value,
      rawValue: evidence.expirationDate.rawValue,
      entityType: "party",
      entityId: "party-1",
    });
  }

  return dates;
}

function buildCanonicalStatementInstitutions(input: {
  parsedInstitutions: NonNullable<ParsedDocumentResult["extracted"]>["institutions"];
  statementText: string;
  fallbackRawCustodian: string | null;
  finalCustodian: string | null;
}) {
  const statementRawInstitutionName =
    detectRawAccountStatementInstitutionName(
      buildStatementInstitutionSearchText(input.statementText),
    ) ??
    detectRawAccountStatementInstitutionName(input.fallbackRawCustodian) ??
    null;
  const baseInstitutions =
    input.parsedInstitutions.length > 0
      ? input.parsedInstitutions.map((institution, index) => {
          const rawName = resolveCanonicalStatementInstitutionRawName({
            parsedRawName: normalizeAIFreeText(institution.name),
            statementRawName: index === 0 ? statementRawInstitutionName : null,
            fallbackRawName: index === 0 ? input.fallbackRawCustodian : null,
          });
          return {
            id: institution.id ?? `institution-${index + 1}`,
            rawName,
          };
        })
      : input.fallbackRawCustodian
        ? [
            {
              id: "institution-1",
              rawName: input.fallbackRawCustodian,
            },
          ]
        : [];

  return {
    extracted: baseInstitutions.map((institution) => ({
      id: institution.id,
      name: institution.rawName,
      rawName: institution.rawName,
      addresses: [],
    })),
    normalized: baseInstitutions.map((institution, index) => {
      const normalized = normalizeAccountStatementCustodian(
        institution.rawName ??
          (index === 0 ? input.finalCustodian : null) ??
          null,
      );

      return {
        id: institution.id,
        name:
          normalized.finalValue ??
          (index === 0 ? input.finalCustodian : null) ??
          institution.rawName,
        rawName: institution.rawName,
        addresses: [],
      };
    }),
  };
}

function buildStatementInstitutionSearchText(rawText: string) {
  const firstPageText = extractFirstPageText(rawText);
  const headerLines = getHeaderZoneLines(firstPageText, normalizeWhitespace, {
    minLines: 8,
    ratio: 0.35,
  });
  const firstPageLines = firstPageText
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .slice(0, 16);

  return [...headerLines, ...firstPageLines].join("\n");
}

function resolveCanonicalStatementInstitutionRawName(input: {
  parsedRawName: string | null;
  statementRawName: string | null;
  fallbackRawName: string | null;
}) {
  const parsedRawName = normalizeAIFreeText(input.parsedRawName);
  const statementRawName = normalizeAIFreeText(input.statementRawName);
  const fallbackRawName = normalizeAIFreeText(input.fallbackRawName);

  return statementRawName ?? parsedRawName ?? fallbackRawName ?? null;
}

function buildCanonicalStatementParties(input: {
  parsedParties: NonNullable<ParsedDocumentResult["extracted"]>["parties"];
  rawAIDetectedClient: string | null;
  rawAIDetectedClient2: string | null;
  detectedClient: string | null;
  detectedClient2: string | null;
  fallbackPartyAddress: StatementPartyAddressEvidence;
}) {
  const baseParties =
    input.parsedParties.length > 0
      ? input.parsedParties.map((party, index) => ({
          id: party.id ?? `party-${index + 1}`,
          rawName: normalizeAIName(party.name),
          address: normalizeAIFreeText(party.address),
        }))
      : [
          input.rawAIDetectedClient ?? input.detectedClient,
          input.rawAIDetectedClient2 ?? input.detectedClient2,
        ]
          .filter((value): value is string => Boolean(value))
          .map((rawName, index) => ({
            id: `party-${index + 1}`,
            rawName,
            address:
              index === 0
                ? input.fallbackPartyAddress.rawAddress?.rawText ?? null
                : null,
          }));

  const extracted = baseParties.map((party, index) => {
    const parsedAddress = buildCanonicalAddressFromParsedText(
      party.address,
      false,
    );

    return {
      id: party.id,
      kind: "person" as const,
      displayName: party.rawName,
      rawName: party.rawName,
      addresses:
        parsedAddress
          ? [parsedAddress]
          : index === 0 && input.fallbackPartyAddress.rawAddress
            ? [input.fallbackPartyAddress.rawAddress]
            : [],
      birthDateId: null,
      taxIdentifiers: [],
      governmentIds: [],
    };
  });

  const normalizedNames = [input.detectedClient, input.detectedClient2].filter(
    (value): value is string => Boolean(value),
  );
  const normalized = normalizedNames.map((displayName, index) => {
    const extractedParty = extracted[index] ?? null;
    const parsedAddress = buildCanonicalAddressFromParsedText(
      baseParties[index]?.address ?? null,
      true,
    );

    return {
      id: extractedParty?.id ?? `party-${index + 1}`,
      kind: "person" as const,
      displayName,
      rawName: extractedParty?.rawName ?? displayName,
      addresses:
        parsedAddress
          ? [parsedAddress]
          : index === 0 && input.fallbackPartyAddress.normalizedAddress
            ? [input.fallbackPartyAddress.normalizedAddress]
            : [],
      birthDateId: null,
      taxIdentifiers: [],
      governmentIds: [],
    };
  });

  return {
    extracted,
    normalized,
  };
}

function buildCanonicalStatementDates(input: {
  parsedDates: NonNullable<ParsedDocumentResult["extracted"]>["dates"];
  fallbackDates: StatementCanonicalEnrichmentEvidence;
  parties: CanonicalExtractedDocumentDraft["extracted"]["parties"];
  institutions: CanonicalExtractedDocumentDraft["extracted"]["institutions"];
}) {
  const extracted: CanonicalExtractedDocumentDraft["extracted"]["dates"] =
    input.parsedDates.map((date, index) => ({
    id: date.id ?? `date-${date.kind ?? "other"}-${index + 1}`,
    kind: mapCanonicalStatementDateKind(date.kind),
    value: date.value,
    rawValue: date.value,
    entityType: mapCanonicalStatementDateScope(date.scope),
    entityId: resolveCanonicalStatementDateEntityId(
      date.scope,
      date.entityId,
      input.parties,
      input.institutions,
    ),
  }));
  const normalized: CanonicalExtractedDocumentDraft["normalized"]["dates"] =
    extracted.map((date) => ({ ...date }));

  for (const fallbackDate of input.fallbackDates.extractedDates) {
    if (hasCanonicalDateEntry(extracted, fallbackDate)) {
      continue;
    }

    extracted.push({
      id: fallbackDate.id,
      kind: fallbackDate.kind,
      value: fallbackDate.value,
      rawValue: fallbackDate.rawValue,
      entityType: fallbackDate.entityType,
      entityId: fallbackDate.entityId,
    });
  }

  for (const fallbackDate of input.fallbackDates.normalizedDates) {
    if (hasCanonicalDateEntry(normalized, fallbackDate)) {
      continue;
    }

    normalized.push({
      id: fallbackDate.id,
      kind: fallbackDate.kind,
      value: fallbackDate.value,
      rawValue: fallbackDate.rawValue,
      entityType: fallbackDate.entityType,
      entityId: fallbackDate.entityId,
    });
  }

  return {
    extracted,
    normalized,
  };
}

function buildCanonicalStatementAccounts(input: {
  parsedAccounts: NonNullable<ParsedDocumentResult["extracted"]>["accounts"];
  fallbackAccounts: StatementCanonicalEnrichmentEvidence;
  extractedDates: CanonicalExtractedDocumentDraft["extracted"]["dates"];
  normalizedDates: CanonicalExtractedDocumentDraft["normalized"]["dates"];
  institutions: {
    extracted: CanonicalExtractedDocumentDraft["extracted"]["institutions"];
    normalized: CanonicalExtractedDocumentDraft["normalized"]["institutions"];
  };
  finalAccountType: string | null;
  rawPrimaryAccountType: string | null;
  finalPrimaryAccountLast4: string | null;
}) {
  if (input.parsedAccounts.length === 0) {
    return {
      extracted: input.fallbackAccounts.extractedAccounts.map((account) => ({
        id: account.normalizedId,
        institutionIds: resolveCanonicalInstitutionIds(
          [],
          input.institutions.extracted,
        ),
        accountNumber: account.rawAccountNumber,
        maskedAccountNumber: account.maskedAccountNumber,
        accountLast4: account.accountLast4,
        accountType: account.rawAccountType,
        registrationType: account.registrationType,
        openedDateId: null,
        closedDateId: null,
        statementStartDateId: account.statementStartDateId,
        statementEndDateId: account.statementEndDateId,
        values: account.values.map((value) => ({
          kind: value.kind,
          label: value.label,
          money:
            value.rawAmount === null
              ? null
              : {
                  amount: value.rawAmount,
                  currency: value.currency,
                },
          dateId: account.statementEndDateId ?? null,
        })),
        beneficiaryText: null,
      })),
      normalized: input.fallbackAccounts.normalizedAccounts.map((account) => ({
        id: account.normalizedId,
        institutionIds: resolveCanonicalInstitutionIds(
          [],
          input.institutions.normalized,
        ),
        accountNumber: account.normalizedAccountNumber,
        maskedAccountNumber: account.maskedAccountNumber,
        accountLast4: account.accountLast4,
        accountType: account.normalizedAccountType,
        registrationType: account.registrationType,
        openedDateId: null,
        closedDateId: null,
        statementStartDateId: account.statementStartDateId,
        statementEndDateId: account.statementEndDateId,
        values: account.values.map((value) => ({
          kind: value.kind,
          label: value.label,
          money:
            value.amount === null
              ? null
              : {
                  amount: value.amount,
                  currency: value.currency,
                },
          dateId: account.statementEndDateId ?? null,
        })),
        beneficiaryText: null,
      })),
    };
  }

  const extracted = input.parsedAccounts.map((account, index) => {
    const fallbackAccount = input.fallbackAccounts.extractedAccounts[index] ?? null;
    const accountId = account.id ?? `account-${index + 1}`;
    const accountNumber =
      normalizeCanonicalAccountNumber(account.accountNumber) ??
      fallbackAccount?.rawAccountNumber ??
      null;
    const maskedAccountNumber =
      normalizeCanonicalMaskedAccountNumber(account.maskedAccountNumber) ??
      maskFullAccountNumber(accountNumber) ??
      fallbackAccount?.maskedAccountNumber ??
      null;
    const accountLast4 =
      sanitizeAIAccountLast4(
        account.accountLast4 ?? accountNumber ?? maskedAccountNumber,
      ) ??
      fallbackAccount?.accountLast4 ??
      (index === 0 ? input.finalPrimaryAccountLast4 : null);
    const accountType =
      normalizeAIFreeText(account.accountType) ??
      fallbackAccount?.rawAccountType ??
      (index === 0 ? input.rawPrimaryAccountType : null);
    const statementStartDateId =
      resolveCanonicalStatementDateId(
        input.extractedDates,
        "statement_period_start",
        accountId,
      ) ??
      fallbackAccount?.statementStartDateId ??
      null;
    const statementEndDateId =
      resolveCanonicalStatementDateId(
        input.extractedDates,
        "statement_period_end",
        accountId,
      ) ??
      fallbackAccount?.statementEndDateId ??
      resolveCanonicalStatementDateId(
        input.extractedDates,
        "document_date",
        accountId,
      ) ??
      null;

    return {
      id: accountId,
      institutionIds: resolveCanonicalInstitutionIds(
        account.institutionIds,
        input.institutions.extracted,
      ),
      accountNumber,
      maskedAccountNumber,
      accountLast4,
      accountType,
      registrationType: normalizeAIFreeText(account.registrationType),
      openedDateId: null,
      closedDateId: null,
      statementStartDateId,
      statementEndDateId,
      values:
        account.values.length > 0
          ? account.values.map((value) => ({
              kind: normalizeAccountStatementValueKind({
                kind: value.kind,
                label: value.label,
              }),
              label: normalizeAIFreeText(value.label),
              money: value.money
                ? {
                    amount: normalizeAIFreeText(value.money.amount),
                    currency: normalizeCanonicalCurrency(value.money.currency),
                  }
                : null,
              dateId: resolveCanonicalValueDateId(
                value.dateId,
                input.extractedDates,
                statementEndDateId,
              ),
            }))
          : (fallbackAccount?.values ?? []).map((value) => ({
              kind: value.kind,
              label: value.label,
              money:
                value.rawAmount === null
                  ? null
                  : {
                      amount: value.rawAmount,
                      currency: value.currency,
                    },
              dateId: statementEndDateId,
            })),
      beneficiaryText: null,
    };
  });

  const normalized = extracted.map((account, index) => {
    const fallbackAccount = input.fallbackAccounts.normalizedAccounts[index] ?? null;
    const normalizedAccountType = normalizeAccountStatementAccountType(
      account.accountType ??
        (index === 0 ? input.finalAccountType : null) ??
        null,
    );
    const statementStartDateId =
      resolveCanonicalStatementDateId(
        input.normalizedDates,
        "statement_period_start",
        account.id,
      ) ??
      fallbackAccount?.statementStartDateId ??
      null;
    const statementEndDateId =
      resolveCanonicalStatementDateId(
        input.normalizedDates,
        "statement_period_end",
        account.id,
      ) ??
      fallbackAccount?.statementEndDateId ??
      resolveCanonicalStatementDateId(
        input.normalizedDates,
        "document_date",
        account.id,
      ) ??
      null;
    const normalizedAccountNumber =
      normalizeCanonicalAccountNumber(account.accountNumber) ??
      fallbackAccount?.normalizedAccountNumber ??
      null;

    return {
      id: account.id,
      institutionIds: resolveCanonicalInstitutionIds(
        account.institutionIds,
        input.institutions.normalized,
      ),
      accountNumber: normalizedAccountNumber,
      maskedAccountNumber:
        maskFullAccountNumber(normalizedAccountNumber) ??
        normalizeCanonicalMaskedAccountNumber(account.maskedAccountNumber),
      accountLast4:
        sanitizeAIAccountLast4(
          account.accountLast4 ??
            normalizedAccountNumber ??
            account.maskedAccountNumber,
        ) ??
        (index === 0 ? input.finalPrimaryAccountLast4 : null),
      accountType:
        normalizedAccountType.finalValue ??
        (index === 0 ? input.finalAccountType : null) ??
        fallbackAccount?.normalizedAccountType ??
        null,
      registrationType: account.registrationType,
      openedDateId: null,
      closedDateId: null,
      statementStartDateId,
      statementEndDateId,
      values: account.values.map((value) => ({
        kind: value.kind,
        label: value.label,
        money:
          value.money === null
            ? null
            : {
                amount:
                  normalizeMoneyAmount(value.money.amount ?? "") ??
                  value.money.amount,
                currency:
                  normalizeCanonicalCurrency(value.money.currency) ??
                  value.money.currency,
              },
        dateId: resolveCanonicalValueDateId(
          value.dateId,
          input.normalizedDates,
          statementEndDateId,
        ),
      })),
      beneficiaryText: account.beneficiaryText,
    };
  });

  return {
    extracted,
    normalized,
  };
}

function buildCanonicalStatementAccountParties(input: {
  parsedAccountParties: NonNullable<ParsedDocumentResult["extracted"]>["accountParties"];
  extractedAccounts: CanonicalExtractedDocumentDraft["extracted"]["accounts"];
  normalizedAccounts: CanonicalExtractedDocumentDraft["normalized"]["accounts"];
  extractedParties: CanonicalExtractedDocumentDraft["extracted"]["parties"];
  normalizedParties: CanonicalExtractedDocumentDraft["normalized"]["parties"];
  ownershipType: "single" | "joint";
  extractedOwnershipType: "single" | "joint";
}) {
  const extractedAccountIds = new Set(input.extractedAccounts.map((account) => account.id));
  const extractedPartyIds = new Set(input.extractedParties.map((party) => party.id));
  const normalizedAccountIds = input.normalizedAccounts.map((account) => account.id);
  const normalizedPartyIds = input.normalizedParties.map((party) => party.id);
  let extracted: CanonicalExtractedDocumentDraft["extracted"]["accountParties"];
  if (input.parsedAccountParties.length > 0) {
    const mappedExtractedAccountParties = input.parsedAccountParties.map(
      (relationship, index) => {
        const accountId =
          relationship.accountId && extractedAccountIds.has(relationship.accountId)
            ? relationship.accountId
            : extractedAccountIds.size === 1
              ? [...extractedAccountIds][0] ?? null
              : null;
        const partyId =
          relationship.partyId && extractedPartyIds.has(relationship.partyId)
            ? relationship.partyId
            : extractedPartyIds.size === 1
              ? [...extractedPartyIds][0] ?? null
              : null;

        if (!accountId || !partyId) {
          return null;
        }

        return {
          id: relationship.id ?? `${accountId}-party-${index + 1}`,
          accountId,
          partyId,
          roles:
            relationship.roles.length > 0
              ? relationship.roles
              : ([input.extractedOwnershipType === "joint"
                  ? "joint_owner"
                  : "owner"] as CanonicalAccountPartyRole[]),
          relationshipLabel: null,
          allocationPercent: null,
        };
      },
    );
    extracted = mappedExtractedAccountParties.flatMap((relationship) =>
      relationship === null ? [] : [relationship],
    );
  } else {
    extracted = buildCanonicalAccountPartiesForAccounts({
      accountIds: input.extractedAccounts.map((account) => account.id),
      partyIds: input.extractedParties.map((party) => party.id),
      ownershipType: input.extractedOwnershipType,
    });
  }

  const normalizedFromAI = extracted
    .map((relationship, index) => {
      if (
        !normalizedAccountIds.includes(relationship.accountId) ||
        !normalizedPartyIds.includes(relationship.partyId)
      ) {
        return null;
      }

      return {
        id: relationship.id ?? `${relationship.accountId}-party-${index + 1}`,
        accountId: relationship.accountId,
        partyId: relationship.partyId,
        roles: relationship.roles,
        relationshipLabel: relationship.relationshipLabel,
        allocationPercent: relationship.allocationPercent,
      };
    })
    .filter(
      (
        relationship,
      ): relationship is CanonicalExtractedDocumentDraft["normalized"]["accountParties"][number] =>
        relationship !== null,
    );

  const normalized =
    hasSufficientCanonicalAccountPartyCoverage(
      normalizedFromAI,
      normalizedAccountIds,
      normalizedPartyIds,
      input.ownershipType,
    )
      ? normalizedFromAI
      : buildCanonicalAccountPartiesForAccounts({
          accountIds: normalizedAccountIds,
          partyIds: normalizedPartyIds,
          ownershipType: input.ownershipType,
        });

  return {
    extracted,
    normalized,
  };
}

function buildCanonicalStatementContacts(input: {
  parsedContacts: NonNullable<ParsedDocumentResult["extracted"]>["contacts"];
  fallbackContacts: StatementContactEvidence[];
  institutions: Array<Pick<CanonicalExtractedDocumentDraft["extracted"]["institutions"][number], "id">>;
  normalizeValues: boolean;
}) {
  if (input.parsedContacts.length === 0) {
    return input.fallbackContacts.map((contact) => ({
      id: contact.id,
      institutionId: resolveCanonicalInstitutionIds([], input.institutions)[0] ?? null,
      method: contact.method,
      purpose: contact.purpose,
      label: contact.label,
      value: input.normalizeValues ? contact.normalizedValue : contact.rawValue,
      address: null,
      hoursText: null,
    }));
  }

  const fallbackContactsByKey = new Map(
    input.fallbackContacts
      .map((contact) => {
        const value = normalizeCanonicalContactValue(contact.method, contact.normalizedValue);
        return value ? [`${contact.method}:${value}`, contact] : null;
      })
      .filter(
        (
          entry,
        ): entry is [string, StatementContactEvidence] => entry !== null,
      ),
  );

  return input.parsedContacts.map((contact, index) => {
    const normalizedValue = normalizeCanonicalContactValue(contact.method, contact.value);
    const fallbackContact =
      normalizedValue && contact.method
        ? fallbackContactsByKey.get(`${contact.method}:${normalizedValue}`) ?? null
        : null;

    return {
      id: contact.id ?? `contact-${index + 1}`,
      institutionId:
        resolveCanonicalInstitutionIds(
          contact.institutionId ? [contact.institutionId] : [],
          input.institutions,
        )[0] ?? null,
      method: contact.method ?? "other",
      purpose: resolveCanonicalStatementContactPurpose({
        method: contact.method,
        parsedPurpose: contact.purpose ?? null,
        fallbackPurpose: fallbackContact?.purpose ?? null,
      }),
      label: null,
      value: input.normalizeValues
        ? normalizedValue
        : normalizeAIFreeText(contact.value),
      address: null,
      hoursText: null,
    };
  });
}

function resolveCanonicalStatementContactPurpose(input: {
  method: string | null | undefined;
  parsedPurpose: ParsedExtractedContactPurpose | null;
  fallbackPurpose: StatementContactEvidence["purpose"] | null;
}): CanonicalContact["purpose"] {
  if (input.method === "website" && input.fallbackPurpose) {
    return input.fallbackPurpose;
  }

  return input.parsedPurpose ?? input.fallbackPurpose ?? "general_support";
}

function buildCanonicalStatementDocumentFacts(
  parsedFacts: NonNullable<ParsedDocumentResult["extracted"]>["documentFacts"],
) {
  const normalized = {
    entityName: normalizeAIFreeText(parsedFacts.entityName),
    idType: normalizeAIFreeText(parsedFacts.idType),
    taxYear: normalizeAIFreeText(parsedFacts.taxYear),
  };

  return {
    extracted: normalized,
    normalized,
  };
}

function buildCanonicalAddressFromParsedText(
  value: string | null | undefined,
  normalizeForDisplay: boolean,
) {
  const rawText = normalizeWhitespace(value ?? "");
  if (!rawText) {
    return null;
  }

  const rawLines = rawText
    .split(/[\n,]+/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
  const cityStateZipLine =
    rawLines.find((line) => looksLikeCanonicalCityStateZip(line)) ??
    extractCanonicalCityStateZipLine(rawText);
  const streetLine =
    rawLines.find((line) => line !== cityStateZipLine) ??
    rawLines[0] ??
    rawText;

  if (!cityStateZipLine) {
    return {
      kind: "identity" as const,
      rawText,
      lines: rawLines.length > 0 ? rawLines : [rawText],
      city: null,
      state: null,
      postalCode: null,
      country: null,
    };
  }

  const parsed = parseCanonicalCityStateZip(cityStateZipLine);
  const normalizedStreetLine = normalizeForDisplay
    ? titleCaseAddressLine(streetLine)
    : streetLine;
  const normalizedCity = normalizeForDisplay
    ? parsed.city
      ? toTitleCaseWords(parsed.city)
      : null
    : parsed.city;
  const normalizedCityStateZipLine = normalizeForDisplay
    ? [normalizedCity, parsed.state, parsed.postalCode].filter(Boolean).join(" ")
    : cityStateZipLine;
  const lines = [normalizedStreetLine, normalizedCityStateZipLine].filter(Boolean);

  return {
    kind: "identity" as const,
    rawText: lines.join(", "),
    lines,
    city: normalizedCity,
    state: parsed.state,
    postalCode: parsed.postalCode,
    country:
      parsed.city || parsed.state || parsed.postalCode ? "US" : null,
  };
}

function extractCanonicalCityStateZipLine(value: string) {
  const match = normalizeWhitespace(value).match(
    /([A-Za-z.\s'-]+\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?)$/,
  );
  return match?.[1] ? normalizeWhitespace(match[1]) : null;
}

function mapCanonicalStatementDateKind(
  value: NonNullable<ParsedDocumentResult["extracted"]>["dates"][number]["kind"],
): CanonicalExtractedDocumentDraft["extracted"]["dates"][number]["kind"] {
  return value === "document_date" ||
    value === "statement_period_start" ||
    value === "statement_period_end"
    ? value
    : "other";
}

function mapCanonicalStatementDateScope(
  value: NonNullable<ParsedDocumentResult["extracted"]>["dates"][number]["scope"],
): CanonicalExtractedDocumentDraft["extracted"]["dates"][number]["entityType"] {
  switch (value) {
    case "account":
      return "account" as const;
    case "party":
      return "party" as const;
    case "institution":
      return "institution" as const;
    case "accountParty":
      return "account_party" as const;
    default:
      return "document" as const;
  }
}

function resolveCanonicalStatementDateEntityId(
  scope: NonNullable<ParsedDocumentResult["extracted"]>["dates"][number]["scope"],
  entityId: string | null,
  parties: CanonicalExtractedDocumentDraft["extracted"]["parties"],
  institutions: CanonicalExtractedDocumentDraft["extracted"]["institutions"],
) {
  if (!entityId) {
    return null;
  }

  if (scope === "party" && parties.some((party) => party.id === entityId)) {
    return entityId;
  }

  if (
    scope === "institution" &&
    institutions.some((institution) => institution.id === entityId)
  ) {
    return entityId;
  }

  return scope === "document" ? null : entityId;
}

function hasCanonicalDateEntry(
  dates: CanonicalExtractedDocumentDraft["extracted"]["dates"],
  candidate: Pick<
    CanonicalExtractedDocumentDraft["extracted"]["dates"][number],
    "kind" | "entityType" | "entityId" | "value"
  >,
) {
  return dates.some(
    (date) =>
      date.kind === candidate.kind &&
      date.entityType === candidate.entityType &&
      date.entityId === candidate.entityId &&
      date.value === candidate.value,
  );
}

function resolveCanonicalInstitutionIds(
  rawIds: string[],
  institutions: Array<Pick<CanonicalExtractedDocumentDraft["extracted"]["institutions"][number], "id">>,
) {
  const institutionIds = new Set(institutions.map((institution) => institution.id));
  const resolved = rawIds.filter((id) => institutionIds.has(id));
  if (resolved.length > 0) {
    return [...new Set(resolved)];
  }

  return institutions.length === 1 ? [institutions[0]?.id].filter(Boolean) : [];
}

function resolveCanonicalStatementDateId(
  dates: Array<
    Pick<
      CanonicalExtractedDocumentDraft["normalized"]["dates"][number],
      "id" | "kind" | "entityType" | "entityId"
    >
  >,
  kind: CanonicalExtractedDocumentDraft["normalized"]["dates"][number]["kind"],
  accountId: string,
) {
  return (
    dates.find(
      (date) =>
        date.kind === kind &&
        date.entityType === "account" &&
        date.entityId === accountId,
    )?.id ??
    dates.find(
      (date) => date.kind === kind && date.entityType === "document",
    )?.id ??
    null
  );
}

function resolveCanonicalValueDateId(
  valueDateId: string | null,
  dates: Array<Pick<CanonicalExtractedDocumentDraft["normalized"]["dates"][number], "id">>,
  fallbackDateId: string | null,
) {
  if (valueDateId && dates.some((date) => date.id === valueDateId)) {
    return valueDateId;
  }

  return fallbackDateId;
}

function normalizeCanonicalAccountNumber(value: string | null | undefined) {
  const digits = normalizeWhitespace(value ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits : null;
}

function normalizeCanonicalMaskedAccountNumber(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value ?? "");
  return normalized || null;
}

function normalizeCanonicalCurrency(value: string | null | undefined) {
  const normalized = normalizeAIFreeText(value);
  return normalized ? normalized.toUpperCase() : null;
}

function normalizeCanonicalContactValue(
  method: NonNullable<ParsedDocumentResult["extracted"]>["contacts"][number]["method"],
  value: string | null,
) {
  const rawValue = normalizeAIFreeText(value);
  if (!rawValue) {
    return null;
  }

  switch (method) {
    case "phone":
      return normalizePhoneNumber(rawValue) ?? rawValue;
    case "website":
      return normalizeWebsite(rawValue) ?? rawValue;
    case "email":
      return rawValue.toLowerCase();
    default:
      return rawValue;
  }
}

function hasSufficientCanonicalAccountPartyCoverage(
  relationships: CanonicalExtractedDocumentDraft["normalized"]["accountParties"],
  accountIds: string[],
  partyIds: string[],
  ownershipType: "single" | "joint",
) {
  if (accountIds.length === 0 || partyIds.length === 0) {
    return relationships.length === 0;
  }

  const requiredPartyIds =
    ownershipType === "joint" ? partyIds : partyIds.slice(0, 1);

  return accountIds.every((accountId) =>
    requiredPartyIds.every((partyId) =>
      relationships.some(
        (relationship) =>
          relationship.accountId === accountId && relationship.partyId === partyId,
      ),
    ),
  );
}

function buildCanonicalStatementContactRefIds(
  sourceRefs: CanonicalSourceRef[],
  contacts: Array<{ label?: string | null; value?: string | null }>,
) {
  return contacts.map((contact, index) =>
    pushSourceRef(sourceRefs, {
      kind: "logic_field",
      fieldPath: `normalized.contacts[${index}].value`,
      label: `${contact.label ?? "Statement contact"} ${index + 1}`,
      value: contact.value ?? null,
    }),
  );
}

function extractStatementCanonicalEnrichment(input: {
  context: TextAnalysisContext;
  detectedClient: string | null;
  rawAIDetectedClient: string | null;
  normalizedAccountType: string | null;
  rawAccountType: string | null;
  normalizedAccountLast4: string | null;
  normalizedDocumentDate: string | null;
}): StatementCanonicalEnrichmentEvidence {
  const firstPageText = extractFirstPageText(input.context.rawText);
  const firstPageLines = firstPageText
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
  const headerLines = getHeaderZoneLines(firstPageText, normalizeWhitespace, {
    minLines: 8,
    ratio: 0.35,
  });
  const anchoredLines = collectAnchoredLines(firstPageText, normalizeWhitespace, [
    /statement period/i,
    /account summary/i,
    /portfolio summary/i,
    /account number/i,
    /ending balance/i,
    /current balance/i,
    /market value/i,
    /customer service/i,
    /questions/i,
    /www\./i,
  ]);
  const allLines = input.context.rawText
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
  const partyAddress = extractStatementPartyAddressEvidence(
    firstPageLines,
    [input.detectedClient, input.rawAIDetectedClient].filter(
      (value): value is string => Boolean(value),
    ),
  );
  const statementDates = extractStatementDateEvidence(
    [...headerLines, ...anchoredLines, ...firstPageLines].join("\n"),
    input.normalizedDocumentDate,
  );
  const normalizedDateIds = {
    documentDateId:
      statementDates.normalized.find((date) => date.kind === "document_date")?.id ?? null,
    statementPeriodStartId:
      statementDates.normalized.find((date) => date.kind === "statement_period_start")?.id ??
      null,
    statementPeriodEndId:
      statementDates.normalized.find((date) => date.kind === "statement_period_end")?.id ?? null,
  };
  const extractedDateIds = {
    statementPeriodStartId:
      statementDates.extracted.find((date) => date.kind === "statement_period_start")?.id ??
      null,
    statementPeriodEndId:
      statementDates.extracted.find((date) => date.kind === "statement_period_end")?.id ?? null,
  };
  const accountEvidence = extractStatementAccountEvidence({
    lines: allLines,
    normalizedAccountType: input.normalizedAccountType,
    rawAccountType: input.rawAccountType,
    normalizedAccountLast4: input.normalizedAccountLast4,
    normalizedDateIds,
    extractedDateIds,
  });

  return {
    normalizedAccounts: accountEvidence.normalized,
    extractedAccounts: accountEvidence.extracted,
    normalizedContacts: extractStatementContactEvidence(
      allLines,
      "normalized-contact",
    ),
    extractedContacts: extractStatementContactEvidence(
      allLines,
      "extracted-contact",
    ),
    normalizedDates: statementDates.normalized,
    extractedDates: statementDates.extracted,
    partyAddress,
  };
}

function extractStatementPartyAddressEvidence(
  lines: string[],
  targetNames: string[],
): StatementPartyAddressEvidence {
  const comparableTargets = new Set(
    targetNames.map((value) => normalizeComparableName(value)).filter(Boolean),
  );

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const normalizedName = sanitizeCanonicalStatementNameCandidate(line);
    const nextLine = lines[index + 1] ?? "";
    const thirdLine = lines[index + 2] ?? "";

    if (!looksLikeCanonicalStreetAddress(nextLine) || !looksLikeCanonicalCityStateZip(thirdLine)) {
      continue;
    }

    if (
      comparableTargets.size > 0 &&
      normalizedName &&
      comparableTargets.has(normalizeComparableName(normalizedName))
    ) {
      return buildCanonicalStatementAddress(nextLine, thirdLine);
    }

    if (comparableTargets.size === 0 && normalizedName) {
      return buildCanonicalStatementAddress(nextLine, thirdLine);
    }
  }

  return {
    rawAddress: null,
    normalizedAddress: null,
  };
}

function buildCanonicalStatementAddress(
  streetLine: string,
  cityStateZipLine: string,
): StatementPartyAddressEvidence {
  const rawLines = [streetLine, cityStateZipLine].filter(Boolean);
  const parsed = parseCanonicalCityStateZip(cityStateZipLine);
  const normalizedStreetLine = titleCaseAddressLine(streetLine);
  const normalizedCity = parsed.city ? toTitleCaseWords(parsed.city) : null;
  const normalizedCityStateZipLine = [normalizedCity, parsed.state, parsed.postalCode]
    .filter(Boolean)
    .join(" ");

  return {
    rawAddress: {
      kind: "identity",
      rawText: rawLines.join(", "),
      lines: rawLines,
      city: parsed.city,
      state: parsed.state,
      postalCode: parsed.postalCode,
      country: "US",
    },
    normalizedAddress: {
      kind: "identity",
      rawText: [normalizedStreetLine, normalizedCityStateZipLine].filter(Boolean).join(", "),
      lines: [normalizedStreetLine, normalizedCityStateZipLine].filter(Boolean),
      city: normalizedCity,
      state: parsed.state,
      postalCode: parsed.postalCode,
      country: "US",
    },
  };
}

function extractStatementDateEvidence(
  text: string,
  normalizedDocumentDate: string | null,
) {
  const statementPeriodMatch = text.match(
    /\bstatement period\b[^A-Za-z0-9]{0,6}([A-Za-z]+\s+\d{1,2},?\s+20\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\s*(?:to|through|\-|\u2013|\u2014)\s*([A-Za-z]+\s+\d{1,2},?\s+20\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/i,
  );
  const rawStart = statementPeriodMatch?.[1] ?? null;
  const rawEnd = statementPeriodMatch?.[2] ?? null;
  const normalizedStart = normalizeDateToken(rawStart);
  const normalizedEnd = normalizeDateToken(rawEnd);
  const documentDate = normalizedEnd ?? normalizedDocumentDate ?? null;
  const extracted: StatementDateEvidence[] = [];
  const normalized: StatementDateEvidence[] = [];

  if (rawEnd) {
    extracted.push({
      id: "date-raw-document",
      kind: "document_date",
      rawValue: rawEnd,
      value: normalizeDateToken(rawEnd),
      entityType: "document",
      entityId: null,
    });
  }

  if (rawEnd || documentDate) {
    normalized.push({
      id: "date-document",
      kind: "document_date",
      rawValue: rawEnd ?? rawStart ?? documentDate,
      value: documentDate,
      entityType: "document",
      entityId: null,
    });
  }

  if (rawStart || normalizedStart) {
    extracted.push({
      id: "date-raw-period-start",
      kind: "statement_period_start",
      rawValue: rawStart,
      value: normalizedStart,
      entityType: "document",
      entityId: null,
    });
    normalized.push({
      id: "date-period-start",
      kind: "statement_period_start",
      rawValue: rawStart,
      value: normalizedStart,
      entityType: "document",
      entityId: null,
    });
  }

  if (rawEnd || normalizedEnd) {
    extracted.push({
      id: "date-raw-period-end",
      kind: "statement_period_end",
      rawValue: rawEnd,
      value: normalizedEnd,
      entityType: "document",
      entityId: null,
    });
    normalized.push({
      id: "date-period-end",
      kind: "statement_period_end",
      rawValue: rawEnd,
      value: normalizedEnd,
      entityType: "document",
      entityId: null,
    });
  }

  return {
    extracted,
    normalized,
  };
}

function extractStatementAccountEvidence(input: {
  lines: string[];
  normalizedAccountType: string | null;
  rawAccountType: string | null;
  normalizedAccountLast4: string | null;
  normalizedDateIds: {
    documentDateId: string | null;
    statementPeriodStartId: string | null;
    statementPeriodEndId: string | null;
  };
  extractedDateIds: {
    statementPeriodStartId: string | null;
    statementPeriodEndId: string | null;
  };
}) {
  const accountLineIndexes = input.lines.flatMap((line, index) =>
    /\b(?:account number|account #|acct(?:ount)?\s*(?:no\.?|#))\b/i.test(line)
      ? [index]
      : [],
  );
  const extracted: StatementAccountEvidence[] = [];
  const normalized: StatementAccountEvidence[] = [];

  if (accountLineIndexes.length > 0) {
    for (let position = 0; position < accountLineIndexes.length; position += 1) {
      const lineIndex = accountLineIndexes[position] ?? 0;
      const nextAccountLineIndex = accountLineIndexes[position + 1] ?? input.lines.length;
      const blockStart = Math.max(0, lineIndex - 3);
      const blockEnd = Math.min(input.lines.length, nextAccountLineIndex);
      const blockLines = input.lines.slice(blockStart, blockEnd);
      const accountNumberLines = input.lines.slice(lineIndex, Math.min(input.lines.length, lineIndex + 3));
      const rawAccountNumber = extractFullAccountNumberFromStatementBlock(accountNumberLines);
      const accountLast4 =
        (rawAccountNumber && rawAccountNumber.slice(-4)) ??
        extractStatementLast4FromBlock(accountNumberLines) ??
        null;
      const rawAccountType =
        extractStatementAccountTypeLabel(blockLines.join("\n")) ??
        (accountLineIndexes.length === 1 ? input.rawAccountType : null);
      const normalizedAccountType = rawAccountType
        ? normalizeAccountStatementAccountType(rawAccountType).finalValue
        : accountLineIndexes.length === 1
          ? input.normalizedAccountType
          : null;
      const values = extractStatementValueEvidence(blockLines.join("\n"));
      const key = rawAccountNumber ?? `${accountLast4 ?? "unknown"}-${position + 1}`;

      extracted.push({
        key,
        extractedId: `account-raw-${position + 1}`,
        normalizedId: `account-${position + 1}`,
        rawAccountNumber,
        normalizedAccountNumber: rawAccountNumber,
        maskedAccountNumber: maskFullAccountNumber(rawAccountNumber),
        accountLast4,
        rawAccountType,
        normalizedAccountType,
        registrationType: null,
        statementStartDateId: input.extractedDateIds.statementPeriodStartId,
        statementEndDateId: input.extractedDateIds.statementPeriodEndId,
        values,
      });
      normalized.push({
        key,
        extractedId: `account-raw-${position + 1}`,
        normalizedId: `account-${position + 1}`,
        rawAccountNumber,
        normalizedAccountNumber: rawAccountNumber,
        maskedAccountNumber: maskFullAccountNumber(rawAccountNumber),
        accountLast4,
        rawAccountType,
        normalizedAccountType,
        registrationType: null,
        statementStartDateId: input.normalizedDateIds.statementPeriodStartId,
        statementEndDateId:
          input.normalizedDateIds.statementPeriodEndId ?? input.normalizedDateIds.documentDateId,
        values,
      });
    }
  }

  if (normalized.length === 0) {
    const fallbackLast4 = input.normalizedAccountLast4;
    if (fallbackLast4 || input.normalizedAccountType || input.rawAccountType) {
      const fallbackValues = extractStatementValueEvidence(input.lines.join("\n"));
      extracted.push({
        key: fallbackLast4 ?? "statement-account",
        extractedId: "account-raw-1",
        normalizedId: "account-1",
        rawAccountNumber: null,
        normalizedAccountNumber: null,
        maskedAccountNumber: null,
        accountLast4: fallbackLast4,
        rawAccountType: input.rawAccountType,
        normalizedAccountType: input.normalizedAccountType,
        registrationType: null,
        statementStartDateId: input.extractedDateIds.statementPeriodStartId,
        statementEndDateId: input.extractedDateIds.statementPeriodEndId,
        values: fallbackValues,
      });
      normalized.push({
        key: fallbackLast4 ?? "statement-account",
        extractedId: "account-raw-1",
        normalizedId: "account-1",
        rawAccountNumber: null,
        normalizedAccountNumber: null,
        maskedAccountNumber: null,
        accountLast4: fallbackLast4,
        rawAccountType: input.rawAccountType,
        normalizedAccountType: input.normalizedAccountType,
        registrationType: null,
        statementStartDateId: input.normalizedDateIds.statementPeriodStartId,
        statementEndDateId:
          input.normalizedDateIds.statementPeriodEndId ?? input.normalizedDateIds.documentDateId,
        values: fallbackValues,
      });
    }
  }

  return { extracted, normalized };
}

function extractStatementContactEvidence(
  lines: string[],
  idPrefix: string,
): StatementContactEvidence[] {
  const contacts: StatementContactEvidence[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const previousLine = (lines[index - 1] ?? "").toLowerCase();
    const lowerLine = line.toLowerCase();
    const contactContext = `${previousLine} ${lowerLine}`;
    const phonePurpose = hasCustomerServiceContactSignal(contactContext)
      ? "customer_service"
      : "general_support";

    const websiteMatches = line.matchAll(
      /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9.-]+\.(?:com|net|org|us|gov)\b(?:\/[^\s]*)?/gi,
    );
    for (const match of websiteMatches) {
      const websitePurpose = classifyStatementWebsitePurpose({
        previousLines: lines
          .slice(Math.max(0, index - 3), index)
          .map((entry) => entry.toLowerCase()),
        line: lowerLine,
        matchIndex: match.index ?? lowerLine.indexOf((match[0] ?? "").toLowerCase()),
      });
      const rawValue = normalizeWhitespace(match[0] ?? "");
      const normalizedValue = normalizeWebsite(rawValue);
      if (!normalizedValue) {
        continue;
      }

      const dedupeKey = `website:${normalizedValue}`;
      if (seen.has(dedupeKey)) {
        continue;
      }

      seen.add(dedupeKey);
      contacts.push({
        id: `${idPrefix}-${contacts.length + 1}`,
        method: "website",
        purpose: websitePurpose,
        label:
          websitePurpose === "customer_service"
            ? "Customer service website"
            : "Website",
        rawValue,
        normalizedValue,
      });
    }

    const phoneMatches = line.matchAll(
      /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]*)\d{3}[-.\s]*\d{4}/g,
    );
    for (const match of phoneMatches) {
      const rawValue = normalizeWhitespace(match[0] ?? "");
      const normalizedValue = normalizePhoneNumber(rawValue);
      if (!normalizedValue) {
        continue;
      }

      if (
        !/customer service|questions|support|help|contact us|call us/.test(
          `${previousLine} ${lowerLine}`,
        ) &&
        !/^8(00|33|44|55|66|77|88)-/.test(normalizedValue)
      ) {
        continue;
      }

      const dedupeKey = `phone:${normalizedValue}`;
      if (seen.has(dedupeKey)) {
        continue;
      }

      seen.add(dedupeKey);
      contacts.push({
        id: `${idPrefix}-${contacts.length + 1}`,
        method: "phone",
        purpose: phonePurpose,
        label:
          phonePurpose === "customer_service"
            ? "Customer service phone"
            : "Support phone",
        rawValue,
        normalizedValue,
      });
    }
  }

  return contacts;
}

function hasCustomerServiceContactSignal(value: string) {
  return /customer service|questions|support|help|contact us|call us/.test(value);
}

function classifyStatementWebsitePurpose(input: {
  previousLines: string[];
  line: string;
  matchIndex: number;
}) {
  const line = input.line ?? "";
  const previousContext = (input.previousLines ?? []).join(" ").slice(-160);
  const boundedMatchIndex = Number.isFinite(input.matchIndex)
    ? Math.max(0, input.matchIndex)
    : 0;
  const localPrefix = line.slice(
    Math.max(0, boundedMatchIndex - 64),
    boundedMatchIndex,
  );
  const localContext = `${previousContext} ${localPrefix}`.trim();

  if (
    /\bonline banking website\b|\bonline banking\b|\bportfolio website\b|\bportfolio access\b|\bplan website\b|\bpolicy access\b|\bpolicy website\b/.test(
      localContext,
    )
  ) {
    return "general_support" as const;
  }

  if (
    /\bcustomer service website\b|\bcustomer support website\b|\bsupport website\b|\bhelp website\b|\bhelp center\b|\bsupport center\b|\bcontact us\b/.test(
      localContext,
    )
  ) {
    return "customer_service" as const;
  }

  if (/\bcustomer service\b.{0,12}\bwebsite\b|\bcustomer support\b.{0,12}\bwebsite\b/.test(localContext)) {
    return "customer_service" as const;
  }

  return "general_support" as const;
}

function extractStatementValueEvidence(text: string): StatementValueEvidence[] {
  const specs: Array<{
    kind: StatementValueEvidence["kind"];
    label: string;
    pattern: RegExp;
  }> = [
    {
      kind: "ending_balance",
      label: "Ending balance",
      pattern: /\bending balance\b[^$\d-]*(\$?\(?-?[\d,]+\.\d{2}\)?)/i,
    },
    {
      kind: "current_balance",
      label: "Current balance",
      pattern: /\bcurrent balance\b[^$\d-]*(\$?\(?-?[\d,]+\.\d{2}\)?)/i,
    },
    {
      kind: "market_value",
      label: "Market value",
      pattern: /\bmarket value\b[^$\d-]*(\$?\(?-?[\d,]+\.\d{2}\)?)/i,
    },
    {
      kind: "available_balance",
      label: "Available balance",
      pattern: /\bavailable balance\b[^$\d-]*(\$?\(?-?[\d,]+\.\d{2}\)?)/i,
    },
    {
      kind: "beginning_balance",
      label: "Beginning balance",
      pattern: /\bbeginning balance\b[^$\d-]*(\$?\(?-?[\d,]+\.\d{2}\)?)/i,
    },
  ];
  const values: StatementValueEvidence[] = [];

  for (const spec of specs) {
    const match = text.match(spec.pattern);
    const rawAmount = match?.[1] ? normalizeWhitespace(match[1]) : null;
    if (!rawAmount) {
      continue;
    }

    values.push({
      kind: spec.kind,
      label: spec.label,
      rawAmount,
      amount: normalizeMoneyAmount(rawAmount),
      currency: rawAmount.includes("$") ? "USD" : null,
    });
  }

  return values;
}

function extractFullAccountNumberFromStatementBlock(lines: string[]) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!/\b(?:account number|account #|acct(?:ount)?\s*(?:no\.?|#))\b/i.test(line)) {
      continue;
    }

    const candidates = [`${line} ${lines[index + 1] ?? ""}`, line];
    for (const candidate of candidates) {
      const matches = [...candidate.matchAll(/\b(\d{5,20})\b/g)];
      if (matches.length > 0) {
        const best = matches.sort(
          (left, right) => (right[1]?.length ?? 0) - (left[1]?.length ?? 0),
        )[0]?.[1];
        if (best) {
          return best;
        }
      }
    }
  }

  return null;
}

function extractStatementLast4FromBlock(lines: string[]) {
  for (const line of lines) {
    const match = line.match(
      /\b(?:account number|account #|acct(?:ount)?\s*(?:no\.?|#))\b[^0-9A-Za-z]*(?:ending in[^0-9]*)?(?:x|#|\*{2,}|•{2,}|\.{2,}|[\s-])?(\d{4})\b/i,
    );
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function extractStatementAccountTypeLabel(text: string) {
  const patterns: Array<[RegExp, string | null]> = [
    [/\b([A-Z][A-Za-z.&*\s]+Smartly Checking)\b/i, null],
    [/\b(Roth IRA)\b/i, null],
    [/\b(Traditional IRA)\b/i, null],
    [/\b(Rollover IRA)\b/i, null],
    [/\b(SEP IRA)\b/i, null],
    [/\b(SIMPLE IRA)\b/i, null],
    [/\b(401\(k\)\s+Savings Plan)\b/i, null],
    [/\b(401\(k\))\b/i, null],
    [/\b(403\(b\))\b/i, null],
    [/\b(HSA)\b/i, null],
    [/\b(Brokerage Account)\b/i, null],
    [/\b(Brokerage)\b/i, null],
    [/\b(Savings Account)\b/i, null],
    [/\b(Checking Account)\b/i, null],
    [/\b(Checking)\b/i, null],
    [/\b(Savings)\b/i, null],
    [/\b(Variable Annuity)\b/i, null],
    [/\b(Fixed Indexed Annuity)\b/i, null],
    [/\b(Fixed Annuity)\b/i, null],
    [/\b(Annuity)\b/i, null],
  ];

  for (const [pattern, override] of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return override ?? normalizeWhitespace(match[1]);
    }
  }

  return null;
}

function sanitizeCanonicalStatementNameCandidate(value: string) {
  const normalized = normalizeWhitespace(value);
  if (!normalized || /\d/.test(normalized)) {
    return null;
  }

  if (
    /\b(?:account|summary|statement|period|checking|savings|portfolio|questions|customer|service|balance|market|value|fidelity|bank)\b/i.test(
      normalized,
    )
  ) {
    return null;
  }

  const tokens = normalized
    .split(/\s+/)
    .map((token) => token.replace(/[^A-Za-z'-]/g, ""))
    .filter(Boolean);

  if (tokens.length < 2 || tokens.length > 4) {
    return null;
  }

  return tokens
    .map((token) => (token.length === 1 ? token.toUpperCase() : toTitleCase(token)))
    .join(" ");
}

function normalizeComparableName(value: string | null | undefined) {
  return normalizeWhitespace(value ?? "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function looksLikeCanonicalStreetAddress(value: string) {
  return (
    /^(?:[NSEW]\s+)?[NSEW]?\d{1,6}\s+[A-Za-z0-9.'#-]+(?:\s+[A-Za-z0-9.'#-]+){0,6}\b/i.test(
      value,
    ) &&
    /\b(?:street|st\b|drive|dr\b|road|rd\b|avenue|ave\b|lane|ln\b|court|ct\b|boulevard|blvd\b|way|place|pl\b|terrace|ter\b)\b/i.test(
      value,
    )
  );
}

function looksLikeCanonicalCityStateZip(value: string) {
  return /\b[A-Z][A-Za-z.\s'-]+\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/.test(value);
}

function parseCanonicalCityStateZip(value: string) {
  const match = value.match(
    /^([A-Za-z.\s'-]+?)\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/,
  );

  return {
    city: match?.[1] ? normalizeWhitespace(match[1]) : null,
    state: match?.[2] ?? null,
    postalCode: match?.[3] ?? null,
  };
}

function titleCaseAddressLine(value: string) {
  return normalizeWhitespace(value)
    .split(/\s+/)
    .map((part) => {
      if (/^\d/.test(part) || /^[NSEW]$/i.test(part)) {
        return part.toUpperCase();
      }

      const cleaned = part.toLowerCase();
      if (/^(?:wi|il|ca|ny|tx|fl|nj|pa|az|co|ma|nc|sc|ga|va|md|ct|mn|ia|mo|oh|mi|in|tn|ky|al|ms|la|ok|ks|ne|sd|nd|mt|id|ut|nv|or|wa|ak|hi|nm|de|ri|vt|nh|me|wv|dc)$/i.test(cleaned)) {
        return cleaned.toUpperCase();
      }

      return cleaned
        .split("-")
        .map((token) => toTitleCase(token))
        .join("-");
    })
    .join(" ");
}

function toTitleCaseWords(value: string) {
  return normalizeWhitespace(value)
    .split(/\s+/)
    .map((token) => toTitleCase(token))
    .join(" ");
}

function normalizeWebsite(value: string) {
  const normalized = normalizeWhitespace(value).replace(/[),.;:]+$/, "");
  if (!normalized) {
    return null;
  }

  return normalized.toLowerCase();
}

function normalizePhoneNumber(value: string) {
  const digits = value.replace(/\D/g, "");
  const normalizedDigits = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;

  if (normalizedDigits.length !== 10) {
    return null;
  }

  return `${normalizedDigits.slice(0, 3)}-${normalizedDigits.slice(3, 6)}-${normalizedDigits.slice(6)}`;
}

function maskFullAccountNumber(value: string | null | undefined) {
  const digits = normalizeWhitespace(value ?? "").replace(/\D/g, "");
  if (digits.length < 4) {
    return null;
  }

  return `${"x".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function normalizeMoneyAmount(value: string) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return null;
  }

  const isNegative = /^\(/.test(normalized) || /-/.test(normalized);
  const digits = normalized.replace(/[^\d.]/g, "");
  if (!digits || !/^\d+(?:\.\d{2})?$/.test(digits)) {
    return null;
  }

  return isNegative && !digits.startsWith("-") ? `-${digits}` : digits;
}

function normalizeDateToken(value: string | null | undefined) {
  const token = normalizeWhitespace(value ?? "");
  if (!token) {
    return null;
  }

  const numericMatch = token.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (numericMatch) {
    const month = Number.parseInt(numericMatch[1] ?? "", 10);
    const day = Number.parseInt(numericMatch[2] ?? "", 10);
    const rawYear = Number.parseInt(numericMatch[3] ?? "", 10);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }

  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function buildCanonicalAccountPartiesForAccounts(input: {
  accountIds: string[];
  partyIds: string[];
  ownershipType: "single" | "joint";
}) {
  return input.accountIds.flatMap((accountId) =>
    buildCanonicalAccountParties({
      accountId,
      partyIds: input.partyIds,
      ownershipType: input.ownershipType,
    }),
  );
}

function buildCanonicalAccountParties(input: {
  accountId: string | null;
  partyIds: string[];
  ownershipType: "single" | "joint";
}) {
  const accountId = input.accountId;
  if (!accountId) {
    return [];
  }

  return input.partyIds.map((partyId, index) => ({
    id: `${accountId}-party-${index + 1}`,
    accountId,
    partyId,
    roles: [
      input.ownershipType === "joint" ? "joint_owner" : "owner",
    ] as CanonicalAccountPartyRole[],
    relationshipLabel: input.ownershipType === "joint" ? "Joint owner" : "Owner",
    allocationPercent: null,
  }));
}

function buildCanonicalFieldProvenance(input: {
  ownership: Partial<Record<ParsedFieldKey, ParsedFieldOwnership>>;
  logicClientSourceRefId: string | null;
  logicClient2SourceRefId: string | null;
  rawClientSourceRefId: string | null;
  rawClient2SourceRefId: string | null;
  rawCustodianSourceRefId: string | null;
  rawAccountTypeSourceRefId: string | null;
  rawAccountLast4SourceRefId: string | null;
  rawDocumentDateSourceRefId: string | null;
}) {
  const fields: Record<string, CanonicalFieldProvenance> = {};

  assignCanonicalFieldProvenance(
    fields,
    "classification.normalized.documentTypeId",
    input.ownership.documentTypeId,
  );
  assignCanonicalFieldProvenance(
    fields,
    "normalized.parties[0].displayName",
    input.ownership.detectedClient,
    [input.logicClientSourceRefId, input.rawClientSourceRefId],
  );
  assignCanonicalFieldProvenance(
    fields,
    "normalized.parties[1].displayName",
    input.ownership.detectedClient2,
    [input.logicClient2SourceRefId, input.rawClient2SourceRefId],
  );
  assignCanonicalFieldProvenance(
    fields,
    "normalized.accountParties[0].roles",
    input.ownership.ownershipType,
  );
  assignCanonicalFieldProvenance(
    fields,
    "normalized.accounts[0].accountLast4",
    input.ownership.accountLast4,
    [input.rawAccountLast4SourceRefId],
  );
  assignCanonicalFieldProvenance(
    fields,
    "normalized.accounts[0].accountType",
    input.ownership.accountType,
    [input.rawAccountTypeSourceRefId],
  );
  assignCanonicalFieldProvenance(
    fields,
    "normalized.institutions[0].name",
    input.ownership.custodian,
    [input.rawCustodianSourceRefId],
  );
  assignCanonicalFieldProvenance(
    fields,
    "normalized.dates[0].value",
    input.ownership.documentDate,
    [input.rawDocumentDateSourceRefId],
  );

  return fields;
}

function assignCanonicalFieldProvenance(
  fields: Record<string, CanonicalFieldProvenance>,
  fieldPath: string,
  ownership: ParsedFieldOwnership | undefined,
  sourceRefIds: Array<string | null> = [],
) {
  if (!ownership) {
    return;
  }

  fields[fieldPath] = {
    owner: ownership.owner,
    source: ownership.source,
    confidence: ownership.confidence ?? null,
    raw: ownership.raw ?? null,
    sourceRefIds: sourceRefIds.filter((value): value is string => Boolean(value)),
  };
}

function buildCanonicalNormalizationRecords(input: {
  normalizedCustodian: {
    rawValue: string | null;
    finalValue: string | null;
    changed: boolean;
    ruleId: string | null;
  };
  normalizedAccountType: {
    rawValue: string | null;
    finalValue: string | null;
    changed: boolean;
    ruleId: string | null;
  };
  rawAccountLast4: string | null;
  finalAccountLast4: string | null;
  rawDocumentDate: string | null;
  finalDocumentDate: string | null;
  rawCustodianSourceRefId: string | null;
  rawAccountTypeSourceRefId: string | null;
  rawAccountLast4SourceRefId: string | null;
  rawDocumentDateSourceRefId: string | null;
}) {
  const normalization: CanonicalNormalizationRecord[] = [];

  if (input.normalizedCustodian.changed) {
    normalization.push({
      fieldPath: "normalized.institutions[0].name",
      source: "normalized_custodian",
      ruleId: input.normalizedCustodian.ruleId,
      rawValue: input.normalizedCustodian.rawValue,
      finalValue: input.normalizedCustodian.finalValue,
      sourceRefId: input.rawCustodianSourceRefId,
    });
  }

  if (input.normalizedAccountType.changed) {
    normalization.push({
      fieldPath: "normalized.accounts[0].accountType",
      source: "normalized_account_type",
      ruleId: input.normalizedAccountType.ruleId,
      rawValue: input.normalizedAccountType.rawValue,
      finalValue: input.normalizedAccountType.finalValue,
      sourceRefId: input.rawAccountTypeSourceRefId,
    });
  }

  if (
    input.rawAccountLast4 &&
    input.finalAccountLast4 &&
    sanitizeAIAccountLast4(input.rawAccountLast4) !== input.rawAccountLast4
  ) {
    normalization.push({
      fieldPath: "normalized.accounts[0].accountLast4",
      source: "validated_account_last4",
      ruleId: "validated_account_last4",
      rawValue: input.rawAccountLast4,
      finalValue: input.finalAccountLast4,
      sourceRefId: input.rawAccountLast4SourceRefId,
    });
  }

  if (
    input.rawDocumentDate &&
    input.finalDocumentDate &&
    sanitizeAIDocumentDate(input.rawDocumentDate) !== input.rawDocumentDate
  ) {
    normalization.push({
      fieldPath: "normalized.dates[0].value",
      source: "validated_document_date",
      ruleId: "validated_document_date",
      rawValue: input.rawDocumentDate,
      finalValue: input.finalDocumentDate,
      sourceRefId: input.rawDocumentDateSourceRefId,
    });
  }

  return normalization;
}

function pushSourceRef(
  sourceRefs: CanonicalSourceRef[],
  sourceRef: Omit<CanonicalSourceRef, "id">,
) {
  if (!sourceRef.value) {
    return null;
  }

  const id = `source-ref-${sourceRefs.length + 1}`;
  sourceRefs.push({
    id,
    ...sourceRef,
  });

  return id;
}

function buildAITraceDebug(
  debug: ParsedDocumentResult["debug"],
  fieldOwnership: Partial<Record<ParsedFieldKey, ParsedFieldOwnership>> = {},
  extra: Partial<DocumentInsight["debug"]> = {},
): Partial<DocumentInsight["debug"]> {
  return {
    aiModel: debug?.aiModel ?? null,
    aiPromptVersion: debug?.aiPromptVersion ?? null,
    aiRawSummary: debug?.aiRawSummary ?? null,
    aiRawDetectedClient: extra.aiRawDetectedClient ?? null,
    aiRawDetectedClient2: extra.aiRawDetectedClient2 ?? null,
    aiRawCustodian: extra.aiRawCustodian ?? null,
    aiRawAccountType: extra.aiRawAccountType ?? null,
    aiEnabled: debug?.aiEnabled ?? false,
    aiAttempted: debug?.aiAttempted ?? false,
    aiUsed: debug?.aiUsed ?? false,
    aiFailureReason: debug?.aiFailureReason ?? null,
    custodianWasNormalized: extra.custodianWasNormalized ?? false,
    accountTypeWasNormalized: extra.accountTypeWasNormalized ?? false,
    custodianNormalizationRule: extra.custodianNormalizationRule ?? null,
    accountTypeNormalizationRule: extra.accountTypeNormalizationRule ?? null,
    fieldOwnership,
  };
}

function resolveAIPrimaryFieldValue<
  Key extends
    | "detectedClient"
    | "detectedClient2"
    | "ownershipType"
    | "accountLast4"
    | "accountType"
    | "custodian"
    | "documentDate",
>(input: {
  field: Key;
  aiValue:
    | string
    | "single"
    | "joint"
    | null
    | undefined;
  legacyValue:
    | string
    | "single"
    | "joint"
    | null
    | undefined;
  ownership: Partial<Record<ParsedFieldKey, ParsedFieldOwnership>>;
  aiRawValue?: string | null;
  validatorSource?: string;
}) {
  if (input.aiValue !== null && input.aiValue !== undefined && input.aiValue !== "") {
    const rawValue = input.aiRawValue ?? String(input.aiValue);
    const ownershipRecord = input.ownership[input.field];

    if (String(input.aiValue) !== rawValue) {
      input.ownership[input.field] = {
        owner: "logic",
        source: input.validatorSource ?? `validated_${input.field}`,
        confidence: ownershipRecord?.confidence ?? null,
        raw: rawValue,
      };
    } else if (!ownershipRecord) {
      input.ownership[input.field] = {
        owner: "ai",
        source: "account_statement_phase1_ai",
        raw: rawValue,
      };
    }

    return input.aiValue;
  }

  if (input.aiRawValue) {
    input.ownership[input.field] = {
      owner: "logic",
      source: input.validatorSource ?? `validated_${input.field}`,
      confidence: input.ownership[input.field]?.confidence ?? null,
      raw: input.aiRawValue,
    };
  }

  if (
    input.legacyValue !== null &&
    input.legacyValue !== undefined &&
    input.legacyValue !== ""
  ) {
    input.ownership[input.field] = {
      owner: "logic",
      source: "legacy_fallback",
      raw: String(input.legacyValue),
    };
    return input.legacyValue;
  }

  return null;
}

function normalizeAIName(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value ?? "");
  if (!normalized) {
    return null;
  }

  if (normalized.length < 3 || /\d/.test(normalized)) {
    return null;
  }

  return normalized;
}

function normalizeAIFreeText(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value ?? "");
  if (!normalized) {
    return null;
  }

  return normalized;
}

function sanitizeAIAccountLast4(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 4) {
    return null;
  }

  return digits.slice(-4);
}

function sanitizeAIDocumentDate(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value ?? "");
  if (!normalized) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const parsed = new Date(`${normalized}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? null : normalized;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function finalizeTextAnalysisInsight(
  context: TextAnalysisContext,
  classification: TextAnalysisClassification,
  extraction: TextAnalysisExtraction,
  extraDebug: Partial<DocumentInsight["debug"]> = {},
) {
  let confidence = classification.confidence;
  let taxYear = extraction.metadata.taxYear;
  let entityName = extraction.metadata.entityName;

  if (classification.documentTypeId !== "tax_document") {
    taxYear = null;
  }

  const isLegalLikeDocument =
    classification.documentLabel === "Legal / estate document" ||
    includesAny(context.lowerText, ["trust", "llc", "estate", "will"]);

  if (!isLegalLikeDocument) {
    entityName = null;
  }

  if (extraction.detectedClient) {
    confidence = Math.min(0.95, confidence + 0.08);
    context.reasons.push(
      `Client name inferred from document content: ${extraction.detectedClient}.`,
    );
  }

  return {
    textExcerpt: context.textExcerpt,
    diagnosticText: context.diagnosticText,
    pdfFields: context.pdfFields,
    detectedClient: extraction.detectedClient,
    detectedClient2: extraction.detectedClient2,
    ownershipType: extraction.ownershipType,
    documentTypeId: classification.documentTypeId,
    documentLabel: classification.documentLabel,
    documentSubtype: classification.documentSubtype,
    filenameLabel: classification.filenameLabel,
    topLevelFolder: classification.topLevelFolder,
    confidence,
    reasons: context.reasons,
    contentSource: context.contentSource,
    debug: {
      parserVersion: PARSER_VERSION,
      parserConflictSummary: context.parserConflictSummary,
      documentSignal: classification.documentSignal,
      statementClientSource: extraction.statementClientSource,
      statementClientCandidate: extraction.statementClientCandidate,
      aiModel: extraDebug.aiModel ?? null,
      aiPromptVersion: extraDebug.aiPromptVersion ?? null,
      aiRawSummary: extraDebug.aiRawSummary ?? null,
      aiRawDetectedClient: extraDebug.aiRawDetectedClient ?? null,
      aiRawDetectedClient2: extraDebug.aiRawDetectedClient2 ?? null,
      aiRawCustodian: extraDebug.aiRawCustodian ?? null,
      aiRawAccountType: extraDebug.aiRawAccountType ?? null,
      aiEnabled: extraDebug.aiEnabled ?? false,
      aiAttempted: extraDebug.aiAttempted ?? false,
      aiUsed: extraDebug.aiUsed ?? false,
      aiFailureReason: extraDebug.aiFailureReason ?? null,
      custodianWasNormalized: extraDebug.custodianWasNormalized ?? false,
      accountTypeWasNormalized: extraDebug.accountTypeWasNormalized ?? false,
      custodianNormalizationRule: extraDebug.custodianNormalizationRule ?? null,
      accountTypeNormalizationRule: extraDebug.accountTypeNormalizationRule ?? null,
      fieldOwnership: extraDebug.fieldOwnership ?? {},
      ownershipClientCandidate: context.ownershipClientCandidate,
      accountContextCandidate: context.accountContextCandidate,
      accountLooseCandidate: context.accountLooseCandidate,
      taxKeywordDetected: context.taxKeywordDetected,
      yearCandidates: context.yearCandidates,
      downloadByteLength: context.downloadFingerprint?.byteLength ?? null,
      downloadSha1: context.downloadFingerprint?.sha1 ?? null,
      pdfFieldReaders: context.pdfFieldReaders,
      pdfExtractionAttempts: context.pdfExtractionAttempts,
    },
    metadata: {
      accountLast4: extraction.metadata.accountLast4,
      accountType: extraction.metadata.accountType,
      custodian: extraction.metadata.custodian,
      documentDate: extraction.metadata.documentDate,
      entityName,
      idType: extraction.metadata.idType,
      taxYear,
    },
  } satisfies DocumentInsight;
}

function shouldSupplementPdfInsight(
  insight: DocumentInsight,
  fields: Record<string, string>,
) {
  if (!Object.keys(fields).length) {
    return false;
  }

  return (
    !insight.metadata.accountType ||
    !insight.metadata.accountLast4 ||
    isAllZeroLast4(insight.metadata.accountLast4)
  );
}

function preferSupplementedPdfInsight(
  baseInsight: DocumentInsight,
  mergedInsight: DocumentInsight,
) {
  return {
    ...mergedInsight,
    metadata: {
      ...mergedInsight.metadata,
      accountLast4:
        mergedInsight.metadata.accountLast4 &&
        !isAllZeroLast4(mergedInsight.metadata.accountLast4)
          ? mergedInsight.metadata.accountLast4
          : baseInsight.metadata.accountLast4 ?? mergedInsight.metadata.accountLast4,
      accountType:
        mergedInsight.metadata.accountType ?? baseInsight.metadata.accountType,
    },
  } satisfies DocumentInsight;
}

function preferSupplementedPdfEnvelope(
  baseEnvelope: TextAnalysisResultEnvelope,
  mergedEnvelope: TextAnalysisResultEnvelope,
): TextAnalysisResultEnvelope {
  return {
    canonical: mergedEnvelope.canonical ?? baseEnvelope.canonical,
    legacyInsight: preferSupplementedPdfInsight(
      baseEnvelope.legacyInsight,
      mergedEnvelope.legacyInsight,
    ),
  };
}

function hasUsefulText(value: string) {
  return normalizeWhitespace(value).length >= 24;
}

function extractClientNameFromFields(fields: Record<string, string>) {
  const jointClients = extractJointClientNamesFromFields(fields);
  if (jointClients) {
    return jointClients.primary;
  }

  for (const [key, value] of Object.entries(fields)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes("owner") ||
      lowerKey.includes("client") ||
      lowerKey.includes("accountname") ||
      lowerKey.includes("account name")
    ) {
      const parts = value
        .replace(/[^A-Za-z\s'-]/g, " ")
        .split(/\s+/)
        .filter(Boolean);

      if (parts.length >= 2) {
        return `${toTitleCase(parts[0])} ${toTitleCase(parts[parts.length - 1])}`;
      }
    }
  }

  return null;
}

function extractJointClientNamesFromFields(fields: Record<string, string>) {
  for (const [key, value] of Object.entries(fields)) {
    const lowerKey = key.toLowerCase();
    if (
      !(
        lowerKey.includes("owner") ||
        lowerKey.includes("accountname") ||
        lowerKey.includes("account name") ||
        lowerKey.includes("name on account")
      )
    ) {
      continue;
    }

    const parsed = parseJointOwnerValue(value);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function analyzeFromMetadata(
  file: GoogleDriveFile,
  options?: {
    downloadFingerprint?: DownloadFingerprint | null;
    extraReasons?: string[];
    metadataOnlyDiagnosticText?: string | null;
    pdfExtractionAttempts?: PdfExtractionAttempt[];
  },
) {
  const name = file.name;
  const lowerName = name.toLowerCase();
  let documentLabel = "Needs inspection";
  let documentSubtype: string | null = null;
  let documentTypeId: DocumentInsight["documentTypeId"] = "default";
  let filenameLabel = "Review_Item";
  let topLevelFolder = "Review";
  let confidence = 0.44;
  let documentSignal: string | null = null;
  const reasons: string[] = [];

  if (
    includesAny(lowerName, [
      "wire",
      "ach",
      "journal",
      "standing payment",
      "money movement",
      "transfer",
    ])
  ) {
    documentLabel = "Money movement form";
    documentSubtype = null;
    documentTypeId = "money_movement_form";
    filenameLabel = "Money_Movement";
    topLevelFolder = "Money Movement";
    confidence = 0.82;
    documentSignal = "Filename matched money movement terms.";
    reasons.push("Filename suggests a transfer or standing payment workflow.");
  } else if (
    includesAny(lowerName, [
      "statement",
      "schwab",
      "fidelity",
      "pershing",
      "account",
      "custodian",
      "brokerage",
    ]) &&
    !hasStrongTaxDocumentSignal(lowerName)
  ) {
    documentLabel = "Account statement";
    documentSubtype = null;
    documentTypeId = "account_statement";
    filenameLabel = "Account_Statement";
    topLevelFolder = "Accounts";
    confidence = 0.8;
    documentSignal = "Filename matched account statement terms.";
    reasons.push("Filename points to an outside account or custody statement.");
  } else if (
    includesAny(lowerName, [
      "driver",
      "license",
      "passport",
      "social security",
      "client profile",
      "photo",
    ]) ||
    file.mimeType.startsWith("image/")
  ) {
    documentLabel = "Identity document";
    documentSubtype = null;
    documentTypeId = "identity_document";
    filenameLabel = "Client_ID";
    topLevelFolder = "Client Info";
    confidence = file.mimeType.startsWith("image/") ? 0.58 : 0.76;
    documentSignal = "Filename or image type matched identity-document terms.";
    reasons.push("This looks like an image or personal identity document.");
  } else if (
    includesAny(lowerName, [
      "tax",
      "tax return",
      "1040",
      "return",
      "1099",
      "1098",
      "w2",
      "w-2",
      "k-1",
      "extension",
      "estimated",
    ])
  ) {
    const taxSubtype = detectTaxDocumentSubtype(name, name);
    const specificTaxDocumentLabel = getTaxDocumentSubtypeLabel(taxSubtype);
    documentLabel = "Tax document";
    documentSubtype = taxSubtype;
    documentTypeId = "tax_document";
    filenameLabel = specificTaxDocumentLabel ?? "Tax_Document";
    topLevelFolder = "Tax";
    confidence = taxSubtype !== "unknown_tax_document" ? 0.76 : 0.75;
    documentSignal = specificTaxDocumentLabel
      ? `Filename matched tax-document text: ${specificTaxDocumentLabel}.`
      : "Filename matched tax-document terms.";
    reasons.push(
      specificTaxDocumentLabel
        ? `Filename suggests this is a ${specificTaxDocumentLabel} tax document.`
        : "Filename suggests a tax document.",
    );
  } else if (includesAny(lowerName, ["meeting", "plan", "notes", "advice"])) {
    documentLabel = "Planning / advice document";
    documentSubtype = null;
    documentTypeId = "planning_document";
    filenameLabel = "Planning_Document";
    topLevelFolder = "Planning";
    confidence = 0.72;
    reasons.push("Filename suggests a planning or advisory artifact.");
  } else if (file.mimeType === "application/pdf") {
    documentLabel = "General PDF";
    filenameLabel = "Document";
    topLevelFolder = "Review";
    confidence = 0.5;
    reasons.push("PDF detected, but the filename does not clearly reveal its type.");
  } else {
    reasons.push("The current metadata is not enough to classify this confidently.");
  }

  const detectedClient = detectClientFromFilename(name);
  const detectedClient2 = null;
  const ownershipType = detectOwnershipType(name, name, null, null);

  if (detectedClient) {
    confidence += 0.12;
    reasons.push(`Client name inferred from filename: ${detectedClient}.`);
  } else {
    confidence -= 0.12;
    reasons.push("No clear client name was found in the filename.");
  }

  for (const reason of options?.extraReasons ?? []) {
    reasons.push(reason);
  }

  return {
    textExcerpt: options?.metadataOnlyDiagnosticText?.slice(0, 260) ?? null,
    diagnosticText: options?.metadataOnlyDiagnosticText ?? null,
    pdfFields: [],
    detectedClient,
    detectedClient2,
    ownershipType,
    documentTypeId,
    documentLabel,
    documentSubtype,
    filenameLabel,
    topLevelFolder,
    confidence: Math.max(0.18, Math.min(0.96, confidence)),
    reasons,
    contentSource: "metadata_only",
    debug: {
      parserVersion: PARSER_VERSION,
      parserConflictSummary: null,
      documentSignal,
      statementClientSource: null,
      statementClientCandidate: null,
      aiModel: null,
      aiPromptVersion: null,
      aiRawSummary: null,
      aiRawDetectedClient: null,
      aiRawDetectedClient2: null,
      aiRawCustodian: null,
      aiRawAccountType: null,
      aiEnabled: false,
      aiAttempted: false,
      aiUsed: false,
      aiFailureReason: null,
      custodianWasNormalized: false,
      accountTypeWasNormalized: false,
      custodianNormalizationRule: null,
      accountTypeNormalizationRule: null,
      fieldOwnership: {},
      ownershipClientCandidate: null,
      accountContextCandidate: null,
      accountLooseCandidate: null,
      taxKeywordDetected: false,
      yearCandidates: [],
      downloadByteLength: options?.downloadFingerprint?.byteLength ?? null,
      downloadSha1: options?.downloadFingerprint?.sha1 ?? null,
      pdfFieldReaders: [],
      pdfExtractionAttempts: options?.pdfExtractionAttempts ?? [],
    },
    metadata: {
      accountLast4: detectLast4FromFilename(name),
      accountType: extractAccountType(name, name),
      custodian: extractCustodian(name, name),
      documentDate: extractDocumentDate(name),
      entityName: null,
      idType: extractIdType(name, name),
      taxYear: extractTaxYear(name, name),
    },
  } satisfies DocumentInsight;
}

function buildPdfMetadataOnlyDiagnostic(
  pdfExtractionAttempts: PdfExtractionAttempt[] = [],
) {
  const runtimeDetail = process.env.VERCEL
    ? "OCR is not available in this Vercel staging runtime, so scanned or image-only PDFs cannot be read yet."
    : "The local OCR fallback did not return usable text for this PDF.";
  const attemptSummary = formatPdfExtractionAttemptSummary(pdfExtractionAttempts);

  const lines = [
    "No selectable PDF text was extracted from this file.",
    runtimeDetail,
    "This preview is using the filename and Google Drive metadata only. If the PDF is scanned or image-based, fields like client, account type, and statement date may stay undetected until OCR is added for staging.",
  ];

  if (attemptSummary) {
    lines.push(`Extractor diagnostics: ${attemptSummary}`);
  }

  return lines.join("\n");
}

function formatPdfExtractionAttemptSummary(attempts: PdfExtractionAttempt[]) {
  return attempts
    .map((attempt) => {
      const metrics = [
        attempt.textLength !== null ? `${attempt.textLength} chars` : null,
        attempt.fieldCount !== null ? `${attempt.fieldCount} fields` : null,
      ].filter(Boolean);
      const suffix = [
        metrics.length ? `(${metrics.join(", ")})` : null,
        attempt.detail,
      ]
        .filter(Boolean)
        .join(" ");
      return suffix
        ? `${attempt.extractor}: ${attempt.status} ${suffix}`
        : `${attempt.extractor}: ${attempt.status}`;
    })
    .join("; ");
}

function describeDownloadedBuffer(buffer: Buffer): DownloadFingerprint {
  return {
    byteLength: buffer.byteLength,
    sha1: createHash("sha1").update(buffer).digest("hex"),
  };
}

function digitCount(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "").length;
}

function isAllZeroNumeric(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D/g, "");
  return Boolean(digits) && /^0+$/.test(digits);
}

function looksNumericPdfField(fieldName: string) {
  const lowerName = fieldName.toLowerCase();
  return (
    lowerName.includes("account") ||
    lowerName.includes("acct") ||
    lowerName.includes("number") ||
    lowerName.includes("routing") ||
    lowerName.includes("gnum")
  );
}

function choosePreferredPdfFieldValue(
  fieldName: string,
  existing: string | null | undefined,
  candidate: string | null | undefined,
  preferCandidate = false,
) {
  const normalizedExisting = normalizeWhitespace(existing ?? "");
  const normalizedCandidate = normalizeWhitespace(candidate ?? "");

  if (!normalizedCandidate) {
    return normalizedExisting || null;
  }

  if (!normalizedExisting) {
    return normalizedCandidate;
  }

  if (
    preferCandidate &&
    looksNumericPdfField(fieldName) &&
    normalizedExisting !== normalizedCandidate
  ) {
    return normalizedCandidate;
  }

  if (looksNumericPdfField(fieldName)) {
    const existingIsZero = isAllZeroNumeric(normalizedExisting);
    const candidateIsZero = isAllZeroNumeric(normalizedCandidate);

    if (existingIsZero && !candidateIsZero) {
      return normalizedCandidate;
    }

    if (candidateIsZero && !existingIsZero) {
      return normalizedExisting;
    }

    const existingDigits = digitCount(normalizedExisting);
    const candidateDigits = digitCount(normalizedCandidate);

    if (candidateDigits > existingDigits) {
      return normalizedCandidate;
    }

    if (existingDigits > candidateDigits) {
      return normalizedExisting;
    }
  }

  if (normalizedCandidate.length > normalizedExisting.length) {
    return normalizedCandidate;
  }

  return normalizedExisting;
}

function mergePdfFieldMaps(
  baseFields: Record<string, string>,
  supplementalFields: Record<string, string>,
  preferSupplementalOnNumericConflicts = false,
) {
  const merged = { ...baseFields };

  for (const [fieldName, value] of Object.entries(supplementalFields)) {
    const preferred = choosePreferredPdfFieldValue(
      fieldName,
      merged[fieldName],
      value,
      preferSupplementalOnNumericConflicts,
    );

    if (preferred) {
      merged[fieldName] = preferred;
    }
  }

  return merged;
}

function summarizeParserConflicts(
  primaryFields: Record<string, string>,
  supplementalFields: Record<string, string>,
) {
  const conflictingFields = Object.keys(supplementalFields)
    .filter((fieldName) => normalizeWhitespace(primaryFields[fieldName] ?? ""))
    .filter(
      (fieldName) =>
        normalizeWhitespace(primaryFields[fieldName] ?? "") !==
        normalizeWhitespace(supplementalFields[fieldName] ?? ""),
    );

  if (!conflictingFields.length) {
    return null;
  }

  const numericConflicts = conflictingFields.filter(looksNumericPdfField);
  const prioritizedFields = (numericConflicts.length ? numericConflicts : conflictingFields).slice(
    0,
    3,
  );

  return `${conflictingFields.length} field conflict${
    conflictingFields.length === 1 ? "" : "s"
  } between pypdf and PDFKit; using PDFKit for live widget values (${prioritizedFields.join(
    ", ",
  )}${conflictingFields.length > prioritizedFields.length ? ", ..." : ""}).`;
}

function extractClientNameFromText(text: string) {
  const ownershipCandidate = extractOwnershipClientCandidate(text);
  if (ownershipCandidate) {
    const [first, last] = ownershipCandidate.split(" ");
    if (isLikelyNamePart(first) && isLikelyNamePart(last)) {
      return `${toTitleCase(first)} ${toTitleCase(last)}`;
    }
  }

  const patterns = [
    /\brecipient(?:'s)? information\b.*?\bform 1099-da\b\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})\b/i,
    /\bform 1099-da\b\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})\s+\b(?:tax id number|[A-Z]\d{3,})/i,
    /\baccount owner(?:s)?[:\s]+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})/i,
    /\bclient name[:\s]+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})/i,
    /\bprimary owner[:\s]+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})/i,
    /\bowner name[:\s]+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})/i,
    /\bstatement for[:\s]+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})/i,
    /\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,2})\s+account summary\b/i,
    /\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,2})\s+portfolio summary\b/i,
    /\bname[:\s]+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) {
      continue;
    }

    const parts = match[1]
      .split(/\s+/)
      .map((part) => part.replace(/[^A-Za-z'-]/g, ""))
      .filter(Boolean);

    if (
      parts.length >= 2 &&
      isLikelyNamePart(parts[0]) &&
      isLikelyNamePart(parts[parts.length - 1])
    ) {
      return `${toTitleCase(parts[0])} ${toTitleCase(parts[parts.length - 1])}`;
    }
  }

  const scoredCandidate = findLikelyPersonName(text);
  if (scoredCandidate) {
    return scoredCandidate;
  }

  return null;
}

const NAME_STOPWORDS = new Set([
  "account",
  "accounts",
  "advisor",
  "allocation",
  "summary",
  "value",
  "values",
  "change",
  "beginning",
  "ending",
  "addition",
  "additions",
  "deposit",
  "deposits",
  "withdrawal",
  "withdrawals",
  "transaction",
  "transactions",
  "costs",
  "charges",
  "checking",
  "bill",
  "bank",
  "report",
  "statement",
  "statements",
  "portfolio",
  "investment",
  "nvestment",
  "fidelity",
  "schwab",
  "pershing",
  "transfer",
  "transferred",
  "electronic",
  "funds",
  "journal",
  "client",
  "owner",
  "date",
  "period",
  "page",
  "total",
  "ending",
  "opening",
  "balance",
  "market",
  "price",
  "gain",
  "loss",
  "return",
  "security",
  "securities",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "january",
  "february",
  "march",
  "april",
]);

function findLikelyPersonName(text: string) {
  const candidatePattern =
    /\b([A-Z][A-Za-z'-]{1,})(?:\s+([A-Z][A-Za-z'-]{1,}))(?:\s+([A-Z][A-Za-z'-]{1,}))?\b/g;
  let bestCandidate: { name: string; score: number } | null = null;

  for (const match of text.matchAll(candidatePattern)) {
    const index = match.index ?? 0;
    const parts = match
      .slice(1)
      .filter((value): value is string => Boolean(value))
      .map((part) => part.replace(/[^A-Za-z'-]/g, ""));

    if (parts.length < 2) {
      continue;
    }

    const first = parts[0];
    const last = parts[parts.length - 1];

    if (!isLikelyNamePart(first) || !isLikelyNamePart(last)) {
      continue;
    }

    const context = text
      .slice(Math.max(0, index - 60), Math.min(text.length, index + match[0].length + 60))
      .toLowerCase();
    let score = 1;

    if (
      includesAny(context, [
        "account owner",
        "owner name",
        "client name",
        "statement for",
        "account summary",
        "portfolio summary",
        "statement period",
        "investment report",
      ])
    ) {
      score += 2;
    }

    if (parts.length === 2) {
      score += 1;
    }

    if (!bestCandidate || score > bestCandidate.score) {
      bestCandidate = {
        name: `${toTitleCase(first)} ${toTitleCase(last)}`,
        score,
      };
    }
  }

  return bestCandidate && bestCandidate.score >= 2 ? bestCandidate.name : null;
}

function isLikelyNamePart(value: string) {
  const normalized = value.toLowerCase();
  return value.length >= 2 && !NAME_STOPWORDS.has(normalized);
}

function detectClientFromFilename(name: string) {
  const stem = name
    .replace(/\.[^.]+$/, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!stem) {
    return null;
  }

  const tokens = stem.split(" ");
  if (tokens.length < 2) {
    return null;
  }

  const firstTwo = tokens.slice(0, 2);
  const valid = firstTwo.every((token) => /^[A-Za-z]{2,}$/.test(token));
  if (!valid) {
    return null;
  }

  return `${toTitleCase(firstTwo[0])} ${toTitleCase(firstTwo[1])}`;
}

function extractCustodian(text: string, fallbackText: string) {
  const source = `${text} ${fallbackText}`.toLowerCase();
  if (source.includes("coinbase")) {
    return "Coinbase";
  }
  if (source.includes("fidelity")) {
    return "Fidelity";
  }
  if (source.includes("schwab")) {
    return "Schwab";
  }
  if (source.includes("pershing")) {
    return "Pershing";
  }
  if (source.includes("vanguard")) {
    return "Vanguard";
  }
  return null;
}

function isLikelyIdentityDocumentText(lowerText: string) {
  if (
    includesAny(lowerText, [
      "form 1099",
      "form 1040",
      "tax return",
      "taxpayer identification number",
      "irs",
      "qualified dividends",
      "capital gains",
    ])
  ) {
    return false;
  }

  return includesAny(lowerText, [
    "driver license",
    "driver's license",
    "passport",
    "date of birth",
    "social security card",
    "id card",
    "iss",
    "eyes",
    "class",
    "sex",
    "height",
    "weight",
    "expiration",
  ]);
}

function extractAccountType(
  text: string,
  fallbackText: string,
  fields?: Record<string, string>,
  documentTypeHint?: DocumentInsight["documentTypeId"],
): string | null {
  const fieldMatch = extractAccountTypeFromFields(fields ?? {});
  if (fieldMatch) {
    return fieldMatch;
  }

  const source = `${text} ${fallbackText}`.toLowerCase();
  const contextualPatterns: Array<[RegExp, string]> = [
    [
      /(?:account type|registration(?: type)?|account registration)\D{0,40}(roth ira|traditional ira|simple ira|sep ira|401\(k\)|403\(b\)|jtwros|joint brokerage|brokerage|trust account|cash management|transfer on death|tod|individual)\b/i,
      "",
    ],
    [
      /\b(roth ira|traditional ira|simple ira|sep ira|401\(k\)|403\(b\)|jtwros|joint brokerage|brokerage|trust account|cash management|transfer on death|tod|individual)\b\D{0,40}(?:account type|registration(?: type)?|account registration)/i,
      "",
    ],
  ];

  for (const [pattern] of contextualPatterns) {
    const match = source.match(pattern);
    const value = match?.[1];
    if (!value) {
      continue;
    }

    const normalized = normalizeDetectedAccountType(value);
    if (normalized) {
      return normalized;
    }
  }

  if (documentTypeHint === "account_statement") {
    const broadStatementPatterns: Array<[RegExp, string]> = [
      [/\broth ira\b/i, "Roth IRA"],
      [/\btraditional ira\b/i, "Traditional IRA"],
      [/\bsimple ira\b/i, "Simple IRA"],
      [/\bsep ira\b/i, "SEP IRA"],
      [/\b401\(k\)\b/i, "401(k)"],
      [/\b403\(b\)\b/i, "403(b)"],
      [/\bjtwros\b/i, "JTWROS"],
      [/\bjoint tenants?\s+with\s+rights?\s+of\s+survivorship\b/i, "JTWROS"],
      [/\bjoint brokerage\b/i, "Joint Brokerage"],
      [/\bbrokerage\b/i, "Brokerage"],
      [/\btrust account\b/i, "Trust Account"],
      [/\bcash management\b/i, "Cash Management"],
    ];

    for (const [pattern, label] of broadStatementPatterns) {
      if (pattern.test(source)) {
        return label;
      }
    }
  }

  const hasIndividual = /\bindividual\b/i.test(source);
  const hasTod =
    /\btransfer on death\b/i.test(source) || /\bt\.?o\.?d\.?\b/i.test(source);
  const hasBrokerage = /\bbrokerage\b/i.test(source);

  if (documentTypeHint !== "account_statement") {
    return null;
  }

  if (hasIndividual && hasTod) {
    return "Individual TOD";
  }

  if (hasIndividual && hasBrokerage) {
    return "Individual Brokerage";
  }

  if (hasTod && hasBrokerage) {
    return "TOD Brokerage";
  }

  if (hasTod) {
    return "TOD";
  }

  if (hasIndividual) {
    return "Individual";
  }

  return null;
}

function normalizeDetectedAccountType(value: string | null | undefined) {
  const normalized = (value ?? "").trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if (normalized === "roth ira") {
    return "Roth IRA";
  }
  if (normalized === "traditional ira") {
    return "Traditional IRA";
  }
  if (normalized === "simple ira") {
    return "Simple IRA";
  }
  if (normalized === "sep ira") {
    return "SEP IRA";
  }
  if (normalized === "401(k)") {
    return "401(k)";
  }
  if (normalized === "403(b)") {
    return "403(b)";
  }
  if (normalized === "jtwros") {
    return "JTWROS";
  }
  if (normalized === "joint brokerage") {
    return "Joint Brokerage";
  }
  if (normalized === "brokerage") {
    return "Brokerage";
  }
  if (normalized === "trust account") {
    return "Trust Account";
  }
  if (normalized === "cash management") {
    return "Cash Management";
  }
  if (normalized === "transfer on death" || normalized === "tod") {
    return "TOD";
  }
  if (normalized === "individual") {
    return "Individual";
  }

  return null;
}

function extractAccountLast4(
  text: string,
  fields: Record<string, string>,
): string | null {
  const fieldDigits = extractAccountLast4FromFields(fields);
  if (fieldDigits) {
    return fieldDigits;
  }

  const combined = text;
  const contextualDigits = extractContextualAccountNumberDigits(combined);
  if (contextualDigits) {
    return contextualDigits.slice(-4);
  }

  const looseDigits = extractLooseAccountNumberDigits(combined);
  if (looseDigits) {
    return looseDigits.slice(-4);
  }

  const patterns = [
    /\baccount(?:\s+number|\s+#)?[^\S\r\n]{0,8}(?:ending\s+in[^\S\r\n]+)?(?:x|#|\*{2,}|•{2,}|\.{2,}|[\s-])?(\d{4})\b/i,
    /\bending\s+in\s+(\d{4})\b/i,
    /\b(?:acct|account)\s*(?:no\.?|number|#)\s*[:\-]?[^\S\r\n]*(?:x|#|\*{2,}|•{2,}|\.{2,})?(\d{4})\b/i,
    /\b(?:x|#)(\d{4})\b/,
    /\b\*{2,}\s*(\d{4})\b/,
  ];

  for (const pattern of patterns) {
    const match = combined.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function extractAccountTypeFromFields(
  fields: Record<string, string>,
): string | null {
  for (const [key, value] of Object.entries(fields)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes("account type") ||
      lowerKey.includes("registration") ||
      lowerKey.includes("account registration") ||
      lowerKey.includes("type")
    ) {
      const direct = normalizeDetectedAccountType(value);
      if (direct) {
        return direct;
      }

      const match = extractAccountType(value, "");
      if (match) {
        return match;
      }
    }
  }

  for (const value of Object.values(fields)) {
    const direct = normalizeDetectedAccountType(value);
    if (direct) {
      return direct;
    }

    const match = extractAccountType(value, "");
    if (match) {
      return match;
    }
  }

  return null;
}

function extractAccountLast4FromFields(
  fields: Record<string, string>,
): string | null {
  const candidates: string[] = [];

  for (const [key, value] of Object.entries(fields)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes("account") ||
      lowerKey.includes("acct") ||
      lowerKey.includes("number")
    ) {
      const directDigits = value.replace(/\D/g, "");
      if (directDigits.length >= 4) {
        const last4 = directDigits.slice(-4);
        if (!isAllZeroLast4(last4)) {
          candidates.push(last4);
        }
        continue;
      }

      const contextualDigits = extractContextualAccountNumberDigits(value);
      if (contextualDigits) {
        const last4 = contextualDigits.slice(-4);
        if (!isAllZeroLast4(last4)) {
          candidates.push(last4);
        }
        continue;
      }

      const looseDigits = extractLooseAccountNumberDigits(value);
      if (looseDigits) {
        const last4 = looseDigits.slice(-4);
        if (!isAllZeroLast4(last4)) {
          candidates.push(last4);
        }
      }
    }
  }

  return Array.from(new Set(candidates))[0] ?? null;
}

function formatPdfFieldsForDiagnostics(
  fields: Record<string, string>,
  rawEntries?: Array<{ name: string; value: string }>,
): Array<{ name: string; value: string }> {
  if (rawEntries?.length) {
    return rawEntries
      .map((entry) => ({
        name: normalizeWhitespace(entry.name).slice(0, 160),
        value: normalizeWhitespace(entry.value).slice(0, 240),
      }))
      .filter((entry) => entry.name && entry.value);
  }

  const entries = Object.entries(fields)
    .map(([name, value]) => ({
      name: normalizeWhitespace(name).slice(0, 120),
      value: normalizeWhitespace(value).slice(0, 240),
    }))
    .filter((entry) => entry.name && entry.value);

  const priority = (value: string) => {
    const lowerValue = value.toLowerCase();

    if (
      lowerValue.includes("owner") ||
      lowerValue.includes("account name") ||
      lowerValue.includes("account owner")
    ) {
      return 0;
    }

    if (
      lowerValue.includes("account") ||
      lowerValue.includes("number") ||
      lowerValue.includes("registration")
    ) {
      return 1;
    }

    return 2;
  };

  return entries
    .sort((left, right) => {
      const priorityDelta = priority(left.name) - priority(right.name);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      return left.name.localeCompare(right.name);
    })
    .slice(0, 20);
}

function detectLast4FromFilename(name: string) {
  const match = name.match(/[xX](\d{4})\b/);
  return match?.[1] ?? null;
}

function extractOwnershipClientCandidate(text: string) {
  const ownershipMatch = text.match(
    /\b([A-Z][A-Za-z.'-]+)\s+([A-Z][A-Za-z.'-]+)\s*-\s*(?:individual|joint|trust|brokerage|t\.?o\.?d\.?|transfer on death|roth ira|traditional ira|simple ira|sep ira)\b/i,
  );
  if (!ownershipMatch?.[1] || !ownershipMatch?.[2]) {
    return null;
  }

  const first = ownershipMatch[1].replace(/[^A-Za-z'-]/g, "");
  const last = ownershipMatch[2].replace(/[^A-Za-z'-]/g, "");

  if (!first || !last) {
    return null;
  }

  return `${first} ${last}`;
}

function extractJointClientNames(text: string) {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const ownerLabelMatch = line.match(
      /^(?:account owners?|owners?|joint owners?)\s*[:\-]?\s*(.*)$/i,
    );
    if (!ownerLabelMatch) {
      continue;
    }

    const labeledValue = ownerLabelMatch[1] || lines[index + 1] || "";
    const parsed = parseJointOwnerValue(labeledValue);
    if (parsed) {
      return parsed;
    }
  }

  for (const line of lines) {
    if (
      !/\b(?:JTWROS|JOINT|JOINT TENANTS?\s+WITH\s+RIGHTS?\s+OF\s+SURVIVORSHIP|T\.?O\.?D\.?|TRANSFER ON DEATH)\b/i.test(
        line,
      )
    ) {
      continue;
    }

    const parsed = parseJointOwnerValue(line);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function parseJointOwnerValue(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return null;
  }

  const withoutOwnerLabel = cleaned.replace(
    /^(?:account owners?|owners?|joint owners?)\s*[:\-]?\s*/i,
    "",
  );
  const withoutJointMarker = withoutOwnerLabel.replace(
    /\s*(?:-|–|—)?\s*(?:JTWROS|JOINT|JOINT TENANTS?\s+WITH\s+RIGHTS?\s+OF\s+SURVIVORSHIP|T\.?O\.?D\.?|TRANSFER ON DEATH)\b.*$/i,
    "",
  );
  const segments = withoutJointMarker
    .split(/\s*(?:&|\/|\band\b|,)\s*/i)
    .map((segment) => normalizeJointOwnerNameSegment(segment))
    .filter(
      (
        segment,
      ): segment is { formatted: string; tokenCount: number; lastName: string | null } =>
        segment !== null,
    );

  if (segments.length !== 2) {
    return null;
  }

  const [primary, secondary] = segments;

  if (primary.tokenCount >= 2 && secondary.tokenCount >= 2) {
    return {
      primary: primary.formatted,
      secondary: secondary.formatted,
    };
  }

  if (primary.tokenCount === 1 && secondary.tokenCount >= 2 && secondary.lastName) {
    return {
      primary: `${primary.formatted} ${secondary.lastName}`,
      secondary: secondary.formatted,
    };
  }

  if (secondary.tokenCount === 1 && primary.tokenCount >= 2 && primary.lastName) {
    return {
      primary: primary.formatted,
      secondary: `${secondary.formatted} ${primary.lastName}`,
    };
  }

  return null;
}

function normalizeJointOwnerNameSegment(value: string) {
  const tokens = value
    .split(/\s+/)
    .map((token) => token.replace(/[^A-Za-z'-]/g, ""))
    .filter(Boolean);

  if (tokens.length < 1 || tokens.length > 4) {
    return null;
  }

  return {
    formatted: tokens
      .map((token) => (token.length === 1 ? token.toUpperCase() : toTitleCase(token)))
      .join(" "),
    tokenCount: tokens.length,
    lastName: tokens.length >= 2 ? toTitleCase(tokens[tokens.length - 1] ?? "") : null,
  };
}

function detectOwnershipType(
  text: string,
  fallbackText: string,
  jointClients: { primary: string; secondary: string } | null,
  accountType: string | null,
) {
  if (jointClients) {
    return "joint" as const;
  }

  const source = `${text} ${fallbackText} ${accountType ?? ""}`.toLowerCase();

  if (
    /\bjtwros\b/i.test(source) ||
    /\bjoint\b/i.test(source) ||
    /\bjoint tenants?\s+with\s+rights?\s+of\s+survivorship\b/i.test(source)
  ) {
    return "joint" as const;
  }

  return "single" as const;
}

function hasMeaningfulSecondaryClient(
  primaryClient: string | null,
  secondaryClient: string | null,
) {
  const primary = normalizeWhitespace(primaryClient ?? "");
  const secondary = normalizeWhitespace(secondaryClient ?? "");

  if (!secondary) {
    return false;
  }

  const secondaryParts = secondary.split(" ").filter(Boolean);
  if (secondaryParts.length < 2) {
    return false;
  }

  if (primary && secondary.toLowerCase() === primary.toLowerCase()) {
    return false;
  }

  return secondaryParts.every((part) => /[A-Za-z]/.test(part));
}

function extractContextualAccountNumberDigits(text: string) {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!/\b(?:acct|account)\s*(?:no\.?|number|#)\b/i.test(line)) {
      continue;
    }

    const inlineMatch = line.match(
      /\b(?:acct|account)\s*(?:no\.?|number|#)\s*[:\-]?[^\S\r\n]*(?:ending\s+in[^\S\r\n]+)?(?:x|#|\*{2,}|•{2,}|\.{2,}|[\s-])?(\d[\d xX#*•.\-]{3,})\b/i,
    );
    if (inlineMatch?.[1]) {
      const digits = inlineMatch[1].replace(/\D/g, "");
      if (digits.length >= 4) {
        return digits;
      }
    }

    const nextLine = lines[index + 1] ?? "";
    if (/^(?:[xX#*•.\-\s]*\d){4,}$/.test(nextLine)) {
      const digits = nextLine.replace(/\D/g, "");
      if (digits.length >= 4) {
        return digits;
      }
    }
  }

  return null;
}

function extractLooseAccountNumberDigits(text: string) {
  const explicitPatterns = [
    /\bending\s+in\s+(\d{4})\b/i,
    /\b(?:x|#)(\d{4})\b/,
    /\b\*{2,}\s*(\d{4})\b/,
  ];

  for (const pattern of explicitPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function isAllZeroLast4(value: string | null | undefined) {
  return typeof value === "string" && /^0{4}$/.test(value);
}


function extractTaxYear(text: string, fallbackText: string) {
  const source = `${text} ${fallbackText}`;
  if (
    !(
      /\btax return\b/i.test(source) ||
      /\b1099\b/i.test(source) ||
      /\bw-?2\b/i.test(source) ||
      /\b1040\b/i.test(source) ||
      /\birs\b/i.test(source) ||
      /\btaxpayer\b/i.test(source) ||
      /\bform\s+1040\b/i.test(source)
    )
  ) {
    return null;
  }

  const matches = [...source.matchAll(/\b(20\d{2})\b/g)].map((match) => match[1]);
  if (!matches.length) {
    return null;
  }

  const sorted = matches
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => value >= 2000 && value <= 2099)
    .sort((left, right) => right - left);

  return sorted[0] ? String(sorted[0]) : null;
}

function extractIdType(text: string, fallbackText: string) {
  const source = `${text} ${fallbackText}`.toLowerCase();
  if (source.includes("driver") && source.includes("license")) {
    return "Driver License";
  }
  if (source.includes("passport")) {
    return "Passport";
  }
  if (source.includes("social security")) {
    return "Social Security Card";
  }
  return null;
}

function extractEntityName(text: string) {
  const labeledMatch = text.match(
    /\b(?:entity|trust|legal|business)\s+name[:\s]+([A-Z][A-Za-z&.'-]+(?:\s+[A-Z][A-Za-z&.'-]+){0,5}\s+(?:Trust|LLC|Inc|Corp|Corporation|Family Trust))\b/i,
  );
  if (labeledMatch?.[1]) {
    return labeledMatch[1].trim();
  }

  const match = text.match(
    /\b([A-Z][A-Za-z&.'-]+(?:\s+[A-Z][A-Za-z&.'-]+){0,5}\s+(?:Trust|LLC|Family Trust))\b/,
  );
  if (!match?.[1]) {
    return null;
  }

  const context = text
    .slice(Math.max(0, (match.index ?? 0) - 40), Math.min(text.length, (match.index ?? 0) + match[0].length + 40))
    .toLowerCase();

  if (includesAny(context, ["top holdings", "description", "income summary"])) {
    return null;
  }

  return match[1].trim();
}

function extractDocumentDate(text: string) {
  const isoMatch = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoMatch?.[1]) {
    return isoMatch[1];
  }

  const longMatch = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2})\b/i,
  );
  if (longMatch) {
    const date = new Date(`${longMatch[1]} ${longMatch[2]}, ${longMatch[3]}`);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString().slice(0, 10);
    }
  }

  return null;
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function includesAny(value: string, keywords: string[]) {
  return keywords.some((keyword) => value.includes(keyword));
}

function hasStrongTaxDocumentSignal(value: string) {
  return (
    /\bform\s+1040\b/i.test(value) ||
    /\b1040x\b/i.test(value) ||
    /\b1099(?:[-\s]?[a-z]+)?\b/i.test(value) ||
    /\b1098\b/i.test(value) ||
    /\bw[-\s]?2\b/i.test(value) ||
    /\bk[-\s]?1\b/i.test(value) ||
    /\bschedule\s+k[-\s]?1\b/i.test(value) ||
    /\btaxpayer\b/i.test(value)
  );
}

function toTitleCase(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1).toLowerCase();
}
