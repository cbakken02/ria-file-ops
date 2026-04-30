import assert from "node:assert/strict";
import test from "node:test";

import { assertNoUnsafeModelContent } from "../../lib/data-intelligence-v2/safe-memory.ts";
import {
  InMemoryRevealAuditSink,
} from "../../lib/data-intelligence-v2/reveal-audit.ts";
import {
  InMemoryRevealTokenStore,
  RevealTokenService,
} from "../../lib/data-intelligence-v2/reveal-token-service.ts";
import { runV2Tool } from "../../lib/data-intelligence-v2/tools/runner.ts";

const RAW_SSN = "123-45-6789";
const RAW_ACCOUNT = "9876543210123456";

const revealAuthContext = {
  userEmail: "owner@example.test",
  ownerEmail: "owner@example.test",
  userId: "user_1",
  role: "advisor",
  allowSensitiveReveal: true,
  allowedClientIds: ["client_1"],
};

test("reveal card creation succeeds without exposing the raw value", async () => {
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
      rawValues: {
        "client.ssn": RAW_SSN,
      },
    }),
  });

  const result = await service.createRevealCard({
    authContext: revealAuthContext,
    requestedOwnerEmail: "owner@example.test",
    clientId: "client_1",
    fieldKey: "client.ssn",
    purpose: "form_completion",
  });
  const serialized = JSON.stringify(result);

  assert.equal(result.status, "success");
  assert.ok(result.revealCard?.revealCardId);
  assert.equal(result.revealCard?.actualValueWasNotShownToModel, true);
  assert.equal(serialized.includes(RAW_SSN), false);
  assertNoUnsafeModelContent(result);
});

test("create_sensitive_reveal tool returns model-safe card metadata only", async () => {
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
      rawValues: {
        "account.fullAccountNumber": RAW_ACCOUNT,
      },
    }),
  });

  const result = await runV2Tool({
    toolName: "create_sensitive_reveal",
    args: {
      clientId: "client_1",
      accountId: "account_1",
      fieldKey: "account.fullAccountNumber",
      purpose: "advisor_task",
    },
    authContext: revealAuthContext,
    revealTokenService: service,
  });
  const serialized = JSON.stringify(result);

  assert.equal(result.status, "success");
  assert.equal(result.secureRevealCards.length, 1);
  assert.equal(serialized.includes(RAW_ACCOUNT), false);
  assert.ok(
    result.disallowedClaims.some((claim) =>
      claim.includes("Do not state the raw sensitive value"),
    ),
  );
  assertNoUnsafeModelContent(result);
});

test("reveal card creation is denied by default without reveal permission", async () => {
  const service = makeRevealService();
  const result = await service.createRevealCard({
    authContext: {
      ...revealAuthContext,
      allowSensitiveReveal: false,
    },
    requestedOwnerEmail: "owner@example.test",
    clientId: "client_1",
    fieldKey: "client.ssn",
    purpose: "form_completion",
  });

  assert.equal(result.status, "denied");
  assert.equal(result.revealCard, undefined);
});

test("readonly users cannot create reveal cards", async () => {
  const service = makeRevealService();
  const result = await service.createRevealCard({
    authContext: {
      ...revealAuthContext,
      role: "readonly",
    },
    requestedOwnerEmail: "owner@example.test",
    clientId: "client_1",
    fieldKey: "client.ssn",
    purpose: "form_completion",
  });

  assert.equal(result.status, "denied");
});

test("fields requiring purpose deny missing purpose", async () => {
  const service = makeRevealService();
  const result = await service.createRevealCard({
    authContext: revealAuthContext,
    requestedOwnerEmail: "owner@example.test",
    clientId: "client_1",
    fieldKey: "client.ssn",
  });

  assert.equal(result.status, "denied");
});

test("client permission scope is enforced for reveal cards", async () => {
  const service = makeRevealService();
  const result = await service.createRevealCard({
    authContext: {
      ...revealAuthContext,
      allowedClientIds: ["client_2"],
    },
    requestedOwnerEmail: "owner@example.test",
    clientId: "client_1",
    fieldKey: "client.ssn",
    purpose: "form_completion",
  });

  assert.equal(result.status, "denied");
});

test("never-expose fields are rejected at runtime", async () => {
  const service = makeRevealService();
  const sourceFileResult = await service.createRevealCard({
    authContext: revealAuthContext,
    requestedOwnerEmail: "owner@example.test",
    clientId: "client_1",
    fieldKey: "uploadedDocument.sourceFileId",
    purpose: "form_completion",
  });
  const tokenResult = await service.createRevealCard({
    authContext: revealAuthContext,
    requestedOwnerEmail: "owner@example.test",
    clientId: "client_1",
    fieldKey: "system.oauthToken",
    purpose: "form_completion",
  });

  assert.equal(sourceFileResult.status, "denied");
  assert.equal(sourceFileResult.revealCard, undefined);
  assert.equal(tokenResult.status, "denied");
  assert.equal(tokenResult.revealCard, undefined);
});

