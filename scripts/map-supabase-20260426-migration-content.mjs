#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseSupabaseMigrationListOutput,
} from "./check-supabase-migration-readiness.mjs";

const DEFAULT_MIGRATIONS_DIR = path.resolve("supabase/migrations");
const TARGET_VERSION = "20260426";
const DUPLICATE_GUARD_FILE =
  "20260426120000_phase1_cleanup_file_states_duplicate_guard.sql";
const CURRENT_20260426_FILE = "20260426_phase1_cleanup_file_states.sql";

export function mapSupabase20260426MigrationContent(options = {}) {
  const repoDir = path.resolve(options.repoDir ?? process.cwd());
  const local = inspectLocal20260426Content({
    migrationsDir: options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR,
  });
  const gitHistory =
    options.withGitHistory === true
      ? inspectGitHistory({ repoDir })
      : {
          attempted: false,
          available: false,
          relevantCommits: [],
          firstSeenByFile: {},
          renameEvidence: [],
          contentChangeEvidence: [],
          untrackedTargetFiles: [],
          confidence: "unknown",
        };
  const remote = inspectRemoteMigrationList(options);
  const mapping = classify20260426Mapping({ local, gitHistory, remote });
  const recommendation = buildRecommendation({ mapping, remote });
  const localParseFailed = local.migrationDirectoryPresent === false;
  const exitCode = localParseFailed
    ? 2
    : local.duplicateVersions.length > 0 ||
        (remote.attempted && remote.hasRemoteHistoryMismatch)
      ? 1
      : 0;

  return {
    local,
    gitHistory,
    remote,
    mapping,
    recommendation,
    safety: {
      noRemoteMutation: true,
      noSecretsPrinted: true,
      noRawSensitiveValuesPrinted: true,
    },
    exitCode,
  };
}

export function inspectLocal20260426Content({ migrationsDir = DEFAULT_MIGRATIONS_DIR } = {}) {
  const absoluteDir = path.resolve(migrationsDir);
  const migrationDirectoryPresent = existsSync(absoluteDir);
  const migrationFiles = migrationDirectoryPresent
    ? readdirSync(absoluteDir).filter((file) => file.endsWith(".sql")).sort()
    : [];
  const versions = migrationFiles.map((fileName) => parseMigrationVersion(fileName));
  const duplicateVersions = findDuplicateVersions(
    migrationFiles.map((fileName) => ({
      fileName,
      version: parseMigrationVersion(fileName),
    })),
  );
  const targetFiles = migrationFiles.filter((fileName) => {
    const source = readFileSync(path.join(absoluteDir, fileName), "utf8");
    return fileName.startsWith(TARGET_VERSION) || source.includes("cleanup_file_states");
  });
  const targetFileSummaries = targetFiles.map((fileName) =>
    summarizeMigrationFile(path.join(absoluteDir, fileName), fileName),
  );
  const normalizedHashComparisons = compareTargetFiles(targetFileSummaries);
  const objectOperationSummaries = Object.fromEntries(
    targetFileSummaries.map((summary) => [
      summary.fileName,
      {
        affectedObjects: summary.affectedObjects,
        operationCategories: summary.operationCategories,
        hasDml: summary.hasDml,
        hasDestructiveStatements: summary.hasDestructiveStatements,
        hasDataLiterals: summary.hasDataLiterals,
        appearsIdempotent: summary.appearsIdempotent,
      },
    ]),
  );

  return {
    migrationDirectoryPresent,
    migrationFiles,
    versions,
    duplicateVersions,
    targetFiles,
    targetFileSummaries,
    normalizedHashComparisons,
    objectOperationSummaries,
    hasCurrent20260426File: targetFiles.includes(CURRENT_20260426_FILE),
    hasDuplicateGuardFile: targetFiles.includes(DUPLICATE_GUARD_FILE),
  };
}

