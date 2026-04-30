import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  InMemoryV2AuditSink,
  assertSafeV2AuditEvent,
  sanitizeV2AuditEvent,
} from "../../lib/data-intelligence-v2/audit.ts";
import {
  getAuditBackendWarning,
  getDataIntelligenceV2Config,
  isAuditBackendProductionSafe,
} from "../../lib/data-intelligence-v2/config.ts";
import {
  getDefaultV2AuditSink,
  resetDataIntelligenceV2ServiceFactoryForTests,
} from "../../lib/data-intelligence-v2/service-factory.ts";
import {
  PostgresV2AuditSink,
} from "../../lib/data-intelligence-v2/postgres-audit-sink.ts";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(TEST_DIR, "../../supabase/migrations");
const RAW_SSN = "123-45-6789";
const RAW_ACCOUNT = "9876543210123456";
const RAW_EMAIL = "client@example.com";
const RAW_PHONE = "312-555-1212";
const RAW_ADDRESS = "123 Main St, Chicago, IL 60601";
const RAW_SOURCE_FILE_ID = "sourceFileId: drive_file_abc123";

test("migration creates V2 audit event table without raw payload columns", async () => {
  const files = await readdir(MIGRATIONS_DIR);
  const migrationName = files.find((file) =>
    file.includes("data_intelligence_v2_audit_events"),
  );
  assert.ok(migrationName);

  const sql = await readFile(path.join(MIGRATIONS_DIR, migrationName), "utf8");
  assert.match(sql, /data_intelligence_v2_audit_events/);
  for (const column of [
    "audit_event_id",
    "event_type",
    "event_category",
    "owner_email",
    "user_email",
    "conversation_id",
    "message_id",
    "reveal_card_id",
    "client_id",
    "tool_name",
    "model_name",
    "status",
    "allowed",
    "reason",
    "metadata jsonb",
    "created_at",
  ]) {
    assert.match(sql, new RegExp(column));
  }
  for (const index of [
    "idx_di_v2_audit_events_created_at",
    "idx_di_v2_audit_events_event_type",
    "idx_di_v2_audit_events_event_category",
    "idx_di_v2_audit_events_reveal_card_id",
    "idx_di_v2_audit_events_conversation_id",
    "idx_di_v2_audit_events_tool_name",
  ]) {
    assert.match(sql, new RegExp(index));
  }
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /must never contain raw sensitive values/i);
  assert.equal(sql.includes(RAW_ACCOUNT), false);
  assert.equal(sql.includes(RAW_SSN), false);
});

test("audit event sanitizer redacts unsafe metadata and does not mutate input", () => {
  const input = {
    eventType: "chat_request_error",
    eventCategory: "chat",
    ownerEmail: "owner@example.test",
    userEmail: RAW_EMAIL,
    reason: `Bad prompt ${RAW_SSN}`,
    metadata: {
      message: `Account ${RAW_ACCOUNT}`,
      phone: RAW_PHONE,
      address: RAW_ADDRESS,
      source: RAW_SOURCE_FILE_ID,
      safeCount: 2,
      nested: { rawValue: RAW_SSN, responseType: "error" },
    },
  };

  const sanitized = sanitizeV2AuditEvent(input);
  assert.notEqual(sanitized, input);
  assertNoRawSensitiveContent(sanitized);
  assert.equal(input.metadata.message.includes(RAW_ACCOUNT), true);
  assert.equal(sanitized.metadata.safeCount, 2);
  assert.equal(sanitized.metadata.nested.rawValue, "[REDACTED]");
  assertSafeV2AuditEvent(sanitized);
});

test("InMemoryV2AuditSink stores sanitized events only", async () => {
  const sink = new InMemoryV2AuditSink();
  await sink.record({
    eventType: "tool_call_error",
    eventCategory: "tool",
    toolName: "resolve_client",
    reason: RAW_SSN,
    metadata: { rawToolOutput: RAW_ACCOUNT, factCount: 1 },
  });

  assert.equal(sink.events.length, 1);
  assertNoRawSensitiveContent(sink.events);
  assert.equal(sink.events[0].metadata.factCount, 1);
});

test("PostgresV2AuditSink inserts sanitized parameterized audit rows", async () => {
  const queries = [];
  const sink = new PostgresV2AuditSink({
    queryClient: {
      query: async (sql, params) => {
        queries.push({ sql, params });
        return { rows: [], rowCount: 1 };
      },
    },
  });

  await sink.record({
    eventType: "sensitive_value_revealed",
    eventCategory: "reveal",
    revealCardId: "rvl_safe_123",
    userEmail: RAW_EMAIL,
    status: "success",
    allowed: true,
    reason: "Authorized reveal.",
    metadata: {
      rawValue: RAW_ACCOUNT,
      secureRevealCardCount: 1,
    },
  });

  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /\$1/);
  assert.match(queries[0].sql, /insert into public\.data_intelligence_v2_audit_events/);
  assert.equal(queries[0].params.length, 22);
  assert.match(queries[0].params[0], /^aud_/);
  assertNoRawSensitiveContent(queries[0].params);
  assert.equal(JSON.parse(queries[0].params[20]).secureRevealCardCount, 1);
});

