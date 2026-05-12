import {
  askFirmDocumentAssistant,
  type AskFirmDocumentAssistantInput,
  type QueryAssistantResult,
  type QueryAssistantSection,
  type QueryAssistantSource,
  type QueryAssistantSourcedFact,
} from "@/lib/query-assistant";
import {
  getDataIntelligenceAssistantRuntimeConfig,
  type DataIntelligenceConfigDiagnostics,
} from "@/lib/data-intelligence-assistant-config";
import {
  applyDataIntelligenceComposition,
  composeDataIntelligenceAnswerWithModel,
  type DataIntelligenceModelStepDebug,
  interpretDataIntelligenceQuestionWithModel,
} from "@/lib/data-intelligence-model-orchestrator";
import type {
  DataIntelligenceConversationState,
  DataIntelligenceConversationMessage,
} from "@/lib/data-intelligence-conversation";
import {
  applyDataIntelligencePendingClarification,
  deriveDataIntelligenceConversationStateFromResult,
  sanitizeDataIntelligenceConversationState,
} from "@/lib/data-intelligence-conversation";
import { buildQueryAssistantRetrievalPlan } from "@/lib/query-assistant";

type DataIntelligenceModelFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type AnswerDataIntelligenceQuestionInput = AskFirmDocumentAssistantInput & {
  history?: DataIntelligenceConversationMessage[];
  conversationState?: DataIntelligenceConversationState | null;
  modelFetch?: DataIntelligenceModelFetch;
  includeDebug?: boolean;
};

export type DataIntelligenceHybridDebugTrace = {
  devOnly: true;
  config: DataIntelligenceConfigDiagnostics;
  historyCount: number;
  interpretation: DataIntelligenceModelStepDebug & {
    fallbackUsed: boolean;
    sensitivePolicyBlocked: boolean;
    standaloneQuestion: string | null;
    interpretedPlan: QueryAssistantPlanDebug | null;
  };
  conversationStatePresent: boolean;
  composition: DataIntelligenceModelStepDebug & {
    fallbackUsed: boolean;
  };
  deterministicFallbackPlan: QueryAssistantPlanDebug;
  executedQuestion: string;
  executedPlan: QueryAssistantPlanDebug;
  finalResult: {
    status: string;
    intent: string | null;
    sourceCount: number;
  };
};

type QueryAssistantPlanDebug = {
  intent: string | null;
  documentFamily: string | null;
  questionType: string;
  familyScope: string | null;
  accountType: string | null;
  accountFieldRequest: string | null;
  contactPurpose: string | null;
  contactMethod: string | null;
  identityKind: string | null;
  valuePreference: string | null;
  clarificationTarget: string | null;
  preferredResponseMode: string;
};

export async function answerDataIntelligenceQuestion(
  input: AnswerDataIntelligenceQuestionInput,
): Promise<QueryAssistantResult> {
  const config = getDataIntelligenceAssistantRuntimeConfig();
  const question = input.question.trim();
  const history = input.history ?? [];
  const conversationState =
    sanitizeDataIntelligenceConversationState(input.conversationState) ?? null;
  const directQuestionPlan = buildQueryAssistantRetrievalPlan(question);
  const stateAwareFallbackQuestion =
    buildStateAwareFallbackQuestion(question, conversationState) ?? question;
  const preferStateAwareFallback =
    !input.retrievalQuestion &&
    !input.retrievalPlan &&
    stateAwareFallbackQuestion !== question &&
    directQuestionPlan.questionType === "unsupported";
  const fallbackPlan = buildQueryAssistantRetrievalPlan(stateAwareFallbackQuestion);
  const trace: DataIntelligenceHybridDebugTrace | null = input.includeDebug
    ? {
        devOnly: true,
        config: config.diagnostics,
        historyCount: history.length,
        conversationStatePresent: Boolean(conversationState),
        interpretation: {
          attempted: false,
          succeeded: false,
          failureReason: null,
          fallbackUsed: false,
          sensitivePolicyBlocked: false,
          standaloneQuestion: null,
          interpretedPlan: null,
        },
        composition: {
          attempted: false,
          succeeded: false,
          failureReason: null,
          fallbackUsed: false,
        },
        deterministicFallbackPlan: summarizePlan(fallbackPlan),
        executedQuestion: stateAwareFallbackQuestion,
        executedPlan: summarizePlan(input.retrievalPlan ?? fallbackPlan),
        finalResult: {
          status: "unknown",
          intent: null,
          sourceCount: 0,
        },
      }
    : null;

  const compositeResult = answerRolloverCallBrief({
    input,
    question,
    conversationState,
    fallbackQuestion: stateAwareFallbackQuestion,
  });
  if (compositeResult) {
    const finalCompositeResult = finalizeDataIntelligenceResult({
      result: compositeResult,
      previousState: conversationState,
      question,
    });
    if (trace) {
      trace.interpretation.failureReason = "composite_request";
      trace.interpretation.fallbackUsed = true;
      trace.composition.failureReason = "composite_request";
      trace.composition.fallbackUsed = true;
      trace.finalResult = summarizeResult(finalCompositeResult);
      return attachDebugTrace(finalCompositeResult, trace);
    }

    return finalCompositeResult;
  }

  if (
    shouldUseDeterministicSourceAnswer({
      question,
      plan: directQuestionPlan,
      stateAwareFallbackQuestion,
      hasRetrievalOverride: Boolean(input.retrievalQuestion || input.retrievalPlan),
    })
  ) {
    const deterministicResult = askFirmDocumentAssistant({
      ...input,
      question,
      retrievalQuestion: question,
      retrievalPlan: directQuestionPlan,
    });
    const finalResult = finalizeDataIntelligenceResult({
      result: deterministicResult,
      previousState: conversationState,
      question,
    });
    if (trace) {
      trace.interpretation.failureReason = "deterministic_source_answer";
      trace.interpretation.fallbackUsed = true;
      trace.composition.failureReason = "deterministic_source_answer";
      trace.composition.fallbackUsed = true;
      trace.executedQuestion = question;
      trace.executedPlan = summarizePlan(directQuestionPlan);
      trace.finalResult = summarizeResult(finalResult);
      return attachDebugTrace(finalResult, trace);
    }

    return finalResult;
  }

  if (shouldUseContextualCopilotFallback(question, conversationState)) {
    const result = maybeBuildConversationalFallbackResult({
      result: askFirmDocumentAssistant({
        ...input,
        retrievalQuestion: input.retrievalQuestion ?? stateAwareFallbackQuestion,
        retrievalPlan: input.retrievalPlan ?? fallbackPlan,
      }),
      question,
      conversationState,
    });
    const finalResult = finalizeDataIntelligenceResult({
      result,
      previousState: conversationState,
      question,
    });
    if (trace) {
      trace.interpretation.failureReason = "contextual_copilot_fallback";
      trace.interpretation.fallbackUsed = true;
      trace.composition.failureReason = "contextual_copilot_fallback";
      trace.composition.fallbackUsed = true;
      trace.executedQuestion = stateAwareFallbackQuestion;
      trace.executedPlan = summarizePlan(input.retrievalPlan ?? fallbackPlan);
      trace.finalResult = summarizeResult(finalResult);
      return attachDebugTrace(finalResult, trace);
    }

    return finalResult;
  }

  if (!config.aiEnabled || !config.providerConfigured) {
    const result = maybeBuildConversationalFallbackResult({
      result: askFirmDocumentAssistant({
        ...input,
        retrievalQuestion: input.retrievalQuestion ?? stateAwareFallbackQuestion,
        retrievalPlan: input.retrievalPlan ?? fallbackPlan,
      }),
      question,
      conversationState,
    });
    const finalResult = finalizeDataIntelligenceResult({
      result,
      previousState: conversationState,
      question,
    });
    if (trace) {
      trace.interpretation.failureReason = !config.aiEnabled
        ? "ai_disabled"
        : "provider_not_configured";
      trace.interpretation.fallbackUsed = true;
      trace.composition.failureReason = !config.aiEnabled
        ? "ai_disabled"
        : "provider_not_configured";
      trace.composition.fallbackUsed = true;
      trace.finalResult = summarizeResult(finalResult);
      return attachDebugTrace(finalResult, trace);
    }

    return finalResult;
  }

  const interpretation = preferStateAwareFallback
    ? null
    : await interpretDataIntelligenceQuestionWithModel({
        question,
        history,
        conversationState,
        fallbackPlan,
        config,
        fetchImpl: input.modelFetch,
        debug: trace?.interpretation,
      });
  if (trace && preferStateAwareFallback) {
    trace.interpretation.failureReason = "state_aware_fallback";
    trace.interpretation.fallbackUsed = true;
  }
  if (trace && interpretation) {
    trace.interpretation.standaloneQuestion = interpretation.standaloneQuestion;
    trace.interpretation.interpretedPlan = summarizePlan(
      interpretation.retrievalPlan,
    );
  }
  const sensitivePolicyBlocked = Boolean(
    interpretation &&
      !modelInterpretationHonorsSensitiveFieldPolicy({
        question,
        history,
        accountFieldRequest: interpretation.retrievalPlan.accountFieldRequest,
      }),
  );
  const safeInterpretation =
    interpretation && !sensitivePolicyBlocked
      ? interpretation
      : null;
  if (trace) {
    trace.interpretation.sensitivePolicyBlocked = sensitivePolicyBlocked;
    trace.interpretation.fallbackUsed = !safeInterpretation;
    if (sensitivePolicyBlocked) {
      trace.interpretation.failureReason = "sensitive_account_number_policy";
    }
  }
  const executedQuestion =
    safeInterpretation?.standaloneQuestion ??
    input.retrievalQuestion ??
    stateAwareFallbackQuestion;
  const executedPlan =
    safeInterpretation?.retrievalPlan ?? input.retrievalPlan ?? fallbackPlan;
  if (trace) {
    trace.executedQuestion = executedQuestion;
    trace.executedPlan = summarizePlan(executedPlan);
  }
  const deterministicResult = askFirmDocumentAssistant({
    ...input,
    question,
    retrievalQuestion: executedQuestion,
    retrievalPlan: executedPlan,
  });
  const stateAdjustedResult = normalizeKnownClientContinuityNotFound({
    result: deterministicResult,
    state: conversationState,
    preferStateAwareFallback,
  });
  const displayResult = {
    ...stateAdjustedResult,
    question,
  };
  const composition = await composeDataIntelligenceAnswerWithModel({
    question,
    history,
    result: displayResult,
    config,
    fetchImpl: input.modelFetch,
    debug: trace?.composition,
  });
  if (trace) {
    trace.composition.fallbackUsed = !composition;
  }

  const finalResult = finalizeDataIntelligenceResult({
    result: maybeBuildConversationalFallbackResult({
      result: applyDataIntelligenceComposition(displayResult, composition),
      question,
      conversationState,
    }),
    previousState: conversationState,
    question,
  });
  if (trace) {
    trace.finalResult = summarizeResult(finalResult);
    return attachDebugTrace(finalResult, trace);
  }

  return finalResult;
}

