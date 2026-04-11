#!/usr/bin/env swift

import AppKit
import Foundation
import PDFKit
import Vision

struct OCRPayload: Encodable {
    let text: String?
    let pageCount: Int?
    let error: String?
}

func emit(_ payload: OCRPayload) -> Never {
    let encoder = JSONEncoder()
    let data = try! encoder.encode(payload)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
    exit(payload.error == nil ? 0 : 1)
}

func cleanText(_ value: String) -> String {
    value.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

func uniqueOrderedLines(_ lines: [String]) -> [String] {
    var seen = Set<String>()
    var ordered: [String] = []

    for rawLine in lines {
        let line = cleanText(rawLine)
        guard !line.isEmpty else {
            continue
        }

        let key = line.lowercased()
        if seen.insert(key).inserted {
            ordered.append(line)
        }
    }

    return ordered
}

func sortObservationsForReadingOrder(
    _ observations: [VNRecognizedTextObservation]
) -> [VNRecognizedTextObservation] {
    observations.sorted { left, right in
        let leftMidY = left.boundingBox.midY
        let rightMidY = right.boundingBox.midY

        if abs(leftMidY - rightMidY) > 0.02 {
            return leftMidY > rightMidY
        }

        return left.boundingBox.minX < right.boundingBox.minX
    }
}

func recognizeLines(from image: CGImage) throws -> [String] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["en-US"]
    request.minimumTextHeight = 0.0

    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    try handler.perform([request])

    let observations = sortObservationsForReadingOrder(request.results ?? [])
    return observations.compactMap { observation in
        observation.topCandidates(1).first?.string
    }
}

func recognizeText(from image: CGImage) throws -> String {
    let lines = try recognizeLines(from: image)
    return cleanText(uniqueOrderedLines(lines).joined(separator: " "))
}

func crop(_ image: CGImage, rect: CGRect) -> CGImage? {
    let pixelRect = CGRect(
        x: rect.origin.x * CGFloat(image.width),
        y: rect.origin.y * CGFloat(image.height),
        width: rect.width * CGFloat(image.width),
        height: rect.height * CGFloat(image.height)
    ).integral

    return image.cropping(to: pixelRect)
}

func cgImage(from image: NSImage) -> CGImage? {
    var rect = CGRect(origin: .zero, size: image.size)
    return image.cgImage(forProposedRect: &rect, context: nil, hints: nil)
}

func renderPDFPage(_ page: PDFPage, scale: CGFloat = 2.0) -> CGImage? {
    let bounds = page.bounds(for: .mediaBox)
    let width = max(Int(bounds.width * scale), 1)
    let height = max(Int(bounds.height * scale), 1)

    guard
        let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
        let context = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        )
    else {
        return nil
    }

    context.setFillColor(NSColor.white.cgColor)
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    context.saveGState()
    context.scaleBy(x: scale, y: scale)
    context.translateBy(x: 0, y: bounds.height)
    context.scaleBy(x: 1, y: -1)
    page.draw(with: .mediaBox, to: context)
    context.restoreGState()

    return context.makeImage()
}

func recognizeImageFile(at path: String) throws -> OCRPayload {
    guard let image = NSImage(contentsOfFile: path), let cgImage = cgImage(from: image) else {
        throw NSError(domain: "OCR", code: 1, userInfo: [
            NSLocalizedDescriptionKey: "Unable to load image for OCR."
        ])
    }

    var allLines = try recognizeLines(from: cgImage)
    let cropRects: [CGRect] = [
        CGRect(x: 0.0, y: 0.0, width: 0.5, height: 0.5),
        CGRect(x: 0.5, y: 0.0, width: 0.5, height: 0.5),
        CGRect(x: 0.0, y: 0.5, width: 0.5, height: 0.5),
        CGRect(x: 0.5, y: 0.5, width: 0.5, height: 0.5),
        CGRect(x: 0.0, y: 0.0, width: 1.0, height: 0.5),
        CGRect(x: 0.0, y: 0.5, width: 1.0, height: 0.5),
    ]

    for rect in cropRects {
        guard let cropped = crop(cgImage, rect: rect) else {
            continue
        }

        let croppedLines = try recognizeLines(from: cropped)
        allLines.append(contentsOf: croppedLines)
    }

    let text = cleanText(uniqueOrderedLines(allLines).joined(separator: " "))
    return OCRPayload(text: text, pageCount: 1, error: nil)
}

func recognizePDFFile(at path: String) throws -> OCRPayload {
    guard let document = PDFDocument(url: URL(fileURLWithPath: path)) else {
        throw NSError(domain: "OCR", code: 2, userInfo: [
            NSLocalizedDescriptionKey: "Unable to open PDF for OCR."
        ])
    }

    let maxPages = min(document.pageCount, 4)
    var pageTexts: [String] = []
    let cropRects: [CGRect] = [
        CGRect(x: 0.0, y: 0.0, width: 1.0, height: 0.45),
        CGRect(x: 0.0, y: 0.0, width: 0.72, height: 0.42),
        CGRect(x: 0.18, y: 0.0, width: 0.82, height: 0.42),
        CGRect(x: 0.0, y: 0.08, width: 1.0, height: 0.22),
        CGRect(x: 0.0, y: 0.08, width: 0.78, height: 0.22),
        CGRect(x: 0.0, y: 0.0, width: 0.5, height: 0.5),
        CGRect(x: 0.5, y: 0.0, width: 0.5, height: 0.5),
    ]

    for index in 0..<maxPages {
        guard let page = document.page(at: index), let cgImage = renderPDFPage(page) else {
            continue
        }

        var allLines = try recognizeLines(from: cgImage)

        for rect in cropRects {
            guard let cropped = crop(cgImage, rect: rect) else {
                continue
            }

            let croppedLines = try recognizeLines(from: cropped)
            allLines.append(contentsOf: croppedLines)
        }

        let text = cleanText(uniqueOrderedLines(allLines).joined(separator: " "))
        if !text.isEmpty {
            pageTexts.append(text)
        }
    }

    return OCRPayload(
        text: cleanText(pageTexts.joined(separator: " ")),
        pageCount: maxPages,
        error: nil
    )
}

if CommandLine.arguments.count != 2 {
    emit(OCRPayload(text: nil, pageCount: nil, error: "Expected a single file path argument."))
}

let inputPath = CommandLine.arguments[1]
let lowercasedPath = inputPath.lowercased()

do {
    if lowercasedPath.hasSuffix(".pdf") {
        emit(try recognizePDFFile(at: inputPath))
    } else {
        emit(try recognizeImageFile(at: inputPath))
    }
} catch {
    emit(OCRPayload(text: nil, pageCount: nil, error: error.localizedDescription))
}
