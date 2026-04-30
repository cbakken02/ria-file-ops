import {
  createV2ClientMessageId,
  buildV2ChatApiRequestBody,
  type V2ClientChatMessage,
} from "@/lib/data-intelligence-v2/client-history";
import {
  getDataIntelligenceV2Config,
  type DataIntelligenceV2Config,
} from "@/lib/data-intelligence-v2/config";
import { DevMockDataIntelligenceV2Gateway } from "@/lib/data-intelligence-v2/dev-mock-data-gateway";
import { DevMockV2ModelAdapter } from "@/lib/data-intelligence-v2/dev-mock-model-adapter";
import { DEV_MOCK_OWNER_EMAIL } from "@/lib/data-intelligence-v2/dev-mock-fixtures";
import { DevMockSensitiveValueProvider } from "@/lib/data-intelligence-v2/dev-mock-sensitive-value-provider";
import {
  gradeV2EvalTurn,
  assertNoSensitiveLeaksInEvalArtifact,
  summarizeEvalFailures,
} from "@/lib/data-intelligence-v2/eval/graders";
import { getDefaultV2EvalCases } from "@/lib/data-intelligence-v2/eval/cases";
import {
  createOpenAIResponsesV2ModelAdapterFromConfig,
} from "@/lib/data-intelligence-v2/openai-model-adapter";
import {
  InMemoryRevealTokenStore,
  RevealTokenService,
} from "@/lib/data-intelligence-v2/reveal-token-service";
import {
  sanitizeObjectForModel,
  sanitizeTextForModel,
} from "@/lib/data-intelligence-v2/safe-memory";
import { runV2ChatTurn } from "@/lib/data-intelligence-v2/chat-service";
import { sanitizeSafeConversationState } from "@/lib/data-intelligence-v2/conversation-state";
import { sanitizeV2AssistantResponseForUser } from "@/lib/data-intelligence-v2/assistant-response";
import type { V2ModelAdapter } from "@/lib/data-intelligence-v2/model-adapter";
import type { ClientDataGateway } from "@/lib/data-intelligence-v2/data-gateway";
import type { SensitiveValueProvider } from "@/lib/data-intelligence-v2/sensitive-value-provider";
import type {
  V2EvalCaseResult,
  V2EvalRunSummary,
  RunV2EvalSuiteArgs,
} from "@/lib/data-intelligence-v2/eval/types";
import type {
  DataIntelligenceV2AuthContext,
  SafeConversationState,
} from "@/lib/data-intelligence-v2/types";

export async function runV2EvalSuite(
  args: RunV2EvalSuiteArgs = {},
): Promise<V2EvalRunSummary> {
  const mode = args.mode ?? "mock";
  const cases = args.cases ?? getDefaultV2EvalCases();
  const services = createV2EvalServicesForMode(args);
  const authContext = makeEvalAuthContext();
  const caseResults: V2EvalCaseResult[] = [];

  for (const evalCase of cases) {
    const turnResults = [];
    let messages: V2ClientChatMessage[] = [];
    let conversationState: SafeConversationState = {};

    for (const [turnIndex, turn] of evalCase.turns.entries()) {
      const requestBody = buildV2ChatApiRequestBody({
        message: turn.userMessage,
        messages,
        conversationState,
      });
      const result = await runV2ChatTurn({
        userMessage: requestBody.message,
        visibleHistory: requestBody.history,
        safeConversationState: requestBody.conversationState,
        authContext,
        modelAdapter: services.modelAdapter,
        dataGateway: services.dataGateway,
        revealTokenService: services.revealTokenService,
      });

      const grade = gradeV2EvalTurn({
        evalCase,
        turn,
        response: result.response,
        nextConversationState: result.nextConversationState,
        toolResults: result.toolResults,
      });
      const safeResponse = sanitizeEvalSummaryArtifact(
        sanitizeV2AssistantResponseForUser(result.response),
      );
      const safeNextConversationState = sanitizeSafeConversationState(
        result.nextConversationState,
      );
      const safeToolResults = sanitizeObjectForModel(
        result.toolResults,
      ) as typeof result.toolResults;

      const safeTurnResult = {
        caseId: evalCase.id,
        turnIndex,
        userMessage: sanitizeEvalPromptForSummary(requestBody.message),
        response: safeResponse,
        nextConversationState: sanitizeEvalSummaryArtifact(
          safeNextConversationState,
        ),
        toolResults: sanitizeEvalSummaryArtifact(safeToolResults),
        grade,
      };

      assertNoSensitiveLeaksInEvalArtifact(safeTurnResult);
      turnResults.push(safeTurnResult);

      messages = [
        ...messages,
        {
          id: createV2ClientMessageId(),
          role: "user" as const,
          content: requestBody.message,
          createdAt: new Date(0).toISOString(),
        },
        {
          id: createV2ClientMessageId(),
          role: "assistant" as const,
          content: typeof safeResponse.answerMarkdown === "string"
            ? safeResponse.answerMarkdown
            : "",
          createdAt: new Date(0).toISOString(),
          response: safeResponse,
        },
      ];
      conversationState = sanitizeEvalSummaryArtifact(safeNextConversationState);
    }

    const caseScore =
      turnResults.reduce((sum, turnResult) => sum + turnResult.grade.score, 0) /
      Math.max(1, turnResults.length);
    const caseResult: V2EvalCaseResult = {
      caseId: evalCase.id,
      title: evalCase.title,
      category: evalCase.category,
      passed: turnResults.every((turnResult) => turnResult.grade.passed),
      score: roundScore(caseScore),
      turnResults,
    };
    assertNoSensitiveLeaksInEvalArtifact(caseResult);
    caseResults.push(caseResult);
  }

  const totalCases = caseResults.length;
  const passedCases = caseResults.filter((caseResult) => caseResult.passed).length;
  const failedCases = totalCases - passedCases;
  const averageScore =
    caseResults.reduce((sum, caseResult) => sum + caseResult.score, 0) /
    Math.max(1, totalCases);
  const summary: V2EvalRunSummary = {
    mode,
    passed: failedCases === 0,
    totalCases,
    passedCases,
    failedCases,
    averageScore: roundScore(averageScore),
    safetyFailures: caseResults.reduce(
      (sum, caseResult) =>
        sum +
        caseResult.turnResults.reduce(
          (turnSum, turnResult) =>
            turnSum + turnResult.grade.safetyFailures.length,
          0,
        ),
      0,
    ),
    toolFailures: caseResults.reduce(
      (sum, caseResult) =>
        sum +
        caseResult.turnResults.reduce(
          (turnSum, turnResult) => turnSum + turnResult.grade.toolFailures.length,
          0,
        ),
      0,
    ),
    qualityFailures: caseResults.reduce(
      (sum, caseResult) =>
        sum +
        caseResult.turnResults.reduce(
          (turnSum, turnResult) =>
            turnSum + turnResult.grade.qualityFailures.length,
          0,
        ),
      0,
    ),
    caseResults,
  };

  const leaks = assertNoSensitiveLeaksInEvalArtifact(summary);
  if (leaks.length > 0) {
    throw new Error("Eval summary failed safety validation.");
  }

  if (args.print) {
    printV2EvalSummary(summary);
  }

  return sanitizeObjectForModel(summary) as V2EvalRunSummary;
}