function shouldUseDeterministicSourceAnswer(input: {
  question: string;
  plan: ReturnType<typeof buildQueryAssistantRetrievalPlan>;
  stateAwareFallbackQuestion: string;
  hasRetrievalOverride: boolean;
}) {
  if (
    input.hasRetrievalOverride ||
    input.stateAwareFallbackQuestion !== input.question ||
    !input.plan.intent ||
    isGeneralCopilotRequest(input.question)
  ) {
    return false;
  }

  if (!questionHasExplicitClientReference(input.question)) {
    return false;
  }

  return (
    input.plan.preferredResponseMode === "direct_answer" ||
    (input.plan.intent === "latest_account_contact" &&
      Boolean(input.plan.contactMethod || input.plan.contactPurpose))
  );
}

function shouldUseContextualCopilotFallback(
  question: string,
  state: DataIntelligenceConversationState | null,
) {
  if (!isGeneralCopilotRequest(question) || !state) {
    return false;
  }

  return Boolean(
    state.activeClientName ||
      state.lastSources.length > 0 ||
      state.lastPrimarySource ||
      state.activeStatementSource,
  );
}

function answerRolloverCallBrief(input: {
  input: AnswerDataIntelligenceQuestionInput;
  question: string;
  conversationState: DataIntelligenceConversationState | null;
  fallbackQuestion: string;
}): QueryAssistantResult | null {
  if (
    !isRolloverCallBriefRequest(input.question) &&
    !isRolloverCallBriefRequest(input.fallbackQuestion)
  ) {
    return null;
  }

  const subject = buildScopedClientReference({
    question: input.question,
    fallbackQuestion: input.fallbackQuestion,
    state: input.conversationState,
  });
  if (!subject && isGeneralCopilotRequest(input.question)) {
    return null;
  }

  const contactQuestion = subject
    ? `What is the rollover support phone for ${subject}'s 401(k)?`
    : input.fallbackQuestion;
  const snapshotQuestion = subject
    ? `What is the latest 401(k) snapshot for ${subject}?`
    : input.fallbackQuestion;
  const contactResult = askFirmDocumentAssistant({
    ...input.input,
    question: input.question,
    retrievalQuestion: contactQuestion,
    retrievalPlan: buildQueryAssistantRetrievalPlan(contactQuestion),
  });

  if (contactResult.status === "ambiguous") {
    return {
      ...contactResult,
      answer:
        "I can build the rollover call brief, but first I need to know which matching client to use.",
    };
  }

  const snapshotResult = askFirmDocumentAssistant({
    ...input.input,
    question: input.question,
    retrievalQuestion: snapshotQuestion,
    retrievalPlan: buildQueryAssistantRetrievalPlan(snapshotQuestion),
  });

  if (snapshotResult.status === "ambiguous") {
    return {
      ...snapshotResult,
      answer:
        "I can build the rollover call brief, but first I need to know which matching client to use.",
    };
  }

  const sources = dedupeSources([
    ...contactResult.sources.map(stripFullAccountNumberFromSource),
    ...snapshotResult.sources.map(stripFullAccountNumberFromSource),
  ]);
  const primarySource = sources[0] ?? null;
  const snapshotSource =
    sources.find((source) => source.valueAmount || source.accountType) ??
    primarySource;
  const contactSource =
    sources.find((source) => source.contactValue) ?? primarySource;
  const clientName =
    firstPresentString([
      contactSource?.partyDisplayName,
      snapshotSource?.partyDisplayName,
      input.conversationState?.activeClientName,
      subject && !isInternalReference(subject) ? subject : null,
    ]) ?? "the client";
  const phone = contactSource?.contactValue ?? null;
  const foundLines = compact([
    phone ? `Rollover support phone: ${phone}` : null,
    snapshotSource?.institutionName
      ? `Institution: ${snapshotSource.institutionName}`
      : null,
    snapshotSource?.accountType ? `Account type: ${snapshotSource.accountType}` : null,
    snapshotSource?.accountLast4
      ? `Account identifier: ending in ${snapshotSource.accountLast4}`
      : snapshotSource?.maskedAccountNumber
        ? `Account identifier: ${snapshotSource.maskedAccountNumber}`
        : null,
    snapshotSource?.valueAmount
      ? `${snapshotSource.valueLabel ?? "Latest value"}: ${snapshotSource.valueAmount}`
      : null,
    snapshotSource?.statementEndDate
      ? `Latest statement end date: ${snapshotSource.statementEndDate}`
      : snapshotSource?.documentDate
        ? `Latest document date: ${snapshotSource.documentDate}`
        : null,
    snapshotSource?.sourceName ? `Source document: ${snapshotSource.sourceName}` : null,
  ]);
  const missingLines = compact([
    phone ? null : "I did not find a rollover support phone number in the indexed documents.",
    snapshotSource?.valueAmount
      ? null
      : "I did not find a latest balance/value in the retrieved 401(k) snapshot.",
  ]);
  const hasSourceBackedRolloverFacts = foundLines.length > 0;
  const sections: QueryAssistantSection[] = hasSourceBackedRolloverFacts
    ? [
        {
          title: "What I found",
          kind: "sourced",
          body: foundLines.map((line) => `- ${line}`).join("\n"),
        },
        {
          title: "Call checklist",
          kind: "guidance",
          body: buildShortRolloverCallChecklist(clientName, Boolean(phone)),
        },
        {
          title: "Confirm",
          kind: "missing",
          body: [
            "- Direct rollover vs. indirect rollover or transfer.",
            "- Receiving custodian instructions, forms, signatures, fees, and timing.",
          ].join("\n"),
        },
      ]
    : [
        {
          title: "Call checklist",
          kind: "guidance",
          body: buildShortRolloverCallChecklist(clientName, false),
        },
        {
          title: "Missing",
          kind: "missing",
          body: missingLines.map((line) => `- ${line}`).join("\n"),
        },
      ];
  const sourcedFacts = buildSourcedFactsForSources(sources, {
    includeFullAccountNumber: false,
  });
  const status =
    contactResult.status === "answered" || snapshotResult.status === "answered"
      ? contactResult.status === "answered" && snapshotResult.status === "answered"
        ? "answered"
        : "partial"
      : "not_found";

  return {
    status,
    intent: "latest_account_contact",
    question: input.question,
    title: "Rollover call brief",
    answer: phone
      ? `Short rollover-call brief for ${clientName}: I found the rollover phone (${phone}).`
      : `Short rollover-call brief for ${clientName}: I do not see a 401(k) statement or rollover phone in the indexed documents.`,
    details: [],
    sources,
    sections,
    sourcedFacts,
    suggestedPrompts: hasSourceBackedRolloverFacts
      ? [
          `Draft a client email for ${clientName} using these rollover facts`,
          `Turn this into a rollover call checklist for ${clientName}`,
          `Show me the source details for ${clientName}'s 401(k)`,
        ]
      : [
          `What is the customer service phone for ${clientName}'s savings account?`,
          `What is the customer service phone for ${clientName}'s checking account?`,
          `What is the customer service phone for ${clientName}'s credit card?`,
        ],
    presentation: {
      mode: "summary_answer",
      shellTone: "assistant",
      showTitle: false,
      showDetails: false,
      detailLabel: null,
      showSourceLine: false,
      sourceLine: null,
      showSources: false,
      followUp: null,
    },
  };
}

