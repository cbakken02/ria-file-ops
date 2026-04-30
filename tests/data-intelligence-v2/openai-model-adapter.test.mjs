import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_OPENAI_TIMEOUT_MS,
  getDataIntelligenceV2Config,
} from "../../lib/data-intelligence-v2/config.ts";
import {
  OpenAIResponsesV2ModelAdapter,
  createOpenAIResponsesV2ModelAdapterFromConfig,
} from "../../lib/data-intelligence-v2/openai-model-adapter.ts";
import {
  getOpenAIV2AssistantResponseTextFormat,
  OPENAI_V2_ASSISTANT_RESPONSE_SCHEMA,
} from "../../lib/data-intelligence-v2/openai-response-schema.ts";
import {
  getOpenAIV2ToolDefinitions,
} from "../../lib/data-intelligence-v2/openai-tool-schema.ts";
import {
  UnavailableV2ModelAdapter,
} from "../../lib/data-intelligence-v2/model-adapter.ts";
import {
  getDefaultV2ModelAdapter,
  resetDataIntelligenceV2ServiceFactoryForTests,
} from "../../lib/data-intelligence-v2/service-factory.ts";
import { runV2ToolLoop } from "../../lib/data-intelligence-v2/tool-loop.ts";

const RAW_SSN = "123-45-6789";
const RAW_ACCOUNT = "9876543210123456";
const RAW_EMAIL = "client@example.com";
const RAW_PHONE = "312-555-1212";
const RAW_ADDRESS = "123 Main St, Chicago, IL 60601";
const RAW_SOURCE_FILE_ID = "drive_file_abc123";

const authContext = {
  userEmail: "owner@example.test",
  ownerEmail: "owner@example.test",
  role: "advisor",
  allowedOwnerEmails: ["owner@example.test"],
};

test("OpenAI config is opt-in and reads model/key/timeout settings safely", () => {
  const defaults = getDataIntelligenceV2Config({});

  assert.equal(defaults.openAiEnabled, false);
  assert.equal(defaults.openAiBaseUrl, "https://api.openai.com/v1");
  assert.equal(defaults.openAiTimeoutMs, DEFAULT_OPENAI_TIMEOUT_MS);
  assert.equal(defaults.openAiApiKey, undefined);

  const configured = getDataIntelligenceV2Config({
    DATA_INTELLIGENCE_V2_OPENAI_ENABLED: "true",
    DATA_INTELLIGENCE_V2_OPENAI_API_KEY: "test-key",
    OPENAI_API_KEY: "fallback-key",
    DATA_INTELLIGENCE_V2_OPENAI_BASE_URL: "https://example.test/v1",
    DATA_INTELLIGENCE_V2_MODEL: "gpt-test",
    DATA_INTELLIGENCE_MODEL: "fallback-model",
    DATA_INTELLIGENCE_V2_OPENAI_TIMEOUT_MS: "1234",
    DATA_INTELLIGENCE_V2_OPENAI_MAX_OUTPUT_TOKENS: "4321",
  });

  assert.equal(configured.openAiEnabled, true);
  assert.equal(configured.openAiApiKey, "test-key");
  assert.equal(configured.openAiBaseUrl, "https://example.test/v1");
  assert.equal(configured.openAiModel, "gpt-test");
  assert.equal(configured.openAiTimeoutMs, 1234);
  assert.equal(configured.openAiMaxOutputTokens, 4321);

  const fallback = getDataIntelligenceV2Config({
    DATA_INTELLIGENCE_V2_OPENAI_ENABLED: "true",
    OPENAI_API_KEY: "fallback-key",
    DATA_INTELLIGENCE_MODEL: "fallback-model",
    DATA_INTELLIGENCE_V2_OPENAI_TIMEOUT_MS: "not-valid",
  });
  assert.equal(fallback.openAiApiKey, "fallback-key");
  assert.equal(fallback.openAiModel, "fallback-model");
  assert.equal(fallback.openAiTimeoutMs, DEFAULT_OPENAI_TIMEOUT_MS);
});

