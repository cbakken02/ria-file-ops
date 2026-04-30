import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "../..");
const SCRIPT = path.join(REPO_ROOT, "scripts/qa-data-intelligence-v2-preview.mjs");
const DOC_PATH = path.join(REPO_ROOT, "docs/data-intelligence-v2/preview-qa.md");
const RAW_SSN = "123-45-6789";
const RAW_ACCOUNT = "9876543210123456";
const { runPreviewQa } = await import(pathToFileURL(SCRIPT).href);

test("preview QA script exists and classifies deployment protection", async () => {
  const source = await readFile(SCRIPT, "utf8");
  assert.match(source, /--json/);
  assert.match(source, /--run-preview-qa-endpoint/);
  assert.match(source, /--qa-secret-env/);
  await withServer(vercelProtectedHandler, (baseUrl) => {
    return runQa(baseUrl).then((summary) => {
    assert.equal(summary.exitCode, 0);
    assert.equal(summary.deploymentProtectionActive, true);
    assert.equal(summary.requestedVercelBypass, false);
    assert.equal(summary.manualAuthenticatedQaRequired, true);
    assertNoSensitiveOutput(JSON.stringify(summary));
    });
  });
});

test("preview QA output redacts bypass secret and classifies app auth after bypass", async () => {
  const secret = "secret-preview-bypass-token-that-must-not-print";
  await withServer(appAuthHandler, (baseUrl) => {
    return runQa(baseUrl, {
      withVercelBypass: true,
      extraEnv: {
      VERCEL_AUTOMATION_BYPASS_SECRET: secret,
      },
    }).then((summary) => {
    assert.equal(summary.exitCode, 0);
    assert.equal(summary.hasVercelBypassSecret, true);
    assert.equal(summary.deploymentProtectionBypassed, true);
    assert.equal(summary.appAuthRequired, true);
    assert.equal(summary.anonymousChatProtected, true);
    assert.equal(summary.anonymousRevealProtected, true);
    const output = JSON.stringify(summary);
    assert.equal(output.includes(secret), false);
    assertNoSensitiveOutput(output);
    });
  });
});

test("missing bypass secret with bypass flag exits safely", async () => {
  await withServer(appAuthHandler, (baseUrl) => {
    return runQa(baseUrl, {
      withVercelBypass: true,
      extraEnv: {
      VERCEL_AUTOMATION_BYPASS_SECRET: "",
      VERCEL_PROTECTION_BYPASS_SECRET: "",
      VERCEL_BYPASS_TOKEN: "",
      },
    }).then((summary) => {
    assert.equal(summary.exitCode, 2);
    assert.ok(summary.blockers.includes("missing_vercel_bypass_secret"));
    assertNoSensitiveOutput(JSON.stringify(summary));
    });
  });
});

test("preview QA endpoint support requires secret and redacts it", async () => {
  const qaSecret = "preview-qa-secret-that-must-not-print";
  await withServer((req, res) => {
    if (req.url === "/api/data-intelligence/v2/qa/preview-smoke" && req.method === "POST") {
      assert.equal(req.headers["x-data-intelligence-v2-qa-secret"], qaSecret);
      send(res, 200, "application/json", JSON.stringify({
        status: "passed",
        summary: {
          v2ChatTurnRan: true,
          secureRevealCardCreated: true,
          revealSucceededWithoutReturningValue: true,
          auditEventsAttempted: true,
          noRawSensitiveValuesReturned: true,
          usedFakeDataOnly: true,
        },
      }));
      return;
    }
    send(res, 200, "text/html", "<main>Preview app shell</main>");
  }, (baseUrl) => runQa(baseUrl, {
    runPreviewQaEndpoint: true,
    extraEnv: {
      DATA_INTELLIGENCE_V2_PREVIEW_QA_SECRET: qaSecret,
    },
  }).then((summary) => {
    assert.equal(summary.exitCode, 0);
    assert.equal(summary.previewQaEndpoint.attempted, true);
    assert.equal(summary.previewQaEndpoint.passed, true);
    const output = JSON.stringify(summary);
    assert.equal(output.includes(qaSecret), false);
    assertNoSensitiveOutput(output);
  }));

  await withServer(vercelProtectedHandler, (baseUrl) => runQa(baseUrl, {
    runPreviewQaEndpoint: true,
    extraEnv: {
      DATA_INTELLIGENCE_V2_PREVIEW_QA_SECRET: "",
    },
  }).then((summary) => {
    assert.equal(summary.exitCode, 2);
    assert.ok(summary.blockers.includes("missing_preview_qa_secret"));
    assertNoSensitiveOutput(JSON.stringify(summary));
  }));
});

