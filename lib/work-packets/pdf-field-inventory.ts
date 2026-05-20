import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type {
  DestinationField,
  DestinationFieldOption,
  DestinationFieldRequiredness,
  DestinationFieldType,
  FieldInventory,
  FieldInventoryExtractionMethod,
  PacketDocumentRef,
} from "@/lib/work-packets/types";

export type InspectPdfFieldInventoryOptions = {
  inventoryId?: string;
  sourceDocumentRef?: PacketDocumentRef;
  templateFingerprint?: string;
  extractionMethod?: FieldInventoryExtractionMethod;
  createdAt?: string;
};

type PdfJsFieldSource = Record<string, unknown>;

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

export async function inspectPdfFieldInventoryFromFile(
  filePath: string,
  options: InspectPdfFieldInventoryOptions = {},
): Promise<FieldInventory> {
  const buffer = await readFile(filePath);
  const templateFingerprint =
    options.templateFingerprint ?? `sha256:${createHash("sha256").update(buffer).digest("hex")}`;

  return inspectPdfFieldInventory(buffer, {
    ...options,
    templateFingerprint,
  });
}

export async function inspectPdfFieldInventory(
  buffer: Buffer | Uint8Array,
  options: InspectPdfFieldInventoryOptions = {},
): Promise<FieldInventory> {
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
    const fieldsByName = new Map<string, DestinationField>();
    const fieldObjects = await pdf.getFieldObjects().catch(() => null);

    if (fieldObjects && typeof fieldObjects === "object") {
      for (const [fieldName, objects] of Object.entries(fieldObjects)) {
        const objectList = Array.isArray(objects) ? objects : [objects];

        for (const object of objectList) {
          upsertField(fieldsByName, fieldName, asPdfJsFieldSource(object), options);
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
            cleanPdfJsText(source.fieldName) ||
            cleanPdfJsText(source.fullName) ||
            cleanPdfJsText(source.id) ||
            `Page ${pageNumber} field ${index + 1}`;

          upsertField(fieldsByName, name, source, options, pageNumber);
        });
      } finally {
        page.cleanup();
      }
    }

    const fields = Array.from(fieldsByName.values());
    return {
      inventoryId: options.inventoryId ?? "pdf_inventory_local_dev",
      sourceKind: "pdf_form",
      sourceDocumentRef: options.sourceDocumentRef,
      templateFingerprint: options.templateFingerprint,
      extractionMethod: options.extractionMethod ?? "pdfjs",
      fields,
      safeSummary: `Inspected ${fields.length} PDF form field${fields.length === 1 ? "" : "s"}.`,
      createdAt: options.createdAt ?? new Date().toISOString(),
    };
  } finally {
    await pdf.destroy();
  }
}

function upsertField(
  fieldsByName: Map<string, DestinationField>,
  rawName: string,
  source: PdfJsFieldSource,
  options: InspectPdfFieldInventoryOptions,
  pageNumber?: number,
) {
  const name = cleanPdfJsText(rawName);

  if (!name) {
    return;
  }

  const existing = fieldsByName.get(name);
  const nextOptions = mergeOptions(existing?.options, collectOptions(source));
  const nextPosition = existing?.position ?? getFieldPosition(source, pageNumber);
  const nextType = existing?.fieldType ?? inferDestinationFieldType(source, name, nextOptions);
  const nextRequiredness = existing?.requiredness ?? inferRequiredness(source);
  const nextCurrentValueStatus =
    existing?.currentValueStatus === "present"
      ? "present"
      : inferCurrentValueStatus(source);

  fieldsByName.set(name, {
    fieldId: existing?.fieldId ?? buildFieldId(fieldsByName.size + 1, name),
    name,
    label: existing?.label ?? cleanPdfJsText(source.alternativeText),
    meaning: existing?.meaning,
    fieldType: nextType,
    requiredness: nextRequiredness,
    options: nextOptions.length > 0 ? nextOptions : undefined,
    sourceDocumentRef: options.sourceDocumentRef,
    sourceRefs: existing?.sourceRefs,
    position: nextPosition,
    currentValueStatus: nextCurrentValueStatus,
    confidence: existing?.confidence ?? "medium",
    metadata: {
      ...(existing?.metadata ?? {}),
      valueWasNotCopied: true,
    },
  });
}

