import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "../..");
const DIAGNOSE_SCRIPT = path.join(
  REPO_ROOT,
  "scripts/diagnose-supabase-migration-history.mjs",
);
const CHECK_SCRIPT = path.join(
  REPO_ROOT,
  "scripts/check-supabase-migration-readiness.mjs",
);
const DOC_PATH = path.join(
  REPO_ROOT,
  "docs/data-intelligence-v2/supabase-migration-reconciliation-plan.md",
);
const RAW_SSN = "123-45-6789";
const RAW_ACCOUNT = "9876543210123456";

const { parseSupabaseMigrationListOutput } = await import(
  pathToFileURL(CHECK_SCRIPT)
);
const {
  inspectLocalMigrationHistory,
  classifyMigrationHistory,
} = await import(pathToFileURL(DIAGNOSE_SCRIPT));

const MATCHED_ONLY_FIXTURE = `
      LOCAL      |  REMOTE  |     TIME (UTC)
  ---------------|----------|---------------------
   20260424      | 20260424 | 2026-04-24 00:00:00
   20260425      | 20260425 | 2026-04-25 00:00:00
`;

const REMOTE_ONLY_FIXTURE = `
      LOCAL      |  REMOTE  |     TIME (UTC)
  ---------------|----------|---------------------
                 | 20260426 | 2026-04-26 00:00:00
`;

const LOCAL_ONLY_FIXTURE = `
      LOCAL      |  REMOTE  |     TIME (UTC)
  ---------------|----------|---------------------
   20260429      |          | 2026-04-29 00:00:00
   20260430      |          | 2026-04-30 00:00:00
`;

const OBSERVED_MISMATCH_FIXTURE = `
      LOCAL       |  REMOTE  |     TIME (UTC)
  ----------------|----------|---------------------
   20260424       | 20260424 | 2026-04-24 00:00:00
   20260425       | 20260425 | 2026-04-25 00:00:00
                  | 20260426 | 2026-04-26 00:00:00
   20260426120000 |          | 2026-04-26 12:00:00
   20260426       |          | 2026-04-26 00:00:00
   20260427       |          | 2026-04-27 00:00:00
   20260428       |          | 2026-04-28 00:00:00
   20260429       |          | 2026-04-29 00:00:00
   20260430       |          | 2026-04-30 00:00:00
`;

