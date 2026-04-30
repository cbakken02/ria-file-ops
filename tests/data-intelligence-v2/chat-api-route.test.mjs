import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildDataIntelligenceV2AuthContext,
} from "../../lib/data-intelligence-v2/auth-context.ts";
import {
  DEFAULT_REVEAL_EXPIRES_IN_MS,
  getDataIntelligenceV2Config,
} from "../../lib/data-intelligence-v2/config.ts";
import {
  handleV2ChatApiRequest,
} from "../../lib/data-intelligence-v2/chat-api-handler.ts";
import {
  InMemoryRevealAuditSink,
} from "../../lib/data-intelligence-v2/reveal-audit.ts";
import {
  InMemoryRevealTokenStore,
  RevealTokenService,
} from "../../lib/data-intelligence-v2/reveal-token-service.ts";
import {
  resetDataIntelligenceV2ServiceFactoryForTests,
} from "../../lib/data-intelligence-v2/service-factory.ts";
const RAW_SSN = "123-45-6789";
const RAW_ACCOUNT = "9876543210123456";
const RAW_EMAIL = "client@example.com";
const RAW_PHONE = "312-555-1212";
const RAW_DOB = "01/23/1960";
const RAW_ADDRESS = "123 Main St, Chicago, IL 60601";
const RAW_SOURCE_FILE_ID = "drive_file_abc123";
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const CHAT_ROUTE_PATH = path.resolve(
  TEST_DIR,
  "../../app/api/data-intelligence/v2/chat/route.ts",
);

const CHAT_ENABLED_CONFIG = {
  enabled: true,
  chatApiEnabled: true,
  uiEnabled: false,
  devMockEnabled: false,
  revealApiEnabled: false,
  allowSensitiveRevealForAuthenticatedUsers: true,
  defaultRevealExpiresInMs: DEFAULT_REVEAL_EXPIRES_IN_MS,
  revealStoreBackend: "auto",
  auditBackend: "auto",
  openAiEnabled: false,
  openAiBaseUrl: "https://api.openai.com/v1",
  openAiTimeoutMs: 30000,
  evalOpenAiEnabled: false,
  evalAllowNetwork: false,
};

const authContext = {
  userEmail: "owner@example.test",
  ownerEmail: "owner@example.test",
  userId: "user_1",
  role: "advisor",
  allowSensitiveReveal: true,
  allowedOwnerEmails: ["owner@example.test"],
  allowedClientIds: ["client_1"],
};

test("chat API config flag is opt-in and exact-match only", () => {
  assert.equal(getDataIntelligenceV2Config({}).chatApiEnabled, false);
  assert.equal(getDataIntelligenceV2Config({}).uiEnabled, false);
  assert.equal(
    getDataIntelligenceV2Config({
      DATA_INTELLIGENCE_V2_CHAT_API_ENABLED: "true",
    }).chatApiEnabled,
    true,
  );
  assert.equal(
    getDataIntelligenceV2Config({
      DATA_INTELLIGENCE_V2_UI_ENABLED: "true",
    }).uiEnabled,
    true,
  );

  for (const value of ["TRUE", "1", "yes", "false"]) {
    assert.equal(
      getDataIntelligenceV2Config({
        DATA_INTELLIGENCE_V2_CHAT_API_ENABLED: value,
      }).chatApiEnabled,
      false,
    );
    assert.equal(
      getDataIntelligenceV2Config({
        DATA_INTELLIGENCE_V2_UI_ENABLED: value,
      }).uiEnabled,
      false,
    );
  }
});