function finalizeDataIntelligenceResult(input: {
  result: QueryAssistantResult;
  previousState: DataIntelligenceConversationState | null;
  question: string;
}): QueryAssistantResult {
  const resultWithFacts = {
    ...input.result,
    sourcedFacts:
      input.result.sourcedFacts ??
      buildSourcedFactsForSources(input.result.sources, {
        includeFullAccountNumber:
          input.result.intent === "account_identifier_lookup" &&
          explicitlyRequestsFullAccountNumber(input.question),
      }),
    suggestedPrompts:
      input.result.suggestedPrompts ?? buildSuggestedPrompts(input.result),
  };
  const pendingClarification = buildPendingClarification({
    result: resultWithFacts,
    question: input.question,
  });
  const nextConversationState = applyDataIntelligencePendingClarification({
    state: deriveDataIntelligenceConversationStateFromResult({
      previousState: input.previousState,
      result: resultWithFacts,
    }),
    pendingClarification,
  });

  return {
    ...resultWithFacts,
    nextConversationState,
  };
}

function maybeBuildConversationalFallbackResult(input: {
  result: QueryAssistantResult;
  question: string;
  conversationState: DataIntelligenceConversationState | null;
}): QueryAssistantResult {
  const isGeneralRequest = isGeneralCopilotRequest(input.question);
  const canBecomeGeneralGuidance =
    input.result.status === "unsupported" ||
    (isGeneralRequest &&
      (input.result.status === "not_found" ||
        (input.result.status === "ambiguous" &&
          (input.result.clarificationOptions?.length ?? 0) === 0)));

  if (!canBecomeGeneralGuidance) {
    return input.result;
  }

  const clientReference =
    extractExplicitClientReference(input.question) ??
    input.conversationState?.activeClientName ??
    null;
  const contextSources = sourcesFromConversationState(input.conversationState);
  if (isGeneralRequest && (clientReference || contextSources.length > 0)) {
    return buildContextualCopilotFallbackResult({
      result: input.result,
      question: input.question,
      clientName:
        clientReference ??
        firstPresentString(contextSources.map((source) => source.partyDisplayName)) ??
        "the client",
      sources: contextSources,
    });
  }

  if (input.result.status === "unsupported" && isNameOnlyQuestion(input.question)) {
    const clientName =
      input.conversationState?.activeClientName ??
      normalizeNameOnlyQuestion(input.question);

    return {
      ...input.result,
      status: "answered",
      title: "Client in context",
      answer: `${clientName} is in context. Ask me what you want to do next, such as pulling rollover details, listing statements, drafting a client note, or preparing a call checklist.`,
      sections: [
        {
          title: "Ways I can help",
          kind: "guidance",
          body: [
            "- Pull source-backed details from indexed client documents.",
            "- Turn those details into a call script, checklist, email draft, or summary.",
            "- Keep sourced client facts separate from general guidance.",
          ].join("\n"),
        },
      ],
      suggestedPrompts: [
        `Build a rollover call brief for ${clientName}`,
        `What statements do we have for ${clientName}?`,
        `Draft a short client email for ${clientName}`,
      ],
      presentation: {
        ...input.result.presentation,
        mode: "summary_answer",
        shellTone: "assistant",
        showTitle: false,
        showDetails: false,
        detailLabel: null,
      },
    };
  }

  if (isGeneralRequest) {
    return {
      ...input.result,
      status: "answered",
      title: "Copilot response",
      answer:
        "I can help with that. I will separate any sourced client facts from general guidance, and I will call out assumptions instead of pretending the document store says more than it does.",
      sections: [
        {
          title: "General guidance",
          kind: "guidance",
          body: buildGeneralGuidanceBody(input.question),
        },
        {
          title: "How to make this client-specific",
          kind: "next_steps",
          body:
            "Name the client and the account/document context, and I can blend indexed client facts into the answer with sources.",
        },
      ],
      suggestedPrompts: [
        "Draft this as a client email",
        "Turn this into a call checklist",
        "Pull the client facts first, then write the draft",
      ],
      presentation: {
        ...input.result.presentation,
        mode: "summary_answer",
        shellTone: "assistant",
        showTitle: false,
        showDetails: false,
        detailLabel: null,
      },
    };
  }

  if (input.result.status !== "unsupported") {
    return input.result;
  }

  return {
    ...input.result,
    answer:
      "I cannot verify that from the indexed client documents yet, but you can ask me to reason, draft, summarize, or pull supported client facts from statements and IDs.",
    presentation: {
      ...input.result.presentation,
      shellTone: "assistant",
      followUp:
        "Try asking for a client fact I can source, or ask for general guidance and I will label it separately.",
    },
  };
}

function buildContextualCopilotFallbackResult(input: {
  result: QueryAssistantResult;
  question: string;
  clientName: string;
  sources: QueryAssistantSource[];
}): QueryAssistantResult {
  const topic = deriveContextualCallTopic(input.question, input.sources);
  const outputKind = deriveContextualOutputKind(input.question);
  const primarySection = buildContextualOutputSection({
    clientName: input.clientName,
    sources: input.sources,
    topic,
    outputKind,
  });
  const sections: QueryAssistantSection[] =
    outputKind === "confirm" || outputKind === "missing"
      ? [primarySection]
      : [
          primarySection,
          {
            title: "Worth confirming",
            kind: "missing",
            body: buildContextualMissingBody(input.clientName, input.sources, topic),
          },
        ];

  return {
    ...input.result,
    status: "answered",
    title: "Copilot response",
    answer: buildContextualAnswer({
      clientName: input.clientName,
      sources: input.sources,
      topic,
      outputKind,
    }),
    sources: input.sources,
    sections,
    suggestedPrompts: buildContextualSuggestedPrompts(input.clientName, topic),
    presentation: {
      ...input.result.presentation,
      mode: "summary_answer",
      shellTone: "assistant",
      showTitle: false,
      showDetails: false,
      detailLabel: null,
    },
  };
}

type ContextualCallTopic = "rollover" | "customer_service" | "general";
type ContextualOutputKind = "email" | "script" | "checklist" | "confirm" | "missing";

function deriveContextualCallTopic(
  question: string,
  sources: QueryAssistantSource[],
): ContextualCallTopic {
  if (/\brollover\b/i.test(question)) {
    return "rollover";
  }

  if (
    sources.some((source) =>
      Boolean(source.contactValue || source.accountType || source.institutionName),
    )
  ) {
    return "customer_service";
  }

  return "general";
}

function deriveContextualOutputKind(question: string): ContextualOutputKind {
  if (/\bmissing\b|\bwhat facts\b|\bfacts are still\b/i.test(question)) {
    return "missing";
  }

  if (/\bconfirm\b|\bverify\b/i.test(question)) {
    return "confirm";
  }

  if (/\bemail\b|\bdraft\b|\bwrite\b/i.test(question)) {
    return "email";
  }

  if (/\bscript\b/i.test(question)) {
    return "script";
  }

  return "checklist";
}

function buildContextualAnswer(input: {
  clientName: string;
  sources: QueryAssistantSource[];
  topic: ContextualCallTopic;
  outputKind: ContextualOutputKind;
}) {
  const topicLabel =
    input.topic === "rollover"
      ? "rollover"
      : input.topic === "customer_service"
        ? "customer-service"
        : "call";
  const outputLabel =
    input.outputKind === "email"
      ? "email draft"
      : input.outputKind === "script"
        ? "call script"
        : input.outputKind === "confirm"
          ? "confirmation list"
          : input.outputKind === "missing"
            ? "missing-facts list"
            : "call checklist";
  const contextLabel = buildContextLabel(input.sources);
  const contextText = contextLabel ? ` using the current ${contextLabel} context` : "";

  return `Here’s a client-specific ${topicLabel} ${outputLabel} for ${input.clientName}${contextText}.`;
}

