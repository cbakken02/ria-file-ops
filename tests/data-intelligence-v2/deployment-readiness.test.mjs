import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "../..");
const MIGRATION_SCRIPT = path.join(
  REPO_ROOT,
  "scripts/check-supabase-migration-readiness.mjs",
);
const PREFLIGHT_SCRIPT = path.join(
  REPO_ROOT,
  "scripts/preflight-data-intelligence-v2-deployment.mjs",
);
const DOC_PATH = path.join(
  REPO_ROOT,
  "docs/data-intelligence-v2/deployment-readiness.md",
);
const RAW_SSN = "123-45-6789";
const RAW_ACCOUNT = "9876543210123456";

test("migration readiness script detects duplicate versions and keeps output safe", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "di-v2-migrations-"));
  try {
    await writeFile(
      path.join(tempDir, "20260101_first.sql"),
      "create table example_one(id text);",
    );
    await writeFile(
      path.join(tempDir, "20260101_second.sql"),
      `-- forbidden fixture ${RAW_SSN}\ncreate table example_two(id text);`,
    );

    const result = runNode([
      MIGRATION_SCRIPT,
      "--json",
      `--migrations-dir=${tempDir}`,
    ]);
    assert.notEqual(result.status, 0);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.passed, false);
    assert.equal(summary.duplicateVersions.length, 1);
    assert.equal(summary.forbiddenPatternFindings.count, 1);
    assert.equal(result.stdout.includes(RAW_SSN), false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("migration readiness script detects required V2 migrations in clean temp dir", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "di-v2-migrations-"));
  try {
    await writeFile(
      path.join(tempDir, "20260101_reveal.sql"),
      `
        create table data_intelligence_v2_reveal_cards (
          reveal_card_id text,
          owner_email text,
          user_email text,
          field_key text,
          field_label text,
          purpose text,
          expires_at timestamptz,
          one_time_use boolean,
          consumed_at timestamptz,
          revoked_at timestamptz,
          actual_value_was_not_shown_to_model boolean
        );
      `,
    );
    await writeFile(
      path.join(tempDir, "20260102_audit.sql"),
      `
        create table data_intelligence_v2_audit_events (
          audit_event_id text,
          event_type text,
          event_category text,
          owner_email text,
          user_email text,
          conversation_id text,
          message_id text,
          reveal_card_id text,
          tool_name text,
          model_name text,
          status text,
          allowed boolean,
          reason text,
          metadata jsonb,
          created_at timestamptz
        );
      `,
    );

    const result = runNode([
      MIGRATION_SCRIPT,
      "--json",
      `--migrations-dir=${tempDir}`,
    ]);
    assert.equal(result.status, 0);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.passed, true);
    assert.equal(summary.hasRevealCardsMigration, true);
    assert.equal(summary.hasAuditEventsMigration, true);
    assert.equal(summary.duplicateVersions.length, 0);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("real repo migration readiness is clean and detects V2 migrations", () => {
  const result = runNode([MIGRATION_SCRIPT, "--json"]);
  assert.equal(result.status, 0);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.passed, true);
  assert.equal(summary.duplicateVersions.length, 0);
  assert.equal(summary.hasRevealCardsMigration, true);
  assert.equal(summary.hasAuditEventsMigration, true);
  assert.equal(summary.forbiddenPatternFindings.count, 0);
});

test("deployment preflight source is read-only by default", async () => {
  const source = await readFile(PREFLIGHT_SCRIPT, "utf8");
  for (const forbidden of [
    "supabase db push",
    "supabase migration repair",
    "supabase db reset",
    "vercel deploy",
    "git push",
    "gh pr create",
  ]) {
    assert.equal(source.includes(forbidden), false);
  }
  assert.equal(source.includes("app/api/query-assistant"), false);
  assert.match(source, /--json/);
});

test("deployment preflight default run returns safe JSON sections", () => {
  const result = runNode([PREFLIGHT_SCRIPT, "--json"]);
  assert.equal(result.status, 0);
  const summary = JSON.parse(result.stdout);
  assert.ok(summary.git);
  assert.ok(summary.migration);
  assert.ok(summary.env);
  assert.ok(summary.supabase);
  assert.ok(summary.vercel);
  assert.ok(summary.safety);
  assert.equal(summary.migration.hasRevealCardsMigration, true);
  assert.equal(summary.migration.hasAuditEventsMigration, true);
  assertNoSensitiveOutput(result.stdout);
});

test("deployment readiness docs describe rollout, rollback, and safe checks", async () => {
  const source = await readFile(DOC_PATH, "utf8");
  assert.match(source, /rolled out to Production/i);
  assert.match(source, /V1 rollback/i);
  assert.match(source, /rollback/i);
  assert.match(source, /do not deploy/i);
  assert.match(source, /DATA_INTELLIGENCE_V2_ENABLED/);
  assert.match(source, /DATA_INTELLIGENCE_V2_REVEAL_STORE_BACKEND/);
  assert.match(source, /DATA_INTELLIGENCE_V2_AUDIT_BACKEND/);
  assert.match(source, /evaluate-data-intelligence-v2/);
  assert.match(source, /smoke-data-intelligence-v2/);
  assertNoSensitiveOutput(source);
});

function runNode(args) {
  return spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
}

function assertNoSensitiveOutput(output) {
  assert.equal(output.includes(RAW_SSN), false);
  assert.equal(output.includes(RAW_ACCOUNT), false);
  assert.equal(/\bsk-[A-Za-z0-9_-]{12,}\b/.test(output), false);
  assert.equal(/postgres(?:ql)?:\/\/[^"\s]+/i.test(output), false);
}