test("OpenAI tool schemas expose strict V2 tools without auth or raw-value args", () => {
  const tools = getOpenAIV2ToolDefinitions();
  const names = tools.map((tool) => tool.name).sort();

  assert.deepEqual(names, [
    "check_workflow_requirements",
    "create_sensitive_reveal",
    "get_accounts",
    "get_identity_status",
    "get_latest_statements",
    "get_tax_documents",
    "resolve_client",
  ]);

  for (const tool of tools) {
    assert.equal(tool.type, "function");
    assert.equal(tool.strict, true);
    assert.equal(tool.parameters.additionalProperties, false);
    const propertyNames = Object.keys(tool.parameters.properties);
    for (const forbidden of [
      "ownerEmail",
      "userEmail",
      "role",
      "firmId",
      "permissions",
      "allowSensitiveReveal",
      "rawValue",
      "ssn",
      "fullAccountNumber",
    ]) {
      assert.equal(
        propertyNames.includes(forbidden),
        false,
        `${tool.name} includes forbidden property ${forbidden}`,
      );
    }
  }

  const revealTool = tools.find((tool) => tool.name === "create_sensitive_reveal");
  assert.ok(revealTool);
  assert.equal(
    Object.keys(revealTool.parameters.properties).includes("value"),
    false,
  );
});

test("OpenAI assistant response schema is strict and includes V2 response fields", () => {
  const textFormat = getOpenAIV2AssistantResponseTextFormat();

  assert.equal(textFormat.type, "json_schema");
  assert.equal(textFormat.strict, true);
  assert.equal(textFormat.schema.additionalProperties, false);
  for (const required of [
    "responseType",
    "answerMarkdown",
    "sourceBackedFacts",
    "missingOrUnverified",
    "recommendedSteps",
    "secureRevealCards",
    "followupSuggestions",
    "statePatch",
  ]) {
    assert.ok(OPENAI_V2_ASSISTANT_RESPONSE_SCHEMA.required.includes(required));
  }
  assert.ok(OPENAI_V2_ASSISTANT_RESPONSE_SCHEMA.properties.secureRevealCards);
});

test("OpenAI adapter first request sends sanitized Responses payload and fails closed on unsafe direct input", async () => {
  const captured = [];
  const adapter = new OpenAIResponsesV2ModelAdapter({
    apiKey: "test-key",
    model: "gpt-test",
    baseUrl: "https://api.test/v1/",
    createClient: async (request) => {
      captured.push(request);
      return finalResponsePayload(
        assistantResponseJson({
          answerMarkdown: "Safe structured answer.",
        }),
      );
    },
  });

  const response = await adapter.run({
    systemPrompt: "Safe system prompt.",
    messages: [{ role: "user", content: "No sensitive values here." }],
    safeConversationState: {},
    toolDefinitions: [],
    previousToolResults: [],
    iteration: 0,
  });

  assert.equal(response.type, "final_response");
  assert.equal(captured.length, 1);
  assert.equal(captured[0].url, "https://api.test/v1/responses");
  assert.equal(captured[0].headers.Authorization.startsWith("Bearer "), true);
  assert.equal(captured[0].body.model, "gpt-test");
  assert.equal(captured[0].body.store, false);
  assert.equal(captured[0].body.tool_choice, "auto");
  assert.equal(captured[0].body.text.format.type, "json_schema");
  assert.ok(captured[0].body.tools.length > 0);
  assertNoRawSensitiveContent(captured[0].body);

  const unsafeCaptured = [];
  const unsafeAdapter = new OpenAIResponsesV2ModelAdapter({
    apiKey: "test-key",
    model: "gpt-test",
    createClient: async (request) => {
      unsafeCaptured.push(request);
      return finalResponsePayload(assistantResponseJson());
    },
  });
  const unsafeResponse = await unsafeAdapter.run({
    systemPrompt: "Safe system prompt.",
    messages: [
      {
        role: "user",
        content: `SSN ${RAW_SSN} account ${RAW_ACCOUNT} email ${RAW_EMAIL} phone ${RAW_PHONE} address ${RAW_ADDRESS} file ${RAW_SOURCE_FILE_ID}`,
      },
    ],
    safeConversationState: {},
    toolDefinitions: [],
    previousToolResults: [],
    iteration: 0,
  });

  assert.equal(unsafeCaptured.length, 0);
  assert.equal(unsafeResponse.type, "final_response");
  assert.equal(unsafeResponse.response.responseType, "error");
  assertNoRawSensitiveContent(unsafeResponse);
});

test("OpenAI adapter parses Responses function_call output into V2 tool calls", async () => {
  const adapter = new OpenAIResponsesV2ModelAdapter({
    apiKey: "test-key",
    model: "gpt-test",
    createClient: async () => ({
      output: [
        {
          type: "function_call",
          call_id: "call_1",
          name: "resolve_client",
          arguments: "{\"query\":\"John Smith\",\"limit\":3}",
        },
      ],
    }),
  });

  const response = await adapter.run(baseAdapterRequest());

  assert.equal(response.type, "tool_calls");
  assert.equal(response.toolCalls.length, 1);
  assert.deepEqual(response.toolCalls[0], {
    callId: "call_1",
    toolName: "resolve_client",
    args: { query: "John Smith", limit: 3 },
  });
  assert.ok(response.providerState);
});

