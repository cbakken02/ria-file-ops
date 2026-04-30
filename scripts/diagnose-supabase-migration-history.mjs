#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseSupabaseMigrationListOutput,
} from "./check-supabase-migration-readiness.mjs";

const DEFAULT_MIGRATIONS_DIR = path.resolve("supabase/migrations");
const V2_MIGRATION_VERSIONS = ["20260429", "20260430"];
const HISTORY_RISK_VERSION = "20260426";

export function diagnoseSupabaseMigrationHistory(options = {}) {
  const local = inspectLocalMigrationHistory({
    migrationsDir: options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR,
  });
  const remoteCheck = getRemoteMigrationCheck(options);
  const classification = classifyMigrationHistory({ local, remoteCheck });
  const recommendedNextActions = buildRecommendedNextActions({
    local,
    remoteCheck,
    classification,
  });
  const localParseFailed = !local.migrationDirectoryPresent;
  const remoteMismatch =
    remoteCheck.attempted &&
    (!remoteCheck.completed || remoteCheck.hasRemoteHistoryMismatch);
  const exitCode = localParseFailed
    ? 2
    : local.duplicateLocalVersions.length > 0 || remoteMismatch
      ? 1
      : 0;

  return {
    localMigrationCount: local.localMigrationCount,
    localVersions: local.localVersions,
    duplicateLocalVersions: local.duplicateLocalVersions,
    localV2MigrationVersions: local.localV2MigrationVersions,
    hasRevealMigration: local.hasRevealMigration,
    hasAuditMigration: local.hasAuditMigration,
    localMigrationOrderSane: local.localMigrationOrderSane,
    hasDuplicateGuardMigration: local.hasDuplicateGuardMigration,
    hasLocal20260426Migration: local.hasLocal20260426Migration,
    hasLocal20260427Migration: local.localVersions.includes("20260427"),
    hasLocal20260428Migration: local.localVersions.includes("20260428"),
    hasLocal20260429Migration: local.localVersions.includes("20260429"),
    hasLocal20260430Migration: local.localVersions.includes("20260430"),
    localMigrations: local.localMigrations,
    remoteCheck,
    classification,
    recommendedNextActions,
    safety: {
      noRemoteMutation: true,
      noSecretValuesPrinted: true,
    },
    exitCode,
  };
}

export function inspectLocalMigrationHistory({ migrationsDir = DEFAULT_MIGRATIONS_DIR } = {}) {
  const absoluteDir = path.resolve(migrationsDir);
  const files = existsSync(absoluteDir)
    ? readdirSync(absoluteDir).filter((file) => file.endsWith(".sql")).sort()
    : [];
  const localMigrations = files.map((fileName) => {
    const source = readFileSync(path.join(absoluteDir, fileName), "utf8");
    return {
      fileName,
      version: parseMigrationVersion(fileName),
      affectedObjects: extractAffectedObjects(source),
    };
  });
  const localVersions = localMigrations.map((migration) => migration.version);
  const duplicateLocalVersions = findDuplicateVersions(localMigrations);
  const hasRevealMigration = localMigrations.some((migration) =>
    migration.affectedObjects.includes("data_intelligence_v2_reveal_cards"),
  );
  const hasAuditMigration = localMigrations.some((migration) =>
    migration.affectedObjects.includes("data_intelligence_v2_audit_events"),
  );

  return {
    migrationDirectoryPresent: existsSync(absoluteDir),
    localMigrationCount: localMigrations.length,
    localVersions,
    duplicateLocalVersions,
    localV2MigrationVersions: V2_MIGRATION_VERSIONS.filter((version) =>
      localVersions.includes(version),
    ),
    hasRevealMigration,
    hasAuditMigration,
    localMigrationOrderSane: isSorted(files),
    hasDuplicateGuardMigration: files.includes(
      "20260426120000_phase1_cleanup_file_states_duplicate_guard.sql",
    ),
    hasLocal20260426Migration: localVersions.includes(HISTORY_RISK_VERSION),
    localMigrations,
  };
}

