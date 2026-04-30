import type {
  ModelSafeRevealCard,
  V2MissingDataItem,
  V2SafeFact,
  V2SourceRef,
  V2ToolName,
  V2ToolResult,
  V2ToolStatus,
} from "@/lib/data-intelligence-v2/types";

export const RAW_SENSITIVE_DISALLOWED_CLAIM =
  "Do not state raw SSNs, full account numbers, DOBs, addresses, phone numbers, emails, government IDs, passport numbers, tax IDs, source file IDs, OAuth tokens, encryption keys, or other reveal-only values.";

export function createToolResult(args: {
  toolName: V2ToolName;
  status: V2ToolStatus;
  summary: string;
  facts?: V2SafeFact[];
  missing?: V2MissingDataItem[];
  sourceRefs?: V2SourceRef[];
  secureRevealCards?: ModelSafeRevealCard[];
  allowedClaims?: string[];
  disallowedClaims?: string[];
}): V2ToolResult {
  const facts = args.facts ?? [];
  const sourceRefs = dedupeSourceRefs([
    ...(args.sourceRefs ?? []),
    ...facts.flatMap((fact) => fact.sourceRefs),
  ]);

  return {
    toolName: args.toolName,
    status: args.status,
    summary: args.summary,
    facts,
    missing: args.missing ?? [],
    sourceRefs,
    secureRevealCards: args.secureRevealCards ?? [],
    allowedClaims: args.allowedClaims ?? [],
    disallowedClaims: [
      RAW_SENSITIVE_DISALLOWED_CLAIM,
      ...(args.disallowedClaims ?? []),
    ],
  };
}

export function createFact(args: {
  factId: string;
  fieldKey: string;
  label: string;
  value: string | number | boolean | null;
  sourceRefs?: V2SourceRef[];
  confidence?: "high" | "medium" | "low";
}): V2SafeFact {
  return {
    factId: args.factId,
    fieldKey: args.fieldKey,
    label: args.label,
    value: args.value,
    displayValue: displayValue(args.value),
    sourceRefs: args.sourceRefs ?? [],
    confidence: args.confidence ?? "high",
  };
}

export function dedupeSourceRefs(sourceRefs: V2SourceRef[]): V2SourceRef[] {
  const seen = new Set<string>();
  const deduped: V2SourceRef[] = [];

  for (const sourceRef of sourceRefs) {
    const key = `${sourceRef.sourceType}:${sourceRef.sourceId}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(sourceRef);
    }
  }

  return deduped;
}

export function displayValue(value: string | number | boolean | null) {
  if (value === null) {
    return "Not found";
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  return String(value);
}
