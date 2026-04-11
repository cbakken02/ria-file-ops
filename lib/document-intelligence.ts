import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GoogleDriveFile } from "@/lib/google-drive";

export type DocumentInsight = {
  documentTypeId:
    | "default"
    | "account_statement"
    | "money_movement_form"
    | "tax_return"
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
  filenameLabel: string;
  topLevelFolder: string;
  confidence: number;
  reasons: string[];
  contentSource: "pdf_text" | "pdf_ocr" | "image_ocr" | "metadata_only";
  debug: {
    parserVersion: string;
    parserConflictSummary: string | null;
    ownershipClientCandidate: string | null;
    accountContextCandidate: string | null;
    accountLooseCandidate: string | null;
    taxKeywordDetected: boolean;
    yearCandidates: string[];
    downloadByteLength: number | null;
    downloadSha1: string | null;
    pdfFieldReaders: string[];
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

const execFileAsync = promisify(execFile);
const PARSER_VERSION = "2026-04-09-parser-debug-8";

type DownloadFingerprint = {
  byteLength: number;
  sha1: string;
};

export async function analyzeDocument(
  file: GoogleDriveFile,
  getFileBuffer: () => Promise<Buffer>,
) {
  if (file.mimeType === "application/pdf") {
    const buffer = await getFileBuffer();
    const fingerprint = describeDownloadedBuffer(buffer);

    try {
      const extraction = await extractPdfData(buffer);
      if (hasUsefulText(extraction.text) || Object.keys(extraction.fields).length > 0) {
        const baseInsight = analyzeTextContent(
          file,
          extraction.text,
          extraction.fields,
          "pdf_text",
          extraction.fieldEntries,
          extraction.fieldReaders,
          fingerprint,
          extraction.parserConflictSummary,
        );

        if (shouldSupplementPdfInsight(baseInsight, extraction.fields)) {
          try {
            const ocrText = await extractVisualText(buffer, "pdf");
            if (hasUsefulText(ocrText)) {
              const mergedInsight = analyzeTextContent(
                file,
                `${extraction.text}\n${ocrText}`,
                extraction.fields,
                "pdf_text",
                extraction.fieldEntries,
                extraction.fieldReaders,
                fingerprint,
                extraction.parserConflictSummary,
              );

              return preferSupplementedPdfInsight(baseInsight, mergedInsight);
            }
          } catch {
            // Keep the base PDF insight if supplemental OCR fails.
          }
        }

        return baseInsight;
      }
    } catch {
      // Fall through to OCR.
    }

    try {
      const ocrText = await extractVisualText(buffer, "pdf");
      if (hasUsefulText(ocrText)) {
        return analyzeTextContent(file, ocrText, {}, "pdf_ocr", [], [], fingerprint);
      }
    } catch {
      // Fall through to metadata.
    }

    return analyzeFromMetadata(file, {
      downloadFingerprint: fingerprint,
      extraReasons: [
        "PDF text extraction and OCR did not return enough usable content, so this file fell back to metadata-only classification.",
      ],
    });
  }

  if (file.mimeType.startsWith("image/")) {
    const buffer = await getFileBuffer();
    const fingerprint = describeDownloadedBuffer(buffer);
    try {
      const ocrText = await extractVisualText(buffer, "image");
      if (hasUsefulText(ocrText)) {
        return analyzeTextContent(file, ocrText, {}, "image_ocr", [], [], fingerprint);
      }
    } catch {
      // Fall through to metadata.
    }

    return analyzeFromMetadata(file, {
      downloadFingerprint: fingerprint,
      extraReasons: [
        "Image OCR did not return enough usable text, so this item is still using metadata only.",
      ],
    });
  }

  return analyzeFromMetadata(file, {
    extraReasons: [
      "The current pipeline only performs OCR on images and PDFs, so this item is still using metadata only.",
    ],
  });
}

async function extractPdfData(buffer: Buffer) {
  const tempPath = path.join(os.tmpdir(), `ria-file-ops-${crypto.randomUUID()}.pdf`);
  await fs.writeFile(tempPath, buffer);

  try {
    let text = "";
    let fields: Record<string, string> = {};
    let fieldEntries: Array<{ name: string; value: string }> = [];
    const fieldReaders: string[] = [];
    let parserConflictSummary: string | null = null;
    let pythonError: Error | null = null;
    let pythonFields: Record<string, string> = {};

    try {
      const pythonExtraction = await extractPdfDataWithPyPdf(tempPath);
      text = pythonExtraction.text;
      fields = pythonExtraction.fields;
      pythonFields = pythonExtraction.fields;
      fieldEntries = pythonExtraction.fieldEntries;
      fieldReaders.push("pypdf");
    } catch (error) {
      pythonError =
        error instanceof Error
          ? error
          : new Error("Python PDF extraction failed unexpectedly.");
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
    } catch {
      // Keep the primary parser result if PDFKit fallback is unavailable.
    }

    if (pythonError && fieldReaders.length === 0) {
      throw pythonError;
    }

    return {
      text,
      fields,
      fieldEntries,
      fieldReaders,
      parserConflictSummary,
    };
  } finally {
    await fs.unlink(tempPath).catch(() => {});
  }
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

function analyzeTextContent(
  file: GoogleDriveFile,
  text: string,
  fields: Record<string, string>,
  contentSource: DocumentInsight["contentSource"],
  diagnosticFieldEntries?: Array<{ name: string; value: string }>,
  pdfFieldReaders: string[] = [],
  downloadFingerprint?: DownloadFingerprint | null,
  parserConflictSummary: string | null = null,
) {
  const metadataFallback = analyzeFromMetadata(file, {
    downloadFingerprint,
  });
  const rawText = text ?? "";
  const combinedFieldText = Object.entries(fields)
    .map(([key, value]) => `${key} ${value}`)
    .join(" ");
  const normalizedText = normalizeWhitespace(`${rawText} ${combinedFieldText}`);
  const pdfFields = formatPdfFieldsForDiagnostics(fields, diagnosticFieldEntries);
  const lowerText = normalizedText.toLowerCase();
  const reasons = [...metadataFallback.reasons];
  const textExcerpt = normalizedText.slice(0, 260) || null;
  const diagnosticText = normalizedText.slice(0, 12000) || null;
  const ownershipClientCandidate = extractOwnershipClientCandidate(normalizedText);
  const accountContextCandidate = extractContextualAccountNumberDigits(rawText);
  const accountLooseCandidate = extractLooseAccountNumberDigits(rawText);
  const yearCandidates = [...normalizedText.matchAll(/\b(20\d{2})\b/g)].map(
    (match) => match[1],
  );
  const taxKeywordDetected =
    /\btax return\b/i.test(normalizedText) ||
    /\b1099\b/i.test(normalizedText) ||
    /\bw-?2\b/i.test(normalizedText) ||
    /\b1040\b/i.test(normalizedText) ||
    /\birs\b/i.test(normalizedText) ||
    /\btaxpayer\b/i.test(normalizedText) ||
    /\bform\s+1040\b/i.test(normalizedText);

  if (contentSource === "pdf_ocr") {
    reasons.unshift("OCR was used because the PDF appears to be scanned or image-based.");
  }

  if (contentSource === "image_ocr") {
    reasons.unshift("Text was read directly from image OCR.");
  }

  const jointClientsFromFields = extractJointClientNamesFromFields(fields);
  let detectedClient = extractClientNameFromFields(fields);
  const jointClients = jointClientsFromFields ?? extractJointClientNames(normalizedText);
  if (jointClients) {
    detectedClient = jointClients.primary;
  }
  if (!detectedClient) {
    detectedClient = extractClientNameFromText(normalizedText);
  }
  if (!detectedClient) {
    detectedClient = metadataFallback.detectedClient;
  }
  const detectedClient2 = jointClients?.secondary ?? metadataFallback.detectedClient2;

  let documentLabel = metadataFallback.documentLabel;
  let documentTypeId = metadataFallback.documentTypeId;
  let filenameLabel = metadataFallback.filenameLabel;
  let topLevelFolder = metadataFallback.topLevelFolder;
  let confidence = Math.max(metadataFallback.confidence, 0.58);
  if (
    includesAny(lowerText, [
      "standing payment",
      "wire instructions",
      "money movement",
      "electronic funds transfer",
      "journal request",
      "ach authorization",
    ])
  ) {
    documentLabel = "Money movement form";
    documentTypeId = "money_movement_form";
    filenameLabel = "Money_Movement";
    topLevelFolder = "Money Movement";
    confidence = 0.88;
    reasons.unshift("Actual document text suggests this is a money movement or transfer form.");
  } else if (
    includesAny(lowerText, [
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
    ])
  ) {
    documentLabel = "Account statement";
    documentTypeId = "account_statement";
    filenameLabel = "Account_Statement";
    topLevelFolder = "Accounts";
    confidence = 0.85;
    reasons.unshift("Actual document text suggests this is an account statement.");
  } else if (
    includesAny(lowerText, [
      "driver license",
      "driver's license",
      "passport",
      "date of birth",
      "social security",
      "identification",
      "iss",
      "eyes",
      "class",
    ])
  ) {
    documentLabel = "Identity document";
    documentTypeId = "identity_document";
    filenameLabel = "Client_ID";
    topLevelFolder = "Client Info";
    confidence = 0.82;
    reasons.unshift("Actual document text suggests this is a personal identity or client document.");
  } else if (includesAny(lowerText, ["tax return", "form 1040", "u.s. individual income tax return"])) {
    documentLabel = "Tax return";
    documentTypeId = "tax_return";
    filenameLabel = "Tax_Return";
    topLevelFolder = "Planning";
    confidence = 0.84;
    reasons.unshift("Actual document text suggests this is a tax return.");
  } else if (
    includesAny(lowerText, [
      "tax",
      "1099",
      "w-2",
      "w2",
      "taxpayer",
      "capital gains",
      "qualified dividends",
    ])
  ) {
    documentLabel = "Tax document";
    documentTypeId = "tax_document";
    filenameLabel = "Tax_Document";
    topLevelFolder = "Planning";
    confidence = 0.8;
    reasons.unshift("Actual document text suggests this is a tax document.");
  } else if (
    includesAny(lowerText, [
      "meeting notes",
      "financial plan",
      "retirement analysis",
      "recommendation",
      "action items",
    ])
  ) {
    documentLabel = "Planning / advice document";
    documentTypeId = "planning_document";
    filenameLabel = "Planning_Document";
    topLevelFolder = "Planning";
    confidence = 0.78;
    reasons.unshift("Actual document text suggests this is a planning or advice document.");
  } else {
    reasons.unshift("Document text was read, but the document type is still somewhat ambiguous.");
  }

  const custodian =
    extractCustodian(normalizedText, file.name) ?? metadataFallback.metadata.custodian;
  const accountType =
    extractAccountType(normalizedText, file.name, fields, documentTypeId) ??
    metadataFallback.metadata.accountType;
  const accountLast4 =
    extractAccountLast4(rawText, fields) ?? metadataFallback.metadata.accountLast4;
  let taxYear =
    extractTaxYear(normalizedText, file.name) ?? metadataFallback.metadata.taxYear;
  const idType =
    extractIdType(normalizedText, file.name) ?? metadataFallback.metadata.idType;
  let entityName =
    extractEntityName(normalizedText) ?? metadataFallback.metadata.entityName;
  const ownershipType = detectOwnershipType(
    normalizedText,
    file.name,
    jointClients,
    accountType,
  );

  if (documentTypeId !== "tax_return" && documentTypeId !== "tax_document") {
    taxYear = null;
  }

  const isLegalLikeDocument =
    documentLabel === "Legal / estate document" ||
    includesAny(lowerText, ["trust", "llc", "estate", "will"]);

  if (!isLegalLikeDocument) {
    entityName = null;
  }

  if (detectedClient) {
    confidence = Math.min(0.95, confidence + 0.08);
    reasons.push(`Client name inferred from document content: ${detectedClient}.`);
  }

  return {
    textExcerpt,
    diagnosticText,
    pdfFields,
    detectedClient,
    detectedClient2,
    ownershipType,
    documentTypeId,
    documentLabel,
    filenameLabel,
    topLevelFolder,
    confidence,
    reasons,
    contentSource,
    debug: {
      parserVersion: PARSER_VERSION,
      parserConflictSummary,
      ownershipClientCandidate,
      accountContextCandidate,
      accountLooseCandidate,
      taxKeywordDetected,
      yearCandidates,
      downloadByteLength: downloadFingerprint?.byteLength ?? null,
      downloadSha1: downloadFingerprint?.sha1 ?? null,
      pdfFieldReaders,
    },
    metadata: {
      accountLast4,
      accountType,
      custodian,
      documentDate: extractDocumentDate(normalizedText),
      entityName,
      idType,
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
  },
) {
  const name = file.name;
  const lowerName = name.toLowerCase();
  let documentLabel = "Needs inspection";
  let documentTypeId: DocumentInsight["documentTypeId"] = "default";
  let filenameLabel = "Review_Item";
  let topLevelFolder = "Review";
  let confidence = 0.44;
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
    documentTypeId = "money_movement_form";
    filenameLabel = "Money_Movement";
    topLevelFolder = "Money Movement";
    confidence = 0.82;
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
    ])
  ) {
    documentLabel = "Account statement";
    documentTypeId = "account_statement";
    filenameLabel = "Account_Statement";
    topLevelFolder = "Accounts";
    confidence = 0.8;
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
    documentTypeId = "identity_document";
    filenameLabel = "Client_ID";
    topLevelFolder = "Client Info";
    confidence = file.mimeType.startsWith("image/") ? 0.58 : 0.76;
    reasons.push("This looks like an image or personal identity document.");
  } else if (includesAny(lowerName, ["tax return", "1040", "return"])) {
    documentLabel = "Tax return";
    documentTypeId = "tax_return";
    filenameLabel = "Tax_Return";
    topLevelFolder = "Planning";
    confidence = 0.76;
    reasons.push("Filename suggests a tax return.");
  } else if (includesAny(lowerName, ["tax", "1099", "w2", "w-2"])) {
    documentLabel = "Tax document";
    documentTypeId = "tax_document";
    filenameLabel = "Tax_Document";
    topLevelFolder = "Planning";
    confidence = 0.75;
    reasons.push("Filename suggests a tax document.");
  } else if (includesAny(lowerName, ["meeting", "plan", "notes", "advice"])) {
    documentLabel = "Planning / advice document";
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
    textExcerpt: null,
    diagnosticText: null,
    pdfFields: [],
    detectedClient,
    detectedClient2,
    ownershipType,
    documentTypeId,
    documentLabel,
    filenameLabel,
    topLevelFolder,
    confidence: Math.max(0.18, Math.min(0.96, confidence)),
    reasons,
    contentSource: "metadata_only",
    debug: {
      parserVersion: PARSER_VERSION,
      parserConflictSummary: null,
      ownershipClientCandidate: null,
      accountContextCandidate: null,
      accountLooseCandidate: null,
      taxKeywordDetected: false,
      yearCandidates: [],
      downloadByteLength: options?.downloadFingerprint?.byteLength ?? null,
      downloadSha1: options?.downloadFingerprint?.sha1 ?? null,
      pdfFieldReaders: [],
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
  const fullPairMatch = text.match(
    /\b([A-Z][A-Za-z.'-]+)\s+([A-Z][A-Za-z.'-]+)\s*(?:&|AND|\/)\s*([A-Z][A-Za-z.'-]+)\s+([A-Z][A-Za-z.'-]+)\s*(?:-|–|—)?\s*(?:JTWROS|JOINT|JOINT TENANTS?\s+WITH\s+RIGHTS?\s+OF\s+SURVIVORSHIP|T\.?O\.?D\.?|TRANSFER ON DEATH)\b/i,
  );
  if (fullPairMatch) {
    const primaryFirst = fullPairMatch[1]?.replace(/[^A-Za-z'-]/g, "");
    const primaryLast = fullPairMatch[2]?.replace(/[^A-Za-z'-]/g, "");
    const secondaryFirst = fullPairMatch[3]?.replace(/[^A-Za-z'-]/g, "");
    const secondaryLast = fullPairMatch[4]?.replace(/[^A-Za-z'-]/g, "");

    if (primaryFirst && primaryLast && secondaryFirst && secondaryLast) {
      return {
        primary: `${toTitleCase(primaryFirst)} ${toTitleCase(primaryLast)}`,
        secondary: `${toTitleCase(secondaryFirst)} ${toTitleCase(secondaryLast)}`,
      };
    }
  }

  const sharedLastMatch = text.match(
    /\b([A-Z][A-Za-z.'-]+)\s*(?:&|AND|\/)\s*([A-Z][A-Za-z.'-]+)\s+([A-Z][A-Za-z.'-]+)\s*(?:-|–|—)?\s*(?:JTWROS|JOINT|JOINT TENANTS?\s+WITH\s+RIGHTS?\s+OF\s+SURVIVORSHIP|T\.?O\.?D\.?|TRANSFER ON DEATH)\b/i,
  );
  if (sharedLastMatch) {
    const primaryFirst = sharedLastMatch[1]?.replace(/[^A-Za-z'-]/g, "");
    const secondaryFirst = sharedLastMatch[2]?.replace(/[^A-Za-z'-]/g, "");
    const sharedLast = sharedLastMatch[3]?.replace(/[^A-Za-z'-]/g, "");

    if (primaryFirst && secondaryFirst && sharedLast) {
      return {
        primary: `${toTitleCase(primaryFirst)} ${toTitleCase(sharedLast)}`,
        secondary: `${toTitleCase(secondaryFirst)} ${toTitleCase(sharedLast)}`,
      };
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

  const fullPairMatch = cleaned.match(
    /^([A-Za-z.'-]+)\s+([A-Za-z.'-]+)\s*(?:,|&|and|\/)\s*([A-Za-z.'-]+)\s+([A-Za-z.'-]+)$/i,
  );
  if (fullPairMatch) {
    return {
      primary: `${toTitleCase(fullPairMatch[1])} ${toTitleCase(fullPairMatch[2])}`,
      secondary: `${toTitleCase(fullPairMatch[3])} ${toTitleCase(fullPairMatch[4])}`,
    };
  }

  const sharedLastMatch = cleaned.match(
    /^([A-Za-z.'-]+)\s*(?:,|&|and|\/)\s*([A-Za-z.'-]+)\s+([A-Za-z.'-]+)$/i,
  );
  if (sharedLastMatch) {
    return {
      primary: `${toTitleCase(sharedLastMatch[1])} ${toTitleCase(sharedLastMatch[3])}`,
      secondary: `${toTitleCase(sharedLastMatch[2])} ${toTitleCase(sharedLastMatch[3])}`,
    };
  }

  return null;
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

function toTitleCase(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1).toLowerCase();
}
