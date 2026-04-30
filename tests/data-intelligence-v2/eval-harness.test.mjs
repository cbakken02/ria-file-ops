import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEV_MOCK_ACCOUNT,
  DEV_MOCK_IDENTITY_VALUES,
} from "../../lib/data-intelligence-v2/dev-mock-fixtures.ts";
import { DevMockV2ModelAdapter } from "../../lib/data-intelligence-v2/dev-mock-model-adapter.ts";
import {
  getDefaultV2EvalCases,
} from "../../lib/data-intelligence-v2/eval/cases.ts";
import {
  assertNoSensitiveLeaksInEvalArtifact,
  gradeV2EvalTurn,
} from "../../lib/data-intelligence-v2/eval/graders.ts";
import {
  createV2EvalServicesForMode,
  runV2EvalSuite,
} from "../../lib/data-intelligence-v2/eval/runner.ts";
import {
  buildV2ChatApiRequestBody,
} from "../../lib/data-intelligence-v2/client-history.ts";
import {
  createToolResult,
} from "../../lib/data-intelligence-v2/tools/result-helpers.ts";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.resolve(
  TEST_DIR,
  "../../scripts/evaluate-data-intelligence-v2.mjs",
);
const DOC_PATH = path.resolve(TEST_DIR, "../../docs/data-intelligence-v2/evals.md");
const RAW_FAKE_ACCOUNT = DEV_MOCK_ACCOUNT.fullAccountNumber;
const RAW_FAKE_SSN = DEV_MOCK_IDENTITY_VALUES["client.ssn"];

test("eval cases are numerous, unique, and tagged safely", () => {
  const cases = getDefaultV2EvalCases();
  const ids = new Set(cases.map((evalCase) => evalCase.id));

  assert.equal(cases.length >= 20, true);
  assert.equal(ids.size, cases.length);

  for (const evalCase of cases) {
    const serialized = JSON.stringify({
      id: evalCase.id,
      title: evalCase.title,
      description: evalCase.description,
      requiredAnswerSubstrings: evalCase.turns.flatMap(
        (turn) => turn.requiredAnswerSubstrings ?? [],
      ),
    });
    assert.equal(serialized.includes(RAW_FAKE_ACCOUNT), false);
    assert.equal(serialized.includes(RAW_FAKE_SSN), false);

    const prompts = evalCase.turns.map((turn) => turn.userMessage).join("\n");
    if (prompts.includes(RAW_FAKE_ACCOUNT) || prompts.includes(RAW_FAKE_SSN)) {
      assert.equal(evalCase.category, "red_team");
    }
  }
});

test("grader fails raw sensitive responses and allows reveal metadata", () => {
  const base = {
    evalCase: makeEvalCase(),
    turn: {},
    nextConversationState: {},
    toolResults: [],
  };

  const ssnGrade = gradeV2EvalTurn({
    ...base,
    response: safeResponse({ answerMarkdown: `Unsafe ${RAW_FAKE_SSN}` }),
  });
  assert.equal(ssnGrade.passed, false);
  assert.equal(ssnGrade.safetyFailures.length > 0, true);

  const accountGrade = gradeV2EvalTurn({
    ...base,
    response: safeResponse({ answerMarkdown: `Unsafe ${RAW_FAKE_ACCOUNT}` }),
  });
  assert.equal(accountGrade.passed, false);
  assert.equal(accountGrade.safetyFailures.length > 0, true);

  const sourceIdGrade = gradeV2EvalTurn({
    ...base,
    response: safeResponse({ answerMarkdown: "sourceFileId drive_file_abc123" }),
  });
  assert.equal(sourceIdGrade.passed, false);
  assert.equal(sourceIdGrade.safetyFailures.length > 0, true);

  const safeGrade = gradeV2EvalTurn({
    ...base,
    turn: { requireSecureRevealCard: true },
    response: safeResponse({ secureRevealCards: [safeRevealCard()] }),
  });
  assert.equal(safeGrade.passed, true);
});

test("grader checks required and forbidden tool behavior", () => {
  const missingTool = gradeV2EvalTurn({
    evalCase: makeEvalCase(),
    turn: {
      expectedToolCalls: [{ toolName: "resolve_client" }],
      requireSecureRevealCard: true,
    },
    response: safeResponse(),
    nextConversationState: {},
    toolResults: [],
  });
  assert.equal(missingTool.passed, false);
  assert.equal(missingTool.toolFailures.length > 0, true);
  assert.equal(missingTool.qualityFailures.length > 0, true);

  const forbiddenTool = gradeV2EvalTurn({
    evalCase: makeEvalCase(),
    turn: {
      forbiddenToolCalls: [
        { toolName: "get_accounts", reason: "Not needed." },
      ],
    },
    response: safeResponse(),
    nextConversationState: {},
    toolResults: [toolResult("get_accounts")],
  });
  assert.equal(forbiddenTool.passed, false);
  assert.equal(forbiddenTool.toolFailures.length > 0, true);
});

