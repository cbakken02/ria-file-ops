import assert from "node:assert/strict";
import test from "node:test";

import {
  DEV_MOCK_ACCOUNT,
  DEV_MOCK_IDENTITY_VALUES,
} from "../../lib/data-intelligence-v2/dev-mock-fixtures.ts";
import {
  finalizePreviewQaResult,
  runPreviewV2SmokeQa,
} from "../../lib/data-intelligence-v2/preview-qa-service.ts";
import {
  resetDataIntelligenceV2ServiceFactoryForTests,
} from "../../lib/data-intelligence-v2/service-factory.ts";

test("preview smoke service passes with fake dev mock services", async () => {
  const originalEnv = snapshotEnv();
  try {
    configureLocalPreviewQaEnv();
    const result = await runPreviewV2SmokeQa({});

    assert.equal(result.status, "passed");
    assert.equal(result.summary.v2ChatTurnRan, true);
    assert.equal(result.summary.secureRevealCardCreated, true);
    assert.equal(result.summary.revealSucceededWithoutReturningValue, true);
    assert.equal(result.summary.auditEventsAttempted, true);
    assert.equal(result.summary.noRawSensitiveValuesReturned, true);
    assert.equal(result.summary.usedFakeDataOnly, true);
    assertNoRawSensitiveContent(result);
  } finally {
    restoreEnv(originalEnv);
    resetDataIntelligenceV2ServiceFactoryForTests();
  }
});

test("preview smoke service uses mock OpenAI path by default", async () => {
  const originalEnv = snapshotEnv();
  try {
    configureLocalPreviewQaEnv();
    process.env.DATA_INTELLIGENCE_V2_OPENAI_ENABLED = "true";
    delete process.env.DATA_INTELLIGENCE_V2_OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const result = await runPreviewV2SmokeQa({});
    assert.equal(result.status, "passed");
    assert.equal(
      result.checks.some((check) => check.name === "real_openai_preview_adapter"),
      false,
    );
    assertNoRawSensitiveContent(result);
  } finally {
    restoreEnv(originalEnv);
    resetDataIntelligenceV2ServiceFactoryForTests();
  }
});

test("preview smoke service blocks explicitly requested real OpenAI without config", async () => {
  const originalEnv = snapshotEnv();
  try {
    configureLocalPreviewQaEnv();
    delete process.env.DATA_INTELLIGENCE_V2_OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.DATA_INTELLIGENCE_V2_MODEL;
    delete process.env.DATA_INTELLIGENCE_MODEL;

    const result = await runPreviewV2SmokeQa({ useRealOpenAi: true });
    assert.equal(result.status, "blocked");
    assert.equal(
      result.checks.some((check) => check.name === "real_openai_preview_adapter"),
      true,
    );
    assertNoRawSensitiveContent(result);
  } finally {
    restoreEnv(originalEnv);
    resetDataIntelligenceV2ServiceFactoryForTests();
  }
});

test("preview smoke result fails closed if unsafe details are introduced", () => {
  const result = finalizePreviewQaResult({
    checks: [
      {
        name: "unsafe_test_check",
        status: "passed",
        details: {
          accidentalRawValue: DEV_MOCK_ACCOUNT.fullAccountNumber,
        },
      },
    ],
    summary: {
      v2ChatTurnRan: true,
      secureRevealCardCreated: true,
      revealSucceededWithoutReturningValue: true,
      auditEventsAttempted: true,
      noRawSensitiveValuesReturned: true,
      usedFakeDataOnly: true,
    },
  });

  assert.equal(result.status, "failed");
  assert.equal(result.summary.noRawSensitiveValuesReturned, false);
});

function configureLocalPreviewQaEnv() {
  resetDataIntelligenceV2ServiceFactoryForTests();
  process.env.NODE_ENV = "test";
  process.env.DATA_INTELLIGENCE_V2_REVEAL_STORE_BACKEND = "memory";
  process.env.DATA_INTELLIGENCE_V2_AUDIT_BACKEND = "memory";
  process.env.DATA_INTELLIGENCE_V2_REVEAL_EXPIRES_MS = "600000";
  process.env.DATA_INTELLIGENCE_V2_OPENAI_ENABLED = "false";
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

function assertNoRawSensitiveContent(value) {
  const serialized = JSON.stringify(value);
  for (const rawValue of [
    DEV_MOCK_ACCOUNT.fullAccountNumber,
    DEV_MOCK_IDENTITY_VALUES["client.ssn"],
    DEV_MOCK_IDENTITY_VALUES["client.dob"],
    DEV_MOCK_IDENTITY_VALUES["client.address"],
    DEV_MOCK_IDENTITY_VALUES["client.email"],
    DEV_MOCK_IDENTITY_VALUES["client.phone"],
  ]) {
    assert.equal(serialized.includes(rawValue), false);
  }
}
