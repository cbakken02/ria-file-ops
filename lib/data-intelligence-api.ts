export const DATA_INTELLIGENCE_GENERIC_ERROR =
  "I hit a server issue while checking the document store. Please try again in a moment.";

export const DATA_INTELLIGENCE_UNREADABLE_RESPONSE_ERROR =
  "I received an unreadable response from the document assistant. Please try again.";

export function stringifyDataIntelligencePayload(value: unknown) {
  return JSON.stringify(value, (_key, nestedValue) =>
    typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue,
  );
}

export function parseDataIntelligencePayloadText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

export function readDataIntelligenceApiError(payload: unknown) {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string" &&
    payload.error.trim()
  ) {
    return payload.error.trim();
  }

  return null;
}

export function dataIntelligenceJsonResponse(
  payload: unknown,
  init?: ResponseInit,
) {
  const body = stringifyDataIntelligencePayload(payload) ?? "{}";

  return new Response(body, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}
