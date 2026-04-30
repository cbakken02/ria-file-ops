import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "../..");
const MAPPING_SCRIPT = path.join(
  REPO_ROOT,
  "scripts/map-supabase-20260426-migration-content.mjs",
);
const CONTENT_MAPPING_DOC = path.join(
  REPO_ROOT,
  "docs/data-intelligence-v2/supabase-20260426-content-mapping.md",
);
const RAW_SSN = "123-45-6789";
const RAW_ACCOUNT = "9876543210123456";

const { inspectLocal20260426Content } = await import(
  pathToFileURL(MAPPING_SCRIPT)
);

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

test("local content mapper detects 20260426 files, hashes, objects, and duplicate versions", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "di-v2-map-"));
  try {
    const migrationsDir = path.join(tempDir, "migrations");
    await mkdir(migrationsDir);
    const cleanupSql =
      "create table if not exists public.cleanup_file_states (id text primary key); create index if not exists cleanup_file_states_id_idx on public.cleanup_file_states(id);";
    await writeFile(
      path.join(migrationsDir, "20260426_phase1_cleanup_file_states.sql"),
      cleanupSql,
    );
    await writeFile(
      path.join(
        migrationsDir,
        "20260426120000_phase1_cleanup_file_states_duplicate_guard.sql",
      ),
      `-- comment ignored by normalized hash\n${cleanupSql}\n`,
    );
    await writeFile(
      path.join(migrationsDir, "20260427_context.sql"),
      "update public.some_table set status = 'done';",
    );
    await writeFile(
      path.join(migrationsDir, "20260428_duplicate_a.sql"),
      "create table public.a (id text);",
    );
    await writeFile(
      path.join(migrationsDir, "20260428_duplicate_b.sql"),
      "create table public.b (id text);",
    );

    const summary = inspectLocal20260426Content({ migrationsDir });
    assert.equal(summary.hasCurrent20260426File, true);
    assert.equal(summary.hasDuplicateGuardFile, true);
    assert.equal(summary.duplicateVersions.length, 1);
    assert.equal(summary.duplicateVersions[0].version, "20260428");
    const current = summary.targetFileSummaries.find((file) =>
      file.fileName.startsWith("20260426_"),
    );
    const guard = summary.targetFileSummaries.find((file) =>
      file.fileName.startsWith("20260426120000_"),
    );
    assert.ok(current.sha256);
    assert.ok(current.normalizedSqlSha256);
    assert.notEqual(current.sha256, guard.sha256);
    assert.equal(current.normalizedSqlSha256, guard.normalizedSqlSha256);
    assert.ok(current.affectedObjects.includes("cleanup_file_states"));
    assert.ok(current.operationCategories.includes("create_table"));
    assert.ok(current.operationCategories.includes("create_index"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mapping CLI output is JSON, safe, and does not dump SQL content", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "di-v2-map-"));
  try {
    const migrationsDir = path.join(tempDir, "migrations");
    await mkdir(migrationsDir);
    await writeFile(
      path.join(migrationsDir, "20260426_phase1_cleanup_file_states.sql"),
      "create table if not exists public.cleanup_file_states (id text);",
    );
    await writeFile(
      path.join(
        migrationsDir,
        "20260426120000_phase1_cleanup_file_states_duplicate_guard.sql",
      ),
      "create table if not exists public.cleanup_file_states (id text);",
    );

    const result = runNode([
      MAPPING_SCRIPT,
      "--json",
      `--migrations-dir=${migrationsDir}`,
    ]);
    assert.equal(result.status, 0);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.local.targetFiles.length, 2);
    assert.equal(summary.safety.noRemoteMutation, true);
    assertNoSensitiveOutput(result.stdout);
    assert.equal(result.stdout.includes("create table"), false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mapping CLI detects observed remote/local fixture mismatch safely", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "di-v2-map-"));
  try {
    const migrationsDir = path.join(tempDir, "migrations");
    const fixturePath = path.join(tempDir, "migration-list.txt");
    await mkdir(migrationsDir);
    await writeFile(
      path.join(migrationsDir, "20260426_phase1_cleanup_file_states.sql"),
      "create table if not exists public.cleanup_file_states (id text);",
    );
    await writeFile(
      path.join(
        migrationsDir,
        "20260426120000_phase1_cleanup_file_states_duplicate_guard.sql",
      ),
      "create table if not exists public.cleanup_file_states (id text);",
    );
    await writeFile(fixturePath, OBSERVED_MISMATCH_FIXTURE);

    const result = runNode([
      MAPPING_SCRIPT,
      "--json",
      `--migrations-dir=${migrationsDir}`,
      `--fixture=${fixturePath}`,
    ]);
    assert.equal(result.status, 1);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.remote.completed, true);
    assert.equal(summary.remote.hasRemoteHistoryMismatch, true);
    assert.equal(
      summary.recommendation.category,
      "remote_20260426_maps_to_current_local_20260426",
    );
    assertNoSensitiveOutput(result.stdout);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mapping CLI can inspect a temp git history without remote GitHub", async (t) => {
  const gitAvailable = spawnSync("git", ["--version"], {
    encoding: "utf8",
  });
  if (gitAvailable.status !== 0) {
    t.skip("git CLI is not available");
    return;
  }

  const tempRepo = await mkdtemp(path.join(os.tmpdir(), "di-v2-map-git-"));
  try {
    const migrationsDir = path.join(tempRepo, "supabase/migrations");
    await mkdir(migrationsDir, { recursive: true });
    runGit(tempRepo, ["init"]);
    runGit(tempRepo, ["config", "user.name", "Migration Test"]);
    runGit(tempRepo, ["config", "user.email", "test@example.invalid"]);
    await writeFile(
      path.join(migrationsDir, "20260426_phase1_cleanup_file_states.sql"),
      "create table if not exists public.cleanup_file_states (id text);",
    );
    runGit(tempRepo, ["add", "supabase/migrations/20260426_phase1_cleanup_file_states.sql"]);
    runGit(tempRepo, ["commit", "-m", "add cleanup migration"]);
    await writeFile(
      path.join(
        migrationsDir,
        "20260426120000_phase1_cleanup_file_states_duplicate_guard.sql",
      ),
      "create table if not exists public.cleanup_file_states (id text);",
    );

    const result = runNode([
      MAPPING_SCRIPT,
      "--json",
      "--with-git-history",
      `--repo-dir=${tempRepo}`,
      `--migrations-dir=${migrationsDir}`,
    ]);
    assert.equal(result.status, 0);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.gitHistory.attempted, true);
    assert.equal(summary.gitHistory.available, true);
    assert.ok(
      summary.gitHistory.firstSeenByFile[
        "20260426_phase1_cleanup_file_states.sql"
      ],
    );
    assert.ok(
      summary.gitHistory.untrackedTargetFiles.some((fileName) =>
        fileName.endsWith(
          "20260426120000_phase1_cleanup_file_states_duplicate_guard.sql",
        ),
      ),
    );
    assertNoSensitiveOutput(result.stdout);
  } finally {
    await rm(tempRepo, { recursive: true, force: true });
  }
});

test("real repo mapping script runs safely and includes a recommendation category", () => {
  const result = runNode([MAPPING_SCRIPT, "--json"]);
  assert.equal(result.status, 0);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.safety.noRemoteMutation, true);
  assert.ok(summary.recommendation.category);
  assert.ok(summary.local.hasCurrent20260426File);
  assert.equal(summary.local.hasDuplicateGuardFile, false);
  assert.equal(
    existsSync(
      path.join(
        REPO_ROOT,
        "supabase/migrations/20260426120000_phase1_cleanup_file_states_duplicate_guard.sql",
      ),
    ),
    false,
  );
  assertNoSensitiveOutput(result.stdout);
});

