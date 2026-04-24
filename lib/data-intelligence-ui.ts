export const DATA_INTELLIGENCE_EMPTY_TITLE =
  "What client data do you want to know about?";

export const DATA_INTELLIGENCE_EMPTY_SUBTEXT =
  "Statements and IDs for now. Ask a narrow, source-aware question.";

export function isSubmittableDataIntelligenceQuestion(value: string) {
  return value.trim().length > 0;
}
