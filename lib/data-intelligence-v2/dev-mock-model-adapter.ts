import {
  sanitizeV2AssistantResponseForUser,
  type V2AssistantResponse,
} from "@/lib/data-intelligence-v2/assistant-response";
import type {
  V2ModelAdapter,
  V2ModelAdapterRequest,
  V2ModelAdapterResponse,
  V2ModelToolCall,
} from "@/lib/data-intelligence-v2/model-adapter";
import type {
  SafeConversationState,
  V2MissingDataItem,
} from "@/lib/data-intelligence-v2/types";

// Dev/eval-only deterministic adapter for local QA. This is intentionally
// simple keyword routing and must not be used as the production assistant.
export class DevMockV2ModelAdapter implements V2ModelAdapter {
  async run(
    request: V2ModelAdapterRequest,
  ): Promise<V2ModelAdapterResponse> {
    if (request.previousToolResults.length > 0) {
      return {
        type: "final_response",
        response: responseFromToolResults(request),
      };
    }

    const latestUserMessage = latestUserContent(request).toLowerCase();
    const toolCalls = toolCallsForMessage(
      latestUserMessage,
      request.safeConversationState,
    );
    if (toolCalls.length > 0) {
      return {
        type: "tool_calls",
        toolCalls,
      };
    }

    return {
      type: "final_response",
      response: sanitizeV2AssistantResponseForUser({
        responseType: isDraftFollowup(
          latestUserMessage,
          request.safeConversationState,
        )
          ? "task_assist"
          : "general_guidance",
        answerMarkdown: isDraftFollowup(
          latestUserMessage,
          request.safeConversationState,
        )
          ? "Dev mock mode drafted a safe advisor note from the prior safe conversation state."
          : "Dev mock mode is active. Try asking about Alex Demo statements, tax documents, transfer requirements, or a secure reveal card.",
        sourceBackedFacts: [],
        missingOrUnverified: [],
        recommendedSteps: [
          "Use Alex Demo for mock client-specific requests.",
          "Ask for a secure reveal card instead of raw sensitive values.",
        ],
        secureRevealCards: [],
        ...(isDraftFollowup(latestUserMessage, request.safeConversationState)
          ? {
              draftNote: {
                audience: "advisor",
                bodyMarkdown:
                  "Mock V2 note: Alex Demo has safe mock records available. Use secure reveal cards for sensitive form fields and verify any missing paperwork before submission.",
                containsSensitivePlaceholders: true,
              },
            }
          : {}),
        followupSuggestions: [
          "For Alex Demo, get the latest Schwab statement.",
          "For Alex Demo, create a secure reveal card for the full account number.",
        ],
      }),
    };
  }
}

function latestUserContent(request: V2ModelAdapterRequest) {
  return [...request.messages]
    .reverse()
    .find((message) => message.role === "user")?.content ?? "";
}