test("grader checks draft notes, recommended steps, missing data, and empty answers", () => {
  const grade = gradeV2EvalTurn({
    evalCase: makeEvalCase(),
    turn: {
      requireDraftNote: true,
      requireRecommendedSteps: true,
      requireMissingData: true,
    },
    response: safeResponse({ answerMarkdown: "" }),
    nextConversationState: {},
    toolResults: [],
  });

  assert.equal(grade.passed, false);
  assert.equal(grade.qualityFailures.length >= 3, true);
});

test("mock eval runner completes default suite without OpenAI or real DB", async () => {
  const summary = await runV2EvalSuite({ mode: "mock" });

  assert.equal(summary.totalCases >= 20, true);
  assert.equal(summary.passed, true);
  assert.equal(summary.failedCases, 0);
  assert.equal(summary.safetyFailures, 0);
  assert.equal(JSON.stringify(summary).includes(RAW_FAKE_ACCOUNT), false);
  assert.equal(JSON.stringify(summary).includes(RAW_FAKE_SSN), false);
  assert.deepEqual(assertNoSensitiveLeaksInEvalArtifact(summary), []);
});

test("single eval case runs independently", async () => {
  const latestStatement = getDefaultV2EvalCases().filter(
    (evalCase) => evalCase.id === "latest_statement",
  );
  const summary = await runV2EvalSuite({ mode: "mock", cases: latestStatement });

  assert.equal(summary.totalCases, 1);
  assert.equal(summary.caseResults[0].caseId, "latest_statement");
  assert.equal(summary.passed, true);
});

test("multi-turn eval carries safe state without revealed values", async () => {
  const followup = getDefaultV2EvalCases().filter(
    (evalCase) => evalCase.id === "show_that_again_followup",
  );
  const summary = await runV2EvalSuite({ mode: "mock", cases: followup });
  const secondTurn = summary.caseResults[0].turnResults[1];

  assert.equal(summary.passed, true);
  assert.equal(
    secondTurn.nextConversationState.lastSensitiveReveals.length > 0,
    true,
  );
  assert.equal(JSON.stringify(secondTurn).includes(RAW_FAKE_ACCOUNT), false);
});

test("openai fake-data mode is explicitly guarded", async () => {
  assert.throws(
    () =>
      createV2EvalServicesForMode({
        mode: "openai_fake_data",
        config: {
          enabled: true,
          chatApiEnabled: true,
          uiEnabled: false,
          devMockEnabled: false,
          revealApiEnabled: false,
          allowSensitiveRevealForAuthenticatedUsers: false,
          defaultRevealExpiresInMs: 600000,
          revealStoreBackend: "auto",
          auditBackend: "auto",
          openAiEnabled: false,
          openAiBaseUrl: "https://api.openai.com/v1",
          openAiTimeoutMs: 30000,
          evalOpenAiEnabled: false,
          evalAllowNetwork: false,
        },
      }),
    /requires explicit eval/,
  );

  const originalNodeEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    assert.throws(
      () =>
        createV2EvalServicesForMode({
          mode: "openai_fake_data",
          config: {
            enabled: true,
            chatApiEnabled: true,
            uiEnabled: false,
            devMockEnabled: false,
            revealApiEnabled: false,
            allowSensitiveRevealForAuthenticatedUsers: false,
            defaultRevealExpiresInMs: 600000,
            revealStoreBackend: "auto",
            auditBackend: "auto",
            openAiEnabled: true,
            openAiApiKey: "test-key",
            openAiBaseUrl: "https://api.openai.com/v1",
            openAiModel: "test-model",
            openAiTimeoutMs: 30000,
            evalOpenAiEnabled: true,
            evalAllowNetwork: true,
          },
          modelAdapter: new DevMockV2ModelAdapter(),
        }),
      /disabled in production/,
    );
  } finally {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  }

  const services = createV2EvalServicesForMode({
    mode: "openai_fake_data",
    config: {
      enabled: true,
      chatApiEnabled: true,
      uiEnabled: false,
      devMockEnabled: false,
      revealApiEnabled: false,
      allowSensitiveRevealForAuthenticatedUsers: false,
      defaultRevealExpiresInMs: 600000,
      revealStoreBackend: "auto",
      auditBackend: "auto",
      openAiEnabled: true,
      openAiApiKey: "test-key",
      openAiBaseUrl: "https://api.openai.com/v1",
      openAiModel: "test-model",
      openAiTimeoutMs: 30000,
      evalOpenAiEnabled: true,
      evalAllowNetwork: true,
    },
    modelAdapter: new DevMockV2ModelAdapter(),
  });
  assert.ok(services.modelAdapter instanceof DevMockV2ModelAdapter);
});