test("OpenAI adapter sends function_call_output follow-ups and parses final structured response", async () => {
  const captured = [];
  const adapter = new OpenAIResponsesV2ModelAdapter({
    apiKey: "test-key",
    model: "gpt-test",
    createClient: async (request) => {
      captured.push(request);
      return finalResponsePayload(
        assistantResponseJson({
          responseType: "client_data_answer",
          answerMarkdown: "Resolved John Smith.",
          recommendedSteps: ["Review source-backed facts."],
        }),
      );
    },
  });

  const response = await adapter.run({
    ...baseAdapterRequest(),
    providerState: {
      responseOutputItems: [
        {
          type: "function_call",
          call_id: "call_1",
          name: "resolve_client",
          arguments: "{\"query\":\"John Smith\"}",
        },
      ],
    },
    previousToolResults: [
      {
        callId: "call_1",
        toolName: "resolve_client",
        result: {
          toolName: "resolve_client",
          status: "success",
          summary: "Resolved client.",
          facts: [],
          missing: [],
          sourceRefs: [],
          secureRevealCards: [],
          allowedClaims: [],
          disallowedClaims: [],
        },
      },
    ],
  });

  const input = captured[0].body.input;
  assert.ok(
    input.some((item) => item.type === "function_call_output" && item.call_id === "call_1"),
  );
  assertNoRawSensitiveContent(captured[0].body);
  assert.equal(response.type, "final_response");
  assert.equal(response.response.answerMarkdown, "Resolved John Smith.");
});

test("OpenAI adapter does not replay reasoning items when sending function_call_output follow-ups", async () => {
  const captured = [];
  const adapter = new OpenAIResponsesV2ModelAdapter({
    apiKey: "test-key",
    model: "gpt-test",
    createClient: async (request) => {
      captured.push(request);
      return finalResponsePayload(
        assistantResponseJson({
          responseType: "client_data_answer",
          answerMarkdown: "Resolved John Smith.",
          recommendedSteps: ["Review source-backed facts."],
        }),
      );
    },
  });

  await adapter.run({
    ...baseAdapterRequest(),
    providerState: {
      responseOutputItems: [
        {
          type: "reasoning",
          id: "rs_test",
          summary: [],
        },
        {
          type: "function_call",
          call_id: "call_1",
          name: "resolve_client",
          arguments: "{\"query\":\"John Smith\"}",
        },
      ],
    },
    previousToolResults: [
      {
        callId: "call_1",
        toolName: "resolve_client",
        result: {
          toolName: "resolve_client",
          status: "success",
          summary: "Resolved client.",
          facts: [],
          missing: [],
          sourceRefs: [],
          secureRevealCards: [],
          allowedClaims: [],
          disallowedClaims: [],
        },
      },
    ],
  });

  const input = captured[0].body.input;
  assert.equal(input.some((item) => item.type === "reasoning"), false);
  assert.equal(input.some((item) => item.type === "function_call"), true);
  assert.equal(input.some((item) => item.type === "function_call_output"), true);
});

test("OpenAI adapter parses final output_text structured response", async () => {
  const adapter = new OpenAIResponsesV2ModelAdapter({
    apiKey: "test-key",
    model: "gpt-test",
    createClient: async () =>
      finalResponsePayload(
        assistantResponseJson({
          answerMarkdown: "Here is the safe answer.",
          recommendedSteps: ["Confirm the client before proceeding."],
        }),
      ),
  });

  const response = await adapter.run(baseAdapterRequest());

  assert.equal(response.type, "final_response");
  assert.equal(response.response.answerMarkdown, "Here is the safe answer.");
  assert.deepEqual(response.response.recommendedSteps, [
    "Confirm the client before proceeding.",
  ]);
});

