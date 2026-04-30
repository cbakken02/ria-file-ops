import type { DataIntelligenceV2Config } from "@/lib/data-intelligence-v2/config";
import type { V2AuditSink } from "@/lib/data-intelligence-v2/audit";
import type { ClientDataGateway } from "@/lib/data-intelligence-v2/data-gateway";
import type { V2ModelAdapter } from "@/lib/data-intelligence-v2/model-adapter";
import type { RevealTokenService } from "@/lib/data-intelligence-v2/reveal-token-service";
import {
  getDefaultV2AuditSink,
} from "@/lib/data-intelligence-v2/service-factory";
import {
  assertNoUnsafeModelContent,
} from "@/lib/data-intelligence-v2/safe-memory";
import { runV2ChatTurn } from "@/lib/data-intelligence-v2/chat-service";
import type {
  DataIntelligenceV2AuthContext,
  SafeConversationState,
  VisibleConversationMessage,
} from "@/lib/data-intelligence-v2/types";

export type V2ChatApiHandlerArgs = {
  requestBody: unknown;
  authContext: DataIntelligenceV2AuthContext | null;
  config: DataIntelligenceV2Config;
  modelAdapter?: V2ModelAdapter;
  dataGateway?: ClientDataGateway;
  revealTokenService?: RevealTokenService;
  auditSink?: V2AuditSink;
};

export type V2ChatApiHandlerResult = {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
};