export function createV2EvalServicesForMode(args: RunV2EvalSuiteArgs = {}): {
  modelAdapter: V2ModelAdapter;
  dataGateway: ClientDataGateway;
  revealTokenService: RevealTokenService;
} {
  const mode = args.mode ?? "mock";
  const config = args.config ?? getDataIntelligenceV2Config();
  const dataGateway = args.dataGateway ?? new DevMockDataIntelligenceV2Gateway();
  const sensitiveValueProvider =
    args.sensitiveValueProvider ?? new DevMockSensitiveValueProvider();
  const revealTokenService =
    args.revealTokenService ??
    makeRevealTokenService({ config, sensitiveValueProvider });

  if (mode === "mock") {
    return {
      modelAdapter: args.modelAdapter ?? new DevMockV2ModelAdapter(),
      dataGateway,
      revealTokenService,
    };
  }

  assertOpenAIFakeDataModeAllowed(config);

  return {
    modelAdapter:
      args.modelAdapter ?? createOpenAIResponsesV2ModelAdapterFromConfig(config),
    dataGateway,
    revealTokenService,
  };
}

export function printV2EvalSummary(summary: V2EvalRunSummary): void {
  const lines = [
    `V2 eval mode: ${summary.mode}`,
    `Cases: ${summary.passedCases}/${summary.totalCases} passed`,
    `Average score: ${summary.averageScore.toFixed(2)}`,
    `Failures: safety=${summary.safetyFailures}, tool=${summary.toolFailures}, quality=${summary.qualityFailures}`,
  ];
  const failures = summarizeEvalFailures(summary);
  if (failures.length > 0) {
    lines.push("Failed cases:");
    lines.push(...failures.map((failure) => `- ${sanitizeTextForModel(failure)}`));
  }

  for (const line of lines) {
    console.log(line);
  }
}

function makeRevealTokenService(args: {
  config: DataIntelligenceV2Config;
  sensitiveValueProvider: SensitiveValueProvider;
}) {
  return new RevealTokenService({
    store: new InMemoryRevealTokenStore(),
    sensitiveValueProvider: args.sensitiveValueProvider,
    defaultExpiresInMs: args.config.defaultRevealExpiresInMs,
  });
}

function assertOpenAIFakeDataModeAllowed(config: DataIntelligenceV2Config): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("OpenAI fake-data eval mode is disabled in production.");
  }

  if (
    !config.evalOpenAiEnabled ||
    !config.evalAllowNetwork ||
    !config.openAiEnabled ||
    !config.openAiApiKey ||
    !config.openAiModel
  ) {
    throw new Error(
      "OpenAI fake-data eval mode requires explicit eval, network, OpenAI, API key, and model configuration.",
    );
  }
}

function makeEvalAuthContext(): DataIntelligenceV2AuthContext {
  return {
    userEmail: DEV_MOCK_OWNER_EMAIL,
    ownerEmail: DEV_MOCK_OWNER_EMAIL,
    userId: "eval_user_1",
    role: "advisor",
    allowedOwnerEmails: [DEV_MOCK_OWNER_EMAIL],
    allowedClientIds: ["mock_client_alex", "mock_client_taylor", "mock_client_jordan"],
    allowSensitiveReveal: true,
  };
}

function sanitizeEvalPromptForSummary(message: string) {
  return sanitizeEvalSummaryText(message);
}

function sanitizeEvalSummaryArtifact<T>(input: T): T {
  if (typeof input === "string") {
    return sanitizeEvalSummaryText(input) as T;
  }

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeEvalSummaryArtifact(item)) as T;
  }

  if (input && typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [
        key,
        sanitizeEvalSummaryArtifact(value),
      ]),
    ) as T;
  }

  return input;
}

function sanitizeEvalSummaryText(value: string) {
  return sanitizeTextForModel(value)
    .replace(/\bsourceFileId\b/gi, "[SOURCE_FILE_ID_REDACTED]")
    .replace(/\bdriveFileId\b/gi, "[SOURCE_FILE_ID_REDACTED]")
    .replace(/\bgoogleDriveFileId\b/gi, "[SOURCE_FILE_ID_REDACTED]");
}

function roundScore(score: number) {
  return Math.round(score * 100) / 100;
}
