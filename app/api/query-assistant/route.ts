import { auth } from "@/auth";
import {
  DATA_INTELLIGENCE_GENERIC_ERROR,
  dataIntelligenceJsonResponse,
} from "@/lib/data-intelligence-api";
import { answerDataIntelligenceQuestion } from "@/lib/data-intelligence-assistant";
import {
  sanitizeDataIntelligenceConversationState,
  sanitizeDataIntelligenceConversationHistory,
} from "@/lib/data-intelligence-conversation";
import { getSafeErrorMetadata } from "@/lib/safe-logging";

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.email) {
    return dataIntelligenceJsonResponse({ error: "Unauthorized" }, { status: 401 });
  }

  let body:
    | { question?: unknown; history?: unknown; conversationState?: unknown }
    | null = null;
  try {
    body = (await request.json()) as {
      question?: unknown;
      history?: unknown;
      conversationState?: unknown;
    };
  } catch {
    return dataIntelligenceJsonResponse(
      { error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const question =
    typeof body?.question === "string" ? body.question.trim() : "";

  if (!question) {
    return dataIntelligenceJsonResponse(
      { error: "Question is required." },
      { status: 400 },
    );
  }

  const history = sanitizeDataIntelligenceConversationHistory(body?.history);
  const conversationState = sanitizeDataIntelligenceConversationState(
    body?.conversationState,
  );
  const includeDebug = isDataIntelligenceDebugEnabled();

  try {
    const result = await answerDataIntelligenceQuestion({
      ownerEmail: session.user.email,
      question,
      history,
      conversationState,
      includeDebug,
    });
    if (includeDebug && result.debug?.dataIntelligenceHybrid) {
      console.info(
        "[data-intelligence] hybrid-debug",
        summarizeHybridDebug(result.debug.dataIntelligenceHybrid),
      );
    }

    return dataIntelligenceJsonResponse(result);
  } catch (error) {
    console.error("[data-intelligence] request-failed", {
      ...getSafeErrorMetadata(error),
    });

    return dataIntelligenceJsonResponse(
      { error: DATA_INTELLIGENCE_GENERIC_ERROR },
      { status: 500 },
    );
  }
}

function isDataIntelligenceDebugEnabled() {
  return process.env.NODE_ENV !== "production";
}

function summarizeHybridDebug(debug: unknown) {
  if (!debug || typeof debug !== "object") {
    return { shape: typeof debug };
  }

  const record = debug as Record<string, unknown>;
  return {
    keys: Object.keys(record).sort(),
    hasCandidates: Array.isArray(record.candidates),
    candidateCount: Array.isArray(record.candidates) ? record.candidates.length : null,
    hasRetrievalPlan: Boolean(record.retrievalPlan),
    hasSources: Array.isArray(record.sources),
    sourceCount: Array.isArray(record.sources) ? record.sources.length : null,
  };
}