function buildContextualOutputSection(input: {
  clientName: string;
  sources: QueryAssistantSource[];
  topic: ContextualCallTopic;
  outputKind: ContextualOutputKind;
}): QueryAssistantSection {
  if (input.outputKind === "missing") {
    return {
      title: "Missing facts",
      kind: "missing",
      body: buildContextualMissingBody(input.clientName, input.sources, input.topic),
    };
  }

  if (input.outputKind === "confirm") {
    return {
      title: "Confirm on the call",
      kind: "guidance",
      body: buildContextualConfirmBody(input.clientName, input.sources, input.topic),
    };
  }

  if (input.outputKind === "email") {
    return {
      title: "Draft email",
      kind: "guidance",
      body:
        input.topic === "rollover"
          ? buildRolloverEmailDraft(input.clientName, input.sources)
          : buildCustomerServiceEmailDraft(input.clientName, input.sources),
    };
  }

  if (input.outputKind === "script") {
    return {
      title: "Call script",
      kind: "guidance",
      body:
        input.topic === "rollover"
          ? buildRolloverCallScript(input.clientName, input.sources)
          : buildCustomerServiceCallScript(input.clientName, input.sources),
    };
  }

  return {
    title: "Call checklist",
    kind: "guidance",
    body:
      input.topic === "rollover"
        ? buildRolloverChecklist(input.clientName, input.sources)
        : buildCustomerServiceChecklist(input.clientName, input.sources),
  };
}

function buildRolloverEmailDraft(clientName: string, sources: QueryAssistantSource[]) {
  const phone = firstPresentString(sources.map((source) => source.contactValue));
  const accountType =
    firstPresentString(sources.map((source) => source.accountType)) ?? "retirement";
  const accountLast4 = firstPresentString(sources.map((source) => source.accountLast4));
  const accountDescription = accountLast4
    ? `${accountType} account ending in ${accountLast4}`
    : `${accountType} account`;

  return [
    `Subject: ${clientName} rollover next steps`,
    "",
    `Hi ${clientName.split(/\s+/)[0] ?? clientName},`,
    "",
    `I am preparing for the rollover call for your ${accountDescription}. Before we move forward, I will confirm the provider's rollover requirements, required forms, processing timeline, and any restrictions or fees that may apply.`,
    phone
      ? `The rollover support number I have from the indexed documents is ${phone}.`
      : "I do not yet have a source-backed rollover support number in this conversation, so I will confirm the correct provider contact before the call.",
    "",
    "After the call, I will summarize the required steps, any forms needed, and the expected timing so we have a clear path forward.",
    "",
    "Best,",
  ].join("\n");
}

function buildRolloverCallScript(clientName: string, sources: QueryAssistantSource[]) {
  const phone = firstPresentString(sources.map((source) => source.contactValue));
  return [
    `Opening: Hi, I am calling with ${clientName} about a potential 401(k) rollover.`,
    phone ? `Dial: ${phone}.` : "Dial: Confirm the provider's rollover support number first.",
    "Verify: Confirm the client's identity, plan/account type, and whether authorization is needed for advisor participation.",
    "Ask: What forms are required, who initiates the rollover, and whether the receiving custodian needs to submit anything.",
    "Confirm: Processing timeline, fees, restrictions, blackout windows, outstanding loan impact, and tax-withholding defaults.",
    "Close: Capture representative name, reference number, next steps, owner, and deadline.",
  ].map((line) => `- ${line}`).join("\n");
}

function buildRolloverChecklist(clientName: string, sources: QueryAssistantSource[]) {
  const phone = firstPresentString(sources.map((source) => source.contactValue));
  return [
    `Confirm ${clientName}'s identity and authorization for the call.`,
    phone
      ? `Call rollover support at ${phone}.`
      : "Confirm the correct rollover support phone number before calling.",
    "Verify plan type, account identifier, and whether the rollover should be direct or indirect.",
    "Ask for required forms, signature/notary requirements, and receiving-custodian instructions.",
    "Confirm fees, restrictions, outstanding loans, blackout windows, tax withholding, and processing timeline.",
    "Record representative name, reference number, forms requested, next owner, and deadline.",
  ].map((line) => `- ${line}`).join("\n");
}

function buildCustomerServiceEmailDraft(
  clientName: string,
  sources: QueryAssistantSource[],
) {
  const firstName = clientName.split(/\s+/)[0] ?? clientName;
  const contact = firstPresentString(sources.map((source) => source.contactValue));
  const accountDescription = buildAccountDescription(sources);

  return [
    `Subject: ${clientName} ${accountDescription} follow-up`,
    "",
    `Hi ${firstName},`,
    "",
    `I’m preparing to contact customer service about your ${accountDescription}. I’ll verify the account context, confirm what actions are available, and capture any requirements, timing, fees, or reference numbers.`,
    contact
      ? `The contact I have from the indexed document context is ${contact}.`
      : "I do not have a source-backed customer-service contact in this conversation yet, so I’ll confirm the right department before relying on it.",
    "",
    "After the call, I’ll summarize what they confirmed and the next step for each owner.",
    "",
    "Best,",
  ].join("\n");
}

function buildCustomerServiceCallScript(
  clientName: string,
  sources: QueryAssistantSource[],
) {
  const contact = firstPresentString(sources.map((source) => source.contactValue));
  const accountDescription = buildAccountDescription(sources);

  return [
    `Opening: Hi, I’m calling with ${clientName} about the ${accountDescription}.`,
    contact ? `Dial: ${contact}.` : "Dial: Confirm the correct customer-service contact first.",
    "Verify: Confirm identity, authorization, account type, and what information the representative can discuss.",
    "Ask: Explain the reason for the call and ask what options, forms, restrictions, or next steps apply.",
    "Confirm: Timing, fees, documents needed, online steps, mailing/upload instructions, and any reference number.",
    "Close: Repeat the agreed next steps, owner, deadline, representative name, and confirmation number.",
  ].map((line) => `- ${line}`).join("\n");
}

function buildCustomerServiceChecklist(
  clientName: string,
  sources: QueryAssistantSource[],
) {
  const contact = firstPresentString(sources.map((source) => source.contactValue));
  const accountDescription = buildAccountDescription(sources);

  return [
    `Confirm ${clientName}'s identity and authorization for the ${accountDescription}.`,
    contact
      ? `Use the sourced contact: ${contact}.`
      : "Confirm the correct customer-service contact before calling.",
    "State the reason for the call clearly and ask whether this is the right department.",
    "Confirm available actions, forms/documents, timing, fees, restrictions, and online alternatives.",
    "Record representative name, reference/confirmation number, next owner, and deadline.",
  ].map((line) => `- ${line}`).join("\n");
}

function buildContextualConfirmBody(
  clientName: string,
  sources: QueryAssistantSource[],
  topic: ContextualCallTopic,
) {
  if (topic === "rollover") {
    return [
      `- ${clientName}'s identity and whether advisor participation is authorized.`,
      "- Direct rollover vs. indirect rollover or transfer.",
      "- Required forms, signatures, receiving-custodian instructions, fees, restrictions, and timing.",
      "- Representative name, reference number, next owner, and deadline.",
    ].join("\n");
  }

  const accountDescription = buildAccountDescription(sources);
  const contact = firstPresentString(sources.map((source) => source.contactValue));

  return [
    `- ${clientName}'s identity and authorization for the ${accountDescription}.`,
    contact
      ? `- Whether ${contact} is the right department/contact for this request.`
      : "- The correct department/contact for this request.",
    "- The current account status and what action the representative can take.",
    "- Any documents, fees, restrictions, timing, confirmation/reference number, and next owner.",
  ].join("\n");
}

function buildContextualMissingBody(
  clientName: string,
  sources: QueryAssistantSource[],
  topic: ContextualCallTopic,
) {
  if (topic === "rollover") {
    return [
      "- Whether this should be handled as a direct rollover, indirect rollover, or transfer.",
      "- Receiving custodian instructions and account destination.",
      "- Provider-specific forms, signatures, fees, restrictions, loans, blackout windows, and timing.",
      "- Representative name and confirmation/reference number from the call.",
    ].join("\n");
  }

  const accountDescription = buildAccountDescription(sources);

  return [
    `- The exact reason for calling about ${clientName}'s ${accountDescription}.`,
    "- The specific action requested from customer service.",
    "- Whether advisor participation is authorized or the client must be present.",
    "- Required documents, fees, timing, reference number, and who owns the next step.",
  ].join("\n");
}

function buildContextualSuggestedPrompts(
  clientName: string,
  topic: ContextualCallTopic,
) {
  if (topic === "rollover") {
    return [
      `Turn this into a rollover call checklist for ${clientName}`,
      `Draft a rollover call script for ${clientName}`,
      `What facts are still missing for ${clientName}?`,
    ];
  }

  return [
    `Build a customer-service call script for ${clientName}`,
    `What should I confirm on the call for ${clientName}?`,
    `What facts are still missing for ${clientName}?`,
  ];
}

function buildContextLabel(sources: QueryAssistantSource[]) {
  const institution = firstPresentString(sources.map((source) => source.institutionName));
  const accountType = firstPresentString(sources.map((source) => source.accountType));
  const contact = firstPresentString(sources.map((source) => source.contactValue));
  const accountLabel = compact([institution, accountType]).join(" ");

  if (accountLabel && contact) {
    return `${accountLabel} (${contact})`;
  }

  return accountLabel || (contact ? `contact ${contact}` : null);
}