function toolCallsForMessage(
  message: string,
  state: SafeConversationState,
): V2ModelToolCall[] {
  if (isDraftFollowup(message, state)) {
    return [];
  }

  if (isShowAgainFollowup(message, state)) {
    const latestReveal = state.lastSensitiveReveals?.[0];
    if (latestReveal?.field === "ssn") {
      return [
        revealCall({
          callId: "dev_call_repeat_ssn_reveal",
          fieldKey: "client.ssn",
          label: "Alex Demo SSN",
        }),
      ];
    }

    return [
      revealCall({
        callId: "dev_call_repeat_account_reveal",
        fieldKey: "account.fullAccountNumber",
        accountId: "mock_account_schwab_ira",
        label: "Mock Schwab IRA account number",
      }),
    ];
  }

  const clientQuery = clientQueryForMessage(message);
  if (!clientQuery) {
    return [];
  }

  const calls: V2ModelToolCall[] = [
    {
      callId: "dev_call_resolve_client",
      toolName: "resolve_client",
      args: { query: clientQuery.query, limit: 3 },
    },
  ];

  if (!clientQuery.clientId) {
    return calls;
  }

  if (shouldGetAccounts(message)) {
    calls.push({
      callId: "dev_call_accounts",
      toolName: "get_accounts",
      args: {
        clientId: clientQuery.clientId,
        custodian: message.includes("schwab") ? "Schwab" : undefined,
        limit: 5,
      },
    });
  }

  if (message.includes("statement") || message.includes("schwab")) {
    calls.push({
      callId: "dev_call_latest_statement",
      toolName: "get_latest_statements",
      args: {
        clientId: clientQuery.clientId,
        custodian: "Schwab",
        limit: 3,
      },
    });
  }

  if (message.includes("tax")) {
    calls.push({
      callId: "dev_call_tax_documents",
      toolName: "get_tax_documents",
      args: {
        clientId: clientQuery.clientId,
        taxYear: taxYearForMessage(message),
        formTypes: ["1099"],
        limit: 3,
      },
    });
  }

  if (shouldCheckWorkflow(message)) {
    calls.push({
      callId: "dev_call_workflow",
      toolName: "check_workflow_requirements",
      args: {
        clientId: clientQuery.clientId,
        workflowType: workflowTypeForMessage(message),
      },
    });
  }

  if (shouldGetIdentityStatus(message)) {
    calls.push({
      callId: "dev_call_identity",
      toolName: "get_identity_status",
      args: {
        clientId: clientQuery.clientId,
        fields: ["ssn", "dob", "address", "phone", "email"],
      },
    });
  }

  if (message.includes("ssn")) {
    calls.push(
      revealCall({
        callId: "dev_call_ssn_reveal",
        fieldKey: "client.ssn",
        label: "Alex Demo SSN",
      }),
    );
  }

  if (message.includes("account number") || message.includes("full account")) {
    calls.push(
      revealCall({
        callId: "dev_call_account_reveal",
        fieldKey: "account.fullAccountNumber",
        accountId: "mock_account_schwab_ira",
        label: "Mock Schwab IRA account number",
      }),
    );
  }

  return calls;
}

function clientQueryForMessage(message: string):
  | { query: string; clientId?: string }
  | undefined {
  if (message.includes("alex demo") || message.includes("alex")) {
    return { query: "Alex Demo", clientId: "mock_client_alex" };
  }
  if (message.includes("taylor test") || message.includes("taylor")) {
    return { query: "Taylor Test", clientId: "mock_client_taylor" };
  }
  if (message.includes("jordan sample") || message.includes("jordan")) {
    return { query: "Jordan Sample", clientId: "mock_client_jordan" };
  }
  if (message.includes("pat unknown")) {
    return { query: "Pat Unknown" };
  }
  if (message.includes("demo")) {
    return { query: "demo" };
  }

  return undefined;
}

function shouldGetAccounts(message: string) {
  return (
    message.includes("account summary") ||
    message.includes("what accounts") ||
    message.includes("accounts do we") ||
    (message.includes("account") && !message.includes("account number"))
  );
}

function shouldGetIdentityStatus(message: string) {
  return (
    message.includes("identity") ||
    message.includes(" id ") ||
    message.includes(" id.") ||
    message.includes("dob") ||
    message.includes("date of birth") ||
    message.includes("new account") ||
    message.includes("transfer")
  );
}

function shouldCheckWorkflow(message: string) {
  return (
    message.includes("new account") ||
    message.includes("transfer") ||
    message.includes("rollover") ||
    message.includes("beneficiary") ||
    message.includes("address change") ||
    message.includes("cash management") ||
    message.includes("document verification")
  );
}

function workflowTypeForMessage(message: string) {
  if (message.includes("transfer")) {
    return "transfer";
  }
  if (message.includes("rollover")) {
    return "rollover";
  }
  if (message.includes("beneficiary")) {
    return "beneficiary_update";
  }
  if (message.includes("address change")) {
    return "address_change";
  }
  if (message.includes("cash management")) {
    return "cash_management";
  }
  if (message.includes("document verification")) {
    return "document_verification";
  }
  return "new_account";
}

function taxYearForMessage(message: string) {
  const match = message.match(/\b(20\d{2}|19\d{2})\b/);
  return match ? Number(match[1]) : 2023;
}