function summarizeMigrationFile(filePath, fileName) {
  const source = readFileSync(filePath, "utf8");
  const normalized = normalizeSql(source);
  const operationCategories = extractOperationCategories(source);
  const affectedObjects = extractAffectedObjects(source);

  return {
    fileName,
    version: parseMigrationVersion(fileName),
    sizeBytes: statSync(filePath).size,
    sha256: sha256(source),
    normalizedSqlSha256: sha256(normalized),
    affectedObjects,
    operationCategories,
    hasDml: /\b(insert|update|delete)\b/i.test(source),
    hasDestructiveStatements: /\b(drop|truncate)\b/i.test(source),
    hasDataLiterals: /'[^']+'|\$\$[\s\S]*?\$\$|\bvalues\s*\(/i.test(source),
    appearsIdempotent: /if\s+not\s+exists/i.test(source) && !/\b(drop|truncate)\b/i.test(source),
  };
}

function compareTargetFiles(summaries) {
  const comparisons = [];
  for (let i = 0; i < summaries.length; i += 1) {
    for (let j = i + 1; j < summaries.length; j += 1) {
      const left = summaries[i];
      const right = summaries[j];
      comparisons.push({
        leftFileName: left.fileName,
        rightFileName: right.fileName,
        fullContentIdentical: left.sha256 === right.sha256,
        normalizedSqlIdentical:
          left.normalizedSqlSha256 === right.normalizedSqlSha256,
        affectedObjectOverlap: left.affectedObjects.filter((objectName) =>
          right.affectedObjects.includes(objectName),
        ),
        operationCategoryOverlap: left.operationCategories.filter((operation) =>
          right.operationCategories.includes(operation),
        ),
      });
    }
  }
  return comparisons;
}

function inspectGitHistory({ repoDir }) {
  const gitCheck = runGit(repoDir, ["rev-parse", "--is-inside-work-tree"]);
  if (!gitCheck.ok) {
    return {
      attempted: true,
      available: false,
      relevantCommits: [],
      firstSeenByFile: {},
      renameEvidence: [],
      contentChangeEvidence: [],
      untrackedTargetFiles: [],
      confidence: "unknown",
    };
  }

  const log = runGit(repoDir, [
    "log",
    "--all",
    "--name-status",
    "--format=commit %H%n%ct%n%s",
    "--",
    "supabase/migrations",
  ]);
  const status = runGit(repoDir, ["status", "--short", "--", "supabase/migrations"]);
  const relevantCommits = parseRelevantGitCommits(log.stdout);
  const firstSeenByFile = getFirstSeenByFile(relevantCommits);
  const renameEvidence = relevantCommits
    .flatMap((commit) =>
      commit.paths
        .filter((entry) => entry.status.startsWith("R"))
        .map((entry) => ({
          commit: commit.commit,
          subject: commit.subject,
          status: entry.status,
          from: entry.from,
          to: entry.to,
        })),
    )
    .filter((entry) =>
      [entry.from, entry.to].some((fileName) => is20260426RelatedPath(fileName)),
    );
  const contentChangeEvidence = relevantCommits
    .flatMap((commit) =>
      commit.paths
        .filter((entry) => entry.status.startsWith("M"))
        .map((entry) => ({
          commit: commit.commit,
          subject: commit.subject,
          fileName: entry.path,
          status: entry.status,
        })),
    )
    .filter((entry) => is20260426RelatedPath(entry.fileName));
  const untrackedTargetFiles = parseUntrackedTargetFiles(status.stdout);

  return {
    attempted: true,
    available: true,
    relevantCommits,
    firstSeenByFile,
    renameEvidence,
    contentChangeEvidence,
    untrackedTargetFiles,
    confidence: relevantCommits.length > 0 ? "medium" : "low",
  };
}

function parseRelevantGitCommits(output) {
  const commits = [];
  let current = null;
  const lines = output.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("commit ")) {
      if (current) {
        commits.push(current);
      }
      current = {
        commit: line.slice("commit ".length),
        timestamp: Number(lines[index + 1] ?? 0),
        subject: lines[index + 2] ?? "",
        paths: [],
      };
      index += 2;
      continue;
    }
    if (!current || !line.trim()) {
      continue;
    }
    const parts = line.split(/\t/);
    if (parts.length >= 2) {
      const status = parts[0];
      const pathPart = parts[parts.length - 1];
      current.paths.push({
        status,
        path: pathPart,
        from: parts.length >= 3 ? parts[1] : undefined,
        to: parts.length >= 3 ? parts[2] : undefined,
      });
    }
  }
  if (current) {
    commits.push(current);
  }

  return commits.filter((commit) =>
    commit.paths.some((entry) =>
      [entry.path, entry.from, entry.to].some((filePath) =>
        is20260426RelatedPath(filePath),
      ),
    ),
  );
}

