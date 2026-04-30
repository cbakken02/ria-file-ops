import {
  createSafeErrorAssistantResponse,
  mergeToolArtifactsIntoAssistantResponse,
  sanitizeV2AssistantResponseForUser,
  validateV2AssistantResponse,
  type V2AssistantResponse,
} from "@/lib/data-intelligence-v2/assistant-response";
import {
  deriveSafeConversationStateFromToolResults,
  sanitizeSafeConversationState,
} from "@/lib/data-intelligence-v2/conversation-state";
import { buildV2SystemPrompt } from "@/lib/data-intelligence-v2/system-prompt";
import {
  assertNoUnsafeModelContent,
  containsUnsafeSensitivePattern,
  sanitizeConversationMessagesForModel,
  sanitizeObjectForModel,
  sanitizeTextForModel,
} from "@/lib/data-intelligence-v2/safe-memory";
import type { ClientDataGateway } from "@/lib/data-intelligence-v2/data-gateway";
import type { RevealTokenService } from "@/lib/data-intelligence-v2/reveal-token-service";
import {
  listV2ToolDefinitions,
  isV2ToolName,
} from "@/lib/data-intelligence-v2/tools/registry";
import { runV2Tool } from "@/lib/data-intelligence-v2/tools/runner";
import {
  createToolResult,
} from "@/lib/data-intelligence-v2/tools/result-helpers";
import type { V2AuditSink, V2AuditEventType } from "@/lib/data-intelligence-v2/audit";
import {
  UnavailableV2ModelAdapter,
  type V2ModelAdapter,
  type V2ModelAdapterResponse,
  type V2ModelInputMessage,
  type V2ModelToolCall,
  type V2ModelToolResultMessage,
} from "@/lib/data-intelligence-v2/model-adapter";
import type {
  DataIntelligenceV2AuthContext,
  SafeConversationState,
  V2ToolName,
  V2ToolResult,
  VisibleConversationMessage,
} from "@/lib/data-intelligence-v2/types";

export type RunV2ToolLoopArgs = {
  userMessage: string;
  visibleHistory?: VisibleConversationMessage[];
  safeConversationState?: SafeConversationState;
  authContext: DataIntelligenceV2AuthContext;
  modelAdapter?: V2ModelAdapter;
  dataGateway?: ClientDataGateway;
  revealTokenService?: RevealTokenService;
  auditSink?: V2AuditSink;
  maxToolIterations?: number;
};

export type RunV2ToolLoopResult = {
  response: V2AssistantResponse;
  nextConversationState: SafeConversationState;
  toolResults: V2ToolResult[];
  modelMessagesSent: V2ModelInputMessage[];
};

