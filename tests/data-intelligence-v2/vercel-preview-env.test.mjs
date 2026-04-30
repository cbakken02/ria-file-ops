import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "../..");
const SCRIPT = path.join(
  REPO_ROOT,
  "scripts/configure-vercel-v2-preview-env.mjs",
);
const DOC_PATH = path.join(
  REPO_ROOT,
  "docs/data-intelligence-v2/vercel-preview-env.md",
);

const ALL_PRESENT_FIXTURE = `
DATA_INTELLIGENCE_V2_ENABLED Preview
DATA_INTELLIGENCE_V2_CHAT_API_ENABLED Preview
DATA_INTELLIGENCE_V2_REVEAL_API_ENABLED Preview
DATA_INTELLIGENCE_V2_UI_ENABLED Preview
DATA_INTELLIGENCE_V2_ALLOW_SENSITIVE_REVEAL Preview
DATA_INTELLIGENCE_V2_DEV_MOCK_ENABLED Preview
DATA_INTELLIGENCE_V2_REVEAL_STORE_BACKEND Preview
DATA_INTELLIGENCE_V2_AUDIT_BACKEND Preview
DATA_INTELLIGENCE_V2_REVEAL_EXPIRES_MS Preview
DATA_INTELLIGENCE_V2_OPENAI_ENABLED Preview
DATA_INTELLIGENCE_V2_MODEL Preview
OPENAI_API_KEY Preview Production
DATA_INTELLIGENCE_V2_OPENAI_TIMEOUT_MS Preview
PERSISTENCE_BACKEND Preview
SUPABASE_DB_URL_POOLER Preview
APP_ENCRYPTION_KEY Preview
NEXTAUTH_SECRET Preview
NEXTAUTH_URL Preview
GOOGLE_CLIENT_ID Preview
GOOGLE_CLIENT_SECRET Preview
`;

const CORE_PRESENT_V2_MISSING_FIXTURE = `
OPENAI_API_KEY Preview Production
PERSISTENCE_BACKEND Preview
SUPABASE_DB_URL_POOLER Preview
APP_ENCRYPTION_KEY Preview
NEXTAUTH_SECRET Preview
NEXTAUTH_URL Preview
GOOGLE_CLIENT_ID Preview
GOOGLE_CLIENT_SECRET Preview
`;

const CORE_MISSING_FIXTURE = `
OPENAI_API_KEY Preview
DATA_INTELLIGENCE_V2_ENABLED Preview
DATA_INTELLIGENCE_V2_CHAT_API_ENABLED Preview
DATA_INTELLIGENCE_V2_REVEAL_API_ENABLED Preview
DATA_INTELLIGENCE_V2_UI_ENABLED Preview
DATA_INTELLIGENCE_V2_ALLOW_SENSITIVE_REVEAL Preview
DATA_INTELLIGENCE_V2_DEV_MOCK_ENABLED Preview
DATA_INTELLIGENCE_V2_REVEAL_STORE_BACKEND Preview
DATA_INTELLIGENCE_V2_AUDIT_BACKEND Preview
DATA_INTELLIGENCE_V2_REVEAL_EXPIRES_MS Preview
DATA_INTELLIGENCE_V2_OPENAI_ENABLED Preview
DATA_INTELLIGENCE_V2_MODEL Preview
DATA_INTELLIGENCE_V2_OPENAI_TIMEOUT_MS Preview
`;

const OPENAI_KEY_MISSING_FIXTURE = `
PERSISTENCE_BACKEND Preview
SUPABASE_DB_URL_POOLER Preview
APP_ENCRYPTION_KEY Preview
NEXTAUTH_SECRET Preview
NEXTAUTH_URL Preview
GOOGLE_CLIENT_ID Preview
GOOGLE_CLIENT_SECRET Preview
`;

test("Vercel Preview env script exists and supports JSON output", async () => {
  await readFile(SCRIPT, "utf8");
  const result = await runWithFixture(ALL_PRESENT_FIXTURE, ["--json"]);
  assert.equal(result.status, 0);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.target, "preview");
  assert.equal(summary.envNamesListable, true);
  assert.deepEqual(summary.v2SpecificMissingNames, []);
  assertNoSecretLikeOutput(result.stdout);
});

test("dry-run mode plans V2 env names by name only and does not mutate envs", async () => {
  const result = await runWithFixture(CORE_PRESENT_V2_MISSING_FIXTURE, [
    "--json",
    "--dry-run",
  ]);
  assert.equal(result.status, 0);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.mode, "dry_run");
  assert.ok(summary.v2NamesPlanned.includes("DATA_INTELLIGENCE_V2_ENABLED"));
  assert.ok(summary.v2NamesPlanned.includes("DATA_INTELLIGENCE_V2_MODEL"));
  assert.equal(summary.v2NamesAddedCount, 0);
  assert.equal(result.stdout.includes("gpt-5.5"), false);
  assertNoSecretLikeOutput(result.stdout);
});

