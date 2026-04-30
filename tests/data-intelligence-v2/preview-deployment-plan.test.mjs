import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "../..");
const DOC_PATH = path.join(
  REPO_ROOT,
  "docs/data-intelligence-v2/preview-deployment-plan.md",
);
const PREFLIGHT_SCRIPT = path.join(
  REPO_ROOT,
  "scripts/preflight-data-intelligence-v2-deployment.mjs",
);
const RAW_SSN = "123-45-6789";
const RAW_ACCOUNT = "9876543210123456";

test("preview deployment doc exists and describes controlled future steps", async () => {
  const source = await readFile(DOC_PATH, "utf8");
  assert.match(source, /V2 remains feature-flagged/i);
  assert.match(source, /V1 remains the default/i);
  assert.match(source, /Vercel Preview deployment completed/i);
  assert.match(source, /not Production/i);
  assert.match(source, /Preview Supabase migrations were applied/i);
  assert.match(source, /matched local and remote versions through\s+`20260430`/i);
  assert.match(source, /Vercel Preview env/i);
  assert.match(source, /durable reveal and audit stores/i);
  assert.match(source, /DATA_INTELLIGENCE_V2_UI_ENABLED/);
  assert.match(source, /DATA_INTELLIGENCE_V2_CHAT_API_ENABLED/);
  assert.match(source, /DATA_INTELLIGENCE_V2_REVEAL_API_ENABLED/);
  assert.match(source, /rollback/i);
  assertNoSensitiveOutput(source);
});

test("preview deployment doc records controlled apply and preview QA status", async () => {
  const source = await readFile(DOC_PATH, "utf8");
  assert.match(source, /Preview migration apply has been performed once/i);
  assert.match(source, /20260429_data_intelligence_v2_reveal_cards\.sql/);
  assert.match(source, /20260430_data_intelligence_v2_audit_events\.sql/);
  assert.match(source, /manual browser QA/i);
  assert.match(source, /Deployment Protection automation bypass/i);
  assert.match(source, /Preview-only QA endpoint passed/i);
  assert.match(source, /Do not run destructive commands/i);
  assert.doesNotMatch(source, /\bsupabase db push\b/);
  assert.doesNotMatch(source, /\bsupabase migration repair\b/);
});

test("preflight default JSON remains safe and parseable", () => {
  const result = runNode([PREFLIGHT_SCRIPT, "--json"]);
  assert.equal(result.status, 0);
  const summary = JSON.parse(result.stdout);
  assert.ok(summary.git);
  assert.ok(summary.supabase);
  assert.ok(summary.vercel);
  assert.ok(summary.migration);
  assertNoSensitiveOutput(result.stdout);
});

test("preflight optional Supabase mode safely reports remote readiness state", () => {
  const result = runNode([PREFLIGHT_SCRIPT, "--json", "--with-supabase-cli"]);
  assert.ok(result.status === 0 || result.status === 1);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.supabase.migrationListChecked, true);
  assert.ok(
    summary.supabase.migrationListAvailable === true ||
      summary.supabase.migrationListAvailable === false ||
      summary.supabase.migrationListAvailable === null,
  );
  assert.ok(Array.isArray(summary.supabase.localOnlyMigrationVersions));
  assert.ok(Array.isArray(summary.supabase.remoteOnlyMigrationVersions));
  assertNoSensitiveOutput(result.stdout);
});

test("preflight source supports safe Vercel npx fallback without deploy commands", async () => {
  const source = await readFile(PREFLIGHT_SCRIPT, "utf8");
  assert.match(source, /--with-vercel-cli/);
  assert.match(source, /--yes", "vercel"/);
  assert.match(source, /previewMissingEnvNames/);
  for (const forbidden of [
    "vercel deploy",
    "git push",
    "gh pr create",
    "supabase db push",
    "supabase migration repair",
  ]) {
    assert.equal(source.includes(forbidden), false);
  }
});

function runNode(args) {
  return spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 1024 * 1024 * 4,
  });
}

function assertNoSensitiveOutput(output) {
  assert.equal(output.includes(RAW_SSN), false);
  assert.equal(output.includes(RAW_ACCOUNT), false);
  assert.equal(/\bsk-[A-Za-z0-9_-]{12,}\b/.test(output), false);
  assert.equal(/postgres(?:ql)?:\/\/[^"\s]+/i.test(output), false);
}