test("OpenAI adapter fails closed on unsafe final content, invalid JSON, invalid args, and invalid tools", async () => {
  const unsafe = await adapterWithResponse(
    finalResponsePayload(
      assistantResponseJson({
        answerMarkdown: `The SSN is ${RAW_SSN}.`,
        draftNote: {
          audience: "advisor",
          bodyMarkdown: `Use account ${RAW_ACCOUNT}.`,
          containsSensitivePlaceholders: false,
        },
      }),
    ),
  ).run(baseAdapterRequest());
  assert.equal(unsafe.type, "final_response");
  assert.equal(unsafe.response.responseType, "error");
  assertNoRawSensitiveContent(unsafe);

  const invalidJson = await adapterWithResponse({ output_text: "not json" }).run(
    baseAdapterRequest(),
  );
  assert.equal(invalidJson.response.responseType, "error");

  const invalidArgs = await adapterWithResponse({
    output: [
      {
        type: "function_call",
        call_id: "call_bad",
        name: "resolve_client",
        arguments: "{bad json",
      },
    ],
  }).run(baseAdapterRequest());
  assert.equal(invalidArgs.response.responseType, "error");

  const invalidTool = await adapterWithResponse({
    output: [
      {
        type: "function_call",
        call_id: "call_bad",
        name: "query_database",
        arguments: "{}",
      },
    ],
  }).run(baseAdapterRequest());
  assert.equal(invalidTool.response.responseType, "error");
});

test("OpenAI adapter timeout returns safe error without raw stack", async () => {
  const adapter = new OpenAIResponsesV2ModelAdapter({
    apiKey: "test-key",
    model: "gpt-test",
    timeoutMs: 5,
    createClient: async () => new Promise(() => {}),
  });

  const response = await adapter.run(baseAdapterRequest());

  assert.equal(response.type, "final_response");
  assert.equal(response.response.responseType, "error");
  assertNoRawSensitiveContent(response);
});

test("OpenAI model adapter factory returns unavailable or OpenAI adapter without calling the API", () => {
  assert.ok(
    createOpenAIResponsesV2ModelAdapterFromConfig({
      ...getDataIntelligenceV2Config({}),
      openAiEnabled: false,
    }) instanceof UnavailableV2ModelAdapter,
  );
  assert.ok(
    createOpenAIResponsesV2ModelAdapterFromConfig({
      ...getDataIntelligenceV2Config({}),
      openAiEnabled: true,
      openAiApiKey: "test-key",
      openAiModel: "gpt-test",
    }) instanceof OpenAIResponsesV2ModelAdapter,
  );

  const originalEnv = snapshotEnv();
  try {
    resetDataIntelligenceV2ServiceFactoryForTests();
    delete process.env.DATA_INTELLIGENCE_V2_OPENAI_ENABLED;
    let first = getDefaultV2ModelAdapter();
    assert.ok(first instanceof UnavailableV2ModelAdapter);

    process.env.DATA_INTELLIGENCE_V2_OPENAI_ENABLED = "true";
    process.env.DATA_INTELLIGENCE_V2_OPENAI_API_KEY = "test-key";
    process.env.DATA_INTELLIGENCE_V2_MODEL = "gpt-test";
    resetDataIntelligenceV2ServiceFactoryForTests();
    first = getDefaultV2ModelAdapter();
    const second = getDefaultV2ModelAdapter();
    assert.ok(first instanceof OpenAIResponsesV2ModelAdapter);
    assert.equal(first, second);

    resetDataIntelligenceV2ServiceFactoryForTests();
    assert.notEqual(getDefaultV2ModelAdapter(), first);
  } finally {
    restoreEnv(originalEnv);
    resetDataIntelligenceV2ServiceFactoryForTests();
  }
});

test("OpenAI adapter integrates with tool loop using mocked Responses API", async () => {
  const captured = [];
  const adapter = new OpenAIResponsesV2ModelAdapter({
    apiKey: "test-key",
    model: "gpt-test",
    createClient: async (request) => {
      captured.push(request);
      if (captured.length === 1) {
        return {
          output: [
            {
              type: "function_call",
              call_id: "call_1",
              name: "resolve_client",
              arguments: "{\"query\":\"John Smith\"}",
            },
          ],
        };
      }

      return finalResponsePayload(
        assistantResponseJson({
          responseType: "client_data_answer",
          answerMarkdown: "John Smith was resolved from structured records.",
        }),
      );
    },
  });

  const result = await runV2ToolLoop({
    userMessage: `Resolve John Smith without using ${RAW_SSN}.`,
    visibleHistory: [
      {
        role: "user",
        content: `Old pasted email ${RAW_EMAIL} and account ${RAW_ACCOUNT}`,
      },
    ],
    authContext,
    modelAdapter: adapter,
    dataGateway: {
      async resolveClient() {
        return {
          candidates: [
            {
              clientId: "client_1",
              displayName: "John Smith",
              sourceRefs: [],
            },
          ],
          sourceRefs: [],
          missing: [],
        };
      },
    },
  });

  assert.equal(result.response.responseType, "client_data_answer");
  assert.equal(captured.length, 2);
  assert.equal(captured.every((request) => request.body.store === false), true);
  assertNoRawSensitiveContent(captured.map((request) => request.body));
  assertNoRawSensitiveContent(result.modelMessagesSent);
  assertNoRawSensitiveContent(result.response);
  assertNoRawSensitiveContent(result.nextConversationState);
});