function asPdfJsFieldSource(value: unknown): PdfJsFieldSource {
  return value && typeof value === "object" ? (value as PdfJsFieldSource) : {};
}

function inferDestinationFieldType(
  source: PdfJsFieldSource,
  fieldName: string,
  options: DestinationFieldOption[],
): DestinationFieldType {
  const fieldType = cleanPdfJsText(source.fieldType);

  if (fieldType === "Tx") {
    return /date/i.test(fieldName) ? "date" : "text";
  }

  if (fieldType === "Ch") {
    return "select";
  }

  if (fieldType === "Sig") {
    return "signature";
  }

  if (fieldType === "Btn") {
    if (options.length > 1 || source.radioButton === true) {
      return "radio";
    }

    return "checkbox";
  }

  if (/date/i.test(fieldName)) {
    return "date";
  }

  return "unknown";
}

function inferRequiredness(source: PdfJsFieldSource): DestinationFieldRequiredness {
  if (source.required === true) {
    return "required";
  }

  if (source.required === false) {
    return "optional";
  }

  return "unknown";
}

function inferCurrentValueStatus(source: PdfJsFieldSource) {
  return collectValueCandidates(source).map(cleanPdfJsText).some(Boolean)
    ? "present"
    : "empty";
}

function collectOptions(source: PdfJsFieldSource): DestinationFieldOption[] {
  const candidates = [
    ...arrayFromUnknown(source.options),
    ...arrayFromUnknown(source.items),
    ...arrayFromUnknown(source.exportValues),
  ];

  return candidates
    .flatMap((candidate, index): DestinationFieldOption[] => {
      if (typeof candidate === "string" || typeof candidate === "number") {
        const label = cleanPdfJsText(candidate);
        return label
          ? [{ optionId: `option_${index + 1}`, label, exportValue: label }]
          : [];
      }

      const sourceOption = asPdfJsFieldSource(candidate);
      const label =
        cleanPdfJsText(sourceOption.displayValue) ||
        cleanPdfJsText(sourceOption.label) ||
        cleanPdfJsText(sourceOption.name) ||
        cleanPdfJsText(sourceOption.exportValue) ||
        cleanPdfJsText(sourceOption.value);
      const exportValue =
        cleanPdfJsText(sourceOption.exportValue) ||
        cleanPdfJsText(sourceOption.value) ||
        undefined;

      return label
        ? [
            {
              optionId: `option_${index + 1}`,
              label,
              ...(exportValue ? { exportValue } : {}),
            },
          ]
        : [];
    });
}

function mergeOptions(
  existing: DestinationFieldOption[] | undefined,
  next: DestinationFieldOption[],
): DestinationFieldOption[] {
  const merged = new Map<string, DestinationFieldOption>();

  for (const option of [...(existing ?? []), ...next]) {
    const key = `${option.label}:${option.exportValue ?? ""}`;
    merged.set(key, option);
  }

  return Array.from(merged.values());
}

function getFieldPosition(source: PdfJsFieldSource, pageNumber?: number) {
  const rect = arrayFromUnknown(source.rect).map(Number);

  if (rect.length < 4 || rect.some((value) => Number.isNaN(value))) {
    return pageNumber ? { page: pageNumber } : undefined;
  }

  const [x1, y1, x2, y2] = rect;
  return {
    page: pageNumber,
    x: x1,
    y: y1,
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

function collectValueCandidates(source: PdfJsFieldSource): unknown[] {
  return [
    source.value,
    source.fieldValue,
    source.defaultValue,
    source.buttonValue,
    source.exportValue,
  ];
}

function arrayFromUnknown(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value == null) {
    return [];
  }

  return [value];
}

function cleanPdfJsText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(cleanPdfJsText).filter(Boolean).join(" ").trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFieldId(index: number, fieldName: string): string {
  const slug = fieldName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);

  return `pdf_field_${index}_${slug || "unnamed"}`;
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

function installPdfJsNodePolyfills() {
  const globalObject = globalThis as typeof globalThis & {
    DOMMatrix?: unknown;
  };

  if (!globalObject.DOMMatrix) {
    globalObject.DOMMatrix = NodePdfDomMatrix as unknown as typeof DOMMatrix;
  }
}
