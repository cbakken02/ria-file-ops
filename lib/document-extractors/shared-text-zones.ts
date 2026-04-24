type NormalizeWhitespace = (value: string) => string;

export function extractFirstPageText(rawText: string) {
  const normalized = rawText.replace(/\r/g, "");

  if (normalized.includes("\f")) {
    return normalized.split("\f", 1)[0] ?? normalized;
  }

  const secondPageMarker = normalized.search(/\n\s*Page\s+2\b/i);
  if (secondPageMarker > 0) {
    return normalized.slice(0, secondPageMarker);
  }

  return normalized;
}

export function getHeaderZoneLines(
  text: string,
  normalizeWhitespace: NormalizeWhitespace,
  options?: {
    minLines?: number;
    ratio?: number;
  },
) {
  const lines = text
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  if (!lines.length) {
    return [];
  }

  const minLines = options?.minLines ?? 6;
  const ratio = options?.ratio ?? 0.3;
  const targetCount = Math.max(minLines, Math.ceil(lines.length * ratio));
  return lines.slice(0, targetCount);
}

export function collectAnchoredLines(
  text: string,
  normalizeWhitespace: NormalizeWhitespace,
  anchorPatterns: readonly RegExp[],
) {
  const lines = text
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
  const selected = new Set<number>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!anchorPatterns.some((pattern) => pattern.test(line))) {
      continue;
    }

    selected.add(index);
    if (index > 0) {
      selected.add(index - 1);
    }
    if (index + 1 < lines.length) {
      selected.add(index + 1);
    }
  }

  return [...selected]
    .sort((left, right) => left - right)
    .map((index) => lines[index] ?? "")
    .filter(Boolean);
}
