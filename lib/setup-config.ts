import {
  getDefaultNamingConventionSummary,
  getDefaultNamingRules,
} from "@/lib/naming-rules";

export const DEFAULT_NAMING_CONVENTION = getDefaultNamingConventionSummary(
  getDefaultNamingRules(),
);

export const DEFAULT_FOLDER_TEMPLATE = [
  "Client Info",
  "Accounts",
  "Money Movement",
  "Planning",
  "Review",
];

export const REVIEW_RULE_OPTIONS = [
  {
    value: "manual_only",
    title: "Manual",
    description:
      "Do not rename or move files automatically. Send every file to review with a proposed name and location.",
  },
  {
    value: "auto_file_high_confidence",
    title: "Auto-file",
    description:
      "Rename and move files automatically. Don't worry, we will still send new clients and anything uncertain to review with a proposed name and location.",
  },
] as const;

export type ReviewRuleValue = (typeof REVIEW_RULE_OPTIONS)[number]["value"];

const legacyReviewRuleMap: Record<string, ReviewRuleValue> = {
  "Send uncertain files to a human review queue before moving anything.":
    "auto_file_high_confidence",
  review_uncertain: "auto_file_high_confidence",
  review_new_clients: "auto_file_high_confidence",
  strict_review_first: "manual_only",
};

export function normalizeFolderTemplate(raw: string | null | undefined) {
  const parts = (raw ?? "")
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);

  return parts.length ? parts : [...DEFAULT_FOLDER_TEMPLATE];
}

export function serializeFolderTemplate(parts: string[]) {
  const cleaned = parts.map((value) => value.trim()).filter(Boolean);
  return cleaned.length ? cleaned.join("\n") : DEFAULT_FOLDER_TEMPLATE.join("\n");
}

export function normalizeReviewRuleValue(
  raw: string | null | undefined,
): ReviewRuleValue {
  if (!raw) {
    return "auto_file_high_confidence";
  }

  if (REVIEW_RULE_OPTIONS.some((option) => option.value === raw)) {
    return raw as ReviewRuleValue;
  }

  return legacyReviewRuleMap[raw] ?? "auto_file_high_confidence";
}

export function getReviewRuleOption(value: string | null | undefined) {
  const normalized = normalizeReviewRuleValue(value);
  return (
    REVIEW_RULE_OPTIONS.find((option) => option.value === normalized) ??
    REVIEW_RULE_OPTIONS.find(
      (option) => option.value === "auto_file_high_confidence",
    ) ??
    REVIEW_RULE_OPTIONS[0]
  );
}