test("chat API handler returns safe disabled and validation responses", async () => {
  const adapter = new ScriptedModelAdapter([
    finalResponse(safeResponse({ answerMarkdown: "Safe response." })),
  ]);

  const disabled = await handleV2ChatApiRequest({
    requestBody: { message: "hello" },
    authContext,
    config: { ...CHAT_ENABLED_CONFIG, enabled: false },
    modelAdapter: adapter,
  });
  assert.equal(disabled.status, 404);

  const chatDisabled = await handleV2ChatApiRequest({
    requestBody: { message: "hello" },
    authContext,
    config: { ...CHAT_ENABLED_CONFIG, chatApiEnabled: false },
    modelAdapter: adapter,
  });
  assert.equal(chatDisabled.status, 404);

  const unauthorized = await handleV2ChatApiRequest({
    requestBody: { message: "hello" },
    authContext: null,
    config: CHAT_ENABLED_CONFIG,
    modelAdapter: adapter,
  });
  assert.equal(unauthorized.status, 401);

  const invalidBody = await handleV2ChatApiRequest({
    requestBody: null,
    authContext,
    config: CHAT_ENABLED_CONFIG,
    modelAdapter: adapter,
  });
  assert.equal(invalidBody.status, 400);

  const missingMessage = await handleV2ChatApiRequest({
    requestBody: { history: [] },
    authContext,
    config: CHAT_ENABLED_CONFIG,
    modelAdapter: adapter,
  });
  assert.equal(missingMessage.status, 400);

  const emptyMessage = await handleV2ChatApiRequest({
    requestBody: { message: "   " },
    authContext,
    config: CHAT_ENABLED_CONFIG,
    modelAdapter: adapter,
  });
  assert.equal(emptyMessage.status, 400);

  assertNoRawSensitiveContent([
    disabled,
    chatDisabled,
    unauthorized,
    invalidBody,
    missingMessage,
    emptyMessage,
  ]);
});

test("chat API handler returns public response shape without tool results", async () => {
  const result = await handleV2ChatApiRequest({
    requestBody: {
      message: "What can you do?",
      history: [],
      conversationState: {},
      clientRequestId: "client_request_1",
    },
    authContext,
    config: CHAT_ENABLED_CONFIG,
    modelAdapter: new ScriptedModelAdapter([
      finalResponse(
        safeResponse({
          responseType: "general_guidance",
          answerMarkdown: "Use structured tools for client-specific facts.",
          recommendedSteps: ["Ask for the client and workflow."],
        }),
      ),
    ]),
  });

  assert.equal(result.status, 200);
  assert.equal(result.headers["Cache-Control"], "no-store");
  assert.equal(result.headers["X-Content-Type-Options"], "nosniff");
  assert.equal(result.body.status, "success");
  assert.ok(result.body.response);
  assert.ok(result.body.nextConversationState);
  assert.equal("toolResults" in result.body, false);
  assertNoRawSensitiveContent(result);
});