export function classifyMigrationHistory({ local, remoteCheck }) {
  if (local.duplicateLocalVersions.length > 0) {
    return {
      category: "D_true_remote_local_divergence",
      label: "D. True remote/local divergence",
      reason: "Duplicate local migration versions block safe migration planning.",
      evidence: [
        `duplicateLocalVersionCount=${local.duplicateLocalVersions.length}`,
      ],
      unknowns: [
        "Whether any duplicate local version has already been applied remotely.",
      ],
    };
  }

  if (!remoteCheck.attempted) {
    return {
      category: "E_unknown",
      label: "E. Unknown",
      reason: "Remote migration history was not checked in this run.",
      evidence: ["localMigrationVersionsAreUnique=true"],
      unknowns: ["Remote migration history alignment."],
    };
  }

  if (!remoteCheck.completed || remoteCheck.parserConfidence === "low") {
    return {
      category: "E_unknown",
      label: "E. Unknown",
      reason: "Read-only remote migration output was unavailable or could not be parsed confidently.",
      evidence: [
        `remoteCheckCompleted=${remoteCheck.completed}`,
        `parserConfidence=${remoteCheck.parserConfidence}`,
      ],
      unknowns: [
        "Whether the remote 20260426 migration maps to the current local cleanup migration.",
      ],
    };
  }

  if (!remoteCheck.hasRemoteHistoryMismatch) {
    return {
      category: "A_parser_artifact",
      label: "A. Parser artifact",
      reason: "Read-only migration output did not show a remote-only or mismatched migration history row.",
      evidence: [
        `matchedVersionCount=${remoteCheck.matchedVersions.length}`,
        `pendingLocalVersionCount=${remoteCheck.localOnlyVersions.length}`,
      ],
      unknowns: [],
    };
  }

  if (
    local.hasDuplicateGuardMigration &&
    remoteCheck.remoteOnlyVersions.includes(HISTORY_RISK_VERSION) &&
    remoteCheck.localOnlyVersions.includes(HISTORY_RISK_VERSION)
  ) {
    return {
      category: "C_local_duplicate_renamed_after_remote_apply",
      label: "C. Local migration file was renamed or duplicated after a remote 20260426 was already applied",
      reason: "The same 20260426 version appears unpaired on both local and remote sides, and the local duplicate-guard migration exists.",
      evidence: [
        "remoteOnlyVersions includes 20260426",
        "localOnlyVersions includes 20260426",
        "local duplicate guard migration exists",
      ],
      unknowns: [
        "Which local cleanup SQL file corresponds to the remote 20260426 history row.",
        "Whether the renamed duplicate-guard migration should remain in the applied migration path.",
      ],
    };
  }

  if (remoteCheck.remoteOnlyVersions.includes(HISTORY_RISK_VERSION)) {
    return {
      category: "B_remote_20260426_applied_mismatch",
      label: "B. Remote history has an applied 20260426 migration that does not match the current local 20260426 file",
      reason: "The remote migration list includes 20260426 without a clean local match.",
      evidence: ["remoteOnlyVersions includes 20260426"],
      unknowns: [
        "Whether the remote history row name/content matches any local migration file.",
      ],
    };
  }

  return {
    category: "D_true_remote_local_divergence",
    label: "D. True remote/local divergence",
    reason: "Read-only migration output showed remote-only or mismatched rows.",
    evidence: [
      `remoteOnlyVersionCount=${remoteCheck.remoteOnlyVersions.length}`,
      `mismatchedRowCount=${remoteCheck.mismatchedRows.length}`,
    ],
    unknowns: [
      "Whether missing local migration files can be recovered from git history or Supabase metadata.",
    ],
  };
}