test("production target is rejected", async () => {
  const result = await runWithFixture(ALL_PRESENT_FIXTURE, [
    "--json",
    "--target=production",
  ]);
  assert.equal(result.status, 1);
  const summary = JSON.parse(result.stdout);
  assert.ok(summary.blockers.includes("Only the preview target is supported by this script."));
});

test("missing confirmation gates block apply", async () => {
  const result = await runWithFixture(CORE_PRESENT_V2_MISSING_FIXTURE, [
    "--json",
    "--apply-preview",
  ]);
  assert.equal(result.status, 1);
  const summary = JSON.parse(result.stdout);
  assert.ok(summary.blockers.includes("CONFIRM_VERCEL_TARGET_IS_PREVIEW"));
  assert.ok(
    summary.blockers.includes(
      "CONFIRM_DATA_INTELLIGENCE_V2_VERCEL_PREVIEW_ENV_APPLY",
    ),
  );
  assert.deepEqual(summary.v2NamesAdded, []);
});

test("core secrets are reported but not planned for setting", async () => {
  const result = await runWithFixture(CORE_MISSING_FIXTURE, ["--json"]);
  assert.equal(result.status, 1);
  const summary = JSON.parse(result.stdout);
  assert.ok(summary.coreMissingNames.includes("PERSISTENCE_BACKEND"));
  assert.ok(
    summary.coreMissingNames.includes("SUPABASE_DB_URL_POOLER or SUPABASE_DB_URL"),
  );
  assert.equal(summary.v2NamesPlanned.includes("PERSISTENCE_BACKEND"), false);
  assertNoSecretLikeOutput(result.stdout);
});

test("OpenAI key is not added from local env unless explicitly allowed", async () => {
  const result = await runWithFixture(OPENAI_KEY_MISSING_FIXTURE, ["--json"], {
    OPENAI_API_KEY: "local-test-key-not-printed",
  });
  assert.equal(result.status, 1);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.openAiKeyPresentInPreview, false);
  assert.equal(summary.openAiKeyPresentLocally, true);
  assert.ok(
    summary.blockers.includes(
      "Preview OpenAI key group is missing and local-key apply was not explicitly allowed.",
    ),
  );
  assert.equal(result.stdout.includes("local-test-key-not-printed"), false);
});

test("OpenAI key can be planned from local env when explicitly allowed", async () => {
  const result = await runWithFixture(
    OPENAI_KEY_MISSING_FIXTURE,
    ["--json", "--allow-set-openai-key-from-local"],
    { OPENAI_API_KEY: "local-test-key-not-printed" },
  );
  assert.equal(result.status, 0);
  const summary = JSON.parse(result.stdout);
  assert.ok(summary.v2NamesPlanned.includes("DATA_INTELLIGENCE_V2_OPENAI_API_KEY"));
  assert.equal(result.stdout.includes("local-test-key-not-printed"), false);
});

test("Vercel Preview env docs contain safe rollback and no-production guidance", async () => {
  const source = await readFile(DOC_PATH, "utf8");
  assert.match(source, /Vercel Preview deployment has completed/i);
  assert.match(source, /No Production deployment happened/i);
  assert.match(source, /does not modify Production/i);
  assert.match(source, /V1 fallback remains intact/i);
  assert.match(source, /DATA_INTELLIGENCE_V2_UI_ENABLED/);
  assert.match(source, /CONFIRM_VERCEL_TARGET_IS_PREVIEW/);
  assert.match(source, /ALLOW_SET_OPENAI_KEY_FROM_LOCAL_FOR_VERCEL_PREVIEW/);
  assert.match(source, /disable `DATA_INTELLIGENCE_V2_CHAT_API_ENABLED`/i);
  assertNoSecretLikeOutput(source);
});

async function runWithFixture(source, args, extraEnv = {}) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "di-v2-vercel-env-"));
  try {
    const fixturePath = path.join(tempDir, "env-list.txt");
    await writeFile(fixturePath, source);
    return spawnSync(process.execPath, [
      SCRIPT,
      `--fixture-env-list=${fixturePath}`,
      ...args,
    ], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        ...extraEnv,
      },
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function assertNoSecretLikeOutput(output) {
  assert.equal(/\bsk-[A-Za-z0-9_-]{12,}\b/.test(output), false);
  assert.equal(/postgres(?:ql)?:\/\/[^"\s]+/i.test(output), false);
  assert.equal(/=local-test-key-not-printed/.test(output), false);
  assert.equal(/SUPABASE_DB_PASSWORD\s*=\s*[^`\s]+/.test(output), false);
}
