import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);

if (
  !process.env.DATA_INTELLIGENCE_V2_SMOKE_REEXEC &&
  !process.execArgv.includes("--experimental-strip-types")
) {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--loader",
      "./tests/ts-alias-loader.mjs",
      SCRIPT_PATH,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATA_INTELLIGENCE_V2_SMOKE_REEXEC: "true",
      },
      stdio: "inherit",
    },
  );
  process.exit(result.status ?? 1);
}

const RAW_FAKE_ACCOUNT_NUMBER = "9999000011112222";

try {
  const { handleV2ChatApiRequest } = await import(
    "../lib/data-intelligence-v2/chat-api-handler.ts"
  );
  const { buildV2ChatApiRequestBody } = await import(
    "../lib/data-intelligence-v2/client-history.ts"
  );
  const { DevMockDataIntelligenceV2Gateway } = await import(
    "../lib/data-intelligence-v2/dev-mock-data-gateway.ts"
  );
  const { DevMockV2ModelAdapter } = await import(
    "../lib/data-intelligence-v2/dev-mock-model-adapter.ts"
  );
  const { DevMockSensitiveValueProvider } = await import(
    "../lib/data-intelligence-v2/dev-mock-sensitive-value-provider.ts"
  );
  const { handleRevealApiRequest } = await import(
    "../lib/data-intelligence-v2/reveal-api-handler.ts"
  );
  const {
    InMemoryRevealTokenStore,
    RevealTokenService,
  } = await import("../lib/data-intelligence-v2/reveal-token-service.ts");

  const config = {
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
  const revealTokenService = new RevealTokenService({
    store: new InMemoryRevealTokenStore(),
    sensitiveValueProvider: new DevMockSensitiveValueProvider(),
  });

  const chatResult = await handleV2ChatApiRequest({
    requestBody: {
      message:
        "Advisor task: For Alex Demo, get the latest Schwab statement and full account number for new account paperwork.",
      history: [],
      conversationState: {},
    },
    authContext,
    config,
    modelAdapter: new DevMockV2ModelAdapter(),
    dataGateway: new DevMockDataIntelligenceV2Gateway(),
    revealTokenService,
  });

  assert(chatResult.status === 200, "chat handler returned 200");
  assert(Boolean(chatResult.body?.response?.answerMarkdown), "chat answer exists");
  assert(
    chatResult.body.response.secureRevealCards.length > 0,
    "secure reveal card exists",
  );
  assert(
    !JSON.stringify(chatResult.body).includes(RAW_FAKE_ACCOUNT_NUMBER),
    "chat response excludes raw reveal value",
  );
  assert(
    chatResult.body.nextConversationState?.lastSensitiveReveals?.length > 0,
    "conversation state has reveal metadata",
  );

  const revealCardId = chatResult.body.response.secureRevealCards[0].revealCardId;
  const revealResult = await handleRevealApiRequest({
    requestBody: { revealCardId },
    authContext,
    config,
    revealTokenService,
  });

  assert(revealResult.status === 200, "reveal handler returned 200");
  assert(
    revealResult.body?.value === RAW_FAKE_ACCOUNT_NUMBER,
    "authorized reveal returned expected fake value",
  );

  const followupPayload = buildV2ChatApiRequestBody({
    message: "Draft a note to the advisor.",
    messages: [
      {
        id: "v2_msg_smoke_assistant",
        role: "assistant",
        content: chatResult.body.response.answerMarkdown,
        createdAt: new Date().toISOString(),
        response: chatResult.body.response,
        revealedValue: revealResult.body.value,
      },
    ],
    conversationState: chatResult.body.nextConversationState,
  });
  assert(
    !JSON.stringify(followupPayload).includes(RAW_FAKE_ACCOUNT_NUMBER),
    "follow-up payload excludes revealed value",
  );

  console.log("V2 dev mock smoke passed: chat, reveal, and follow-up safety checks succeeded.");
} catch (error) {
  console.error(
    `V2 dev mock smoke failed: ${
      error instanceof Error ? error.message : "unknown failure"
    }`,
  );
  process.exit(1);
}

function assert(condition, description) {
  if (!condition) {
    throw new Error(description);
  }
}
