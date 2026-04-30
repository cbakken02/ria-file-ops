import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  getDataIntelligenceV2Config,
  getRevealStoreBackendWarning,
  isRevealStoreProductionSafe,
} from "../../lib/data-intelligence-v2/config.ts";
import {
  PostgresRevealTokenStore,
} from "../../lib/data-intelligence-v2/postgres-reveal-token-store.ts";
import {
  InMemoryRevealTokenStore,
  RevealTokenService,
} from "../../lib/data-intelligence-v2/reveal-token-service.ts";
import {
  InMemoryRevealAuditSink,
} from "../../lib/data-intelligence-v2/reveal-audit.ts";
import {
  getDefaultRevealTokenStore,
  resetDataIntelligenceV2ServiceFactoryForTests,
} from "../../lib/data-intelligence-v2/service-factory.ts";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(TEST_DIR, "../../supabase/migrations");
const RAW_SSN = "123-45-6789";
const RAW_ACCOUNT = "9876543210123456";
const OWNER_EMAIL = "owner@example.test";
const USER_EMAIL = "advisor@example.test";

test("migration creates reveal-card metadata table without raw value columns", async () => {
  const files = await readdir(MIGRATIONS_DIR);
  const migrationName = files.find((file) =>
    file.includes("data_intelligence_v2_reveal_cards"),
  );
  assert.ok(migrationName);

  const source = await readFile(path.join(MIGRATIONS_DIR, migrationName), "utf8");
  for (const required of [
    "data_intelligence_v2_reveal_cards",
    "reveal_card_id text primary key",
    "owner_email text not null",
    "user_email text not null",
    "field_key text not null",
    "expires_at timestamptz not null",
    "one_time_use boolean not null default true",
    "consumed_at timestamptz",
    "revoked_at timestamptz",
    "actual_value_was_not_shown_to_model boolean not null default true",
    "enable row level security",
    "idx_di_v2_reveal_cards_owner_email",
    "idx_di_v2_reveal_cards_active",
  ]) {
    assert.match(source, new RegExp(escapeRegExp(required), "i"));
  }

  assert.doesNotMatch(source, /\braw_value\b/i);
  assert.doesNotMatch(source, /\bssn\b/i);
  assert.doesNotMatch(source, /\bfull_account_number\b/i);
  assert.doesNotMatch(source, /\boauth\b/i);
  assert.match(source, /Raw sensitive values are never stored here/i);
});

test("PostgresRevealTokenStore create/get uses parameterized SQL and maps metadata", async () => {
  const queryClient = new FakeQueryClient([
    { rows: [], rowCount: 1 },
    { rows: [rowFromRecord(makeRecord())], rowCount: 1 },
  ]);
  const store = new PostgresRevealTokenStore({ queryClient });

  await store.create(makeRecord());
  const createCall = queryClient.calls[0];
  assert.match(createCall.sql, /insert into public\.data_intelligence_v2_reveal_cards/i);
  assert.match(createCall.sql, /\$1/);
  assert.equal(createCall.params.includes(OWNER_EMAIL), true);
  assert.equal(createCall.params.includes(USER_EMAIL), true);
  assertNoRawSensitiveContent(createCall.params);

  const fetched = await store.get("rvl_test_1");
  const getCall = queryClient.calls[1];
  assert.match(getCall.sql, /where reveal_card_id = \$1/i);
  assert.deepEqual(getCall.params, ["rvl_test_1"]);
  assert.equal(fetched.revealCardId, "rvl_test_1");
  assert.equal(fetched.ownerEmail, OWNER_EMAIL);
  assert.equal(fetched.userEmail, USER_EMAIL);
  assert.equal(fetched.actualValueWasNotShownToModel, true);
});

