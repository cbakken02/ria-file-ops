import assert from "node:assert/strict";
import test from "node:test";

import {
  getDataIntelligenceV2Config,
} from "../../lib/data-intelligence-v2/config.ts";
import {
  buildV2ChatApiRequestBody,
} from "../../lib/data-intelligence-v2/client-history.ts";
import {
  handleV2ChatApiRequest,
} from "../../lib/data-intelligence-v2/chat-api-handler.ts";
import {
  DevMockDataIntelligenceV2Gateway,
} from "../../lib/data-intelligence-v2/dev-mock-data-gateway.ts";
import { DevMockV2ModelAdapter } from "../../lib/data-intelligence-v2/dev-mock-model-adapter.ts";
import {
  DEV_MOCK_ACCOUNT,
  DEV_MOCK_IDENTITY_VALUES,
} from "../../lib/data-intelligence-v2/dev-mock-fixtures.ts";
import {
  DevMockSensitiveValueProvider,
} from "../../lib/data-intelligence-v2/dev-mock-sensitive-value-provider.ts";
import {
  UnavailableV2ModelAdapter,
} from "../../lib/data-intelligence-v2/model-adapter.ts";
import {
  handleRevealApiRequest,
} from "../../lib/data-intelligence-v2/reveal-api-handler.ts";
import {
  InMemoryRevealTokenStore,
  RevealTokenService,
} from "../../lib/data-intelligence-v2/reveal-token-service.ts";
import {
  assertNoUnsafeModelContent,
} from "../../lib/data-intelligence-v2/safe-memory.ts";
import {
  getDefaultDataGateway,
  getDefaultRevealTokenService,
  getDefaultSensitiveValueProvider,
  getDefaultV2ModelAdapter,
  resetDataIntelligenceV2ServiceFactoryForTests,
} from "../../lib/data-intelligence-v2/service-factory.ts";
import { runV2ChatTurn } from "../../lib/data-intelligence-v2/chat-service.ts";

const RAW_FAKE_ACCOUNT = DEV_MOCK_ACCOUNT.fullAccountNumber;
const RAW_FAKE_SSN = DEV_MOCK_IDENTITY_VALUES["client.ssn"];
const RAW_FAKE_DOB = DEV_MOCK_IDENTITY_VALUES["client.dob"];
const RAW_FAKE_ADDRESS = DEV_MOCK_IDENTITY_VALUES["client.address"];
const RAW_FAKE_EMAIL = DEV_MOCK_IDENTITY_VALUES["client.email"];
const RAW_FAKE_PHONE = DEV_MOCK_IDENTITY_VALUES["client.phone"];

const devMockConfig = {
  enabled: true,
  chatApiEnabled: true,
  uiEnabled: true,
  devMockEnabled: true,
  revealApiEnabled: true,
  allowSensitiveRevealForAuthenticatedUsers: true,
  defaultRevealExpiresInMs: 600000,
  revealStoreBackend: "auto",
  auditBackend: "auto",
  openAiEnabled: false,
  openAiBaseUrl: "https://api.openai.com/v1",
  openAiTimeoutMs: 30000,
  evalOpenAiEnabled: false,
  evalAllowNetwork: false,
};

const authContext = {
  userEmail: "advisor.demo@example.test",
  ownerEmail: "advisor.demo@example.test",
  userId: "mock_user_1",
  role: "advisor",
  allowSensitiveReveal: true,
  allowedOwnerEmails: ["advisor.demo@example.test"],
  allowedClientIds: ["mock_client_alex"],
};

test("dev mock config is exact-match opt-in and disabled in production", () => {
  assert.equal(getDataIntelligenceV2Config({}).devMockEnabled, false);
  assert.equal(
    getDataIntelligenceV2Config({
      NODE_ENV: "development",
      DATA_INTELLIGENCE_V2_DEV_MOCK_ENABLED: "true",
    }).devMockEnabled,
    true,
  );
  assert.equal(
    getDataIntelligenceV2Config({
      NODE_ENV: "production",
      DATA_INTELLIGENCE_V2_DEV_MOCK_ENABLED: "true",
    }).devMockEnabled,
    false,
  );

  for (const value of ["TRUE", "1", "yes", "false"]) {
    assert.equal(
      getDataIntelligenceV2Config({
        NODE_ENV: "development",
        DATA_INTELLIGENCE_V2_DEV_MOCK_ENABLED: value,
      }).devMockEnabled,
      false,
    );
  }
});

