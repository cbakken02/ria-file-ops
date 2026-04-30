import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryV2AuditSink,
} from "../../lib/data-intelligence-v2/audit.ts";
import {
  handleV2ChatApiRequest,
} from "../../lib/data-intelligence-v2/chat-api-handler.ts";
import {
  InMemoryRevealTokenStore,
  RevealTokenService,
} from "../../lib/data-intelligence-v2/reveal-token-service.ts";
import {
  V2RevealAuditSinkAdapter,
} from "../../lib/data-intelligence-v2/reveal-audit.ts";
import {
  resetDataIntelligenceV2ServiceFactoryForTests,
} from "../../lib/data-intelligence-v2/service-factory.ts";
import { runV2ChatTurn } from "../../lib/data-intelligence-v2/chat-service.ts";
import { runV2Tool } from "../../lib/data-intelligence-v2/tools/runner.ts";

const RAW_SSN = "123-45-6789";
const RAW_ACCOUNT = "9876543210123456";
const RAW_EMAIL = "client@example.com";

const authContext = {
  userEmail: "owner@example.test",
  ownerEmail: "owner@example.test",
  userId: "user_1",
  role: "advisor",
  allowSensitiveReveal: true,
  allowedOwnerEmails: ["owner@example.test"],
  allowedClientIds: ["client_1"],
};