test("content mapping documentation is explicit, cautious, and safe", async () => {
  const source = await readFile(CONTENT_MAPPING_DOC, "utf8");
  assert.match(source, /Purpose/i);
  assert.match(source, /No remote repair or migration apply was performed/i);
  assert.match(source, /duplicate guard migration was removed/i);
  assert.match(source, /pending remotely/i);
  assert.match(source, /V1 fallback remains intact/i);
  assert.match(source, /20260426_phase1_cleanup_file_states\.sql/i);
  assert.match(source, /20260426120000_phase1_cleanup_file_states_duplicate_guard\.sql/i);
  assertNoSensitiveOutput(source);
  assert.equal(source.includes("create table"), false);
});

function runNode(args) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "di-v2-map-output-"));
  const stdoutPath = path.join(tempDir, "stdout.txt");
  const stdoutFd = openSync(stdoutPath, "w");
  const result = spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", stdoutFd, "pipe"],
    timeout: 60000,
  });
  closeSync(stdoutFd);
  const stdout = readFileSync(stdoutPath, "utf8");
  rmSync(tempDir, { recursive: true, force: true });
  return {
    ...result,
    stdout,
  };
}

function runGit(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 60000,
  });
  assert.equal(result.status, 0, result.stderr);
}

function assertNoSensitiveOutput(output) {
  assert.equal(output.includes(RAW_SSN), false);
  assert.equal(output.includes(RAW_ACCOUNT), false);
  assert.equal(/\bsk-[A-Za-z0-9_-]{12,}\b/.test(output), false);
  assert.equal(/postgres(?:ql)?:\/\/[^"\s]+/i.test(output), false);
  assert.equal(/BEGIN\s+PRIVATE\s+KEY/i.test(output), false);
}