function getFirstSeenByFile(commits) {
  const firstSeen = {};
  for (const commit of [...commits].reverse()) {
    for (const entry of commit.paths) {
      if (!entry.status.startsWith("A") && !entry.status.startsWith("R")) {
        continue;
      }
      const fileName = path.basename(entry.to ?? entry.path);
      if (!is20260426RelatedPath(fileName)) {
        continue;
      }
      firstSeen[fileName] = {
        commit: commit.commit,
        subject: commit.subject,
        timestamp: commit.timestamp,
        status: entry.status,
      };
    }
  }
  return firstSeen;
}

function parseUntrackedTargetFiles(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("?? "))
    .map((line) => line.slice(3))
    .filter((fileName) => is20260426RelatedPath(fileName));
}

function inspectRemoteMigrationList(options) {
  if (options.fixturePath) {
    return summarizeRemoteOutput({
      attempted: true,
      completed: true,
      timedOut: false,
      source: readFileSync(path.resolve(options.fixturePath), "utf8"),
    });
  }
  if (options.withSupabaseCli !== true) {
    return {
      attempted: false,
      completed: false,
      timedOut: false,
      matchedVersions: [],
      remoteOnlyVersions: [],
      localOnlyVersions: [],
      parserConfidence: "low",
      pendingV2Versions: [],
      hasRemoteHistoryMismatch: false,
    };
  }

  const result = spawnSync("supabase", ["migration", "list"], {
    encoding: "utf8",
    timeout: options.timeoutMs ?? 30000,
    env: createSafeSupabaseCliEnv(process.env),
  });
  if (result.error || result.status !== 0) {
    return {
      attempted: true,
      completed: false,
      timedOut: result.error?.code === "ETIMEDOUT",
      matchedVersions: [],
      remoteOnlyVersions: [],
      localOnlyVersions: [],
      parserConfidence: "low",
      pendingV2Versions: [],
      hasRemoteHistoryMismatch: false,
    };
  }
  return summarizeRemoteOutput({
    attempted: true,
    completed: true,
    timedOut: false,
    source: result.stdout,
  });
}

function summarizeRemoteOutput({ attempted, completed, timedOut, source }) {
  const parsed = parseSupabaseMigrationListOutput(source);
  return {
    attempted,
    completed,
    timedOut,
    matchedVersions: parsed.matchedVersions,
    remoteOnlyVersions: parsed.remoteOnlyVersions,
    localOnlyVersions: parsed.localOnlyVersions,
    parserConfidence: parsed.parserConfidence,
    pendingV2Versions: parsed.v2MigrationVersionsPendingRemote,
    hasRemoteHistoryMismatch: parsed.hasRemoteHistoryMismatch,
  };
}