const enabledConfig = {
  enabled: true,
  chatApiEnabled: true,
  uiEnabled: false,
  devMockEnabled: false,
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

test("reveal service records sanitized V2 reveal audit events", async () => {
  let now = new Date("2026-04-28T10:00:00.000Z");
  const auditSink = new InMemoryV2AuditSink();
  const service = makeRevealService({
    auditSink,
    now: () => now,
  });

  const denied = await service.createRevealCard({
    authContext: { ...authContext, allowSensitiveReveal: false },
    requestedOwnerEmail: "owner@example.test",
    clientId: "client_1",
    fieldKey: "client.ssn",
    purpose: "form_completion",
  });
  assert.equal(denied.status, "denied");

  const created = await service.createRevealCard({
    authContext,
    requestedOwnerEmail: "owner@example.test",
    clientId: "client_1",
    accountId: "account_1",
    fieldKey: "account.fullAccountNumber",
    purpose: "form_completion",
    expiresInMs: 1000,
  });
  assert.equal(created.status, "success");

  const firstReveal = await service.revealSensitiveValue({
    authContext,
    revealCardId: created.revealCard.revealCardId,
  });
  assert.equal(firstReveal.status, "success");
  assert.equal(firstReveal.revealedValue.value, RAW_ACCOUNT);

  const secondReveal = await service.revealSensitiveValue({
    authContext,
    revealCardId: created.revealCard.revealCardId,
  });
  assert.equal(secondReveal.status, "denied");

  const expiring = await service.createRevealCard({
    authContext,
    requestedOwnerEmail: "owner@example.test",
    clientId: "client_1",
    fieldKey: "client.ssn",
    purpose: "form_completion",
    expiresInMs: 100,
  });
  now = new Date("2026-04-28T10:00:01.000Z");
  const expired = await service.revealSensitiveValue({
    authContext,
    revealCardId: expiring.revealCard.revealCardId,
  });
  assert.equal(expired.status, "expired");

  const eventTypes = auditSink.events.map((event) => event.eventType);
  assert.ok(eventTypes.includes("reveal_card_denied"));
  assert.ok(eventTypes.includes("reveal_card_created"));
  assert.ok(eventTypes.includes("reveal_card_consumed"));
  assert.ok(eventTypes.includes("sensitive_value_revealed"));
  assert.ok(eventTypes.includes("sensitive_value_reveal_denied"));
  assert.ok(eventTypes.includes("reveal_card_expired"));
  assertNoRawSensitiveContent(auditSink.events);
});

test("chat handler records request denied, received, and completed events", async () => {
  const auditSink = new InMemoryV2AuditSink();
  const denied = await handleV2ChatApiRequest({
    requestBody: { message: "hello" },
    authContext: null,
    config: enabledConfig,
    auditSink,
  });
  assert.equal(denied.status, 401);

  const completed = await handleV2ChatApiRequest({
    requestBody: {
      message: "Can you help?",
      history: [],
      conversationState: {},
    },
    authContext,
    config: enabledConfig,
    modelAdapter: new ScriptedModelAdapter([
      finalResponse(safeResponse({ answerMarkdown: "Safe answer." })),
    ]),
    auditSink,
  });
  assert.equal(completed.status, 200);

  const eventTypes = auditSink.events.map((event) => event.eventType);
  assert.ok(eventTypes.includes("chat_request_denied"));
  assert.ok(eventTypes.includes("chat_request_received"));
  assert.ok(eventTypes.includes("chat_request_completed"));
  assert.equal(JSON.stringify(auditSink.events).includes("Safe answer."), false);
  assertNoRawSensitiveContent(auditSink.events);
});

test("tool calls record sanitized started, completed, and error events", async () => {
  const auditSink = new InMemoryV2AuditSink();
  const success = await runV2Tool({
    toolName: "resolve_client",
    args: { query: "Alex Demo" },
    authContext,
    dataGateway: makeGateway(),
    auditSink,
  });
  assert.equal(success.status, "success");

  const invalid = await runV2Tool({
    toolName: "resolve_client",
    args: { ownerEmail: RAW_EMAIL },
    authContext,
    dataGateway: makeGateway(),
    auditSink,
  });
  assert.equal(invalid.status, "error");

  const eventTypes = auditSink.events.map((event) => event.eventType);
  assert.ok(eventTypes.includes("tool_call_started"));
  assert.ok(eventTypes.includes("tool_call_completed"));
  assert.ok(eventTypes.includes("tool_call_error"));
  assertNoRawSensitiveContent(auditSink.events);
});

test("safety validation failures are audited without raw unsafe content", async () => {
  const auditSink = new InMemoryV2AuditSink();
  const result = await runV2ChatTurn({
    userMessage: "Please answer safely.",
    authContext,
    modelAdapter: new ScriptedModelAdapter([
      finalResponse(
        safeResponse({
          answerMarkdown: `Unsafe ${RAW_SSN}`,
        }),
      ),
    ]),
    auditSink,
  });

  assert.equal(result.status, "error");
  assert.ok(
    auditSink.events.some(
      (event) => event.eventType === "safety_validation_failed",
    ),
  );
  assertNoRawSensitiveContent(auditSink.events);
});

test("unavailable model adapter path records a safe model audit event", async () => {
  const originalEnv = snapshotEnv();
  const auditSink = new InMemoryV2AuditSink();
  try {
    delete process.env.DATA_INTELLIGENCE_V2_OPENAI_ENABLED;
    delete process.env.DATA_INTELLIGENCE_V2_OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.DATA_INTELLIGENCE_V2_MODEL;
    delete process.env.DATA_INTELLIGENCE_MODEL;
    resetDataIntelligenceV2ServiceFactoryForTests();
    const result = await runV2ChatTurn({
      userMessage: "Can you help?",
      authContext,
      auditSink,
    });
    assert.equal(result.status, "error");
  } finally {
    restoreEnv(originalEnv);
    resetDataIntelligenceV2ServiceFactoryForTests();
  }

  assert.ok(
    auditSink.events.some(
      (event) => event.eventType === "model_adapter_unavailable",
    ),
  );
  assertNoRawSensitiveContent(auditSink.events);
});

function makeRevealService({ auditSink, now } = {}) {
  return new RevealTokenService({
    store: new InMemoryRevealTokenStore(),
    sensitiveValueProvider: new FakeSensitiveValueProvider(),
    auditSink: new V2RevealAuditSinkAdapter(auditSink),
    now,
  });
}

class FakeSensitiveValueProvider {
  async getSensitiveValueStatus(target) {
    if (target.fieldKey === "account.fullAccountNumber") {
      return {
        status: "on_file",
        fieldLabel: "Full account number",
        label: "Account number",
        maskedValue: "****3456",
      };
    }
    return {
      status: "on_file",
      fieldLabel: "Social Security number",
      label: "Client SSN",
      maskedValue: "***-**-6789",
    };
  }

  async revealSensitiveValue(target) {
    return {
      status: "success",
      value:
        target.fieldKey === "account.fullAccountNumber"
          ? RAW_ACCOUNT
          : RAW_SSN,
    };
  }
}

class ScriptedModelAdapter {
  constructor(responses) {
    this.responses = [...responses];
  }

  async run() {
    return this.responses.shift() ?? finalResponse(safeResponse());
  }
}

function finalResponse(response) {
  return { type: "final_response", response };
}

function safeResponse(overrides = {}) {
  return {
    responseType: "general_guidance",
    answerMarkdown: "Safe response.",
    sourceBackedFacts: [],
    missingOrUnverified: [],
    recommendedSteps: [],
    secureRevealCards: [],
    followupSuggestions: [],
    ...overrides,
  };
}

function makeGateway() {
  return {
    async resolveClient() {
      return {
        candidates: [
          {
            clientId: "client_1",
            displayName: "Alex Demo",
            sourceRefs: [sourceRef()],
          },
        ],
        missing: [],
        sourceRefs: [sourceRef()],
      };
    },
  };
}

function sourceRef() {
  return {
    sourceId: "mock_source_client",
    sourceType: "system_record",
    label: "Mock client record",
    confidence: "high",
  };
}

function assertNoRawSensitiveContent(input) {
  const serialized = JSON.stringify(input);
  for (const raw of [RAW_SSN, RAW_ACCOUNT, RAW_EMAIL]) {
    assert.equal(serialized.includes(raw), false);
  }
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
  Object.assign(process.env, snapshot);
}