function revealCall(args: {
  callId: string;
  fieldKey: "client.ssn" | "account.fullAccountNumber";
  accountId?: string;
  label: string;
}): V2ModelToolCall {
  return {
    callId: args.callId,
    toolName: "create_sensitive_reveal",
    args: {
      clientId: "mock_client_alex",
      ...(args.accountId ? { accountId: args.accountId } : {}),
      fieldKey: args.fieldKey,
      purpose: "form_completion",
      label: args.label,
    },
  };
}

function isDraftFollowup(message: string, state: SafeConversationState) {
  return (
    message.includes("draft") &&
    message.includes("note") &&
    Boolean(
      state.activeClientId ||
        state.lastResolvedClients?.length ||
        state.lastSensitiveReveals?.length,
    )
  );
}

function isShowAgainFollowup(message: string, state: SafeConversationState) {
  return (
    (message.includes("show that again") || message.includes("show it again")) &&
    Boolean(state.lastSensitiveReveals?.length)
  );
}

function responseFromToolResults(
  request: V2ModelAdapterRequest,
): V2AssistantResponse {
  const toolResults = request.previousToolResults.map(
    (message) => message.result,
  );
  const facts = toolResults.flatMap((result) => result.facts);
  const missing = toolResults.flatMap((result) => result.missing);
  const revealCards = toolResults.flatMap((result) => result.secureRevealCards);
  const usedWorkflowTool = toolResults.some(
    (result) => result.toolName === "check_workflow_requirements",
  );
  const usedResolveOnly =
    toolResults.length === 1 && toolResults[0]?.toolName === "resolve_client";
  const hasAmbiguity = toolResults.some((result) => result.status === "ambiguous");
  const hasNotFound = toolResults.some((result) => result.status === "not_found");

  return sanitizeV2AssistantResponseForUser({
    responseType: hasAmbiguity
      ? "clarification_needed"
      : hasNotFound
        ? "missing_data"
        : usedResolveOnly
          ? "client_data_answer"
          : missing.length > 0
            ? "task_assist"
            : "client_data_answer",
    answerMarkdown: buildAnswer(toolResults.length, revealCards.length, missing),
    sourceBackedFacts: facts.slice(0, 12).map((fact) => ({
      fact: `${fact.label}: ${fact.displayValue}`,
      sourceRefs: fact.sourceRefs,
      confidence: fact.confidence,
    })),
    missingOrUnverified: missing,
    recommendedSteps: buildRecommendedSteps(revealCards.length, missing),
    secureRevealCards: [],
    ...(usedWorkflowTool || isDraftRequest(request)
      ? {
          draftNote: {
            audience: "advisor",
            bodyMarkdown:
              "Mock V2 note: Alex Demo has source-backed mock records available. Use secure reveal cards for sensitive form fields and request any missing paperwork before submission.",
            containsSensitivePlaceholders: true,
          },
        }
      : {}),
    followupSuggestions: [
      "Draft a note to the advisor.",
      "Check tax documents for Alex Demo.",
      "Create a secure reveal card for Alex Demo SSN.",
    ],
  });
}

function buildAnswer(
  toolResultCount: number,
  revealCardCount: number,
  missing: V2MissingDataItem[],
) {
  const parts = [
    `Dev mock mode checked ${toolResultCount} V2 tool result${toolResultCount === 1 ? "" : "s"}.`,
  ];

  if (revealCardCount > 0) {
    parts.push(
      "A secure reveal card is available. The raw value was not shown to the model.",
    );
  }

  if (missing.length > 0) {
    parts.push("Some mock requirements are missing or need verification.");
  }

  return parts.join(" ");
}

function buildRecommendedSteps(
  revealCardCount: number,
  missing: V2MissingDataItem[],
) {
  const steps = [
    "Review the source-backed mock facts before taking action.",
  ];

  if (revealCardCount > 0) {
    steps.push("Use the secure reveal card only when the value is needed.");
  }

  if (missing.length > 0) {
    steps.push("Request or upload the missing mock paperwork.");
  }

  return steps;
}

function isDraftRequest(request: V2ModelAdapterRequest) {
  const message = latestUserContent(request).toLowerCase();
  return message.includes("draft") && message.includes("note");
}