export async function runV2ToolLoop(
  args: RunV2ToolLoopArgs,
): Promise<RunV2ToolLoopResult> {
  const systemPrompt = buildV2SystemPrompt();
  const messages = buildModelMessages(args.visibleHistory, args.userMessage);
  const safeConversationState = sanitizeSafeConversationState(
    args.safeConversationState,
  );
  const modelMessagesSent = messages;
  const toolResults: V2ToolResult[] = [];
  const previousToolResults: V2ModelToolResultMessage[] = [];
  const modelAdapter = args.modelAdapter ?? new UnavailableV2ModelAdapter();
  const maxToolIterations = Math.max(0, args.maxToolIterations ?? 8);
  let providerState: unknown;
  let recordedUnavailableAdapter = false;

  try {
    assertNoUnsafeModelContent(systemPrompt);
    assertNoUnsafeModelContent(messages);
    assertNoUnsafeModelContent(safeConversationState);

    for (let iteration = 0; iteration <= maxToolIterations; iteration += 1) {
      assertNoUnsafeModelContent(previousToolResults);
      if (
        args.auditSink &&
        modelAdapter instanceof UnavailableV2ModelAdapter &&
        !recordedUnavailableAdapter
      ) {
        recordedUnavailableAdapter = true;
        await recordLoopAudit(args.auditSink, {
          eventType: "model_adapter_unavailable",
          eventCategory: "model",
          authContext: args.authContext,
          status: "unavailable",
          allowed: false,
          reason: "V2 model adapter is not configured.",
          metadata: { iteration, modelConfigured: false },
        });
      }

      const adapterResponse = await modelAdapter.run({
        systemPrompt,
        messages,
        safeConversationState,
        toolDefinitions: listV2ToolDefinitions(),
        previousToolResults,
        iteration,
        providerState,
      });

      if (!isModelAdapterResponse(adapterResponse)) {
        await recordLoopAudit(args.auditSink, {
          eventType: "model_adapter_error",
          eventCategory: "model",
          authContext: args.authContext,
          status: "invalid_response",
          allowed: false,
          reason: "Model adapter returned invalid output.",
          metadata: { iteration },
        });
        return safeLoopResult({
          response: createSafeErrorAssistantResponse(
            "I could not safely interpret the model response.",
          ),
          previousState: safeConversationState,
          toolResults,
          modelMessagesSent,
        });
      }

      if (adapterResponse.type === "final_response") {
        providerState = mergeModelProviderState(
          providerState,
          adapterResponse.providerState,
        );
        if (containsUnsafeSensitivePattern(adapterResponse.response)) {
          await recordLoopAudit(args.auditSink, {
            eventType: "safety_validation_failed",
            eventCategory: "safety",
            authContext: args.authContext,
            status: "unsafe_final_response",
            allowed: false,
            reason: "Model final response failed safety validation.",
          });
        }
        await recordLoopAudit(args.auditSink, {
          eventType: "model_adapter_completed",
          eventCategory: "model",
          authContext: args.authContext,
          status: "final_response",
          allowed: true,
          reason: "Model adapter returned a final response.",
          metadata: {
            iteration,
            finalResponseType: adapterResponse.response.responseType,
          },
        });
        return finalizeLoopResult({
          response: adapterResponse.response,
          previousState: safeConversationState,
          toolResults,
          modelMessagesSent,
        });
      }

      if (iteration >= maxToolIterations) {
        await recordLoopAudit(args.auditSink, {
          eventType: "model_adapter_error",
          eventCategory: "model",
          authContext: args.authContext,
          status: "tool_limit",
          allowed: false,
          reason: "Tool iteration limit reached.",
          metadata: { iteration, maxToolIterations },
        });
        return safeLoopResult({
          response: createSafeErrorAssistantResponse(
            "I could not finish the request within the tool limit.",
          ),
          previousState: safeConversationState,
          toolResults,
          modelMessagesSent,
        });
      }

      providerState = mergeModelProviderState(
        providerState,
        adapterResponse.providerState,
      );
      for (const toolCall of adapterResponse.toolCalls) {
        const result = await executeToolCall({
          toolCall,
          authContext: args.authContext,
          dataGateway: args.dataGateway,
          revealTokenService: args.revealTokenService,
          auditSink: args.auditSink,
        });
        const sanitizedResult = {
          ...(sanitizeObjectForModel(result) as V2ToolResult),
          secureRevealCards: result.secureRevealCards,
        };
        try {
          assertNoUnsafeModelContent(sanitizedResult);
        } catch {
          await recordLoopAudit(args.auditSink, {
            eventType: "safety_validation_failed",
            eventCategory: "safety",
            authContext: args.authContext,
            toolName: isV2ToolName(toolCall.toolName)
              ? toolCall.toolName
              : undefined,
            status: "unsafe_tool_result",
            allowed: false,
            reason: "Tool result failed model-safety validation.",
          });
          toolResults.push(
            createToolResult({
              toolName: "resolve_client",
              status: "error",
              summary: "Tool result failed model-safety validation.",
              disallowedClaims: [
                "Do not use unsafe tool output as a factual source.",
              ],
            }),
          );
          continue;
        }

        toolResults.push(sanitizedResult);
        previousToolResults.push({
          callId: sanitizeTextForModel(toolCall.callId),
          toolName: sanitizedResult.toolName,
          result: sanitizedResult,
        });
      }
    }
  } catch {
    await recordLoopAudit(args.auditSink, {
      eventType: "model_adapter_error",
      eventCategory: "model",
      authContext: args.authContext,
      status: "error",
      allowed: false,
      reason: "Tool loop failed before producing a safe result.",
    });
    return safeLoopResult({
      response: createSafeErrorAssistantResponse(
        "I could not safely complete that request.",
      ),
      previousState: safeConversationState,
      toolResults,
      modelMessagesSent,
    });
  }

  return safeLoopResult({
    response: createSafeErrorAssistantResponse(
      "I could not finish the request within the tool limit.",
    ),
    previousState: safeConversationState,
    toolResults,
    modelMessagesSent,
  });
}

function buildModelMessages(
  visibleHistory: VisibleConversationMessage[] | undefined,
  userMessage: string,
): V2ModelInputMessage[] {
  const safeHistory = sanitizeConversationMessagesForModel(visibleHistory ?? [], {
    maxMessages: 8,
  }).map((message) => ({
    role: message.role,
    content: message.content,
  }));

  return [
    ...safeHistory,
    {
      role: "user" as const,
      content: sanitizeTextForModel(userMessage),
    },
  ];
}