test("PostgresRevealTokenStore atomically claims one-time reveal cards", async () => {
  const claimed = {
    ...makeRecord(),
    consumedAt: "2026-04-28T10:01:00.000Z",
  };
  const queryClient = new FakeQueryClient([
    { rows: [rowFromRecord(claimed)], rowCount: 1 },
  ]);
  const store = new PostgresRevealTokenStore({ queryClient });

  const result = await store.claimForReveal({
    revealCardId: "rvl_test_1",
    now: "2026-04-28T10:01:00.000Z",
  });
  const call = queryClient.calls[0];

  assert.equal(result.status, "claimed");
  assert.equal(result.record.consumedAt, "2026-04-28T10:01:00.000Z");
  assert.match(call.sql, /update public\.data_intelligence_v2_reveal_cards/i);
  assert.match(call.sql, /consumed_at = case/i);
  assert.match(call.sql, /returning \*/i);
  assert.deepEqual(call.params, ["rvl_test_1", "2026-04-28T10:01:00.000Z"]);
  assertNoRawSensitiveContent(result);
});

test("PostgresRevealTokenStore claims reusable cards without consuming", async () => {
  const queryClient = new FakeQueryClient([
    {
      rows: [rowFromRecord({ ...makeRecord(), oneTimeUse: false })],
      rowCount: 1,
    },
  ]);
  const store = new PostgresRevealTokenStore({ queryClient });
  const result = await store.claimForReveal({
    revealCardId: "rvl_test_1",
    now: "2026-04-28T10:01:00.000Z",
  });

  assert.equal(result.status, "claimed");
  assert.equal(result.record.oneTimeUse, false);
  assert.equal(result.record.consumedAt, undefined);
});

test("PostgresRevealTokenStore classifies unclaimable cards safely", async () => {
  const cases = [
    {
      name: "not_found",
      row: undefined,
      expected: "not_found",
    },
    {
      name: "expired",
      row: rowFromRecord({
        ...makeRecord(),
        expiresAt: "2026-04-28T09:00:00.000Z",
      }),
      expected: "expired",
    },
    {
      name: "consumed",
      row: rowFromRecord({
        ...makeRecord(),
        consumedAt: "2026-04-28T09:30:00.000Z",
      }),
      expected: "consumed",
    },
    {
      name: "revoked",
      row: rowFromRecord({
        ...makeRecord(),
        revokedAt: "2026-04-28T09:30:00.000Z",
      }),
      expected: "revoked",
    },
  ];

  for (const item of cases) {
    const queryClient = new FakeQueryClient([
      { rows: [], rowCount: 0 },
      { rows: item.row ? [item.row] : [], rowCount: item.row ? 1 : 0 },
    ]);
    const store = new PostgresRevealTokenStore({ queryClient });
    const result = await store.claimForReveal({
      revealCardId: `rvl_${item.name}`,
      now: "2026-04-28T10:00:00.000Z",
    });
    assert.equal(result.status, item.expected);
    assertNoRawSensitiveContent(result);
  }
});

test("RevealTokenService uses claimForReveal and exposes raw value only in revealedValue", async () => {
  const auditSink = new InMemoryRevealAuditSink();
  const store = new CountingMemoryRevealTokenStore();
  const service = makeRevealService({
    store,
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
    authContext: authContext(),
    requestedOwnerEmail: OWNER_EMAIL,
    clientId: "client_1",
    fieldKey: "client.ssn",
    purpose: "form_completion",
    oneTimeUse: true,
  });

  const first = await service.revealSensitiveValue({
    authContext: authContext(),
    revealCardId: created.revealCard.revealCardId,
  });
  const second = await service.revealSensitiveValue({
    authContext: authContext(),
    revealCardId: created.revealCard.revealCardId,
  });
  const firstWithoutValue = {
    ...first,
    revealedValue: first.revealedValue
      ? { ...first.revealedValue, value: undefined }
      : undefined,
  };

  assert.equal(store.claimCount, 1);
  assert.equal(first.status, "success");
  assert.equal(first.revealedValue.value, RAW_SSN);
  assert.equal(second.status, "denied");
  assertNoRawSensitiveContent(created);
  assertNoRawSensitiveContent(firstWithoutValue);
  assertNoRawSensitiveContent(second);
  assertNoRawSensitiveContent(auditSink.events);
});