export const V2_CHAT_API_NO_CACHE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function handleV2ChatApiRequest(
  args: V2ChatApiHandlerArgs,
): Promise<V2ChatApiHandlerResult> {
  const startedAt = Date.now();
  const auditSink = args.auditSink ?? safeGetDefaultV2AuditSink();
  if (!args.config.enabled) {
    await recordChatAudit(auditSink, {
      eventType: "chat_request_denied",
      authContext: args.authContext,
      status: "disabled",
      allowed: false,
      reason: "V2 is disabled.",
      metadata: { durationMs: Date.now() - startedAt },
    });
    return response(404, { error: "Not found." });
  }

  if (!args.config.chatApiEnabled) {
    await recordChatAudit(auditSink, {
      eventType: "chat_request_denied",
      authContext: args.authContext,
      status: "disabled",
      allowed: false,
      reason: "V2 chat API is disabled.",
      metadata: { durationMs: Date.now() - startedAt },
    });
    return response(404, { error: "Not found." });
  }

  if (!args.authContext) {
    await recordChatAudit(auditSink, {
      eventType: "chat_request_denied",
      authContext: null,
      status: "unauthorized",
      allowed: false,
      reason: "Missing V2 auth context.",
      metadata: { durationMs: Date.now() - startedAt },
    });
    return response(401, { error: "Unauthorized." });
  }

  if (!isRecord(args.requestBody)) {
    await recordChatAudit(auditSink, {
      eventType: "chat_request_denied",
      authContext: args.authContext,
      status: "bad_request",
      allowed: false,
      reason: "Request body must be an object.",
      metadata: { durationMs: Date.now() - startedAt },
    });
    return response(400, { error: "Request body must be an object." });
  }

  const message =
    typeof args.requestBody.message === "string"
      ? args.requestBody.message.trim()
      : "";
  if (!message) {
    await recordChatAudit(auditSink, {
      eventType: "chat_request_denied",
      authContext: args.authContext,
      status: "bad_request",
      allowed: false,
      reason: "Message is required.",
      metadata: { durationMs: Date.now() - startedAt },
    });
    return response(400, { error: "message is required." });
  }

  if (
    args.requestBody.history !== undefined &&
    !Array.isArray(args.requestBody.history)
  ) {
    await recordChatAudit(auditSink, {
      eventType: "chat_request_denied",
      authContext: args.authContext,
      status: "bad_request",
      allowed: false,
      reason: "History must be an array when provided.",
      metadata: { durationMs: Date.now() - startedAt },
    });
    return response(400, { error: "history must be an array when provided." });
  }

  if (
    args.requestBody.conversationState !== undefined &&
    !isRecord(args.requestBody.conversationState)
  ) {
    await recordChatAudit(auditSink, {
      eventType: "chat_request_denied",
      authContext: args.authContext,
      status: "bad_request",
      allowed: false,
      reason: "Conversation state must be an object when provided.",
      metadata: { durationMs: Date.now() - startedAt },
    });
    return response(400, {
      error: "conversationState must be an object when provided.",
    });
  }

  try {
    await recordChatAudit(auditSink, {
      eventType: "chat_request_received",
      authContext: args.authContext,
      status: "accepted",
      allowed: true,
      reason: "V2 chat request accepted.",
      metadata: {
        messageLength: message.length,
        historyCount: Array.isArray(args.requestBody.history)
          ? args.requestBody.history.length
          : 0,
        hasConversationState: isRecord(args.requestBody.conversationState),
      },
    });

    const result = await runV2ChatTurn({
      userMessage: message,
      visibleHistory: args.requestBody.history as
        | VisibleConversationMessage[]
        | undefined,
      safeConversationState: args.requestBody.conversationState as
        | SafeConversationState
        | undefined,
      authContext: args.authContext,
      modelAdapter: args.modelAdapter,
      dataGateway: args.dataGateway,
      revealTokenService: args.revealTokenService,
      auditSink,
    });

    const body = {
      status: result.status,
      response: result.response,
      nextConversationState: result.nextConversationState,
    };
    assertNoUnsafeModelContent(body);
    await recordChatAudit(auditSink, {
      eventType: "chat_request_completed",
      authContext: args.authContext,
      status: result.status,
      allowed: true,
      reason: "V2 chat request completed.",
      metadata: {
        responseType: result.response.responseType,
        secureRevealCardCount: result.response.secureRevealCards.length,
        missingItemCount: result.response.missingOrUnverified.length,
        sourceBackedFactCount: result.response.sourceBackedFacts.length,
        recommendedStepCount: result.response.recommendedSteps.length,
        durationMs: Date.now() - startedAt,
      },
    });
    return response(200, body);
  } catch {
    await recordChatAudit(auditSink, {
      eventType: "chat_request_error",
      authContext: args.authContext,
      status: "error",
      allowed: false,
      reason: "V2 chat request failed.",
      metadata: { durationMs: Date.now() - startedAt },
    });
    return response(500, {
      status: "error",
      error: "Chat turn failed.",
    });
  }
}

async function recordChatAudit(
  auditSink: V2AuditSink | undefined,
  args: {
    eventType:
      | "chat_request_received"
      | "chat_request_denied"
      | "chat_request_completed"
      | "chat_request_error";
    authContext: DataIntelligenceV2AuthContext | null;
    status: string;
    allowed: boolean;
    reason: string;
    metadata?: Record<string, unknown>;
  },
) {
  if (!auditSink) {
    return;
  }

  try {
    await auditSink.record({
      eventType: args.eventType,
      eventCategory: "chat",
      ownerEmail: args.authContext?.ownerEmail,
      userEmail: args.authContext?.userEmail,
      userId: args.authContext?.userId,
      firmId: args.authContext?.firmId,
      role: args.authContext?.role,
      status: args.status,
      allowed: args.allowed,
      reason: args.reason,
      metadata: args.metadata,
    });
  } catch {
    // Chat audit failures must not leak or alter the public response path.
  }
}

function safeGetDefaultV2AuditSink(): V2AuditSink | undefined {
  try {
    return getDefaultV2AuditSink();
  } catch {
    return undefined;
  }
}

function response(status: number, body: unknown): V2ChatApiHandlerResult {
  return {
    status,
    headers: V2_CHAT_API_NO_CACHE_HEADERS,
    body,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
