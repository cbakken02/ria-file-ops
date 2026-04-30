import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDataIntelligenceV2AuthContext,
} from "../../lib/data-intelligence-v2/auth-context.ts";
import {
  DEFAULT_REVEAL_EXPIRES_IN_MS,
  getDataIntelligenceV2Config,
} from "../../lib/data-intelligence-v2/config.ts";
import {
  handleRevealApiRequest,
} from "../../lib/data-intelligence-v2/reveal-api-handler.ts";
import {
  InMemoryRevealAuditSink,
} from "../../lib/data-intelligence-v2/reveal-audit.ts";
import {
  InMemoryRevealTokenStore,
  RevealTokenService,
} from "../../lib/data-intelligence-v2/reveal-token-service.ts";
import {
  getDefaultRevealTokenService,
  resetDataIntelligenceV2ServiceFactoryForTests,
} from "../../lib/data-intelligence-v2/service-factory.ts";
import { runV2Tool } from "../../lib/data-intelligence-v2/tools/runner.ts";

const RAW_SSN = "123-45-6789";
const RAW_ACCOUNT = "9876543210123456";
const ENABLED_CONFIG = {
  enabled: true,
  chatApiEnabled: false,
  uiEnabled: false,
  devMockEnabled: false,
  revealApiEnabled: true,
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
const REVEAL_AUTH_CONTEXT = {
  userEmail: "owner@example.test",
  ownerEmail: "owner@example.test",
  userId: "user_1",
  role: "advisor",
  allowSensitiveReveal: true,
  allowedOwnerEmails: ["owner@example.test"],
  allowedClientIds: ["client_1"],
};

test("config defaults are conservative and env flags opt in explicitly", () => {
  assert.deepEqual(getDataIntelligenceV2Config({}), {
    enabled: false,
    chatApiEnabled: false,
    uiEnabled: false,
    devMockEnabled: false,
    revealApiEnabled: false,
    allowSensitiveRevealForAuthenticatedUsers: false,
    defaultRevealExpiresInMs: DEFAULT_REVEAL_EXPIRES_IN_MS,
    revealStoreBackend: "auto",
    auditBackend: "auto",
    openAiEnabled: false,
    openAiBaseUrl: "https://api.openai.com/v1",
    openAiTimeoutMs: 30000,
    evalOpenAiEnabled: false,
    evalAllowNetwork: false,
    previewQaEnabled: false,
    previewQaSecretPresent: false,
  });

  assert.deepEqual(
    getDataIntelligenceV2Config({
      DATA_INTELLIGENCE_V2_ENABLED: "true",
      DATA_INTELLIGENCE_V2_REVEAL_API_ENABLED: "true",
      DATA_INTELLIGENCE_V2_ALLOW_SENSITIVE_REVEAL: "true",
      DATA_INTELLIGENCE_V2_REVEAL_EXPIRES_MS: "120000",
      DATA_INTELLIGENCE_V2_OPENAI_TIMEOUT_MS: "30000",
    }),
    {
      enabled: true,
      chatApiEnabled: false,
      uiEnabled: false,
      devMockEnabled: false,
      revealApiEnabled: true,
      allowSensitiveRevealForAuthenticatedUsers: true,
      defaultRevealExpiresInMs: 120000,
      revealStoreBackend: "auto",
      auditBackend: "auto",
      openAiEnabled: false,
      openAiBaseUrl: "https://api.openai.com/v1",
      openAiTimeoutMs: 30000,
      evalOpenAiEnabled: false,
      evalAllowNetwork: false,
      previewQaEnabled: false,
      previewQaSecretPresent: false,
    },
  );

  assert.equal(
    getDataIntelligenceV2Config({
      DATA_INTELLIGENCE_V2_PREVIEW_QA_ENABLED: "true",
      DATA_INTELLIGENCE_V2_PREVIEW_QA_SECRET: "present",
    }).previewQaEnabled,
    true,
  );
  assert.equal(
    getDataIntelligenceV2Config({
      DATA_INTELLIGENCE_V2_PREVIEW_QA_SECRET: "present",
    }).previewQaSecretPresent,
    true,
  );

  assert.equal(
    getDataIntelligenceV2Config({
      DATA_INTELLIGENCE_V2_REVEAL_EXPIRES_MS: "not-a-number",
    }).defaultRevealExpiresInMs,
    DEFAULT_REVEAL_EXPIRES_IN_MS,
  );
});

test("auth context uses authenticated email as MVP owner scope", () => {
  assert.equal(
    buildDataIntelligenceV2AuthContext({
      session: null,
      config: ENABLED_CONFIG,
    }),
    null,
  );
  assert.equal(
    buildDataIntelligenceV2AuthContext({
      session: { user: { id: "user_1" } },
      config: ENABLED_CONFIG,
    }),
    null,
  );

  const authContext = buildDataIntelligenceV2AuthContext({
    session: {
      user: {
        email: "advisor@example.test",
        id: "user_1",
        role: "not-supported",
      },
    },
    config: ENABLED_CONFIG,
  });

  assert.equal(authContext.userEmail, "advisor@example.test");
  assert.equal(authContext.ownerEmail, "advisor@example.test");
  assert.equal(authContext.userId, "user_1");
  assert.equal(authContext.role, "csa");
  assert.equal(authContext.allowSensitiveReveal, true);
  assert.deepEqual(authContext.allowedOwnerEmails, ["advisor@example.test"]);
});

test("reveal API handler returns safe responses for disabled and invalid requests", async () => {
  const disabled = await handleRevealApiRequest({
    requestBody: { revealCardId: "rvl_xaaaaaaaaaaaaaaaa" },
    authContext: REVEAL_AUTH_CONTEXT,
    config: { ...ENABLED_CONFIG, enabled: false },
    revealTokenService: makeRevealService(),
  });
  assert.equal(disabled.status, 404);

  const revealDisabled = await handleRevealApiRequest({
    requestBody: { revealCardId: "rvl_xaaaaaaaaaaaaaaaa" },
    authContext: REVEAL_AUTH_CONTEXT,
    config: { ...ENABLED_CONFIG, revealApiEnabled: false },
    revealTokenService: makeRevealService(),
  });
  assert.equal(revealDisabled.status, 404);

  const unauthorized = await handleRevealApiRequest({
    requestBody: { revealCardId: "rvl_xaaaaaaaaaaaaaaaa" },
    authContext: null,
    config: ENABLED_CONFIG,
    revealTokenService: makeRevealService(),
  });
  assert.equal(unauthorized.status, 401);

  const invalidBody = await handleRevealApiRequest({
    requestBody: null,
    authContext: REVEAL_AUTH_CONTEXT,
    config: ENABLED_CONFIG,
    revealTokenService: makeRevealService(),
  });
  assert.equal(invalidBody.status, 400);

  const missingRevealCardId = await handleRevealApiRequest({
    requestBody: {},
    authContext: REVEAL_AUTH_CONTEXT,
    config: ENABLED_CONFIG,
    revealTokenService: makeRevealService(),
  });
  assert.equal(missingRevealCardId.status, 400);

  const invalidRevealCardId = await handleRevealApiRequest({
    requestBody: { revealCardId: "bad id" },
    authContext: REVEAL_AUTH_CONTEXT,
    config: ENABLED_CONFIG,
    revealTokenService: makeRevealService(),
  });
  assert.equal(invalidRevealCardId.status, 400);

  const serialized = JSON.stringify([
    disabled,
    revealDisabled,
    unauthorized,
    invalidBody,
    missingRevealCardId,
    invalidRevealCardId,
  ]);
  assert.equal(serialized.includes(RAW_SSN), false);
  assert.equal(serialized.includes(RAW_ACCOUNT), false);
});

test("reveal API handler returns raw value only in successful authorized body", async () => {
  const auditSink = new InMemoryRevealAuditSink();
  const service = makeRevealService({
    auditSink,
    provider: new FakeSensitiveValueProvider({
      statuses: {
        "client.ssn": {
          status: "on_file",
          fieldLabel: "Social Security number",
          label: "Client SSN",
          maskedValue: "***-**-6789",
        },
      },
      rawValues: { "client.ssn": RAW_SSN },
    }),
  });
  const created = await service.createRevealCard({
    authContext: REVEAL_AUTH_CONTEXT,
    requestedOwnerEmail: "owner@example.test",
    clientId: "client_1",
    fieldKey: "client.ssn",
    purpose: "form_completion",
    oneTimeUse: false,
  });

  const result = await handleRevealApiRequest({
    requestBody: { revealCardId: created.revealCard.revealCardId },
    authContext: REVEAL_AUTH_CONTEXT,
    config: ENABLED_CONFIG,
    revealTokenService: service,
  });
  const bodyWithoutValue = { ...result.body, value: undefined };

  assert.equal(result.status, 200);
  assert.equal(result.headers["Cache-Control"], "no-store");
  assert.equal(result.body.value, RAW_SSN);
  assert.equal(JSON.stringify(bodyWithoutValue).includes(RAW_SSN), false);
  assert.equal(JSON.stringify(auditSink.events).includes(RAW_SSN), false);
});

test("reveal API handler denies cross-user reveal without exposing raw value", async () => {
  const service = makeRevealService({
    provider: new FakeSensitiveValueProvider({
      statuses: {
        "client.ssn": {
          status: "on_file",
          fieldLabel: "Social Security number",
          label: "Client SSN",
          maskedValue: "***-**-6789",
        },
      },
      rawValues: { "client.ssn": RAW_SSN },
    }),
  });
  const created = await service.createRevealCard({
    authContext: REVEAL_AUTH_CONTEXT,
    requestedOwnerEmail: "owner@example.test",
    clientId: "client_1",
    fieldKey: "client.ssn",
    purpose: "form_completion",
    oneTimeUse: false,
  });

  const result = await handleRevealApiRequest({
    requestBody: { revealCardId: created.revealCard.revealCardId },
    authContext: {
      ...REVEAL_AUTH_CONTEXT,
      userEmail: "other@example.test",
      userId: "user_2",
    },
    config: ENABLED_CONFIG,
    revealTokenService: service,
  });

  assert.equal(result.status, 403);
  assert.equal(JSON.stringify(result).includes(RAW_SSN), false);
});

test("reveal API handler maps expired cards to 410 without raw value", async () => {
  let currentTime = new Date("2026-04-28T10:00:00.000Z");
  const service = makeRevealService({
    now: () => currentTime,
    provider: new FakeSensitiveValueProvider({
      statuses: {
        "client.ssn": {
          status: "on_file",
          fieldLabel: "Social Security number",
          label: "Client SSN",
          maskedValue: "***-**-6789",
        },
      },
      rawValues: { "client.ssn": RAW_SSN },
    }),
  });
  const created = await service.createRevealCard({
    authContext: REVEAL_AUTH_CONTEXT,
    requestedOwnerEmail: "owner@example.test",
    clientId: "client_1",
    fieldKey: "client.ssn",
    purpose: "form_completion",
    expiresInMs: 100,
  });
  currentTime = new Date("2026-04-28T10:00:01.000Z");

  const result = await handleRevealApiRequest({
    requestBody: { revealCardId: created.revealCard.revealCardId },
    authContext: REVEAL_AUTH_CONTEXT,
    config: ENABLED_CONFIG,
    revealTokenService: service,
  });

  assert.equal(result.status, 410);
  assert.equal(JSON.stringify(result).includes(RAW_SSN), false);
});

test("reveal API handler enforces one-time use", async () => {
  const service = makeRevealService({
    provider: new FakeSensitiveValueProvider({
      statuses: {
        "account.fullAccountNumber": {
          status: "on_file",
          fieldLabel: "Full account number",
          label: "Account number",
          maskedValue: "****3456",
        },
      },
      rawValues: { "account.fullAccountNumber": RAW_ACCOUNT },
    }),
  });
  const created = await service.createRevealCard({
    authContext: REVEAL_AUTH_CONTEXT,
    requestedOwnerEmail: "owner@example.test",
    clientId: "client_1",
    accountId: "account_1",
    fieldKey: "account.fullAccountNumber",
    purpose: "advisor_task",
    oneTimeUse: true,
  });

  const first = await handleRevealApiRequest({
    requestBody: { revealCardId: created.revealCard.revealCardId },
    authContext: REVEAL_AUTH_CONTEXT,
    config: ENABLED_CONFIG,
    revealTokenService: service,
  });
  const second = await handleRevealApiRequest({
    requestBody: { revealCardId: created.revealCard.revealCardId },
    authContext: REVEAL_AUTH_CONTEXT,
    config: ENABLED_CONFIG,
    revealTokenService: service,
  });

  assert.equal(first.status, 200);
  assert.equal(first.body.value, RAW_ACCOUNT);
  assert.equal(second.status, 403);
  assert.equal(JSON.stringify(second).includes(RAW_ACCOUNT), false);
});

test("reveal API handler maps unknown reveal cards to 404 safely", async () => {
  const result = await handleRevealApiRequest({
    requestBody: { revealCardId: "rvl_xaaaaaaaaaaaaaaaa" },
    authContext: REVEAL_AUTH_CONTEXT,
    config: ENABLED_CONFIG,
    revealTokenService: makeRevealService(),
  });

  assert.equal(result.status, 404);
  assert.equal(JSON.stringify(result).includes(RAW_SSN), false);
});

test("reveal API handler maps provider not_supported to 501 safely", async () => {
  const store = new InMemoryRevealTokenStore();
  const service = makeRevealService({
    store,
    provider: new FakeSensitiveValueProvider({
      statuses: {
        "account.fullAccountNumber": {
          status: "on_file",
          fieldLabel: "Full account number",
          label: "Account number",
          maskedValue: "****3456",
        },
      },
      revealStatuses: {
        "account.fullAccountNumber": "not_supported",
      },
      rawValues: { "account.fullAccountNumber": RAW_ACCOUNT },
    }),
  });
  const created = await service.createRevealCard({
    authContext: REVEAL_AUTH_CONTEXT,
    requestedOwnerEmail: "owner@example.test",
    clientId: "client_1",
    accountId: "account_1",
    fieldKey: "account.fullAccountNumber",
    purpose: "advisor_task",
    oneTimeUse: false,
  });

  const result = await handleRevealApiRequest({
    requestBody: { revealCardId: created.revealCard.revealCardId },
    authContext: REVEAL_AUTH_CONTEXT,
    config: ENABLED_CONFIG,
    revealTokenService: service,
  });

  assert.equal(result.status, 501);
  assert.equal(JSON.stringify(result).includes(RAW_ACCOUNT), false);
});

test("shared service factory returns a stable singleton and runner can use it", async () => {
  resetDataIntelligenceV2ServiceFactoryForTests();
  const first = getDefaultRevealTokenService();
  const second = getDefaultRevealTokenService();
  assert.equal(first, second);

  resetDataIntelligenceV2ServiceFactoryForTests();
  const resetService = getDefaultRevealTokenService();
  assert.notEqual(resetService, first);

  const result = await runV2Tool({
    toolName: "create_sensitive_reveal",
    args: {
      clientId: "client_1",
      fieldKey: "client.ssn",
      purpose: "form_completion",
    },
    authContext: {
      userEmail: "owner@example.test",
      ownerEmail: "owner@example.test",
      role: "advisor",
      allowSensitiveReveal: true,
      allowedOwnerEmails: ["owner@example.test"],
      allowedClientIds: ["client_1"],
    },
  });

  assert.ok(["error", "not_found"].includes(result.status));
  assert.equal(JSON.stringify(result).includes(RAW_SSN), false);
  resetDataIntelligenceV2ServiceFactoryForTests();
});

function makeRevealService({
  provider = new FakeSensitiveValueProvider({
    statuses: {
      "client.ssn": {
        status: "on_file",
        fieldLabel: "Social Security number",
        label: "Client SSN",
        maskedValue: "***-**-6789",
      },
    },
    rawValues: { "client.ssn": RAW_SSN },
  }),
  auditSink = new InMemoryRevealAuditSink(),
  now,
  store = new InMemoryRevealTokenStore(),
} = {}) {
  return new RevealTokenService({
    store,
    sensitiveValueProvider: provider,
    auditSink,
    now,
  });
}

class FakeSensitiveValueProvider {
  constructor({ statuses = {}, rawValues = {}, revealStatuses = {} } = {}) {
    this.statuses = statuses;
    this.rawValues = rawValues;
    this.revealStatuses = revealStatuses;
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
    const revealStatus = this.revealStatuses[args.fieldKey];
    if (revealStatus) {
      return {
        status: revealStatus,
        fieldLabel: status?.fieldLabel ?? args.fieldKey,
        label: status?.label ?? args.fieldKey,
      };
    }

    const value = this.rawValues[args.fieldKey];
    if (!status || !value) {
      return {
        status: "not_found",
        fieldLabel: status?.fieldLabel ?? args.fieldKey,
        label: status?.label ?? args.fieldKey,
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