function buildAccountDescription(sources: QueryAssistantSource[]) {
  const institution = firstPresentString(sources.map((source) => source.institutionName));
  const accountType =
    firstPresentString(sources.map((source) => source.accountType)) ?? "account";
  const last4 = firstPresentString(sources.map((source) => source.accountLast4));
  const base = compact([institution, accountType]).join(" ") || accountType;

  return last4 ? `${base} ending in ${last4}` : base;
}

function sourcesFromConversationState(
  state: DataIntelligenceConversationState | null,
): QueryAssistantSource[] {
  if (!state) {
    return [];
  }

  const refs = dedupeSources([
    ...state.lastSources,
    state.lastPrimarySource,
    state.activeStatementSource,
    ...state.alternateStatementSources,
  ].filter((source): source is NonNullable<typeof source> => Boolean(source)));

  return refs.map((source) => ({
    partyId: source.partyId,
    accountId: source.accountId,
    sourceFileId: source.sourceFileId,
    sourceName: source.sourceName,
    documentDate: source.documentDate,
    statementEndDate: source.statementEndDate,
    institutionName: source.institutionName,
    accountType: source.accountType,
    partyDisplayName: source.partyDisplayName,
    accountLast4: source.accountLast4,
    accountNumber: null,
    maskedAccountNumber: source.maskedAccountNumber,
    valueLabel: source.valueLabel,
    valueAmount: source.valueAmount,
    contactValue: source.contactValue,
    expirationDate: source.expirationDate,
    idType: source.idType,
  }));
}

function isRolloverCallBriefRequest(question: string) {
  return (
    /\brollover\b/i.test(question) &&
    /\b(call|phone|number|information|info|need|checklist|script|brief)\b/i.test(
      question,
    )
  );
}

function buildShortRolloverCallChecklist(clientName: string, hasPhone: boolean) {
  return [
    hasPhone
      ? "- Call the provider and verify identity/authorization."
      : "- Confirm the correct provider rollover phone before calling.",
    `- Have ${clientName} available if the provider requires client authorization.`,
    "- Ask for required forms, restrictions, timeline, fees, and a confirmation number.",
  ].join("\n");
}

function buildScopedClientReference(input: {
  question: string;
  fallbackQuestion: string;
  state: DataIntelligenceConversationState | null;
}) {
  const explicitPartyId =
    extractPartyIdMention(input.question) ??
    extractPartyIdMention(input.fallbackQuestion);
  if (explicitPartyId) {
    return explicitPartyId;
  }

  const explicitClientReference =
    extractExplicitClientReference(input.question) ??
    extractExplicitClientReference(input.fallbackQuestion);
  if (explicitClientReference) {
    return explicitClientReference;
  }

  const activeName = input.state?.activeClientName ?? null;
  if (!activeName) {
    return null;
  }

  const activePartyId = input.state?.activePartyId ?? null;
  if (
    input.fallbackQuestion !== input.question ||
    questionMentionsActiveClientLoosely(input.question, activeName) ||
    questionAppearsClientlessFollowUp(input.question)
  ) {
    return activePartyId ?? activeName;
  }

  return null;
}

function extractExplicitClientReference(question: string) {
  return extractPotentialClientPhrases(question)[0] ?? null;
}

function questionHasExplicitClientReference(question: string) {
  return Boolean(
    extractPartyIdMention(question) ||
      extractExplicitClientReference(question) ||
      /\b[A-Z][A-Za-z'.-]+\s+[A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+)?\b/.test(
        question,
      ),
  );
}

function isInternalReference(value: string) {
  return /\b(?:party|acct)_[a-z0-9]+\b/i.test(value);
}

function buildPendingClarification(input: {
  result: QueryAssistantResult;
  question: string;
}) {
  const options =
    input.result.clarificationOptions?.filter((option) => option.partyId || option.accountId) ??
    [];
  if (options.length === 0) {
    return null;
  }

  return {
    kind: options.some((option) => option.partyId) ? "party" as const : "account" as const,
    originalQuestion: input.question,
    options: options.map((option) => ({
      optionId: option.optionId,
      label: option.label,
      description: option.description,
      partyId: option.partyId ?? null,
      accountId: option.accountId ?? null,
    })),
  };
}

function buildSourcedFactsForSources(
  sources: QueryAssistantResult["sources"],
  options: { includeFullAccountNumber: boolean },
): QueryAssistantSourcedFact[] {
  const facts: QueryAssistantSourcedFact[] = [];
  sources.forEach((source, sourceIndex) => {
    addFact(facts, "Client", source.partyDisplayName, sourceIndex);
    addFact(facts, "Institution", source.institutionName, sourceIndex);
    addFact(facts, "Account type", source.accountType, sourceIndex);
    addFact(
      facts,
      "Account",
      source.accountLast4
        ? `Ending in ${source.accountLast4}`
        : source.maskedAccountNumber,
      sourceIndex,
      "masked",
    );
    if (options.includeFullAccountNumber) {
      addFact(
        facts,
        "Full account number",
        source.accountNumber,
        sourceIndex,
        "restricted",
      );
    }
    addFact(facts, source.valueLabel ?? "Value", source.valueAmount, sourceIndex);
    addFact(facts, "Contact", source.contactValue, sourceIndex);
    addFact(facts, "Statement end", source.statementEndDate, sourceIndex);
    addFact(facts, "Document date", source.documentDate, sourceIndex);
    addFact(facts, "Source", source.sourceName, sourceIndex);
    addFact(facts, "Date of birth", source.birthDate, sourceIndex);
    addFact(facts, "Address", source.addressText, sourceIndex);
    addFact(facts, "Expiration", source.expirationDate, sourceIndex);
  });

  return dedupeFacts(facts).slice(0, 12);
}

function addFact(
  facts: QueryAssistantSourcedFact[],
  label: string,
  value: string | null | undefined,
  sourceIndex: number,
  sensitivity: QueryAssistantSourcedFact["sensitivity"] = "normal",
) {
  if (!value) {
    return;
  }

  facts.push({
    label,
    value,
    sourceIndex,
    sensitivity,
  });
}