test("InMemoryRevealTokenStore claimForReveal has durable-store parity", async () => {
  const store = new InMemoryRevealTokenStore();
  await store.create(makeRecord({ revealCardId: "rvl_once", oneTimeUse: true }));
  await store.create(makeRecord({ revealCardId: "rvl_reuse", oneTimeUse: false }));
  await store.create(
    makeRecord({
      revealCardId: "rvl_expired",
      expiresAt: "2026-04-28T09:00:00.000Z",
    }),
  );

  assert.equal(
    (await store.claimForReveal({
      revealCardId: "rvl_once",
      now: "2026-04-28T10:00:00.000Z",
    })).status,
    "claimed",
  );
  assert.equal(
    (await store.claimForReveal({
      revealCardId: "rvl_once",
      now: "2026-04-28T10:00:01.000Z",
    })).status,
    "consumed",
  );
  assert.equal(
    (await store.claimForReveal({
      revealCardId: "rvl_reuse",
      now: "2026-04-28T10:00:00.000Z",
    })).status,
    "claimed",
  );
  assert.equal(
    (await store.claimForReveal({
      revealCardId: "rvl_reuse",
      now: "2026-04-28T10:00:01.000Z",
    })).status,
    "claimed",
  );
  assert.equal(
    (await store.claimForReveal({
      revealCardId: "rvl_expired",
      now: "2026-04-28T10:00:00.000Z",
    })).status,
    "expired",
  );
});

test("reveal store backend config is parsed conservatively", () => {
  assert.equal(getDataIntelligenceV2Config({}).revealStoreBackend, "auto");
  assert.equal(
    getDataIntelligenceV2Config({
      DATA_INTELLIGENCE_V2_REVEAL_STORE_BACKEND: "memory",
    }).revealStoreBackend,
    "memory",
  );
  assert.equal(
    getDataIntelligenceV2Config({
      DATA_INTELLIGENCE_V2_REVEAL_STORE_BACKEND: "postgres",
    }).revealStoreBackend,
    "postgres",
  );
  assert.equal(
    getDataIntelligenceV2Config({
      DATA_INTELLIGENCE_V2_REVEAL_STORE_BACKEND: "other",
    }).revealStoreBackend,
    "auto",
  );

  const unsafeConfig = getDataIntelligenceV2Config({
    DATA_INTELLIGENCE_V2_ENABLED: "true",
    DATA_INTELLIGENCE_V2_REVEAL_API_ENABLED: "true",
    DATA_INTELLIGENCE_V2_ALLOW_SENSITIVE_REVEAL: "true",
    DATA_INTELLIGENCE_V2_REVEAL_STORE_BACKEND: "memory",
  });
  assert.equal(
    isRevealStoreProductionSafe(unsafeConfig, { NODE_ENV: "production" }),
    false,
  );
  assert.match(
    getRevealStoreBackendWarning(unsafeConfig, { NODE_ENV: "production" }),
    /not production-safe/i,
  );
});

test("service factory selects memory or Postgres reveal store by safe backend rules", () => {
  const originalEnv = snapshotEnv();
  try {
    process.env.NODE_ENV = "development";
    process.env.DATA_INTELLIGENCE_V2_DEV_MOCK_ENABLED = "true";
    process.env.DATA_INTELLIGENCE_V2_REVEAL_STORE_BACKEND = "postgres";
    resetDataIntelligenceV2ServiceFactoryForTests();
    assert.ok(getDefaultRevealTokenStore() instanceof InMemoryRevealTokenStore);

    process.env.DATA_INTELLIGENCE_V2_DEV_MOCK_ENABLED = "false";
    process.env.DATA_INTELLIGENCE_V2_REVEAL_STORE_BACKEND = "postgres";
    resetDataIntelligenceV2ServiceFactoryForTests();
    assert.ok(getDefaultRevealTokenStore() instanceof PostgresRevealTokenStore);

    process.env.NODE_ENV = "production";
    process.env.DATA_INTELLIGENCE_V2_ENABLED = "true";
    process.env.DATA_INTELLIGENCE_V2_REVEAL_API_ENABLED = "true";
    process.env.DATA_INTELLIGENCE_V2_ALLOW_SENSITIVE_REVEAL = "true";
    process.env.DATA_INTELLIGENCE_V2_REVEAL_STORE_BACKEND = "memory";
    resetDataIntelligenceV2ServiceFactoryForTests();
    assert.throws(
      () => getDefaultRevealTokenStore(),
      /not production-safe/i,
    );

    process.env.DATA_INTELLIGENCE_V2_REVEAL_STORE_BACKEND = "auto";
    process.env.PERSISTENCE_BACKEND = "supabase";
    process.env.SUPABASE_DB_URL_POOLER = "postgresql://user:password@localhost:6543/postgres";
    resetDataIntelligenceV2ServiceFactoryForTests();
    assert.ok(getDefaultRevealTokenStore() instanceof PostgresRevealTokenStore);
  } finally {
    restoreEnv(originalEnv);
    resetDataIntelligenceV2ServiceFactoryForTests();
  }
});