test("local migration parser detects clean order, V2 migrations, and affected objects", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "di-v2-history-"));
  try {
    await writeFile(
      path.join(tempDir, "20260429_data_intelligence_v2_reveal_cards.sql"),
      "create table if not exists public.data_intelligence_v2_reveal_cards (id text); create index if not exists idx_reveal on public.data_intelligence_v2_reveal_cards(id);",
    );
    await writeFile(
      path.join(tempDir, "20260430_data_intelligence_v2_audit_events.sql"),
      "create table if not exists public.data_intelligence_v2_audit_events (id text);",
    );

    const summary = inspectLocalMigrationHistory({ migrationsDir: tempDir });
    assert.equal(summary.localMigrationCount, 2);
    assert.deepEqual(summary.duplicateLocalVersions, []);
    assert.equal(summary.localMigrationOrderSane, true);
    assert.equal(summary.hasRevealMigration, true);
    assert.equal(summary.hasAuditMigration, true);
    assert.deepEqual(summary.localV2MigrationVersions, ["20260429", "20260430"]);
    assert.ok(
      summary.localMigrations[0].affectedObjects.includes(
        "data_intelligence_v2_reveal_cards",
      ),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("local migration parser detects duplicate versions", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "di-v2-history-"));
  try {
    await writeFile(path.join(tempDir, "20260426_one.sql"), "create table a(id text);");
    await writeFile(path.join(tempDir, "20260426_two.sql"), "create table b(id text);");

    const summary = inspectLocalMigrationHistory({ migrationsDir: tempDir });
    assert.equal(summary.duplicateLocalVersions.length, 1);
    assert.equal(summary.duplicateLocalVersions[0].version, "20260426");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("Supabase migration list parser handles matched, remote-only, and local-only fixtures", () => {
  const matched = parseSupabaseMigrationListOutput(MATCHED_ONLY_FIXTURE);
  assert.deepEqual(matched.matchedVersions, ["20260424", "20260425"]);
  assert.deepEqual(matched.remoteOnlyVersions, []);
  assert.deepEqual(matched.localOnlyVersions, []);
  assert.equal(matched.parserConfidence, "high");

  const remoteOnly = parseSupabaseMigrationListOutput(REMOTE_ONLY_FIXTURE);
  assert.deepEqual(remoteOnly.remoteOnlyVersions, ["20260426"]);
  assert.equal(remoteOnly.hasRemoteHistoryMismatch, true);

  const localOnly = parseSupabaseMigrationListOutput(LOCAL_ONLY_FIXTURE);
  assert.deepEqual(localOnly.localOnlyVersions, ["20260429", "20260430"]);
  assert.deepEqual(localOnly.v2MigrationVersionsPendingRemote, [
    "20260429",
    "20260430",
  ]);
  assert.equal(localOnly.hasPendingLocalMigrations, true);
  assert.equal(localOnly.hasRemoteHistoryMismatch, false);
});

test("observed migration-list shape is parsed as a history mismatch with medium confidence", () => {
  const parsed = parseSupabaseMigrationListOutput(OBSERVED_MISMATCH_FIXTURE);
  assert.deepEqual(parsed.matchedVersions, ["20260424", "20260425"]);
  assert.ok(parsed.remoteOnlyVersions.includes("20260426"));
  assert.ok(parsed.localOnlyVersions.includes("20260426120000"));
  assert.ok(parsed.localOnlyVersions.includes("20260426"));
  assert.ok(parsed.localOnlyVersions.includes("20260429"));
  assert.ok(parsed.localOnlyVersions.includes("20260430"));
  assert.deepEqual(parsed.unpairedSameVersions, ["20260426"]);
  assert.equal(parsed.hasRemoteHistoryMismatch, true);
  assert.notEqual(parsed.parserConfidence, "high");
});

test("classification separates parser artifact from observed remote/local mismatch", () => {
  const local = inspectLocalMigrationHistory({
    migrationsDir: path.join(REPO_ROOT, "supabase/migrations"),
  });
  const matched = parseSupabaseMigrationListOutput(MATCHED_ONLY_FIXTURE);
  const artifact = classifyMigrationHistory({
    local,
    remoteCheck: {
      attempted: true,
      completed: true,
      timedOut: false,
      ...toRemoteCheck(matched),
    },
  });
  assert.equal(artifact.category, "A_parser_artifact");

  const observed = parseSupabaseMigrationListOutput(OBSERVED_MISMATCH_FIXTURE);
  const mismatch = classifyMigrationHistory({
    local,
    remoteCheck: {
      attempted: true,
      completed: true,
      timedOut: false,
      ...toRemoteCheck(observed),
    },
  });
  assert.equal(mismatch.category, "B_remote_20260426_applied_mismatch");
});

test("diagnostic CLI default run is local-only, safe, and parseable", () => {
  const result = runNode([DIAGNOSE_SCRIPT, "--json"]);
  assert.equal(result.status, 0);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.remoteCheck.attempted, false);
  assert.equal(summary.duplicateLocalVersions.length, 0);
  assert.equal(summary.hasRevealMigration, true);
  assert.equal(summary.hasAuditMigration, true);
  assert.equal(summary.safety.noRemoteMutation, true);
  assertNoSensitiveOutput(result.stdout);
});

test("diagnostic CLI parses fixture output and blocks observed mismatch", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "di-v2-history-"));
  const fixturePath = path.join(tempDir, "migration-list.txt");
  try {
    await writeFile(fixturePath, OBSERVED_MISMATCH_FIXTURE);
    const result = runNode([DIAGNOSE_SCRIPT, "--json", `--fixture=${fixturePath}`]);
    assert.equal(result.status, 1);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.remoteCheck.completed, true);
    assert.equal(summary.remoteCheck.hasRemoteHistoryMismatch, true);
    assert.equal(
      summary.classification.category,
      "B_remote_20260426_applied_mismatch",
    );
    assertNoSensitiveOutput(result.stdout);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("existing migration readiness script still passes local-only clean check", () => {
  const result = runNode([CHECK_SCRIPT, "--json"]);
  assert.equal(result.status, 0);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.passed, true);
  assert.equal(summary.duplicateVersions.length, 0);
  assert.equal(summary.hasRevealCardsMigration, true);
  assert.equal(summary.hasAuditEventsMigration, true);
});

test("reconciliation documentation is explicit, future-oriented, and safe", async () => {
  const source = await readFile(DOC_PATH, "utf8");
  assert.match(source, /No migration repair/i);
  assert.match(source, /V1 fallback remains intact/i);
  assert.match(source, /Preview Supabase migrations were applied/i);
  assert.match(source, /matched local\/remote migration\s+history through `20260430`/i);
  assert.match(source, /do not run `supabase migration repair` during diagnosis/i);
  assert.match(source, /Future preview migration apply is allowed only after/i);
  assertNoSensitiveOutput(source);
});

function toRemoteCheck(parsed) {
  return {
    parserConfidence: parsed.parserConfidence,
    matchedVersions: parsed.matchedVersions,
    remoteOnlyVersions: parsed.remoteOnlyVersions,
    localOnlyVersions: parsed.localOnlyVersions,
    pendingV2Versions: parsed.v2MigrationVersionsPendingRemote,
    mismatchedRows: parsed.mismatchedRows,
    unpairedSameVersions: parsed.unpairedSameVersions,
    hasPendingLocalMigrations: parsed.hasPendingLocalMigrations,
    hasRemoteHistoryMismatch: parsed.hasRemoteHistoryMismatch,
  };
}

function runNode(args) {
  return spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 60000,
  });
}

function assertNoSensitiveOutput(output) {
  assert.equal(output.includes(RAW_SSN), false);
  assert.equal(output.includes(RAW_ACCOUNT), false);
  assert.equal(/\bsk-[A-Za-z0-9_-]{12,}\b/.test(output), false);
  assert.equal(/postgres(?:ql)?:\/\/[^"\s]+/i.test(output), false);
}