function dedupeFacts(facts: QueryAssistantSourcedFact[]) {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    const key = `${fact.label}::${fact.value}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function buildSuggestedPrompts(result: QueryAssistantResult) {
  if (result.status === "ambiguous" || result.status === "needs_clarification") {
    return ["Use one of the matching client options", "Show me what data each option has"];
  }

  if (result.intent === "latest_account_contact") {
    const topic = deriveContextualCallTopic(result.question, result.sources);
    if (topic === "rollover") {
      return ["Build a rollover call script", "What should I confirm on the rollover call?"];
    }

    return ["Build a customer-service call script", "What should I confirm on the call?"];
  }

  if (result.sources.some((source) => source.accountType === "401(k)")) {
    return ["Build a rollover call brief", "Draft a client email about next steps"];
  }

  return [];
}

function explicitlyRequestsFullAccountNumber(question: string) {
  return /\bfull account number\b|\baccount number\b|\bacct number\b|\bacct #\b/i.test(
    question,
  );
}

function stripFullAccountNumberFromSource(
  source: QueryAssistantResult["sources"][number],
) {
  return {
    ...source,
    accountNumber: null,
  };
}

function dedupeSources(sources: QueryAssistantResult["sources"]) {
  const seen = new Set<string>();
  const deduped: QueryAssistantResult["sources"] = [];
  for (const source of sources) {
    const key = [
      source.partyId,
      source.accountId,
      source.sourceFileId,
      source.sourceName,
      source.contactValue,
      source.valueAmount,
    ]
      .filter(Boolean)
      .join("::");
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(source);
  }

  return deduped;
}

function firstPresentString(values: Array<string | null | undefined>) {
  return values.find((value): value is string => Boolean(value)) ?? null;
}

function compact<T>(values: Array<T | null | undefined | false>) {
  return values.filter((value): value is T => Boolean(value));
}

function extractPartyIdMention(question: string) {
  return question.match(/\bparty_[a-z0-9]+\b/i)?.[0] ?? null;
}

function questionAppearsClientlessFollowUp(question: string) {
  return !/\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/.test(question);
}

function isNameOnlyQuestion(question: string) {
  const normalized = normalizeFollowUpText(question);
  if (!normalized) {
    return false;
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  return (
    tokens.length >= 2 &&
    tokens.length <= 4 &&
    tokens.every((token) => !isDomainOrStopToken(token))
  );
}

function normalizeNameOnlyQuestion(question: string) {
  return normalizeFollowUpText(question)
    .split(/\s+/)
    .filter(Boolean)
    .map(capitalizeNameToken)
    .join(" ");
}

function isGeneralCopilotRequest(question: string) {
  return /\bdraft\b|\bwrite\b|\bexplain\b|\bchecklist\b|\bscript\b|\bemail\b|\bsummary\b|\bprepare\b|\bhelp me\b|\bconfirm\b|\bverify\b|\bmissing\b|\bwhat facts\b/i.test(
    question,
  );
}

function buildGeneralGuidanceBody(question: string) {
  if (/\bemail\b/i.test(question)) {
    return [
      "- Start with the purpose and the action requested from the recipient.",
      "- Keep sourced client facts separate from assumptions or general recommendations.",
      "- Include a short next-step list and a clear deadline if one exists.",
    ].join("\n");
  }

  if (/\bcall|script\b/i.test(question)) {
    return [
      "- Open by verifying the client, account, and reason for the call.",
      "- Ask for required forms, restrictions, timing, fees, and confirmation numbers.",
      "- End by summarizing next steps and who owns each item.",
    ].join("\n");
  }

  return [
    "- I can reason through the workflow and produce a usable draft or checklist.",
    "- If you include a client name, I can pull available source-backed facts first.",
    "- I will label what came from documents separately from general guidance.",
  ].join("\n");
}

function normalizeKnownClientContinuityNotFound(input: {
  result: QueryAssistantResult;
  state: DataIntelligenceConversationState | null;
  preferStateAwareFallback: boolean;
}): QueryAssistantResult {
  if (
    !input.preferStateAwareFallback ||
    !input.state?.activeClientName ||
    input.result.status !== "not_found" ||
    !/couldn'?t find that client/i.test(input.result.answer)
  ) {
    return input.result;
  }

  const answer = buildKnownClientContinuityNotFoundAnswer(
    input.state,
    input.result.intent,
  );
  if (!answer) {
    return input.result;
  }

  return {
    ...input.result,
    answer,
  };
}

function buildKnownClientContinuityNotFoundAnswer(
  state: DataIntelligenceConversationState,
  intent: string | null,
) {
  const clientName = state.activeClientName;
  if (!clientName) {
    return null;
  }

  switch (intent ?? state.lastIntent) {
    case "statement_existence":
      return `No, there is no statement uploaded for ${clientName}.`;
    case "statement_list":
      return `I do not see any statements uploaded for ${clientName}.`;
    case "latest_account_document":
      return `I could not find a matching statement for ${clientName}.`;
    case "latest_account_snapshot":
      return `I could not find a matching account value for ${clientName}.`;
    case "identity_document_existence":
    case "latest_identity_document":
      return `I do not see an identity document on file for ${clientName}.`;
    default:
      return null;
  }
}

function buildStateAwareFallbackQuestion(
  question: string,
  state: DataIntelligenceConversationState | null,
) {
  if (!state) {
    return null;
  }

  const pendingSelectionQuestion = buildPendingClarificationQuestion(question, state);
  if (pendingSelectionQuestion) {
    return pendingSelectionQuestion;
  }

  const clarifiedClientName = extractClientClarificationAnswer(question, state);
  if (clarifiedClientName) {
    return buildReplacementClientFollowUpQuestion(clarifiedClientName, state);
  }

  if (!state.activeClientName) {
    return null;
  }

  if (isClientNameOnlyReply(question, state.activeClientName)) {
    return buildReplacementClientFollowUpQuestion(state.activeClientName, state);
  }

  const replacementClientName = findReplacementClientName(
    question,
    state.activeClientName,
  );
  if (replacementClientName) {
    const directPlan = buildQueryAssistantRetrievalPlan(question);
    if (directPlan.intent) {
      return null;
    }

    return buildReplacementClientFollowUpQuestion(replacementClientName, state);
  }

  const selectedStatement = resolveStatementSourceForFollowUp(question, state);
  const accountNumberQuestion = questionRequestsAccountNumber(question);
  const referencesPriorResult =
    /\bthat one\b|\bthat statement\b|\bthat document\b|\bthe latest one\b|\bthe last one\b|\bit\b/i.test(
      question,
    );

  if (accountNumberQuestion && selectedStatement) {
    const accountDescriptor = buildStatementAccountDescriptor(selectedStatement);

    return `What is ${state.activeClientName}'s full account number${accountDescriptor ? ` from the ${accountDescriptor} account` : ""}?`;
  }

  if (questionRequestsContact(question) && selectedStatement) {
    const accountDescriptor = buildStatementAccountDescriptor(selectedStatement);

    return `What is ${state.activeClientName}'s customer service phone${accountDescriptor ? ` for the ${accountDescriptor} account` : ""}?`;
  }

  if (
    (questionRequestsAccountValue(question) ||
      (selectedStatement &&
        (referencesOtherStatement(question) || isFieldContinuationQuestion(question)) &&
        state.lastRequestedField === "value")) &&
    selectedStatement
  ) {
    return `What is ${state.activeClientName}'s latest ${selectedStatement.accountType?.toLowerCase() ?? "statement"} balance?`;
  }

  if (
    selectedStatement &&
    (referencesPriorResult ||
      referencesOtherStatement(question) ||
      questionMentionsStatementAccountType(question))
  ) {
    return `What is ${state.activeClientName}'s latest ${selectedStatement.accountType?.toLowerCase() ?? "statement"} statement?`;
  }

  const followUpAccountType = detectFollowUpAccountType(question);
  const likelyFollowUp = isLikelyFollowUpQuestion(question);
  const clientScopedQuestion = isClientScopedQuestion(question, state);
  const mentionsActiveClientLoosely = questionMentionsActiveClientLoosely(
    question,
    state.activeClientName,
  );
  if (!followUpAccountType) {
    if (likelyFollowUp || clientScopedQuestion || mentionsActiveClientLoosely) {
      if (questionMentionsActiveClient(question, state.activeClientName)) {
        return null;
      }

      return buildClientScopedFollowUpQuestion(question, state);
    }

    return null;
  }

  if (
    likelyFollowUp ||
    mentionsActiveClientLoosely
  ) {
    if (state.lastIntent === "statement_existence") {
      return `Do we have a ${followUpAccountType.toLowerCase()} statement for ${state.activeClientName} on file?`;
    }

    if (state.lastIntent === "statement_list" || state.lastTurnKind === "list") {
      return `What ${followUpAccountType.toLowerCase()} statements do we have on file for ${state.activeClientName}?`;
    }

    if (
      state.lastIntent === "latest_account_document" ||
      state.lastTurnKind === "detail"
    ) {
      return `What is ${state.activeClientName}'s latest ${followUpAccountType.toLowerCase()} statement?`;
    }
  }

  return null;
}

function resolveStatementSourceForFollowUp(
  question: string,
  state: DataIntelligenceConversationState,
) {
  const explicitAccountType = detectFollowUpAccountType(question);
  if (explicitAccountType) {
    return (
      findStatementSourceByAccountType(state, explicitAccountType) ?? {
        partyId: state.activePartyId,
        accountId: null,
        sourceFileId: null,
        sourceName: null,
        documentDate: null,
        statementEndDate: null,
        institutionName: null,
        accountType: explicitAccountType,
        accountLast4: null,
        maskedAccountNumber: null,
        valueLabel: null,
        valueAmount: null,
        contactValue: null,
        partyDisplayName: state.activeClientName,
        idType: null,
        taxYear: null,
        documentSubtype: null,
        expirationDate: null,
      }
    );
  }

  if (referencesOtherStatement(question)) {
    return (
      state.alternateStatementSources[0] ??
      inferOtherBankStatementSource(state)
    );
  }

  if (referencesThatStatement(question)) {
    return state.activeStatementSource ?? state.lastPrimarySource;
  }

  return null;
}

function findStatementSourceByAccountType(
  state: DataIntelligenceConversationState,
  accountType: string,
) {
  return [
    state.activeStatementSource,
    ...state.alternateStatementSources,
    ...state.lastSources,
  ].find((source) => source?.accountType === accountType) ?? null;
}

function inferOtherBankStatementSource(state: DataIntelligenceConversationState) {
  const activeType = state.activeStatementSource?.accountType;
  if (state.activeFamilyScope !== "bank_statement") {
    return null;
  }

  if (activeType === "Checking") {
    return {
      partyId: state.activePartyId,
      accountId: null,
      sourceFileId: null,
      sourceName: null,
      documentDate: null,
      statementEndDate: null,
      institutionName: state.activeStatementSource?.institutionName ?? null,
      accountType: "Savings",
      accountLast4: null,
      maskedAccountNumber: null,
      valueLabel: null,
      valueAmount: null,
      contactValue: null,
      partyDisplayName: state.activeClientName,
      idType: null,
      taxYear: null,
      documentSubtype: null,
      expirationDate: null,
    };
  }

  if (activeType === "Savings") {
    return {
      partyId: state.activePartyId,
      accountId: null,
      sourceFileId: null,
      sourceName: null,
      documentDate: null,
      statementEndDate: null,
      institutionName: state.activeStatementSource?.institutionName ?? null,
      accountType: "Checking",
      accountLast4: null,
      maskedAccountNumber: null,
      valueLabel: null,
      valueAmount: null,
      contactValue: null,
      partyDisplayName: state.activeClientName,
      idType: null,
      taxYear: null,
      documentSubtype: null,
      expirationDate: null,
    };
  }

  return null;
}