test("PostgresV2AuditSink exposes safe insert failures", async () => {
  const sink = new PostgresV2AuditSink({
    queryClient: {
      query: async () => {
        throw new Error(`database failed ${RAW_ACCOUNT}`);
      },
    },
  });

  await assert.rejects(
    () =>
      sink.record({
        eventType: "system_error",
        eventCategory: "system",
        reason: "Audit insert test.",
      }),
    (error) => {
      assert.equal(error.message.includes(RAW_ACCOUNT), false);
      assert.match(error.message, /audit event insert failed/i);
      return true;
    },
  );
});

test("audit backend config is parsed conservatively", () => {
  assert.equal(getDataIntelligenceV2Config({}).auditBackend, "auto");
  assert.equal(
    getDataIntelligenceV2Config({
      DATA_INTELLIGENCE_V2_AUDIT_BACKEND: "noop",
    }).auditBackend,
    "noop",
  );
  assert.equal(
    getDataIntelligenceV2Config({
      DATA_INTELLIGENCE_V2_AUDIT_BACKEND: "memory",
    }).auditBackend,
    "memory",
  );
  assert.equal(
    getDataIntelligenceV2Config({
      DATA_INTELLIGENCE_V2_AUDIT_BACKEND: "postgres",
    }).auditBackend,
    "postgres",
  );
  assert.equal(
    getDataIntelligenceV2Config({
      DATA_INTELLIGENCE_V2_AUDIT_BACKEND: "other",
    }).auditBackend,
    "auto",
  );

  const unsafeConfig = getDataIntelligenceV2Config({
    DATA_INTELLIGENCE_V2_ENABLED: "true",
    DATA_INTELLIGENCE_V2_CHAT_API_ENABLED: "true",
    DATA_INTELLIGENCE_V2_AUDIT_BACKEND: "memory",
  });
  assert.equal(
    isAuditBackendProductionSafe(unsafeConfig, { NODE_ENV: "production" }),
    false,
  );
  assert.match(
    getAuditBackendWarning(unsafeConfig, { NODE_ENV: "production" }),
    /durable audit logging/i,
  );
});

test("service factory selects safe audit backends", () => {
  const originalEnv = snapshotEnv();
  try {
    process.env.NODE_ENV = "development";
    process.env.DATA_INTELLIGENCE_V2_DEV_MOCK_ENABLED = "true";
    process.env.DATA_INTELLIGENCE_V2_AUDIT_BACKEND = "postgres";
    resetDataIntelligenceV2ServiceFactoryForTests();
    assert.ok(getDefaultV2AuditSink() instanceof InMemoryV2AuditSink);

    process.env.DATA_INTELLIGENCE_V2_DEV_MOCK_ENABLED = "false";
    process.env.DATA_INTELLIGENCE_V2_AUDIT_BACKEND = "postgres";
    resetDataIntelligenceV2ServiceFactoryForTests();
    assert.ok(getDefaultV2AuditSink() instanceof PostgresV2AuditSink);

    process.env.NODE_ENV = "production";
    process.env.DATA_INTELLIGENCE_V2_ENABLED = "true";
    process.env.DATA_INTELLIGENCE_V2_CHAT_API_ENABLED = "true";
    process.env.DATA_INTELLIGENCE_V2_AUDIT_BACKEND = "memory";
    resetDataIntelligenceV2ServiceFactoryForTests();
    assert.throws(() => getDefaultV2AuditSink(), /durable audit logging/i);

    process.env.DATA_INTELLIGENCE_V2_AUDIT_BACKEND = "auto";
    process.env.PERSISTENCE_BACKEND = "supabase";
    process.env.SUPABASE_DB_URL_POOLER = "postgresql://user:password@localhost:6543/postgres";
    resetDataIntelligenceV2ServiceFactoryForTests();
    assert.ok(getDefaultV2AuditSink() instanceof PostgresV2AuditSink);
  } finally {
    restoreEnv(originalEnv);
    resetDataIntelligenceV2ServiceFactoryForTests();
  }
});

function assertNoRawSensitiveContent(input) {
  const serialized = JSON.stringify(input);
  for (const raw of [
    RAW_SSN,
    RAW_ACCOUNT,
    RAW_EMAIL,
    RAW_PHONE,
    RAW_ADDRESS,
    RAW_SOURCE_FILE_ID,
  ]) {
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
