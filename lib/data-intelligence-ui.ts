export const DATA_INTELLIGENCE_EMPTY_TITLE =
  "Ask the firm's document intelligence assistant";

export const DATA_INTELLIGENCE_EMPTY_SUBTEXT =
  "I can check indexed statements and IDs, keep context across follow-ups, and show the source I used.";

export function isSubmittableDataIntelligenceQuestion(value: string) {
  return value.trim().length > 0;
}