test("PostgresRevealTokenStore sanitizes unsafe labels before storing metadata", async () => {
  const queryClient = new FakeQueryClient([{ rows: [], rowCount: 1 }]);
  const store = new PostgresRevealTokenStore({ queryClient });
  await store.create(
    makeRecord({
      fieldLabel: `Unsafe ${RAW_SSN}`,
      label: `Unsafe ${RAW_ACCOUNT}`,
    }),
  );

  assertNoRawSensitiveContent(queryClient.calls[0].params);
});

class FakeQueryClient {
  constructor(responses = []) {
    this.responses = responses;
    this.calls = [];
  }

  async query(sql, params = []) {
    this.calls.push({ sql, params });
    return this.responses.shift() ?? { rows: [], rowCount: 0 };
  }
}

class CountingMemoryRevealTokenStore extends InMemoryRevealTokenStore {
  claimCount = 0;

  async claimForReveal(args) {
    this.claimCount += 1;
    return super.claimForReveal(args);
  }
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
    const value = this.rawValues[args.fieldKey];
    const status = this.statuses[args.fieldKey];
    if (!value || !status) {
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

function makeRevealService({ store, auditSink, provider } = {}) {
  return new RevealTokenService({
    store,
    auditSink,
    sensitiveValueProvider:
      provider ??
      new FakeSensitiveValueProvider({
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
}

function makeRecord(overrides = {}) {
  return {
    revealCardId: "rvl_test_1",
    ownerEmail: OWNER_EMAIL,
    userEmail: USER_EMAIL,
    userId: "user_1",
    firmId: "firm_1",
    role: "advisor",
    clientId: "client_1",
    accountId: "account_1",
    documentId: "document_1",
    sourceId: "mock_source_1",
    fieldKey: "client.ssn",
    fieldLabel: "Social Security number",
    label: "Client SSN",
    purpose: "form_completion",
    createdAt: "2026-04-28T10:00:00.000Z",
    expiresAt: "2026-04-28T10:10:00.000Z",
    oneTimeUse: true,
    actualValueWasNotShownToModel: true,
    ...overrides,
  };
}

function rowFromRecord(record) {
  return {
    reveal_card_id: record.revealCardId,
    owner_email: record.ownerEmail,
    user_email: record.userEmail,
    user_id: record.userId,
    firm_id: record.firmId,
    role: record.role,
    client_id: record.clientId,
    account_id: record.accountId,
    document_id: record.documentId,
    source_id: record.sourceId,
    field_key: record.fieldKey,
    field_label: record.fieldLabel,
    label: record.label,
    purpose: record.purpose,
    created_at: record.createdAt,
    expires_at: record.expiresAt,
    one_time_use: record.oneTimeUse,
    consumed_at: record.consumedAt,
    revoked_at: record.revokedAt,
    actual_value_was_not_shown_to_model: record.actualValueWasNotShownToModel,
  };
}

function authContext() {
  return {
    userEmail: USER_EMAIL,
    ownerEmail: OWNER_EMAIL,
    userId: "user_1",
    role: "advisor",
    allowSensitiveReveal: true,
    allowedOwnerEmails: [OWNER_EMAIL],
    allowedClientIds: ["client_1"],
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

function assertNoRawSensitiveContent(input) {
  const serialized = JSON.stringify(input);
  for (const rawValue of [RAW_SSN, RAW_ACCOUNT]) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      "Expected payload not to include raw sensitive fixture value.",
    );
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