test("tool loop preserves prior OpenAI function calls across sequential tool follow-ups", async () => {
  const captured = [];
  const adapter = new OpenAIResponsesV2ModelAdapter({
    apiKey: "test-key",
    model: "gpt-test",
    createClient: async (request) => {
      captured.push(request);
      if (captured.length === 1) {
        return {
          output: [
            {
              type: "function_call",
              call_id: "call_1",
              name: "resolve_client",
              arguments: "{\"query\":\"John Smith\"}",
            },
          ],
        };
      }

      if (captured.length === 2) {
        return {
          output: [
            {
              type: "function_call",
              call_id: "call_2",
              name: "get_latest_statements",
              arguments: "{\"clientId\":\"client_1\"}",
            },
          ],
        };
      }

      return finalResponsePayload(
        assistantResponseJson({
          responseType: "client_data_answer",
          answerMarkdown: "Latest statement metadata was found.",
          recommendedSteps: ["Review the statement source."],
        }),
      );
    },
  });

  const result = await runV2ToolLoop({
    userMessage: "Find John Smith's latest statement.",
    authContext,
    modelAdapter: adapter,
    dataGateway: {
      async resolveClient() {
        return {
          candidates: [
            {
              clientId: "client_1",
              displayName: "John Smith",
              sourceRefs: [],
            },
          ],
          sourceRefs: [],
          missing: [],
        };
      },
      async getLatestStatements() {
        return {
          statements: [
            {
              documentId: "doc_1",
              label: "Statement",
              custodian: "Schwab",
              accountType: "IRA",
              statementDate: "2024-12-31",
              sourceRefs: [],
            },
          ],
          sourceRefs: [],
          missing: [],
        };
      },
    },
  });

  const finalInput = captured[2].body.input;
  assert.equal(
    finalInput.some(
      (item) => item.type === "function_call" && item.call_id === "call_1",
    ),
    true,
  );
  assert.equal(
    finalInput.some(
      (item) => item.type === "function_call" && item.call_id === "call_2",
    ),
    true,
  );
  assert.equal(
    finalInput.some(
      (item) =>
        item.type === "function_call_output" && item.call_id === "call_1",
    ),
    true,
  );
  assert.equal(
    finalInput.some(
      (item) =>
        item.type === "function_call_output" && item.call_id === "call_2",
    ),
    true,
  );
  assert.equal(result.response.responseType, "client_data_answer");
});

function baseAdapterRequest(overrides = {}) {
  return {
    systemPrompt: "Safe system prompt.",
    messages: [{ role: "user", content: "Resolve John Smith." }],
    safeConversationState: {},
    toolDefinitions: [],
    previousToolResults: [],
    iteration: 0,
    ...overrides,
  };
}

function adapterWithResponse(response) {
  return new OpenAIResponsesV2ModelAdapter({
    apiKey: "test-key",
    model: "gpt-test",
    createClient: async () => response,
  });
}

function finalResponsePayload(json) {
  return {
    output_text: JSON.stringify(json),
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: JSON.stringify(json),
          },
        ],
      },
    ],
  };
}

function assistantResponseJson(overrides = {}) {
  return {
    responseType: "general_guidance",
    answerMarkdown: "Safe answer.",
    sourceBackedFacts: [],
    missingOrUnverified: [],
    recommendedSteps: [],
    secureRevealCards: [],
    draftNote: null,
    followupSuggestions: [],
    statePatch: null,
    ...overrides,
  };
}

function assertNoRawSensitiveContent(value) {
  const serialized = JSON.stringify(value);
  for (const rawValue of [
    RAW_SSN,
    RAW_ACCOUNT,
    RAW_EMAIL,
    RAW_PHONE,
    RAW_ADDRESS,
    RAW_SOURCE_FILE_ID,
  ]) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `Expected payload not to include ${rawValue}`,
    );
  }
}

function snapshotEnv() {
  return {
    DATA_INTELLIGENCE_V2_OPENAI_ENABLED:
      process.env.DATA_INTELLIGENCE_V2_OPENAI_ENABLED,
    DATA_INTELLIGENCE_V2_OPENAI_API_KEY:
      process.env.DATA_INTELLIGENCE_V2_OPENAI_API_KEY,
    DATA_INTELLIGENCE_V2_MODEL: process.env.DATA_INTELLIGENCE_V2_MODEL,
  };
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