test("service factory uses dev mock services only outside production", async () => {
  const originalEnv = snapshotEnv();
  try {
    process.env.NODE_ENV = "development";
    process.env.DATA_INTELLIGENCE_V2_DEV_MOCK_ENABLED = "true";
    resetDataIntelligenceV2ServiceFactoryForTests();

    assert.ok(getDefaultV2ModelAdapter() instanceof DevMockV2ModelAdapter);
    assert.ok(
      getDefaultDataGateway() instanceof DevMockDataIntelligenceV2Gateway,
    );
    assert.ok(
      getDefaultSensitiveValueProvider() instanceof DevMockSensitiveValueProvider,
    );

    const service = getDefaultRevealTokenService();
    const created = await service.createRevealCard({
      authContext,
      requestedOwnerEmail: authContext.ownerEmail,
      clientId: "mock_client_alex",
      accountId: "mock_account_schwab_ira",
      fieldKey: "account.fullAccountNumber",
      purpose: "form_completion",
    });
    assert.equal(created.status, "success");
    assertNoRawSensitiveContent(created);

    resetDataIntelligenceV2ServiceFactoryForTests();
    process.env.NODE_ENV = "production";
    process.env.DATA_INTELLIGENCE_V2_DEV_MOCK_ENABLED = "true";
    assert.ok(getDefaultV2ModelAdapter() instanceof UnavailableV2ModelAdapter);
    assert.equal(
      getDefaultDataGateway() instanceof DevMockDataIntelligenceV2Gateway,
      false,
    );

    resetDataIntelligenceV2ServiceFactoryForTests();
    process.env.NODE_ENV = "development";
    process.env.DATA_INTELLIGENCE_V2_DEV_MOCK_ENABLED = "true";
    const first = getDefaultV2ModelAdapter();
    resetDataIntelligenceV2ServiceFactoryForTests();
    assert.notEqual(getDefaultV2ModelAdapter(), first);
  } finally {
    restoreEnv(originalEnv);
    resetDataIntelligenceV2ServiceFactoryForTests();
  }
});

test("dev mock gateway returns model-safe structured records", async () => {
  const gateway = new DevMockDataIntelligenceV2Gateway();
  const accounts = await gateway.getAccounts({
    ownerEmail: authContext.ownerEmail,
    clientId: "mock_client_alex",
  });
  const statements = await gateway.getLatestStatements({
    ownerEmail: authContext.ownerEmail,
    clientId: "mock_client_alex",
  });
  const identity = await gateway.getIdentityStatus({
    ownerEmail: authContext.ownerEmail,
    clientId: "mock_client_alex",
  });
  const workflow = await gateway.checkWorkflowRequirements({
    ownerEmail: authContext.ownerEmail,
    clientId: "mock_client_alex",
    workflowType: "new_account",
  });

  for (const output of [accounts, statements, identity, workflow]) {
    assertNoUnsafeModelContent(output);
    assertNoRawSensitiveContent(output);
  }
  assert.equal(accounts.accounts[0].accountLast4, "2222");
  assert.equal(identity.statuses.some((status) => status.status === "on_file"), true);
  assert.equal(workflow.requirements.length > 0, true);
  assert.equal(workflow.missing.length > 0, true);
});