test("expired reveal cards cannot reveal values and are audited", async () => {
  let currentTime = new Date("2026-04-28T10:00:00.000Z");
  const auditSink = new InMemoryRevealAuditSink();
  const service = makeRevealService({
    auditSink,
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
      rawValues: {
        "client.ssn": RAW_SSN,
      },
    }),
  });

  const created = await service.createRevealCard({
    authContext: revealAuthContext,
    requestedOwnerEmail: "owner@example.test",
    clientId: "client_1",
    fieldKey: "client.ssn",
    purpose: "form_completion",
    expiresInMs: 100,
  });
  currentTime = new Date("2026-04-28T10:00:01.000Z");

  const revealed = await service.revealSensitiveValue({
    authContext: revealAuthContext,
    revealCardId: created.revealCard.revealCardId,
  });

  assert.equal(revealed.status, "expired");
  assert.ok(
    auditSink.events.some((event) => event.eventType === "reveal_card_expired"),
  );
});

test("one-time reveal cards reveal once and then deny reuse", async () => {
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
      rawValues: {
        "client.ssn": RAW_SSN,
      },
    }),
  });

  const created = await service.createRevealCard({
    authContext: revealAuthContext,
    requestedOwnerEmail: "owner@example.test",
    clientId: "client_1",
    fieldKey: "client.ssn",
    purpose: "form_completion",
    oneTimeUse: true,
  });
  const createPayload = JSON.stringify(created);

  const firstReveal = await service.revealSensitiveValue({
    authContext: revealAuthContext,
    revealCardId: created.revealCard.revealCardId,
  });
  const secondReveal = await service.revealSensitiveValue({
    authContext: revealAuthContext,
    revealCardId: created.revealCard.revealCardId,
  });

  assert.equal(createPayload.includes(RAW_SSN), false);
  assert.equal(firstReveal.status, "success");
  assert.equal(firstReveal.revealedValue.value, RAW_SSN);
  assert.equal(secondReveal.status, "denied");
  assert.ok(
    auditSink.events.some((event) => event.eventType === "reveal_card_consumed"),
  );
});

test("same-user enforcement denies non-admin users and allows admin with policy scope", async () => {
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
      rawValues: {
        "client.ssn": RAW_SSN,
      },
    }),
  });
  const created = await service.createRevealCard({
    authContext: revealAuthContext,
    requestedOwnerEmail: "owner@example.test",
    clientId: "client_1",
    fieldKey: "client.ssn",
    purpose: "form_completion",
    oneTimeUse: false,
  });

  const denied = await service.revealSensitiveValue({
    authContext: {
      ...revealAuthContext,
      userEmail: "other@example.test",
      userId: "user_2",
      role: "advisor",
    },
    revealCardId: created.revealCard.revealCardId,
  });
  const admin = await service.revealSensitiveValue({
    authContext: {
      ...revealAuthContext,
      userEmail: "admin@example.test",
      userId: "admin_1",
      role: "admin",
    },
    revealCardId: created.revealCard.revealCardId,
  });

  assert.equal(denied.status, "denied");
  assert.equal(admin.status, "success");
});

test("audit events do not include raw sensitive values", async () => {
  const auditSink = new InMemoryRevealAuditSink();
  const service = makeRevealService({
    auditSink,
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
  });
  const created = await service.createRevealCard({
    authContext: revealAuthContext,
    requestedOwnerEmail: "owner@example.test",
    clientId: "client_1",
    accountId: "account_1",
    fieldKey: "account.fullAccountNumber",
    purpose: "advisor_task",
  });
  await service.revealSensitiveValue({
    authContext: revealAuthContext,
    revealCardId: created.revealCard.revealCardId,
  });

  const auditPayload = JSON.stringify(auditSink.events);
  assert.equal(auditPayload.includes(RAW_ACCOUNT), false);
  assert.equal(auditPayload.includes(RAW_SSN), false);
  assert.ok(
    auditSink.events.some((event) => event.eventType === "reveal_card_created"),
  );
  assert.ok(
    auditSink.events.some(
      (event) => event.eventType === "sensitive_value_revealed",
    ),
  );
});

test("non-reveal tools still return an empty secureRevealCards array", async () => {
  const result = await runV2Tool({
    toolName: "resolve_client",
    args: { query: "No Match" },
    authContext: {
      userEmail: "owner@example.test",
      ownerEmail: "owner@example.test",
    },
    dataGateway: {
      async resolveClient() {
        return { candidates: [], sourceRefs: [], missing: [] };
      },
    },
  });

  assert.deepEqual(result.secureRevealCards, []);
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
    rawValues: {
      "client.ssn": RAW_SSN,
    },
  }),
  auditSink = new InMemoryRevealAuditSink(),
  now,
} = {}) {
  return new RevealTokenService({
    store: new InMemoryRevealTokenStore(),
    sensitiveValueProvider: provider,
    auditSink,
    now,
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

    if (!status) {
      return {
        status: "not_found",
        fieldLabel: args.fieldKey,
        label: args.fieldKey,
      };
    }

    if (!value) {
      return {
        status: "not_found",
        fieldLabel: status.fieldLabel,
        label: status.label,
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
