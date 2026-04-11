import Foundation
import PDFKit

struct FieldEntry: Encodable {
  let name: String
  let value: String
}

struct Payload: Encodable {
  let fields: [String: String]
  let field_entries: [FieldEntry]
}

func cleanText(_ value: String?) -> String {
  guard let value else {
    return ""
  }

  return value
    .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
    .trimmingCharacters(in: .whitespacesAndNewlines)
}

func digitCount(_ value: String) -> Int {
  return value.filter(\.isNumber).count
}

func isAllZeroNumeric(_ value: String) -> Bool {
  let digits = value.filter(\.isNumber)
  return !digits.isEmpty && Set(digits) == ["0"]
}

func looksNumericField(_ fieldName: String) -> Bool {
  let lower = fieldName.lowercased()
  return lower.contains("account")
    || lower.contains("acct")
    || lower.contains("number")
    || lower.contains("routing")
    || lower.contains("gnum")
}

func choosePreferredFieldValue(
  fieldName: String,
  existing: String?,
  candidate: String?
) -> String? {
  let existing = cleanText(existing)
  let candidate = cleanText(candidate)

  if candidate.isEmpty {
    return existing.isEmpty ? nil : existing
  }

  if existing.isEmpty {
    return candidate
  }

  if looksNumericField(fieldName) {
    let existingIsZero = isAllZeroNumeric(existing)
    let candidateIsZero = isAllZeroNumeric(candidate)

    if existingIsZero && !candidateIsZero {
      return candidate
    }

    if candidateIsZero && !existingIsZero {
      return existing
    }

    let existingDigits = digitCount(existing)
    let candidateDigits = digitCount(candidate)

    if candidateDigits > existingDigits {
      return candidate
    }

    if existingDigits > candidateDigits {
      return existing
    }
  }

  if candidate.count > existing.count {
    return candidate
  }

  return existing
}

func stringify(_ value: Any?) -> String? {
  guard let value else {
    return nil
  }

  if let string = value as? String {
    let cleaned = cleanText(string)
    return cleaned.isEmpty ? nil : cleaned
  }

  if let number = value as? NSNumber {
    return number.stringValue
  }

  let cleaned = cleanText(String(describing: value))
  return cleaned.isEmpty ? nil : cleaned
}

func pageAnnotationName(
  annotation: PDFAnnotation,
  pageIndex: Int,
  annotationIndex: Int
) -> String {
  let cleaned = cleanText(annotation.fieldName)
  if !cleaned.isEmpty {
    return cleaned
  }

  return "unnamed_field_p\(pageIndex + 1)_\(annotationIndex + 1)"
}

func annotationMeta(_ annotation: PDFAnnotation) -> String {
  var parts: [String] = []

  if let annotationType = annotation.type, !annotationType.isEmpty {
    parts.append("type=\(annotationType)")
  }

  let widgetFieldType = String(describing: annotation.widgetFieldType)
  if widgetFieldType != "Optional(nil)" && widgetFieldType != "nil" {
    parts.append("widgetFieldType=\(widgetFieldType)")
  }

  if let flags = stringify(annotation.value(forAnnotationKey: .widgetFieldFlags)) {
    parts.append("widgetFieldFlags=\(flags)")
  }

  if let maxLen = stringify(annotation.value(forAnnotationKey: .widgetMaxLen)) {
    parts.append("widgetMaxLen=\(maxLen)")
  }

  return parts.joined(separator: ", ")
}

func main() -> Int32 {
  guard CommandLine.arguments.count == 2 else {
    let error = ["error": "Expected a single PDF file path argument."]
    if let data = try? JSONSerialization.data(withJSONObject: error),
       let text = String(data: data, encoding: .utf8) {
      print(text)
    }
    return 1
  }

  let pdfPath = CommandLine.arguments[1]
  let url = URL(fileURLWithPath: pdfPath)

  guard FileManager.default.fileExists(atPath: pdfPath) else {
    let error = ["error": "File not found: \(pdfPath)"]
    if let data = try? JSONSerialization.data(withJSONObject: error),
       let text = String(data: data, encoding: .utf8) {
      print(text)
    }
    return 1
  }

  guard let document = PDFDocument(url: url) else {
    let error = ["error": "PDFKit could not open the PDF document."]
    if let data = try? JSONSerialization.data(withJSONObject: error),
       let text = String(data: data, encoding: .utf8) {
      print(text)
    }
    return 1
  }

  var fields: [String: String] = [:]
  var entries: [FieldEntry] = []
  var annotationCount = 0

  for pageIndex in 0..<document.pageCount {
    annotationCount += document.page(at: pageIndex)?.annotations.count ?? 0
  }

  entries.append(
    FieldEntry(
      name: "PDFKit Form [meta]",
      value: "pageCount=\(document.pageCount), annotationCount=\(annotationCount)"
    )
  )

  for pageIndex in 0..<document.pageCount {
    guard let page = document.page(at: pageIndex) else {
      continue
    }

    for (annotationIndex, annotation) in page.annotations.enumerated() {
      let fieldName = pageAnnotationName(
        annotation: annotation,
        pageIndex: pageIndex,
        annotationIndex: annotationIndex
      )

      let meta = annotationMeta(annotation)
      if !meta.isEmpty {
        entries.append(
          FieldEntry(
            name: "\(fieldName) [pdfkit p\(pageIndex + 1) #\(annotationIndex + 1) meta]",
            value: meta
          )
        )
      }

      let candidates: [(String, String?)] = [
        ("pdfkit widgetStringValue", cleanText(annotation.widgetStringValue)),
        ("pdfkit widgetValue", stringify(annotation.value(forAnnotationKey: .widgetValue))),
        ("pdfkit widgetDefaultValue", stringify(annotation.value(forAnnotationKey: .widgetDefaultValue))),
        ("pdfkit contents", cleanText(annotation.contents)),
        ("pdfkit appearanceState", stringify(annotation.value(forAnnotationKey: .appearanceState))),
      ]

      var emittedValue = false

      for (label, candidate) in candidates {
        let cleaned = cleanText(candidate)
        if cleaned.isEmpty {
          continue
        }

        emittedValue = true
        fields[fieldName] =
          choosePreferredFieldValue(
            fieldName: fieldName,
            existing: fields[fieldName],
            candidate: cleaned
          ) ?? cleaned

        entries.append(
          FieldEntry(
            name: "\(fieldName) [pdfkit p\(pageIndex + 1) #\(annotationIndex + 1) \(label)]",
            value: cleaned
          )
        )
      }

      if !emittedValue {
        entries.append(
          FieldEntry(
            name: "\(fieldName) [pdfkit p\(pageIndex + 1) #\(annotationIndex + 1) empty]",
            value: "(no PDFKit widget value)"
          )
        )
      }
    }
  }

  let payload = Payload(fields: fields, field_entries: entries)
  let encoder = JSONEncoder()

  do {
    let data = try encoder.encode(payload)
    if let text = String(data: data, encoding: .utf8) {
      print(text)
      return 0
    }
  } catch {
    let errorPayload = ["error": error.localizedDescription]
    if let data = try? JSONSerialization.data(withJSONObject: errorPayload),
       let text = String(data: data, encoding: .utf8) {
      print(text)
    }
  }

  return 1
}

exit(main())