test("chat API handler tool path resolves active client safely", async () => {
  const adapter = new ScriptedModelAdapter([
    toolCalls([
      {
        callId: "call_resolve",
        toolName: "resolve_client",
        args: { query: "John Smith" },
      },
    ]),
    finalResponse(
      safeResponse({
        responseType: "client_data_answer",
        answerMarkdown: "I found John Smith.",
      }),
    ),
  ]);

  const result = await handleV2ChatApiRequest({
    requestBody: { message: "Find John Smith." },
    authContext,
    config: CHAT_ENABLED_CONFIG,
    modelAdapter: adapter,
    dataGateway: makeGateway({
      resolveClient: async () => ({
        candidates: [
          {
            clientId: "client_1",
            displayName: "John Smith",
            sourceRefs: [sourceRef("Client record")],
          },
        ],
        sourceRefs: [sourceRef("Client record")],
        missing: [],
      }),
    }),
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.nextConversationState.activeClientId, "client_1");
  assert.equal("toolResults" in result.body, false);
  assertNoRawSensitiveContent(result);
});

test("chat API handler merges secure reveal cards without raw sensitive values", async () => {
  const result = await handleV2ChatApiRequest({
    requestBody: { message: "Create a secure reveal for the account number." },
    authContext,
    config: CHAT_ENABLED_CONFIG,
    modelAdapter: new ScriptedModelAdapter([
      toolCalls([
        {
          callId: "call_reveal",
          toolName: "create_sensitive_reveal",
          args: {
            clientId: "client_1",
            accountId: "account_1",
            fieldKey: "account.fullAccountNumber",
            purpose: "form_completion",
          },
        },
      ]),
      finalResponse(
        safeResponse({
          responseType: "task_assist",
          answerMarkdown: "A secure reveal card is available.",
        }),
      ),
    ]),
    revealTokenService: makeRevealService({
      provider: new FakeSensitiveValueProvider({
        statuses: {
          "account.fullAccountNumber": {
            status: "on_file",
            fieldLabel: "Full account number",
            label: "Account number",
            maskedValue: "****3456",
          },
        },
        rawValues: {
          "account.fullAccountNumber": RAW_ACCOUNT,
        },
      }),
    }),
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.response.secureRevealCards.length, 1);
  assert.match(result.body.response.secureRevealCards[0].revealCardId, /^rvl_/);
  assert.equal(
    result.body.response.secureRevealCards[0].actualValueWasNotShownToModel,
    true,
  );
  assert.equal("toolResults" in result.body, false);
  assertNoRawSensitiveContent(result);
});

test("chat API handler sanitizes unsafe request text before model use", async () => {
  const adapter = new ScriptedModelAdapter([
    finalResponse(
      safeResponse({
        responseType: "general_guidance",
        answerMarkdown: "The request was handled safely.",
      }),
    ),
  ]);

  const result = await handleV2ChatApiRequest({
    requestBody: {
      message: `Current SSN ${RAW_SSN} and account ${RAW_ACCOUNT}.`,
      history: [
        {
          role: "user",
          content: `Email ${RAW_EMAIL}, phone ${RAW_PHONE}, DOB ${RAW_DOB}, address ${RAW_ADDRESS}, file ${RAW_SOURCE_FILE_ID}.`,
        },
      ],
      conversationState: {
        missingItems: [
          {
            item: "unsafe note",
            reason: `The user pasted ${RAW_EMAIL}.`,
          },
        ],
      },
    },
    authContext,
    config: CHAT_ENABLED_CONFIG,
    modelAdapter: adapter,
  });

  assert.equal(result.status, 200);
  assertNoRawSensitiveContent(adapter.requests[0].messages);
  assertNoRawSensitiveContent(adapter.requests[0].safeConversationState);
  assertNoRawSensitiveContent(result);
});

test("chat API handler fails closed for malicious final model output", async () => {
  const result = await handleV2ChatApiRequest({
    requestBody: { message: "Draft notes." },
    authContext,
    config: CHAT_ENABLED_CONFIG,
    modelAdapter: new ScriptedModelAdapter([
      finalResponse(
        safeResponse({
          responseType: "client_data_answer",
          answerMarkdown: `The SSN is ${RAW_SSN}.`,
          draftNote: {
            audience: "advisor",
            bodyMarkdown: `Use account ${RAW_ACCOUNT}.`,
            containsSensitivePlaceholders: false,
          },
        }),
      ),
    ]),
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.status, "error");
  assert.equal(result.body.response.responseType, "error");
  assertNoRawSensitiveContent(result);
});

test("chat API handler default service path is safe when OpenAI is disabled", async () => {
  const originalEnv = snapshotEnv();
  try {
    delete process.env.DATA_INTELLIGENCE_V2_OPENAI_ENABLED;
    delete process.env.DATA_INTELLIGENCE_V2_OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.DATA_INTELLIGENCE_V2_MODEL;
    delete process.env.DATA_INTELLIGENCE_MODEL;
    resetDataIntelligenceV2ServiceFactoryForTests();

    const result = await handleV2ChatApiRequest({
      requestBody: { message: "Can you help?" },
      authContext,
      config: CHAT_ENABLED_CONFIG,
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.status, "error");
    assert.equal(result.body.response.responseType, "error");
    assert.match(result.body.response.answerMarkdown, /not configured/i);
    assertNoRawSensitiveContent(result);
  } finally {
    restoreEnv(originalEnv);
    resetDataIntelligenceV2ServiceFactoryForTests();
  }
});

test("chat route file exports POST and force-dynamic mode", async () => {
  const source = await readFile(CHAT_ROUTE_PATH, "utf8");

  assert.match(source, /export const dynamic = "force-dynamic"/);
  assert.match(source, /export async function POST/);
  assert.match(source, /handleV2ChatApiRequest/);
  assert.match(source, /V2_CHAT_API_NO_CACHE_HEADERS/);
});

test("auth context builder still works with chat-enabled config", () => {
  const built = buildDataIntelligenceV2AuthContext({
    session: {
      user: {
        email: "advisor@example.test",
        id: "user_1",
        role: "advisor",
      },
    },
    config: CHAT_ENABLED_CONFIG,
  });

  assert.equal(built.userEmail, "advisor@example.test");
  assert.equal(built.ownerEmail, "advisor@example.test");
  assert.equal(built.allowSensitiveReveal, true);
});

function safeResponse(overrides = {}) {
  return {
    responseType: "general_guidance",
    answerMarkdown: "I can help with that.",
    sourceBackedFacts: [],
    missingOrUnverified: [],
    recommendedSteps: [],
    secureRevealCards: [],
    followupSuggestions: [],
    ...overrides,
  };
}

function toolCalls(toolCalls) {
  return {
    type: "tool_calls",
    toolCalls,
  };
}

function finalResponse(response) {
  return {
    type: "final_response",
    response,
  };
}

class ScriptedModelAdapter {
  constructor(responses) {
    this.responses = responses;
    this.requests = [];
  }

  async run(request) {
    this.requests.push(request);
    const response = this.responses.shift();
    if (typeof response === "function") {
      return response(request);
    }

    return (
      response ??
      finalResponse(
        safeResponse({
          responseType: "error",
          answerMarkdown: "No scripted model response was available.",
        }),
      )
    );
  }
}

function makeGateway(overrides = {}) {
  return {
    async resolveClient(args) {
      if (overrides.resolveClient) {
        return overrides.resolveClient(args);
      }

      return {
        candidates: [],
        sourceRefs: [],
        missing: [
          {
            item: "client",
            checked: ["client records"],
            reason: "No matching client was found.",
          },
        ],
      };
    },
    async getAccounts() {
      return { accounts: [], sourceRefs: [], missing: [] };
    },
    async getLatestStatements() {
      return { statements: [], sourceRefs: [], missing: [] };
    },
    async getTaxDocuments() {
      return { taxDocuments: [], sourceRefs: [], missing: [] };
    },
    async getIdentityStatus() {
      return { statuses: [], sourceRefs: [], missing: [] };
    },
    async checkWorkflowRequirements(args) {
      return {
        workflowType: args.workflowType,
        requirements: [],
        sourceRefs: [],
        missing: [],
      };
    },
  };
}

function makeRevealService({
  provider = new FakeSensitiveValueProvider(),
} = {}) {
  return new RevealTokenService({
    store: new InMemoryRevealTokenStore(),
    sensitiveValueProvider: provider,
    auditSink: new InMemoryRevealAuditSink(),
  });
}

class FakeSensitiveValueProvider {
  constructor({ statuses = {}, rawValues = {} } = {}) {
    this.statuses = statuses;
    this.rawValues = rawValues;
  }

  async getSensitiveValueStatus(args) {
    return (
      this.statuses[args.fieldKey] ?? {
        status: "not_found",
        fieldLabel: args.fieldKey,
        label: args.fieldKey,
      }
    );
  }

  async revealSensitiveValue(args) {
    const status = this.statuses[args.fieldKey];
    const value = this.rawValues[args.fieldKey];
    if (!status || !value) {
      return {
        status: "not_found",
        fieldLabel: args.fieldKey,
        label: args.fieldKey,
      };
    }

    return {
      status: "success",
      fieldLabel: status.fieldLabel,
      label: status.label,
      value,
    };
  }
}

function sourceRef(
  label,
  documentId = "doc_1",
  sourceType = "system_record",
) {
  return {
    sourceId: `source_${documentId}`,
    sourceType,
    label,
    documentId,
    date: "2024-12-31",
    confidence: "high",
  };
}

function snapshotEnv() {
  return { ...process.env };
}

function restoreEnv(snapshot) {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  }

  for (const [key, value] of Object.entries(snapshot)) {
    process.env[key] = value;
  }
}

function assertNoRawSensitiveContent(value) {
  const serialized = JSON.stringify(value);
  for (const rawValue of [
    RAW_SSN,
    RAW_ACCOUNT,
    RAW_EMAIL,
    RAW_PHONE,
    RAW_DOB,
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