function classify20260426Mapping({ local, gitHistory, remote }) {
  const current = local.targetFileSummaries.find(
    (summary) => summary.fileName === CURRENT_20260426_FILE,
  );
  const duplicateGuard = local.targetFileSummaries.find(
    (summary) => summary.fileName === DUPLICATE_GUARD_FILE,
  );
  const currentAndGuardIdentical = local.normalizedHashComparisons.some(
    (comparison) =>
      [comparison.leftFileName, comparison.rightFileName].includes(
        CURRENT_20260426_FILE,
      ) &&
      [comparison.leftFileName, comparison.rightFileName].includes(
        DUPLICATE_GUARD_FILE,
      ) &&
      comparison.fullContentIdentical &&
      comparison.normalizedSqlIdentical,
  );
  const currentFirstSeen = gitHistory.firstSeenByFile?.[CURRENT_20260426_FILE];
  const duplicateGuardUntracked = gitHistory.untrackedTargetFiles?.some(
    (fileName) => path.basename(fileName) === DUPLICATE_GUARD_FILE,
  );
  const remoteExact20260426 =
    remote.remoteOnlyVersions.includes(TARGET_VERSION) ||
    remote.matchedVersions?.includes?.(TARGET_VERSION);
  const localExact20260426 =
    local.versions.includes(TARGET_VERSION) ||
    remote.localOnlyVersions.includes(TARGET_VERSION);
  const evidence = [];
  const unknowns = [];

  if (current) {
    evidence.push("current local 20260426 migration exists");
  }
  if (duplicateGuard) {
    evidence.push("renamed duplicate guard migration exists");
  }
  if (currentAndGuardIdentical) {
    evidence.push("current 20260426 and duplicate guard files are byte-identical and normalized-identical");
  }
  if (currentFirstSeen) {
    evidence.push("git history shows current 20260426 file was added as a tracked migration");
  }
  if (duplicateGuardUntracked) {
    evidence.push("git status shows duplicate guard file is currently untracked");
  }
  if (remoteExact20260426) {
    evidence.push("read-only remote list references exact version 20260426");
  }
  if (remote.hasRemoteHistoryMismatch) {
    evidence.push("read-only remote list shows 20260426 as unpaired remote/local history");
  }

  if (!remote.attempted) {
    unknowns.push("remote migration list was not checked in this mapping run");
  }
  if (!currentAndGuardIdentical && duplicateGuard) {
    unknowns.push("duplicate guard differs from current local 20260426 content");
  }
  if (!currentFirstSeen) {
    unknowns.push("git history did not identify when current 20260426 first appeared");
  }
  unknowns.push("remote schema migration metadata content/name was not inspected directly");

  if (remote.attempted && !remote.completed) {
    return {
      likelyRemote20260426LocalFile: null,
      confidence: "unknown",
      evidence,
      unknowns,
    };
  }

  if (
    current &&
    currentFirstSeen &&
    remoteExact20260426 &&
    localExact20260426 &&
    duplicateGuardUntracked
  ) {
    return {
      likelyRemote20260426LocalFile: CURRENT_20260426_FILE,
      confidence: currentAndGuardIdentical ? "medium" : "high",
      evidence,
      unknowns,
    };
  }

  if (duplicateGuard && !current && remoteExact20260426) {
    return {
      likelyRemote20260426LocalFile: DUPLICATE_GUARD_FILE,
      confidence: "low",
      evidence,
      unknowns,
    };
  }

  return {
    likelyRemote20260426LocalFile: current?.fileName ?? null,
    confidence: current ? "low" : "unknown",
    evidence,
    unknowns,
  };
}

function buildRecommendation({ mapping, remote }) {
  let category = "true_divergence_unknown_mapping";
  let recommendedNextAction =
    "Do not apply pending migrations until a human confirms the 20260426 remote/local mapping.";

  if (!remote.attempted) {
    category =
      mapping.likelyRemote20260426LocalFile === CURRENT_20260426_FILE
        ? "remote_20260426_maps_to_current_local_20260426"
        : "true_divergence_unknown_mapping";
    recommendedNextAction =
      "Run a read-only remote migration-list check, then confirm whether the remote 20260426 row maps to the current local cleanup migration.";
  } else if (!remote.hasRemoteHistoryMismatch) {
    category = "parser_artifact";
    recommendedNextAction =
      "Treat the earlier mismatch as a parser/output artifact only after rerunning readiness confirms no remote history mismatch.";
  } else if (
    mapping.likelyRemote20260426LocalFile === CURRENT_20260426_FILE &&
    mapping.confidence !== "unknown"
  ) {
    category = "remote_20260426_maps_to_current_local_20260426";
    recommendedNextAction =
      "Plan a controlled migration-history reconciliation for 20260426 before applying V2 reveal/audit migrations.";
  } else if (
    mapping.likelyRemote20260426LocalFile === DUPLICATE_GUARD_FILE
  ) {
    category = "remote_20260426_maps_to_duplicate_guard";
    recommendedNextAction =
      "Verify why the duplicate guard is the likely remote source before any repair or apply step.";
  }

  return {
    category,
    recommendedNextAction,
    futureCommandsToConsider: [
      "DO NOT RUN until explicitly approved: node scripts/diagnose-supabase-migration-history.mjs --json --with-supabase-cli",
      "DO NOT RUN until explicitly approved: a controlled Supabase migration repair command only after exact mapping is confirmed",
    ],
    commandsNotRun: [
      "supabase db push",
      "supabase migration repair",
      "supabase db reset",
      "vercel deploy",
      "git push",
      "gh pr create",
      "OpenAI eval",
    ],
  };
}