async function executeToolCall(args: {
  toolCall: V2ModelToolCall;
  authContext: DataIntelligenceV2AuthContext;
  dataGateway?: ClientDataGateway;
  revealTokenService?: RevealTokenService;
  auditSink?: V2AuditSink;
}): Promise<V2ToolResult> {
  if (!isRecord(args.toolCall) || !isV2ToolName(args.toolCall.toolName)) {
    return createToolResult({
      toolName: "resolve_client",
      status: "error",
      summary: "Model requested an unknown V2 tool.",
      disallowedClaims: ["Do not use invalid tool output as a factual source."],
    });
  }

  return runV2Tool({
    toolName: args.toolCall.toolName,
    args: isRecord(args.toolCall.args) ? args.toolCall.args : {},
    authContext: args.authContext,
    dataGateway: args.dataGateway,
    revealTokenService: args.revealTokenService,
    auditSink: args.auditSink,
  });
}

async function recordLoopAudit(
  auditSink: V2AuditSink | undefined,
  event: {
    eventType: V2AuditEventType;
    eventCategory: "model" | "safety";
    authContext: DataIntelligenceV2AuthContext;
    toolName?: V2ToolName;
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
      eventType: event.eventType,
      eventCategory: event.eventCategory,
      ownerEmail: event.authContext.ownerEmail,
      userEmail: event.authContext.userEmail,
      userId: event.authContext.userId,
      firmId: event.authContext.firmId,
      role: event.authContext.role,
      toolName: event.toolName,
      status: event.status,
      allowed: event.allowed,
      reason: event.reason,
      metadata: event.metadata,
    });
  } catch {
    // Audit failures should not leak or interrupt model-safe fallback behavior.
  }
}

function finalizeLoopResult(args: {
  response: V2AssistantResponse;
  previousState: SafeConversationState;
  toolResults: V2ToolResult[];
  modelMessagesSent: V2ModelInputMessage[];
}): RunV2ToolLoopResult {
  try {
    const validated = validateV2AssistantResponse(args.response);
    const merged = mergeToolArtifactsIntoAssistantResponse({
      response: validated,
      toolResults: args.toolResults,
    });
    const sanitized = sanitizeV2AssistantResponseForUser(merged);
    const nextConversationState = deriveSafeConversationStateFromToolResults({
      previousState: args.previousState,
      toolResults: args.toolResults,
      assistantResponse: sanitized,
    });

    return {
      response: sanitized,
      nextConversationState,
      toolResults: args.toolResults,
      modelMessagesSent: args.modelMessagesSent,
    };
  } catch {
    return safeLoopResult({
      response: createSafeErrorAssistantResponse(
        "I could not safely produce that response.",
      ),
      previousState: args.previousState,
      toolResults: args.toolResults,
      modelMessagesSent: args.modelMessagesSent,
    });
  }
}

function safeLoopResult(args: {
  response: V2AssistantResponse;
  previousState: SafeConversationState;
  toolResults: V2ToolResult[];
  modelMessagesSent: V2ModelInputMessage[];
}): RunV2ToolLoopResult {
  const response = sanitizeV2AssistantResponseForUser(args.response);
  const nextConversationState = deriveSafeConversationStateFromToolResults({
    previousState: args.previousState,
    toolResults: args.toolResults,
    assistantResponse: response,
  });

  return {
    response,
    nextConversationState,
    toolResults: args.toolResults,
    modelMessagesSent: args.modelMessagesSent,
  };
}

function isModelAdapterResponse(
  response: unknown,
): response is V2ModelAdapterResponse {
  if (!isRecord(response)) {
    return false;
  }

  if (response.type === "final_response") {
    return "response" in response;
  }

  if (response.type === "tool_calls") {
    return Array.isArray(response.toolCalls);
  }

  return false;
}

function mergeModelProviderState(previous: unknown, next: unknown): unknown {
  if (!isRecord(next)) {
    return previous;
  }

  if (
    Array.isArray(next.responseOutputItems) &&
    (!previous ||
      (isRecord(previous) && Array.isArray(previous.responseOutputItems)))
  ) {
    const previousItems =
      isRecord(previous) && Array.isArray(previous.responseOutputItems)
        ? previous.responseOutputItems
        : [];
    return {
      ...next,
      responseOutputItems: dedupeProviderItems([
        ...previousItems,
        ...next.responseOutputItems,
      ]),
    };
  }

  return next;
}

function dedupeProviderItems(items: unknown[]) {
  const seen = new Set<string>();
  const deduped: unknown[] = [];

  for (const item of items) {
    const key = providerItemKey(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function providerItemKey(item: unknown) {
  if (isRecord(item)) {
    if (typeof item.call_id === "string") {
      return `call:${item.call_id}`;
    }
    if (typeof item.id === "string") {
      return `id:${item.id}`;
    }
    if (typeof item.type === "string") {
      return `type:${item.type}:${JSON.stringify(item)}`;
    }
  }

  return JSON.stringify(item);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
