import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);

if (
  !process.env.WORK_PACKETS_OPTION_VISUALS_REEXEC &&
  !process.execArgv.includes("--experimental-strip-types")
) {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--loader",
      "./tests/ts-alias-loader.mjs",
      SCRIPT_PATH,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        WORK_PACKETS_OPTION_VISUALS_REEXEC: "true",
      },
      stdio: "inherit",
    },
  );
  process.exit(result.status ?? 1);
}

const {
  JON_SMITH_FIDELITY_TOA_OPTION_MAPPING_OUTPUT_DIR,
} = await import("../lib/work-packets/dev-demo/fidelity-toa-option-mapping.ts");
const {
  JON_SMITH_FIDELITY_TOA_OPTION_VISUAL_DEBUG_DIR,
  classifyJonSmithFidelityToaOptionVisuals,
} = await import("../lib/work-packets/dev-demo/fidelity-toa-option-visuals.ts");

const blankPdfPath = path.join(
  JON_SMITH_FIDELITY_TOA_OPTION_MAPPING_OUTPUT_DIR,
  "blank-control.pdf",
);

if (!existsSync(blankPdfPath)) {
  console.error(
    JSON.stringify(
      {
        status: "error",
        code: "missing_blank_control",
        blankPdfPath,
        message:
          "Run scripts/generate-work-packets-fidelity-toa-option-mapping.mjs before visual inspection.",
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

await mkdir(JON_SMITH_FIDELITY_TOA_OPTION_VISUAL_DEBUG_DIR, {
  recursive: true,
});

const candidates = await listOptionProbeCandidates(
  JON_SMITH_FIDELITY_TOA_OPTION_MAPPING_OUTPUT_DIR,
);

if (candidates.length === 0) {
  console.error(
    JSON.stringify(
      {
        status: "error",
        code: "missing_option_probes",
        optionMappingDirectory: JON_SMITH_FIDELITY_TOA_OPTION_MAPPING_OUTPUT_DIR,
        message:
          "No Type, Type2, or Trans option probe PDFs were found. Run the option-mapping generation script first.",
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const rendered = await renderAndDiffOptionProbePdfs({
  blankPdfPath,
  candidates,
  debugDirectory: JON_SMITH_FIDELITY_TOA_OPTION_VISUAL_DEBUG_DIR,
  pageIndex: 1,
  scale: 2,
});
const report = classifyJonSmithFidelityToaOptionVisuals(rendered.candidates);
const allHighConfidence = Object.values(report).every(
  (result) => result.confidence === "high",
);

console.log(
  JSON.stringify(
    {
      status: allHighConfidence ? "completed" : "manual_review_required",
      method:
        "Rendered page 2 of blank-control.pdf and each option probe PDF with macOS PDFKit/Swift, compared pixels, then classified the changed checkbox region against demo-specific Fidelity TOA target regions.",
      sourceDirectory: JON_SMITH_FIDELITY_TOA_OPTION_MAPPING_OUTPUT_DIR,
      visualDebugDirectory: JON_SMITH_FIDELITY_TOA_OPTION_VISUAL_DEBUG_DIR,
      renderedBlankPagePath: rendered.renderedBlankPagePath,
      pageInspected: 2,
      typeTraditionalIra: publicResult(report.typeTraditionalIra),
      type2TraditionalIra: publicResult(report.type2TraditionalIra),
      transFullInKind: publicResult(report.transFullInKind),
      candidateDiffs: rendered.candidates.map((candidate) => ({
        fieldName: candidate.fieldName,
        exportValue: candidate.exportValue,
        changedPixelCount: candidate.changedPixelCount,
        pdfCenter: candidate.pdfCenter,
        pdfBounds: candidate.pdfBounds,
        diffImagePath: candidate.diffImagePath,
        error: candidate.error,
      })),
      rendererWarnings: rendered.warnings,
    },
    null,
    2,
  ),
);

function publicResult(result) {
  return {
    field: result.field,
    exportValue: result.exportValue,
    confidence: result.confidence,
    evidence: result.evidence,
    debug: result.debug,
  };
}

async function listOptionProbeCandidates(optionMappingDirectory) {
  const entries = await readdir(optionMappingDirectory);
  const candidates = [];

  for (const entry of entries) {
    const match = /^(type2|type|trans)-value-(.+)\.pdf$/i.exec(entry);

    if (!match) {
      continue;
    }

    const fieldName = fieldNameForProbePrefix(match[1]);
    candidates.push({
      fieldName,
      exportValue: match[2],
      probePdfPath: path.join(optionMappingDirectory, entry),
    });
  }

  return candidates.sort((a, b) => {
    const fieldOrder = fieldSortOrder(a.fieldName) - fieldSortOrder(b.fieldName);

    if (fieldOrder !== 0) {
      return fieldOrder;
    }

    return Number(a.exportValue) - Number(b.exportValue);
  });
}

function fieldNameForProbePrefix(prefix) {
  if (prefix.toLowerCase() === "type") {
    return "Type";
  }

  if (prefix.toLowerCase() === "type2") {
    return "Type2";
  }

  return "Trans";
}

function fieldSortOrder(fieldName) {
  return { Type: 1, Type2: 2, Trans: 3 }[fieldName] ?? 99;
}

async function renderAndDiffOptionProbePdfs(input) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "ria-file-ops-option-visuals-"));
  const swiftPath = path.join(tempDir, "inspect-option-visuals.swift");

  try {
    await writeFile(swiftPath, swiftOptionVisualInspectorSource());
    const result = spawnSync("swift", [swiftPath], {
      cwd: process.cwd(),
      input: JSON.stringify(input),
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 20,
    });

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error(result.stderr.trim() || `swift exited with ${result.status}`);
    }

    return JSON.parse(result.stdout);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

function swiftOptionVisualInspectorSource() {
  return String.raw`
import AppKit
import Foundation
import PDFKit

struct InspectorInput: Decodable {
    let blankPdfPath: String
    let candidates: [CandidateInput]
    let debugDirectory: String
    let pageIndex: Int
    let scale: Double
}

struct CandidateInput: Decodable {
    let fieldName: String
    let exportValue: String
    let probePdfPath: String
}

struct InspectorOutput: Encodable {
    let renderedBlankPagePath: String
    let candidates: [CandidateOutput]
    let warnings: [String]
}

struct CandidateOutput: Encodable {
    let fieldName: String
    let exportValue: String
    let probePdfPath: String
    let changedPixelCount: Int
    let pdfBounds: Bounds?
    let pdfCenter: Point?
    let renderedImagePath: String?
    let diffImagePath: String?
    let error: String?
}

struct Bounds: Encodable {
    let xMin: Double
    let yMin: Double
    let xMax: Double
    let yMax: Double
}

struct Point: Encodable {
    let x: Double
    let y: Double
}

struct RenderedPage {
    let pixels: [UInt8]
    let width: Int
    let height: Int
    let bounds: CGRect
}

let inputData = FileHandle.standardInput.readDataToEndOfFile()
let input = try JSONDecoder().decode(InspectorInput.self, from: inputData)
try FileManager.default.createDirectory(
    at: URL(fileURLWithPath: input.debugDirectory),
    withIntermediateDirectories: true
)

let blankPage = try renderPdfPage(
    path: input.blankPdfPath,
    pageIndex: input.pageIndex,
    scale: input.scale
)
let blankPagePath = "\(input.debugDirectory)/blank-control-page-\(input.pageIndex + 1).png"
try writePng(
    pixels: blankPage.pixels,
    width: blankPage.width,
    height: blankPage.height,
    path: blankPagePath
)

var outputs: [CandidateOutput] = []
var warnings: [String] = []

for candidate in input.candidates {
    do {
        let candidatePage = try renderPdfPage(
            path: candidate.probePdfPath,
            pageIndex: input.pageIndex,
            scale: input.scale
        )
        let baseName = "\(slugify(candidate.fieldName))-value-\(slugify(candidate.exportValue))-page-\(input.pageIndex + 1)"
        let renderedPath = "\(input.debugDirectory)/\(baseName).png"
        let diffPath = "\(input.debugDirectory)/\(baseName)-diff.png"
        try writePng(
            pixels: candidatePage.pixels,
            width: candidatePage.width,
            height: candidatePage.height,
            path: renderedPath
        )
        let diff = diffPages(blankPage: blankPage, candidatePage: candidatePage, scale: input.scale)
        try writePng(
            pixels: diff.diffPixels,
            width: blankPage.width,
            height: blankPage.height,
            path: diffPath
        )
        outputs.append(CandidateOutput(
            fieldName: candidate.fieldName,
            exportValue: candidate.exportValue,
            probePdfPath: candidate.probePdfPath,
            changedPixelCount: diff.changedPixelCount,
            pdfBounds: diff.pdfBounds,
            pdfCenter: diff.pdfCenter,
            renderedImagePath: renderedPath,
            diffImagePath: diffPath,
            error: nil
        ))
    } catch {
        warnings.append("Failed to inspect \(candidate.probePdfPath): \(error.localizedDescription)")
        outputs.append(CandidateOutput(
            fieldName: candidate.fieldName,
            exportValue: candidate.exportValue,
            probePdfPath: candidate.probePdfPath,
            changedPixelCount: 0,
            pdfBounds: nil,
            pdfCenter: nil,
            renderedImagePath: nil,
            diffImagePath: nil,
            error: error.localizedDescription
        ))
    }
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
let output = InspectorOutput(
    renderedBlankPagePath: blankPagePath,
    candidates: outputs,
    warnings: warnings
)
FileHandle.standardOutput.write(try encoder.encode(output))

func renderPdfPage(path: String, pageIndex: Int, scale: Double) throws -> RenderedPage {
    guard let document = PDFDocument(url: URL(fileURLWithPath: path)),
          let page = document.page(at: pageIndex) else {
        throw NSError(
            domain: "FidelityToaOptionVisuals",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Could not open page \(pageIndex + 1) of \(path)."]
        )
    }

    let pageBounds = page.bounds(for: .mediaBox)
    let width = Int((pageBounds.width * scale).rounded(.up))
    let height = Int((pageBounds.height * scale).rounded(.up))
    let bytesPerPixel = 4
    let bytesPerRow = width * bytesPerPixel
    var pixels = [UInt8](repeating: 255, count: height * bytesPerRow)
    let colorSpace = CGColorSpaceCreateDeviceRGB()

    pixels.withUnsafeMutableBytes { rawBuffer in
        let context = CGContext(
            data: rawBuffer.baseAddress!,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: bytesPerRow,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        )!
        context.setFillColor(NSColor.white.cgColor)
        context.fill(CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)))
        context.saveGState()
        context.scaleBy(x: scale, y: scale)
        page.draw(with: .mediaBox, to: context)
        context.restoreGState()
    }

    return RenderedPage(
        pixels: pixels,
        width: width,
        height: height,
        bounds: pageBounds
    )
}

func diffPages(blankPage: RenderedPage, candidatePage: RenderedPage, scale: Double) -> (
    changedPixelCount: Int,
    pdfBounds: Bounds?,
    pdfCenter: Point?,
    diffPixels: [UInt8]
) {
    let width = min(blankPage.width, candidatePage.width)
    let height = min(blankPage.height, candidatePage.height)
    var diffPixels = [UInt8](repeating: 255, count: blankPage.width * blankPage.height * 4)
    var changedPixelCount = 0
    var minX = Int.max
    var minY = Int.max
    var maxX = -1
    var maxY = -1

    for y in 0..<height {
        for x in 0..<width {
            let blankIndex = (y * blankPage.width + x) * 4
            let candidateIndex = (y * candidatePage.width + x) * 4
            let redDelta = abs(Int(blankPage.pixels[blankIndex]) - Int(candidatePage.pixels[candidateIndex]))
            let greenDelta = abs(Int(blankPage.pixels[blankIndex + 1]) - Int(candidatePage.pixels[candidateIndex + 1]))
            let blueDelta = abs(Int(blankPage.pixels[blankIndex + 2]) - Int(candidatePage.pixels[candidateIndex + 2]))

            if redDelta + greenDelta + blueDelta > 60 {
                diffPixels[blankIndex] = 255
                diffPixels[blankIndex + 1] = 0
                diffPixels[blankIndex + 2] = 0
                diffPixels[blankIndex + 3] = 255
                changedPixelCount += 1
                minX = min(minX, x)
                minY = min(minY, y)
                maxX = max(maxX, x)
                maxY = max(maxY, y)
            }
        }
    }

    guard changedPixelCount > 0 else {
        return (0, nil, nil, diffPixels)
    }

    let xMin = Double(minX) / scale
    let xMax = Double(maxX) / scale
    let yMin = Double(blankPage.bounds.height) - (Double(maxY) / scale)
    let yMax = Double(blankPage.bounds.height) - (Double(minY) / scale)
    let center = Point(
        x: (xMin + xMax) / 2,
        y: (yMin + yMax) / 2
    )
    let bounds = Bounds(xMin: xMin, yMin: yMin, xMax: xMax, yMax: yMax)

    return (changedPixelCount, bounds, center, diffPixels)
}

func writePng(pixels: [UInt8], width: Int, height: Int, path: String) throws {
    let bytesPerRow = width * 4
    let data = Data(pixels)
    guard let provider = CGDataProvider(data: data as CFData),
          let image = CGImage(
            width: width,
            height: height,
            bitsPerComponent: 8,
            bitsPerPixel: 32,
            bytesPerRow: bytesPerRow,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
            provider: provider,
            decode: nil,
            shouldInterpolate: false,
            intent: .defaultIntent
          ) else {
        throw NSError(
            domain: "FidelityToaOptionVisuals",
            code: 2,
            userInfo: [NSLocalizedDescriptionKey: "Could not create PNG image for \(path)."]
        )
    }

    let representation = NSBitmapImageRep(cgImage: image)
    guard let pngData = representation.representation(using: .png, properties: [:]) else {
        throw NSError(
            domain: "FidelityToaOptionVisuals",
            code: 3,
            userInfo: [NSLocalizedDescriptionKey: "Could not encode PNG image for \(path)."]
        )
    }

    try pngData.write(to: URL(fileURLWithPath: path))
}

func slugify(_ value: String) -> String {
    let allowed = CharacterSet.alphanumerics
    let scalars = value.unicodeScalars.map { scalar -> Character in
        allowed.contains(scalar) ? Character(scalar) : "-"
    }
    let collapsed = String(scalars)
        .lowercased()
        .split(separator: "-", omittingEmptySubsequences: true)
        .joined(separator: "-")
    return collapsed.isEmpty ? "unknown" : collapsed
}
`;
}