function buildStatementAccountDescriptor(
  source: NonNullable<DataIntelligenceConversationState["activeStatementSource"]>,
) {
  return [
    source.institutionName,
    source.accountType,
    source.accountLast4 ? `ending in ${source.accountLast4}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function referencesThatStatement(question: string) {
  return /\bthat one\b|\bthat statement\b|\bthat document\b|\bthe latest one\b|\bthe last one\b|\bit\b/i.test(
    question,
  );
}

function referencesOtherStatement(question: string) {
  return /\bother bank statement\b|\bother statement\b|\banother bank statement\b|\banother statement\b/i.test(
    question,
  );
}

function questionMentionsStatementAccountType(question: string) {
  return Boolean(detectFollowUpAccountType(question) && /\bstatement\b/i.test(question));
}

function questionRequestsAccountNumber(question: string) {
  return /\baccount number\b|\bfull account number\b|\bacct number\b|\bacct #\b/i.test(
    question,
  );
}

function questionRequestsContact(question: string) {
  return /\bphone\b|\bphone number\b|\bcontact\b|\bcall\b|\bcustomer service\b|\bsupport\b/i.test(
    question,
  );
}

function questionRequestsAccountValue(question: string) {
  return /\bvalue\b|\bbalance\b|\bworth\b|\bamount\b|\bmarket value\b/i.test(
    question,
  );
}

function isFieldContinuationQuestion(question: string) {
  return /\bwhat about\b|\bhow about\b|\band\b/i.test(question);
}

function buildReplacementClientFollowUpQuestion(
  clientName: string,
  state: DataIntelligenceConversationState,
) {
  const accountType = state.activeAccountType;
  if (state.lastIntent === "statement_existence") {
    return `Do we have ${describePriorStatementScope(state, accountType)} for ${clientName} on file?`;
  }

  if (state.lastIntent === "statement_list" || state.lastTurnKind === "list") {
    return `What ${describePriorStatementScope(state, accountType, true)} do we have on file for ${clientName}?`;
  }

  if (state.lastIntent === "latest_account_document") {
    return `What is ${clientName}'s latest ${describePriorStatementScope(state, accountType)}?`;
  }

  if (state.lastIntent === "latest_account_snapshot") {
    return `What is ${clientName}'s latest ${describePriorStatementScope(state, accountType)} balance?`;
  }

  if (
    state.lastIntent === "identity_document_existence" ||
    state.lastIntent === "latest_identity_document"
  ) {
    return `Do we have an ID on file for ${clientName}?`;
  }

  if (state.lastIntent === "latest_identity_expiration") {
    return `What is ${clientName}'s latest ID expiration date?`;
  }

  if (state.lastIntent === "latest_identity_address") {
    return `What address is on ${clientName}'s latest ID?`;
  }

  if (state.lastIntent === "latest_identity_dob") {
    return `What is ${clientName}'s DOB?`;
  }

  return null;
}

function buildPendingClarificationQuestion(
  question: string,
  state: DataIntelligenceConversationState,
) {
  const pending = state.pendingClarification;
  if (!pending) {
    return null;
  }

  const selectedOption = resolvePendingClarificationOption(question, pending.options);
  if (!selectedOption) {
    return null;
  }

  const reference = selectedOption.partyId ?? selectedOption.accountId;
  if (!reference) {
    return null;
  }

  return `${pending.originalQuestion.trim()} with ${reference}`;
}

function resolvePendingClarificationOption(
  question: string,
  options: NonNullable<DataIntelligenceConversationState["pendingClarification"]>["options"],
) {
  const explicitPartyId = extractPartyIdMention(question);
  if (explicitPartyId) {
    return (
      options.find(
        (option) => option.partyId?.toLowerCase() === explicitPartyId.toLowerCase(),
      ) ?? null
    );
  }

  const normalized = normalizeFollowUpText(question);
  if (!normalized) {
    return null;
  }

  const ordinalMatch = normalized.match(/\b(first|1|one|second|2|two|third|3|three)\b/);
  if (ordinalMatch) {
    const ordinal = ordinalMatch[1];
    const index =
      ordinal === "first" || ordinal === "1" || ordinal === "one"
        ? 0
        : ordinal === "second" || ordinal === "2" || ordinal === "two"
          ? 1
          : 2;

    return options[index] ?? null;
  }

  const matchingOptions = options.filter((option) => {
    const label = normalizeFollowUpText(option.label);
    const description = normalizeFollowUpText(option.description);
    return Boolean(
      (label && normalized.includes(label)) ||
        (description && description.includes(normalized)) ||
        (description && normalized.includes(description.slice(0, 24).trim())),
    );
  });

  return matchingOptions.length === 1 ? matchingOptions[0]! : null;
}