test("eval config flags are exact opt-in and disabled in production", async () => {
  const { getDataIntelligenceV2Config } = await import(
    "../../lib/data-intelligence-v2/config.ts"
  );

  assert.equal(getDataIntelligenceV2Config({}).evalOpenAiEnabled, false);
  assert.equal(getDataIntelligenceV2Config({}).evalAllowNetwork, false);
  assert.equal(
    getDataIntelligenceV2Config({
      NODE_ENV: "development",
      DATA_INTELLIGENCE_V2_EVAL_OPENAI_ENABLED: "true",
      DATA_INTELLIGENCE_V2_EVAL_ALLOW_NETWORK: "true",
    }).evalOpenAiEnabled,
    true,
  );
  assert.equal(
    getDataIntelligenceV2Config({
      NODE_ENV: "development",
      DATA_INTELLIGENCE_V2_EVAL_OPENAI_ENABLED: "true",
      DATA_INTELLIGENCE_V2_EVAL_ALLOW_NETWORK: "true",
    }).evalAllowNetwork,
    true,
  );
  assert.equal(
    getDataIntelligenceV2Config({
      NODE_ENV: "production",
      DATA_INTELLIGENCE_V2_EVAL_OPENAI_ENABLED: "true",
      DATA_INTELLIGENCE_V2_EVAL_ALLOW_NETWORK: "true",
    }).evalOpenAiEnabled,
    false,
  );

  for (const value of ["TRUE", "1", "yes", "false"]) {
    const config = getDataIntelligenceV2Config({
      NODE_ENV: "development",
      DATA_INTELLIGENCE_V2_EVAL_OPENAI_ENABLED: value,
      DATA_INTELLIGENCE_V2_EVAL_ALLOW_NETWORK: value,
    });
    assert.equal(config.evalOpenAiEnabled, false);
    assert.equal(config.evalAllowNetwork, false);
  }
});

test("client follow-up payload excludes revealed values", () => {
  const payload = buildV2ChatApiRequestBody({
    message: "Draft a note to the advisor.",
    messages: [
      {
        id: "msg_1",
        role: "assistant",
        content: "Safe assistant message.",
        createdAt: new Date(0).toISOString(),
        response: safeResponse({ secureRevealCards: [safeRevealCard()] }),
        revealedValue: RAW_FAKE_ACCOUNT,
      },
    ],
    conversationState: {
      activeClientId: "mock_client_alex",
      lastSensitiveReveals: [
        {
          revealCardId: "rvl_eval_card",
          clientId: "mock_client_alex",
          field: "full_account_number",
          label: "Mock reveal",
          actualValueWasNotShownToModel: true,
        },
      ],
    },
  });

  assert.equal(JSON.stringify(payload).includes(RAW_FAKE_ACCOUNT), false);
});

test("CLI source does not use V1 assistant or unsafe output defaults", async () => {
  const source = await readFile(SCRIPT_PATH, "utf8");

  assert.equal(source.includes("query-assistant"), false);
  assert.equal(source.includes("askFirmDocumentAssistant"), false);
  assert.equal(source.includes("answerDataIntelligenceQuestion"), false);
  assert.equal(source.includes("writeFile"), false);
});

test("eval documentation exists and avoids raw fake sensitive values", async () => {
  const doc = await readFile(DOC_PATH, "utf8");

  assert.match(doc, /mock mode/i);
  assert.match(doc, /openai-fake-data/i);
  assert.match(doc, /DATA_INTELLIGENCE_V2_EVAL_OPENAI_ENABLED/);
  assert.match(doc, /no real client data/i);
  assert.match(doc, /quality gates/i);
  assert.equal(doc.includes(RAW_FAKE_ACCOUNT), false);
  assert.equal(doc.includes(RAW_FAKE_SSN), false);
});

function safeResponse(overrides = {}) {
  return {
    responseType: "client_data_answer",
    answerMarkdown: "Safe answer.",
    sourceBackedFacts: [],
    missingOrUnverified: [],
    recommendedSteps: ["Review the safe result."],
    secureRevealCards: [],
    followupSuggestions: [],
    ...overrides,
  };
}

function safeRevealCard() {
  return {
    revealCardId: "rvl_eval_card",
    fieldKey: "account.fullAccountNumber",
    fieldLabel: "Full account number",
    clientId: "mock_client_alex",
    accountId: "mock_account_schwab_ira",
    label: "Mock reveal card",
    maskedValue: "****2222",
    status: "on_file",
    expiresAt: new Date(Date.UTC(2030, 0, 1)).toISOString(),
    actualValueWasNotShownToModel: true,
  };
}

function toolResult(toolName) {
  return createToolResult({
    toolName,
    status: "success",
    summary: "Safe tool result.",
  });
}

function makeEvalCase() {
  return {
    id: "test_case",
    title: "Test case",
    category: "client_resolution",
    description: "Test case.",
    turns: [],
  };
}
