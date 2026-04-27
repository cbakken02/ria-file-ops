import assert from "node:assert/strict";
import test from "node:test";

import { setAIPrimaryCompletionAdapterForTests } from "../lib/ai-primary-parser.ts";
import { analyzeDocumentWithEnvelope } from "../lib/document-intelligence.ts";

function withEnv(overrides) {
  const previous = new Map();

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

function buildTextPdfBuffer(text) {
  const stream = `BT /F1 12 Tf 72 720 Td (${escapePdfText(text)}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets[index + 1] = Buffer.byteLength(body, "latin1");
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    body += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(body, "latin1");
}

function escapePdfText(text) {
  return text.replace(/[\\()]/g, (match) => `\\${match}`);
}

function buildPdfFile(buffer, name = "Christopher Bakken Statement.pdf") {
  return {
    id: `test-${name}`,
    name,
    mimeType: "application/pdf",
    modifiedTime: "2026-04-26T12:00:00.000Z",
    size: String(buffer.byteLength),
  };
}

test("Vercel PDF extraction uses direct pdfjs text before native fallbacks", async () => {
  const restoreEnv = withEnv({ VERCEL: "1" });
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const originalDomMatrix = globalThis.DOMMatrix;
  const originalPdfJsWorker = globalThis.pdfjsWorker;
  const originalWorkerSrc = pdfjs.GlobalWorkerOptions.workerSrc;
  delete globalThis.DOMMatrix;
  delete globalThis.pdfjsWorker;
  pdfjs.GlobalWorkerOptions.workerSrc = "./missing-pdf-worker.mjs";
  const buffer = buildTextPdfBuffer(
    "Account Statement U.S. Bank CHRISTOPHER T BAKKEN Checking account ending in 6642 Statement date 2026-04-12 ending balance 1234.56",
  );
  setAIPrimaryCompletionAdapterForTests(async () => ({
    model: "test-model",
    rawText: JSON.stringify({
      documentTypeId: "account_statement",
      detectedClient: "Christopher T Bakken",
      detectedClient2: null,
      ownershipType: "single",
      metadata: {
        custodian: "U.S. Bank National Association",
        accountType: "Checking",
        accountLast4: "6642",
        documentDate: "2026-04-12",
      },
      confidence: {
        documentTypeId: 0.98,
        detectedClient: 0.96,
        detectedClient2: null,
        ownershipType: 0.91,
        custodian: 0.95,
        accountType: 0.94,
        accountLast4: 0.96,
        documentDate: 0.9,
      },
      rawEvidenceSummary:
        "Text PDF includes statement, owner, custodian, account type, last four, and date.",
    }),
  }));

  try {
    const envelope = await analyzeDocumentWithEnvelope(
      buildPdfFile(buffer),
      async () => buffer,
      { analysisProfile: "preview_ai_primary" },
    );
    const insight = envelope.legacyInsight;

    assert.equal(insight.contentSource, "pdf_text");
    assert.equal(insight.debug.aiAttempted, true);
    assert.equal(insight.debug.aiUsed, true);
    assert.equal(insight.metadata.accountLast4, "6642");
    assert.equal(insight.metadata.accountType, "Checking");
    assert.equal(insight.debug.pdfExtractionAttempts[0]?.extractor, "pdfjs");
    assert.equal(insight.debug.pdfExtractionAttempts[0]?.status, "succeeded");
    assert.ok(
      insight.debug.pdfExtractionAttempts.some(
        (attempt) => attempt.extractor === "pypdf" && attempt.status === "skipped",
      ),
    );
    assert.ok(
      insight.debug.pdfExtractionAttempts.some(
        (attempt) => attempt.extractor === "pdfkit" && attempt.status === "skipped",
      ),
    );
  } finally {
    if (originalDomMatrix === undefined) {
      delete globalThis.DOMMatrix;
    } else {
      globalThis.DOMMatrix = originalDomMatrix;
    }
    if (originalPdfJsWorker === undefined) {
      delete globalThis.pdfjsWorker;
    } else {
      globalThis.pdfjsWorker = originalPdfJsWorker;
    }
    pdfjs.GlobalWorkerOptions.workerSrc = originalWorkerSrc;
    setAIPrimaryCompletionAdapterForTests(null);
    restoreEnv();
  }
});

test("Vercel metadata-only fallback records extractor diagnostics when PDF text fails", async () => {
  const restoreEnv = withEnv({ VERCEL: "1" });
  const buffer = Buffer.from("not a valid pdf");

  try {
    const envelope = await analyzeDocumentWithEnvelope(
      buildPdfFile(buffer, "Unreadable Statement.pdf"),
      async () => buffer,
      { analysisProfile: "preview_ai_primary" },
    );
    const insight = envelope.legacyInsight;
    const attempts = insight.debug.pdfExtractionAttempts;

    assert.equal(insight.contentSource, "metadata_only");
    assert.equal(insight.debug.aiAttempted, false);
    assert.match(insight.diagnosticText ?? "", /Extractor diagnostics:/);
    assert.ok(
      attempts.some(
        (attempt) => attempt.extractor === "pdfjs" && attempt.status === "failed",
      ),
    );
    assert.ok(
      attempts.some(
        (attempt) =>
          attempt.extractor === "pdf-parse" && attempt.status === "failed",
      ),
    );
    assert.ok(
      attempts.some(
        (attempt) => attempt.extractor === "ocr" && attempt.status === "skipped",
      ),
    );
  } finally {
    restoreEnv();
  }
});
