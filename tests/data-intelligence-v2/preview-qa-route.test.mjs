import assert from "node:assert/strict";
import test from "node:test";

import {
  DEV_MOCK_ACCOUNT,
  DEV_MOCK_IDENTITY_VALUES,
} from "../../lib/data-intelligence-v2/dev-mock-fixtures.ts";
import {
  resetDataIntelligenceV2ServiceFactoryForTests,
} from "../../lib/data-intelligence-v2/service-factory.ts";
import {
  POST,
  dynamic,
} from "../../app/api/data-intelligence/v2/qa/preview-smoke/route.ts";

const QA_SECRET = "safe-preview-qa-secret-for-route-tests";

test("preview QA route exports POST and force-dynamic mode", () => {
  assert.equal(dynamic, "force-dynamic");
  assert.equal(typeof POST, "function");
});

test("preview QA route returns 404 outside Vercel Preview", async () => {
  const originalEnv = snapshotEnv();
  try {
    configureRouteEnv({ vercelEnv: "production", enabled: true });
    const response = await POST(makeRequest({ secret: QA_SECRET }));

    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assertNoRawSensitiveContent(await response.text());
  } finally {
    restoreEnv(originalEnv);
    resetDataIntelligenceV2ServiceFactoryForTests();
  }
});

test("preview QA route returns 404 when flag is disabled", async () => {
  const originalEnv = snapshotEnv();
  try {
    configureRouteEnv({ vercelEnv: "preview", enabled: false });
    const response = await POST(makeRequest({ secret: QA_SECRET }));

    assert.equal(response.status, 404);
    assertNoRawSensitiveContent(await response.text());
  } finally {
    restoreEnv(originalEnv);
    resetDataIntelligenceV2ServiceFactoryForTests();
  }
});

test("preview QA route returns 401 when secret is missing or wrong", async () => {
  const originalEnv = snapshotEnv();
  try {
    configureRouteEnv({ vercelEnv: "preview", enabled: true });

    const missing = await POST(makeRequest({ secret: null }));
    const wrong = await POST(makeRequest({ secret: "wrong-secret" }));

    assert.equal(missing.status, 401);
    assert.equal(wrong.status, 401);
    assertNoRawSensitiveContent(await missing.text());
    assertNoRawSensitiveContent(await wrong.text());
  } finally {
    restoreEnv(originalEnv);
    resetDataIntelligenceV2ServiceFactoryForTests();
  }
});

test("preview QA route returns safe smoke result with correct secret", async () => {
  const originalEnv = snapshotEnv();
  try {
    configureRouteEnv({ vercelEnv: "preview", enabled: true });
    const response = await POST(makeRequest({ secret: QA_SECRET }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(body.status, "passed");
    assert.equal(body.summary.v2ChatTurnRan, true);
    assert.equal(body.summary.secureRevealCardCreated, true);
    assert.equal(body.summary.revealSucceededWithoutReturningValue, true);
    assert.equal(body.summary.noRawSensitiveValuesReturned, true);
    assertNoRawSensitiveContent(JSON.stringify(body));
  } finally {
    restoreEnv(originalEnv);
    resetDataIntelligenceV2ServiceFactoryForTests();
  }
});

function configureRouteEnv({ vercelEnv, enabled }) {
  resetDataIntelligenceV2ServiceFactoryForTests();
  process.env.NODE_ENV = "test";
  process.env.VERCEL_ENV = vercelEnv;
  process.env.DATA_INTELLIGENCE_V2_PREVIEW_QA_ENABLED = enabled ? "true" : "false";
  process.env.DATA_INTELLIGENCE_V2_PREVIEW_QA_SECRET = QA_SECRET;
  process.env.DATA_INTELLIGENCE_V2_REVEAL_STORE_BACKEND = "memory";
  process.env.DATA_INTELLIGENCE_V2_AUDIT_BACKEND = "memory";
  process.env.DATA_INTELLIGENCE_V2_REVEAL_EXPIRES_MS = "600000";
  process.env.DATA_INTELLIGENCE_V2_OPENAI_ENABLED = "false";
}

function makeRequest({ secret, body = {} }) {
  const headers = new Headers({ "content-type": "application/json" });
  if (secret) {
    headers.set("x-data-intelligence-v2-qa-secret", secret);
  }
  return new Request("https://preview.example.test/api/data-intelligence/v2/qa/preview-smoke", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
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
  Object.assign(process.env, snapshot);
}

function assertNoRawSensitiveContent(value) {
  const serialized = String(value);
  for (const rawValue of [
    DEV_MOCK_ACCOUNT.fullAccountNumber,
    DEV_MOCK_IDENTITY_VALUES["client.ssn"],
    DEV_MOCK_IDENTITY_VALUES["client.dob"],
    DEV_MOCK_IDENTITY_VALUES["client.address"],
    DEV_MOCK_IDENTITY_VALUES["client.email"],
    DEV_MOCK_IDENTITY_VALUES["client.phone"],
    QA_SECRET,
  ]) {
    assert.equal(serialized.includes(rawValue), false);
  }
}