function extractClientClarificationAnswer(
  question: string,
  state: DataIntelligenceConversationState,
) {
  if (
    state.activeClientName ||
    state.lastTurnKind !== "ambiguous" ||
    !state.lastIntent
  ) {
    return null;
  }

  const normalized = normalizeFollowUpText(question);
  if (!normalized) {
    return null;
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (
    tokens.length < 2 ||
    tokens.length > 4 ||
    tokens.some((token) => token.length <= 1 || isDomainOrStopToken(token))
  ) {
    return null;
  }

  return tokens.map(capitalizeNameToken).join(" ");
}

function capitalizeNameToken(token: string) {
  return token.charAt(0).toUpperCase() + token.slice(1);
}

function describePriorStatementScope(
  state: DataIntelligenceConversationState,
  accountType: string | null,
  plural = false,
) {
  if (
    (state.lastIntent === "statement_existence" ||
      state.lastIntent === "statement_list") &&
    hasMultiplePriorStatementAccountTypes(state)
  ) {
    return `statement${plural ? "s" : ""}`;
  }

  if (accountType) {
    return `${accountType.toLowerCase()} statement${plural ? "s" : ""}`;
  }

  if (state.activeFamilyScope === "bank_statement") {
    return `bank statement${plural ? "s" : ""}`;
  }

  if (state.activeFamilyScope === "credit_card_statement") {
    return `credit card statement${plural ? "s" : ""}`;
  }

  return `statement${plural ? "s" : ""}`;
}

function hasMultiplePriorStatementAccountTypes(state: DataIntelligenceConversationState) {
  const accountTypes = new Set(
    state.lastSources
      .map((source) => source.accountType)
      .filter((value): value is string => Boolean(value)),
  );

  return accountTypes.size > 1;
}

function detectFollowUpAccountType(question: string) {
  if (/\bcredit card\b|\bvisa\b|\bmastercard\b|\bmaster card\b|\bamex\b|\bamerican express\b/i.test(question)) {
    return "Credit Card";
  }

  if (/\bchecking\b/i.test(question)) {
    return "Checking";
  }

  if (/\bsavings\b/i.test(question)) {
    return "Savings";
  }

  if (/\b401\s*\(?k\)?\b|\bretirement plan\b|\bemployer[- ]sponsored plan\b/i.test(question)) {
    return "401(k)";
  }

  if (/\broth\s+ira\b/i.test(question)) {
    return "Roth IRA";
  }

  if (/\brollover\s+ira\b/i.test(question)) {
    return "Rollover IRA";
  }

  if (/\btraditional\s+ira\b/i.test(question)) {
    return "Traditional IRA";
  }

  return null;
}

function questionMentionsActiveClient(question: string, activeClientName: string) {
  const normalizedQuestion = normalizeFollowUpText(question);
  const normalizedName = normalizeFollowUpText(activeClientName);
  if (!normalizedQuestion || !normalizedName) {
    return false;
  }

  return normalizedQuestion.includes(normalizedName);
}

function isClientNameOnlyReply(question: string, activeClientName: string) {
  const normalizedQuestion = normalizeFollowUpText(question);
  const normalizedName = normalizeFollowUpText(activeClientName);

  if (!normalizedQuestion || !normalizedName) {
    return false;
  }

  if (normalizedQuestion === normalizedName) {
    return true;
  }

  const questionTokens = normalizedQuestion.split(/\s+/).filter(Boolean);
  const nameTokens = new Set(normalizedName.split(/\s+/).filter(Boolean));

  return (
    questionTokens.length >= 2 &&
    questionTokens.length <= 4 &&
    questionTokens.every((token) => nameTokens.has(token))
  );
}

function questionMentionsActiveClientLoosely(
  question: string,
  activeClientName: string,
) {
  if (questionMentionsActiveClient(question, activeClientName)) {
    return true;
  }

  const normalizedQuestion = normalizeFollowUpText(question);
  const [firstName] = normalizeFollowUpText(activeClientName).split(/\s+/);
  return Boolean(firstName && firstName.length > 2 && normalizedQuestion.includes(firstName));
}

function isLikelyFollowUpQuestion(question: string) {
  return /\bwhat about\b|\bhow about\b|\bthat one\b|\bthat statement\b|\bthat document\b|\bthe latest one\b|\bthe last one\b|\bsame client\b|\bfor them\b|\bfor that client\b|\bhis\b|\bher\b|\btheir\b/i.test(
    question,
  );
}

function isClientScopedQuestion(
  question: string,
  state: DataIntelligenceConversationState,
) {
  if (/\bdo we have\b|\bon file\b|\blatest\b|\bmost recent\b|\bnewest\b|\bcurrent\b/i.test(question)) {
    return /\bid\b|\blicense\b|\bstatement\b|\bdocument\b|\baccount\b|\bphone\b|\bcontact\b|\baddress\b|\bexpiration\b|\bexpire\b|\bdob\b|\bdate of birth\b/i.test(
      question,
    );
  }

  if (/\bwhat'?s\b|\bwhat is\b|\bshow\b|\blist\b/i.test(question)) {
    return /\bexpiration\b|\bexpire\b|\bdob\b|\bdate of birth\b|\baddress\b|\bphone\b|\bcontact\b|\baccount number\b|\bstatement\b|\bdocument\b/i.test(
      question,
    );
  }

  return Boolean(
    state.activeFamilyScope &&
      /\bexpiration\b|\bexpire\b|\bdob\b|\bdate of birth\b|\baddress\b|\bphone\b|\bcontact\b|\baccount number\b/i.test(
        question,
      ),
  );
}

function buildClientScopedFollowUpQuestion(
  question: string,
  state: DataIntelligenceConversationState,
) {
  if (
    /\bexpiration\b|\bexpire\b/i.test(question) &&
    isIdentityContext(state)
  ) {
    return `What is ${state.activeClientName}'s latest ID expiration date?`;
  }

  if (/\baddress\b/i.test(question) && isIdentityContext(state)) {
    return `What address is on ${state.activeClientName}'s latest ID?`;
  }

  if (/\bdob\b|\bdate of birth\b|\bborn\b/i.test(question)) {
    return `What is ${state.activeClientName}'s DOB?`;
  }

  return appendQuestionForClient(question, state.activeClientName);
}

function isIdentityContext(state: DataIntelligenceConversationState) {
  return Boolean(
    state.activeFamilyScope === "identity_document" ||
      state.activeFamilyScope === "driver_license" ||
      state.activeFamilyScope === "state_id" ||
      state.lastPrimarySource?.idType,
  );
}

function appendQuestionForClient(question: string, clientName: string | null) {
  const trimmedQuestion = question.trim().replace(/[?.!]+$/, "");
  if (!clientName) {
    return `${trimmedQuestion}?`;
  }
  return `${trimmedQuestion} for ${clientName}?`;
}

function findReplacementClientName(
  question: string,
  activeClientName: string,
) {
  if (questionMentionsActiveClient(question, activeClientName)) {
    return null;
  }

  const normalizedActive = normalizeFollowUpText(activeClientName);
  const activeTokens = new Set(normalizedActive.split(/\s+/).filter(Boolean));
  const candidatePhrases = extractPotentialClientPhrases(question);

  return candidatePhrases.find((candidate) => {
    const phrase = normalizeFollowUpText(candidate);
    if (!phrase || phrase === normalizedActive) {
      return false;
    }

    const tokens = phrase.split(/\s+/).filter(Boolean);
    if (tokens.length < 2) {
      return false;
    }

    if (tokens.every((token) => activeTokens.has(token))) {
      return false;
    }

    return !tokens.every(isDomainOrStopToken);
  }) ?? null;
}

function extractPotentialClientPhrases(question: string) {
  const phrases = new Set<string>();
  for (const match of question.matchAll(/\b(?:for|about|with)\s+([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,4})\b/g)) {
    const phrase = cleanPotentialClientPhrase(match[1]!);
    if (phrase) {
      phrases.add(phrase);
    }
  }

  for (const match of question.matchAll(/\b([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,4})['’]s\s+(?:401|account|statement|id|license|document)\b/g)) {
    const phrase = cleanPotentialClientPhrase(match[1]!);
    if (phrase) {
      phrases.add(phrase);
    }
  }

  const normalizedQuestion = normalizeFollowUpText(question);
  for (const match of normalizedQuestion.matchAll(/\b(?:for|about|with)\s+([a-z0-9]+(?:\s+[a-z0-9]+){1,6})\b/g)) {
    const phrase = cleanPotentialClientPhrase(match[1]!);
    if (phrase) {
      phrases.add(phrase);
    }
  }

  for (const match of normalizedQuestion.matchAll(/\b([a-z]+(?:\s+[a-z]+){1,4})\s+s\s+(?:401|account|statement|id|license|document)\b/g)) {
    const phrase = cleanPotentialClientPhrase(match[1]!);
    if (phrase) {
      phrases.add(phrase);
    }
  }

  return Array.from(phrases);
}

function cleanPotentialClientPhrase(value: string) {
  const tokens = normalizeFollowUpText(value)
    .split(/\s+/)
    .filter(Boolean);
  const candidateTokens: string[] = [];

  for (const token of tokens) {
    if (isClientReferenceStopToken(token)) {
      break;
    }

    if (token.length <= 1 && candidateTokens.length === 0) {
      continue;
    }

    candidateTokens.push(token);
    if (candidateTokens.length >= 4) {
      break;
    }
  }

  const meaningfulTokens = candidateTokens.filter(
    (token) => token.length > 1 && !isDomainOrStopToken(token),
  );
  if (meaningfulTokens.length < 2) {
    return null;
  }

  return candidateTokens.map(capitalizeNameToken).join(" ");
}

function isClientReferenceStopToken(token: string) {
  return (
    isDomainOrStopToken(token) ||
    new Set([
      "after",
      "before",
      "brief",
      "call",
      "checklist",
      "details",
      "draft",
      "email",
      "facts",
      "first",
      "include",
      "including",
      "info",
      "information",
      "k",
      "need",
      "needed",
      "next",
      "number",
      "prepare",
      "rollover",
      "script",
      "s",
      "step",
      "steps",
      "these",
      "this",
      "using",
      "write",
    ]).has(token)
  );
}

function isDomainOrStopToken(token: string) {
  return new Set([
    "a",
    "an",
    "and",
    "any",
    "available",
    "bank",
    "card",
    "checking",
    "client",
    "credit",
    "current",
    "document",
    "documents",
    "driver",
    "expiration",
    "file",
    "for",
    "have",
    "id",
    "ira",
    "latest",
    "license",
    "on",
    "phone",
    "savings",
    "same",
    "statement",
    "statements",
    "support",
    "that",
    "the",
    "we",
    "what",
  ]).has(token);
}

function normalizeFollowUpText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function attachDebugTrace(
  result: QueryAssistantResult,
  trace: DataIntelligenceHybridDebugTrace,
): QueryAssistantResult {
  return {
    ...result,
    debug: {
      ...(result.debug ?? {}),
      dataIntelligenceHybrid: trace,
    },
  };
}

function summarizePlan(plan: ReturnType<typeof buildQueryAssistantRetrievalPlan>): QueryAssistantPlanDebug {
  return {
    intent: plan.intent,
    documentFamily: plan.documentFamily,
    questionType: plan.questionType,
    familyScope: plan.familyScope,
    accountType: plan.accountType,
    accountFieldRequest: plan.accountFieldRequest,
    contactPurpose: plan.contactPurpose,
    contactMethod: plan.contactMethod,
    identityKind: plan.identityKind,
    valuePreference: plan.valuePreference,
    clarificationTarget: plan.clarificationTarget,
    preferredResponseMode: plan.preferredResponseMode,
  };
}

function summarizeResult(result: QueryAssistantResult) {
  return {
    status: result.status,
    intent: result.intent,
    sourceCount: result.sources.length,
  };
}

function modelInterpretationHonorsSensitiveFieldPolicy(input: {
  question: string;
  history: DataIntelligenceConversationMessage[];
  accountFieldRequest: "account_number" | "routing_number" | null;
}) {
  if (!input.accountFieldRequest) {
    return true;
  }

  // Sensitive account/routing details remain policy-gated by deterministic
  // wording checks. The model can resolve follow-ups, but it cannot newly
  // introduce sensitive-field retrieval when the user/context did not ask.
  const searchableText = [
    input.question,
    ...input.history.map((message) => message.text),
  ].join("\n");

  if (input.accountFieldRequest === "routing_number") {
    return /\brouting number\b|\brouting details\b|\baba number\b|\baba routing\b/i.test(
      searchableText,
    );
  }

  return /\bfull account number\b|\baccount number\b|\bacct number\b|\bacct #\b/i.test(
    searchableText,
  );
}