test("anonymous chat accepting requests is a failure", async () => {
  await withServer((req, res) => {
    if (req.url === "/api/data-intelligence/v2/chat" && req.method === "POST") {
      send(res, 200, "application/json", JSON.stringify({ ok: true }));
      return;
    }
    if (req.url === "/api/data-intelligence/v2/reveal" && req.method === "POST") {
      send(res, 401, "application/json", JSON.stringify({ error: "unauthorized" }));
      return;
    }
    send(res, 200, "text/html", "<main>Preview app shell</main>");
  }, (baseUrl) => runQa(baseUrl, {
    withVercelBypass: true,
    extraEnv: {
      VERCEL_AUTOMATION_BYPASS_SECRET: "safe-test-bypass-secret",
    },
  }).then((summary) => {
    assert.equal(summary.exitCode, 1);
    assert.ok(summary.failures.includes("anonymous_chat_accepted"));
    assert.equal(summary.anonymousChatProtected, false);
    assertNoSensitiveOutput(JSON.stringify(summary));
  }));
});

test("anonymous reveal accepting requests is a failure", async () => {
  await withServer((req, res) => {
    if (req.url === "/api/data-intelligence/v2/chat" && req.method === "POST") {
      send(res, 401, "application/json", JSON.stringify({ error: "unauthorized" }));
      return;
    }
    if (req.url === "/api/data-intelligence/v2/reveal" && req.method === "POST") {
      send(res, 200, "application/json", JSON.stringify({ ok: true }));
      return;
    }
    send(res, 200, "text/html", "<main>Preview app shell</main>");
  }, (baseUrl) => runQa(baseUrl, {
    withVercelBypass: true,
    extraEnv: {
      VERCEL_AUTOMATION_BYPASS_SECRET: "safe-test-bypass-secret",
    },
  }).then((summary) => {
    assert.equal(summary.exitCode, 1);
    assert.ok(summary.failures.includes("anonymous_reveal_accepted"));
    assert.equal(summary.anonymousRevealProtected, false);
    assertNoSensitiveOutput(JSON.stringify(summary));
  }));
});

test("preview QA docs and source stay safe and non-mutating", async () => {
  const [doc, source] = await Promise.all([
    readFile(DOC_PATH, "utf8"),
    readFile(SCRIPT, "utf8"),
  ]);
  assert.match(doc, /automated QA/i);
  assert.match(doc, /Vercel Deployment Protection bypass does not bypass/i);
  assert.match(doc, /Preview-only QA endpoint/i);
  assert.match(doc, /DATA_INTELLIGENCE_V2_PREVIEW_QA_ENABLED=true/);
  assert.match(doc, /should not accept anonymous chat/i);
  assert.match(doc, /Do not use real client/i);
  assert.match(doc, /DATA_INTELLIGENCE_V2_UI_ENABLED=false/);
  assert.equal(source.includes("/api/query-assistant"), false);
  for (const forbidden of [
    "vercel deploy",
    "git push",
    "gh pr create",
    "supabase db push",
    "supabase migration repair",
  ]) {
    assert.equal(source.includes(forbidden), false);
  }
  assertNoSensitiveOutput(doc);
  assertNoSensitiveOutput(source);
});

function vercelProtectedHandler(_req, res) {
  send(res, 401, "text/html", "<title>Vercel Authentication</title>");
}

function appAuthHandler(req, res) {
  assert.equal(Boolean(req.headers["x-vercel-protection-bypass"]), true);
  if (req.url === "/api/data-intelligence/v2/chat" && req.method === "POST") {
    send(res, 401, "application/json", JSON.stringify({ error: "unauthorized" }));
    return;
  }
  if (req.url === "/api/data-intelligence/v2/reveal" && req.method === "POST") {
    send(res, 401, "application/json", JSON.stringify({ error: "unauthorized" }));
    return;
  }
  send(res, 401, "text/html", "<main>Sign in required</main>");
}

async function withServer(handler, fn) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function send(res, status, contentType, body) {
  res.writeHead(status, { "content-type": contentType });
  res.end(body);
}

async function runQa(baseUrl, options = {}) {
  return runPreviewQa({
    url: baseUrl,
    withVercelBypass: options.withVercelBypass === true,
    runPreviewQaEndpoint: options.runPreviewQaEndpoint === true,
    timeoutMs: 5000,
    env: {
      ...process.env,
      ...(options.extraEnv ?? {}),
    },
  });
}

function assertNoSensitiveOutput(output) {
  assert.equal(output.includes(RAW_SSN), false);
  assert.equal(output.includes(RAW_ACCOUNT), false);
  assert.equal(/\bsk-[A-Za-z0-9_-]{12,}\b/.test(output), false);
  assert.equal(/postgres(?:ql)?:\/\/[^"\s]+/i.test(output), false);
  assert.equal(/secret-preview-bypass-token-that-must-not-print/.test(output), false);
}