function normalizeSql(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function extractAffectedObjects(source) {
  const objects = [];
  const patterns = [
    /\b(?:create\s+table(?:\s+if\s+not\s+exists)?|alter\s+table|drop\s+table(?:\s+if\s+exists)?|comment\s+on\s+table)\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi,
    /\bcreate\s+(?:unique\s+)?index(?:\s+if\s+not\s+exists)?\s+([a-z_][a-z0-9_]*)/gi,
  ];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      objects.push(match[1]);
    }
  }
  return [...new Set(objects)].sort();
}

function extractOperationCategories(source) {
  const operations = [];
  const checks = [
    ["create_table", /\bcreate\s+table\b/i],
    ["alter_table", /\balter\s+table\b/i],
    ["create_index", /\bcreate\s+(?:unique\s+)?index\b/i],
    ["comment", /\bcomment\s+on\b/i],
    ["insert", /\binsert\b/i],
    ["update", /\bupdate\b/i],
    ["delete", /\bdelete\b/i],
    ["drop", /\bdrop\b/i],
    ["truncate", /\btruncate\b/i],
  ];
  for (const [name, pattern] of checks) {
    if (pattern.test(source)) {
      operations.push(name);
    }
  }
  return operations;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseMigrationVersion(fileName) {
  return fileName.match(/^(\d+)_/)?.[1] ?? "";
}

function findDuplicateVersions(migrations) {
  const byVersion = new Map();
  for (const migration of migrations) {
    const entries = byVersion.get(migration.version) ?? [];
    entries.push(migration.fileName);
    byVersion.set(migration.version, entries);
  }
  return [...byVersion.entries()]
    .filter(([version, fileNames]) => version && fileNames.length > 1)
    .map(([version, fileNames]) => ({ version, fileNames }));
}

function runGit(repoDir, args) {
  const result = spawnSync("git", ["-C", repoDir, ...args], {
    encoding: "utf8",
    timeout: 30000,
  });
  return {
    ok: !result.error && result.status === 0,
    stdout: result.stdout ?? "",
  };
}

function is20260426RelatedPath(filePath) {
  if (!filePath) {
    return false;
  }
  const baseName = path.basename(filePath);
  return baseName.includes("20260426") || baseName.includes("cleanup_file_states");
}

function createSafeSupabaseCliEnv(env) {
  const safeEnv = { ...env };
  for (const name of [
    "SUPABASE_DB_URL",
    "SUPABASE_DB_URL_POOLER",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
    "POSTGRES_URL",
    "POSTGRES_PRISMA_URL",
    "POSTGRES_URL_NON_POOLING",
  ]) {
    delete safeEnv[name];
  }
  return safeEnv;
}

function parseArgs(argv) {
  return {
    json: argv.includes("--json"),
    withGitHistory: argv.includes("--with-git-history"),
    withSupabaseCli: argv.includes("--with-supabase-cli"),
    fixturePath: readOption(argv, "--fixture"),
    migrationsDir: readOption(argv, "--migrations-dir") ?? DEFAULT_MIGRATIONS_DIR,
    repoDir: readOption(argv, "--repo-dir") ?? process.cwd(),
  };
}

function readOption(argv, name) {
  const prefix = `${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

export function printSupabase20260426ContentMapping(summary) {
  console.log("Supabase 20260426 migration content mapping");
  console.log(`- Target files: ${summary.local.targetFiles.length}`);
  console.log(`- Duplicate versions: ${summary.local.duplicateVersions.length}`);
  console.log(`- Git history attempted: ${summary.gitHistory.attempted}`);
  console.log(`- Remote check attempted: ${summary.remote.attempted}`);
  console.log(`- Likely mapping: ${summary.mapping.likelyRemote20260426LocalFile ?? "unknown"}`);
  console.log(`- Confidence: ${summary.mapping.confidence}`);
  console.log(`- Recommendation: ${summary.recommendation.category}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const summary = mapSupabase20260426MigrationContent(args);
  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printSupabase20260426ContentMapping(summary);
  }
  process.exit(summary.exitCode);
}
