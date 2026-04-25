import {
  askFirmDocumentAssistant,
  type AskFirmDocumentAssistantInput,
  type QueryAssistantResult,
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
import { sanitizeDataIntelligenceConversationState } from "@/lib/data-intelligence-conversation";
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
  const stateAwareFallbackQuestion =
    buildStateAwareFallbackQuestion(question, conversationState) ?? question;
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

  if (!config.aiEnabled || !config.providerConfigured) {
    const result = askFirmDocumentAssistant({
      ...input,
      retrievalQuestion: input.retrievalQuestion ?? stateAwareFallbackQuestion,
      retrievalPlan: input.retrievalPlan ?? fallbackPlan,
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
      trace.finalResult = summarizeResult(result);
      return attachDebugTrace(result, trace);
    }

    return result;
  }

  const interpretation = await interpretDataIntelligenceQuestionWithModel({
    question,
    history,
    conversationState,
    fallbackPlan,
    config,
    fetchImpl: input.modelFetch,
    debug: trace?.interpretation,
  });
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
  const displayResult = {
    ...deterministicResult,
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

  const finalResult = applyDataIntelligenceComposition(displayResult, composition);
  if (trace) {
    trace.finalResult = summarizeResult(finalResult);
    return attachDebugTrace(finalResult, trace);
  }

  return finalResult;
}

function buildStateAwareFallbackQuestion(
  question: string,
  state: DataIntelligenceConversationState | null,
) {
  if (!state) {
    return null;
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
        sourceFileId: null,
        sourceName: null,
        documentDate: null,
        statementEndDate: null,
        institutionName: null,
        accountType: explicitAccountType,
        accountLast4: null,
        maskedAccountNumber: null,
        partyDisplayName: state.activeClientName,
        idType: null,
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
      sourceFileId: null,
      sourceName: null,
      documentDate: null,
      statementEndDate: null,
      institutionName: state.activeStatementSource?.institutionName ?? null,
      accountType: "Savings",
      accountLast4: null,
      maskedAccountNumber: null,
      partyDisplayName: state.activeClientName,
      idType: null,
      expirationDate: null,
    };
  }

  if (activeType === "Savings") {
    return {
      sourceFileId: null,
      sourceName: null,
      documentDate: null,
      statementEndDate: null,
      institutionName: state.activeStatementSource?.institutionName ?? null,
      accountType: "Checking",
      accountLast4: null,
      maskedAccountNumber: null,
      partyDisplayName: state.activeClientName,
      idType: null,
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
  for (const match of question.matchAll(/\b(?:for|about)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g)) {
    phrases.add(match[1]!);
  }

  const normalizedQuestion = normalizeFollowUpText(question);
  for (const match of normalizedQuestion.matchAll(/\b(?:for|about)\s+([a-z]+(?:\s+[a-z]+){1,3})\b/g)) {
    const tokens = match[1]!.split(/\s+/).filter(Boolean);
    const candidateTokens = tokens.filter((token) => !isDomainOrStopToken(token));
    if (candidateTokens.length >= 2) {
      phrases.add(candidateTokens.slice(0, 3).join(" "));
    }
  }

  return Array.from(phrases);
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
