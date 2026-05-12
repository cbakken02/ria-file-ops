export const DATA_INTELLIGENCE_EMPTY_TITLE =
  "Ask Data Intelligence anything";

export const DATA_INTELLIGENCE_EMPTY_SUBTEXT =
  "I can draft, explain, plan next steps, and weave in sourced client facts when they are available.";

export function isSubmittableDataIntelligenceQuestion(value: string) {
  return value.trim().length > 0;
}