function getRemoteMigrationCheck(options) {
  if (options.fixturePath) {
    const source = readFileSync(path.resolve(options.fixturePath), "utf8");
    return summarizeParsedRemoteOutput({
      attempted: true,
      completed: true,
      timedOut: false,
      source,
    });
  }

  if (options.withSupabaseCli !== true) {
    return {
      attempted: false,
      completed: false,
      timedOut: false,
      parserConfidence: "low",
      matchedVersions: [],
      remoteOnlyVersions: [],
      localOnlyVersions: [],
      pendingV2Versions: [],
      mismatchedRows: [],
      unpairedSameVersions: [],
      hasPendingLocalMigrations: false,
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
      parserConfidence: "low",
      matchedVersions: [],
      remoteOnlyVersions: [],
      localOnlyVersions: [],
      pendingV2Versions: [],
      mismatchedRows: [],
      unpairedSameVersions: [],
      hasPendingLocalMigrations: false,
      hasRemoteHistoryMismatch: false,
    };
  }

  return summarizeParsedRemoteOutput({
    attempted: true,
    completed: true,
    timedOut: false,
    source: result.stdout,
  });
}

function summarizeParsedRemoteOutput({ attempted, completed, timedOut, source }) {
  const parsed = parseSupabaseMigrationListOutput(source);
  return {
    attempted,
    completed,
    timedOut,
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

function buildRecommendedNextActions({ local, remoteCheck, classification }) {
  const actions = [];
  if (local.duplicateLocalVersions.length > 0) {
    actions.push("Resolve duplicate local migration versions before any remote migration action.");
  }
  if (!remoteCheck.attempted) {
    actions.push("Run the diagnostic with --with-supabase-cli when ready for a read-only remote check.");
  }
  if (remoteCheck.attempted && !remoteCheck.completed) {
    actions.push("Re-run the read-only Supabase migration list from a stable network/session.");
  }
  if (classification.category === "C_local_duplicate_renamed_after_remote_apply") {
    actions.push("Map the remote 20260426 history row to the intended local cleanup migration before applying pending migrations.");
    actions.push("Decide whether the renamed duplicate-guard migration should remain pending, be removed from the migration path, or be handled by a future controlled repair.");
  }
  if (remoteCheck.pendingV2Versions.length > 0) {
    actions.push("Keep V2 reveal/audit migrations pending until migration history is reconciled.");
  }
  if (actions.length === 0) {
    actions.push("Continue with preview migration planning after env and rollback checks are complete.");
  }
  return actions;
}

function extractAffectedObjects(source) {
  const objects = [];
  const objectPatterns = [
    /\b(?:create\s+table(?:\s+if\s+not\s+exists)?|alter\s+table|drop\s+table(?:\s+if\s+exists)?|comment\s+on\s+table)\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi,
    /\bcreate\s+(?:unique\s+)?index(?:\s+if\s+not\s+exists)?\s+([a-z_][a-z0-9_]*)/gi,
  ];
  for (const pattern of objectPatterns) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      objects.push(match[1]);
    }
  }
  return [...new Set(objects)].sort();
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

function isSorted(values) {
  return values.every((value, index) => index === 0 || values[index - 1] <= value);
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
    withSupabaseCli: argv.includes("--with-supabase-cli"),
    fixturePath: readOption(argv, "--fixture"),
    migrationsDir: readOption(argv, "--migrations-dir") ?? DEFAULT_MIGRATIONS_DIR,
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

export function printSupabaseMigrationHistoryDiagnosis(summary) {
  console.log("Supabase migration history diagnosis");
  console.log(`- Local migrations: ${summary.localMigrationCount}`);
  console.log(`- Duplicate local versions: ${summary.duplicateLocalVersions.length}`);
  console.log(`- V2 reveal migration present: ${summary.hasRevealMigration}`);
  console.log(`- V2 audit migration present: ${summary.hasAuditMigration}`);
  console.log(`- Remote check attempted: ${summary.remoteCheck.attempted}`);
  console.log(`- Remote check completed: ${summary.remoteCheck.completed}`);
  console.log(`- Classification: ${summary.classification.label}`);
  for (const action of summary.recommendedNextActions) {
    console.log(`- Next action: ${action}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const summary = diagnoseSupabaseMigrationHistory(args);
  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printSupabaseMigrationHistoryDiagnosis(summary);
  }
  process.exit(summary.exitCode);
}
