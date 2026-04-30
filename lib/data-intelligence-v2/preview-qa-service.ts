import {
  getDataIntelligenceV2Config,
} from "@/lib/data-intelligence-v2/config";
import {
  DevMockDataIntelligenceV2Gateway,
} from "@/lib/data-intelligence-v2/dev-mock-data-gateway";
import {
  DEV_MOCK_ACCOUNT,
  DEV_MOCK_IDENTITY_VALUES,
  DEV_MOCK_OWNER_EMAIL,
} from "@/lib/data-intelligence-v2/dev-mock-fixtures";
import { DevMockV2ModelAdapter } from "@/lib/data-intelligence-v2/dev-mock-model-adapter";
import {
  DevMockSensitiveValueProvider,
} from "@/lib/data-intelligence-v2/dev-mock-sensitive-value-provider";
import {
  createOpenAIResponsesV2ModelAdapterFromConfig,
} from "@/lib/data-intelligence-v2/openai-model-adapter";
import {
  assertNoUnsafeModelContent,
  containsUnsafeSensitivePattern,
} from "@/lib/data-intelligence-v2/safe-memory";
import {
  getDefaultRevealTokenStore,
  getDefaultV2AuditSink,
} from "@/lib/data-intelligence-v2/service-factory";
import type { V2AuditEvent, V2AuditSink } from "@/lib/data-intelligence-v2/audit";
import {
  RevealTokenService,
} from "@/lib/data-intelligence-v2/reveal-token-service";
import {
  V2RevealAuditSinkAdapter,
} from "@/lib/data-intelligence-v2/reveal-audit";
import { runV2ChatTurn } from "@/lib/data-intelligence-v2/chat-service";
import type {
  DataIntelligenceV2AuthContext,
  ModelSafeRevealCard,
} from "@/lib/data-intelligence-v2/types";

export type PreviewQaSmokeResult = {
  status: "passed" | "failed" | "blocked";
  checks: Array<{
    name: string;
    status: "passed" | "failed" | "blocked";
    details?: Record<string, unknown>;
  }>;
  summary: {
    v2ChatTurnRan: boolean;
    secureRevealCardCreated: boolean;
    revealSucceededWithoutReturningValue: boolean;
    auditEventsAttempted: boolean;
    noRawSensitiveValuesReturned: boolean;
    usedFakeDataOnly: boolean;
  };
};

const PREVIEW_QA_PROMPT =
  "Advisor task: For Alex Demo, prepare new account paperwork. Need latest statement, ID status, and full account number.";

const PREVIEW_QA_AUTH_CONTEXT: DataIntelligenceV2AuthContext = {
  userEmail: DEV_MOCK_OWNER_EMAIL,
  ownerEmail: DEV_MOCK_OWNER_EMAIL,
  userId: "preview_qa_user",
  role: "advisor",
  allowSensitiveReveal: true,
  allowedOwnerEmails: [DEV_MOCK_OWNER_EMAIL],
  allowedClientIds: ["mock_client_alex"],
};

export async function runPreviewV2SmokeQa(args: {
  useRealOpenAi?: boolean;
}): Promise<PreviewQaSmokeResult> {
  const checks: PreviewQaSmokeResult["checks"] = [];
  const summary: PreviewQaSmokeResult["summary"] = {
    v2ChatTurnRan: false,
    secureRevealCardCreated: false,
    revealSucceededWithoutReturningValue: false,
    auditEventsAttempted: false,
    noRawSensitiveValuesReturned: false,
    usedFakeDataOnly: true,
  };

  try {
    assertNoUnsafeModelContent(PREVIEW_QA_PROMPT);
  } catch {
    checks.push({
      name: "fake_prompt_is_model_safe",
      status: "failed",
    });
    return finalizePreviewQaResult({ checks, summary });
  }

  const config = getDataIntelligenceV2Config(process.env);
  const modelAdapter = args.useRealOpenAi
    ? createRealOpenAiPreviewAdapter(config, checks)
    : new DevMockV2ModelAdapter();
  if (!modelAdapter) {
    return finalizePreviewQaResult({ checks, summary });
  }

  const auditSink = makeCountingAuditSink(checks);
  const revealTokenService = makePreviewRevealTokenService(checks, auditSink);
  if (!revealTokenService) {
    return finalizePreviewQaResult({ checks, summary });
  }

  const chatResult = await runV2ChatTurn({
    userMessage: PREVIEW_QA_PROMPT,
    authContext: PREVIEW_QA_AUTH_CONTEXT,
    modelAdapter,
    dataGateway: new DevMockDataIntelligenceV2Gateway(),
    revealTokenService,
    auditSink,
  });
  summary.v2ChatTurnRan = true;
  checks.push({
    name: "v2_chat_turn",
    status: chatResult.status === "success" ? "passed" : "failed",
    details: {
      responseType: chatResult.response.responseType,
      sourceBackedFactCount: chatResult.response.sourceBackedFacts.length,
      missingItemCount: chatResult.response.missingOrUnverified.length,
      secureRevealCardCount: chatResult.response.secureRevealCards.length,
    },
  });

  const revealCard = firstRevealCard(chatResult.response.secureRevealCards);
  summary.secureRevealCardCreated = Boolean(revealCard);
  checks.push({
    name: "secure_reveal_card_created",
    status: revealCard ? "passed" : "failed",
    details: {
      secureRevealCardCount: chatResult.response.secureRevealCards.length,
    },
  });

  if (revealCard) {
    const revealResult = await revealTokenService.revealSensitiveValue({
      revealCardId: revealCard.revealCardId,
      authContext: PREVIEW_QA_AUTH_CONTEXT,
    });
    summary.revealSucceededWithoutReturningValue =
      revealResult.status === "success" && Boolean(revealResult.revealedValue?.value);
    checks.push({
      name: "internal_reveal",
      status: revealResult.status === "success" ? "passed" : "failed",
      details: {
        status: revealResult.status,
        valueReturnedToQaResponse: false,
      },
    });
  } else {
    checks.push({
      name: "internal_reveal",
      status: "blocked",
      details: {
        reason: "secure_reveal_card_missing",
      },
    });
  }

  summary.auditEventsAttempted = auditSink.attempts > 0;
  checks.push({
    name: "audit_events_attempted",
    status:
      auditSink.attempts > 0 && auditSink.failures === 0 ? "passed" : "failed",
    details: {
      attempts: auditSink.attempts,
      failures: auditSink.failures,
    },
  });

  const result = finalizePreviewQaResult({ checks, summary });
  result.summary.noRawSensitiveValuesReturned = !containsUnsafePreviewQaPayload(result);
  if (!result.summary.noRawSensitiveValuesReturned) {
    result.status = "failed";
    result.checks.push({
      name: "qa_result_safety",
      status: "failed",
    });
  }

  return result;
}