test("dev mock sensitive provider keeps status model-safe and reveals only through reveal method", async () => {
  const provider = new DevMockSensitiveValueProvider();
  const status = await provider.getSensitiveValueStatus({
    ownerEmail: authContext.ownerEmail,
    clientId: "mock_client_alex",
    accountId: "mock_account_schwab_ira",
    fieldKey: "account.fullAccountNumber",
  });
  assert.equal(status.status, "on_file");
  assert.match(status.maskedValue, /\*\*\*\*2222/);
  assertNoUnsafeModelContent(status);
  assertNoRawSensitiveContent(status);

  const revealed = await provider.revealSensitiveValue({
    ownerEmail: authContext.ownerEmail,
    clientId: "mock_client_alex",
    accountId: "mock_account_schwab_ira",
    fieldKey: "account.fullAccountNumber",
  });
  assert.equal(revealed.status, "success");
  assert.equal(
    revealed.value === RAW_FAKE_ACCOUNT,
    true,
    "Expected provider reveal to return the configured fake account value.",
  );
});

test("dev mock model adapter creates source-backed answers and reveal cards safely", async () => {
  const revealTokenService = makeRevealService();
  const statementResult = await runV2ChatTurn({
    userMessage: "For Alex Demo, get the latest Schwab statement.",
    authContext,
    modelAdapter: new DevMockV2ModelAdapter(),
    dataGateway: new DevMockDataIntelligenceV2Gateway(),
    revealTokenService,
  });

  assert.equal(statementResult.status, "success");
  assert.equal(statementResult.response.sourceBackedFacts.length > 0, true);
  assertNoRawSensitiveContent(statementResult);

  const accountResult = await runV2ChatTurn({
    userMessage: "For Alex Demo, create a secure reveal card for the full account number.",
    authContext,
    modelAdapter: new DevMockV2ModelAdapter(),
    dataGateway: new DevMockDataIntelligenceV2Gateway(),
    revealTokenService,
  });

  assert.equal(accountResult.status, "success");
  assert.equal(accountResult.response.secureRevealCards.length, 1);
  assert.equal(
    accountResult.nextConversationState.lastSensitiveReveals[0].field,
    "full_account_number",
  );
  assertNoRawSensitiveContent(accountResult);
});

test("pure dev mock handlers support chat, reveal, and safe follow-up payloads", async () => {
  const revealTokenService = makeRevealService();
  const chatResult = await handleV2ChatApiRequest({
    requestBody: {
      message:
        "Advisor task: For Alex Demo, get the latest Schwab statement and full account number for new account paperwork.",
      history: [],
      conversationState: {},
    },
    authContext,
    config: devMockConfig,
    modelAdapter: new DevMockV2ModelAdapter(),
    dataGateway: new DevMockDataIntelligenceV2Gateway(),
    revealTokenService,
  });

  assert.equal(chatResult.status, 200);
  assert.equal(chatResult.body.response.secureRevealCards.length > 0, true);
  assertNoRawSensitiveContent(chatResult.body);

  const revealResult = await handleRevealApiRequest({
    requestBody: {
      revealCardId: chatResult.body.response.secureRevealCards[0].revealCardId,
    },
    authContext,
    config: devMockConfig,
    revealTokenService,
  });
  assert.equal(revealResult.status, 200);
  assert.equal(
    revealResult.body.value === RAW_FAKE_ACCOUNT,
    true,
    "Expected reveal API to return the configured fake account value.",
  );

  const followupPayload = buildV2ChatApiRequestBody({
    message: "Draft a note to the advisor.",
    messages: [
      {
        id: "v2_msg_test",
        role: "assistant",
        content: chatResult.body.response.answerMarkdown,
        createdAt: "2026-04-28T00:00:00.000Z",
        response: chatResult.body.response,
        revealedValue: revealResult.body.value,
      },
    ],
    conversationState: chatResult.body.nextConversationState,
  });

  assertNoRawSensitiveContent(followupPayload);
});

function makeRevealService() {
  return new RevealTokenService({
    store: new InMemoryRevealTokenStore(),
    sensitiveValueProvider: new DevMockSensitiveValueProvider(),
  });
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
    RAW_FAKE_ACCOUNT,
    RAW_FAKE_SSN,
    RAW_FAKE_DOB,
    RAW_FAKE_ADDRESS,
    RAW_FAKE_EMAIL,
    RAW_FAKE_PHONE,
    "sourceFileId",
    "driveFileId",
    "googleDriveFileId",
  ]) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      "Expected payload not to include raw sensitive content.",
    );
  }
}