function createRealOpenAiPreviewAdapter(
  config: ReturnType<typeof getDataIntelligenceV2Config>,
  checks: PreviewQaSmokeResult["checks"],
) {
  if (!config.openAiEnabled || !config.openAiApiKey || !config.openAiModel) {
    checks.push({
      name: "real_openai_preview_adapter",
      status: "blocked",
      details: {
        openAiConfigured: false,
      },
    });
    return null;
  }

  checks.push({
    name: "real_openai_preview_adapter",
    status: "passed",
    details: {
      openAiConfigured: true,
      fakeDataOnly: true,
    },
  });
  return createOpenAIResponsesV2ModelAdapterFromConfig(config);
}

function makePreviewRevealTokenService(
  checks: PreviewQaSmokeResult["checks"],
  auditSink: CountingV2AuditSink,
) {
  try {
    return new RevealTokenService({
      store: getDefaultRevealTokenStore(),
      sensitiveValueProvider: new DevMockSensitiveValueProvider(),
      auditSink: new V2RevealAuditSinkAdapter(auditSink),
      defaultExpiresInMs:
        getDataIntelligenceV2Config(process.env).defaultRevealExpiresInMs,
    });
  } catch {
    checks.push({
      name: "reveal_token_service",
      status: "blocked",
      details: {
        initialized: false,
      },
    });
  }

  try {
    return new RevealTokenService({
      sensitiveValueProvider: new DevMockSensitiveValueProvider(),
      auditSink: new V2RevealAuditSinkAdapter(auditSink),
      defaultExpiresInMs:
        getDataIntelligenceV2Config(process.env).defaultRevealExpiresInMs,
    });
  } catch {
    checks.push({
      name: "reveal_token_service_fallback",
      status: "failed",
      details: {
        initialized: false,
      },
    });
    return null;
  }
}

function makeCountingAuditSink(
  checks: PreviewQaSmokeResult["checks"],
): CountingV2AuditSink {
  try {
    return new CountingV2AuditSink(getDefaultV2AuditSink());
  } catch {
    checks.push({
      name: "audit_sink",
      status: "blocked",
      details: {
        initialized: false,
      },
    });
    return new CountingV2AuditSink();
  }
}

function firstRevealCard(cards: ModelSafeRevealCard[]) {
  return cards.find(
    (card) => card.fieldKey === "account.fullAccountNumber",
  ) ?? cards[0];
}

export function finalizePreviewQaResult(args: {
  checks: PreviewQaSmokeResult["checks"];
  summary: PreviewQaSmokeResult["summary"];
}): PreviewQaSmokeResult {
  const hasFailure = args.checks.some((check) => check.status === "failed");
  const hasBlocked = args.checks.some((check) => check.status === "blocked");
  const result: PreviewQaSmokeResult = {
    status: hasFailure ? "failed" : hasBlocked ? "blocked" : "passed",
    checks: args.checks,
    summary: {
      ...args.summary,
      noRawSensitiveValuesReturned: true,
      usedFakeDataOnly: true,
    },
  };

  result.summary.noRawSensitiveValuesReturned =
    !containsUnsafePreviewQaPayload(result);
  if (!result.summary.noRawSensitiveValuesReturned) {
    result.status = "failed";
  }
  return result;
}

function containsUnsafePreviewQaPayload(result: PreviewQaSmokeResult) {
  const serialized = JSON.stringify(result);
  const rawValues = [
    DEV_MOCK_ACCOUNT.fullAccountNumber,
    DEV_MOCK_IDENTITY_VALUES["client.ssn"],
    DEV_MOCK_IDENTITY_VALUES["client.dob"],
    DEV_MOCK_IDENTITY_VALUES["client.address"],
    DEV_MOCK_IDENTITY_VALUES["client.email"],
    DEV_MOCK_IDENTITY_VALUES["client.phone"],
  ].filter((value): value is string => Boolean(value));

  return (
    rawValues.some((value) => serialized.includes(value)) ||
    containsUnsafeSensitivePattern(result)
  );
}

class CountingV2AuditSink implements V2AuditSink {
  attempts = 0;
  failures = 0;
  private readonly inner?: V2AuditSink;

  constructor(inner?: V2AuditSink) {
    this.inner = inner;
  }

  async record(event: V2AuditEvent): Promise<void> {
    this.attempts += 1;
    if (!this.inner) {
      return;
    }
    try {
      await this.inner.record(event);
    } catch {
      this.failures += 1;
    }
  }
}
