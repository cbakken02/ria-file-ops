#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_MIGRATIONS_DIR = path.resolve("supabase/migrations");

const REQUIRED_REVEAL_COLUMNS = [
  "reveal_card_id",
  "owner_email",
  "user_email",
  "field_key",
  "field_label",
  "purpose",
  "expires_at",
  "one_time_use",
  "consumed_at",
  "revoked_at",
  "actual_value_was_not_shown_to_model",
];

const REQUIRED_AUDIT_COLUMNS = [
  "audit_event_id",
  "event_type",
  "event_category",
  "owner_email",
  "user_email",
  "conversation_id",
  "message_id",
  "reveal_card_id",
  "tool_name",
  "model_name",
  "status",
  "allowed",
  "reason",
  "metadata",
  "created_at",
];

const FORBIDDEN_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/g,
  /\b\d{12,19}\b/g,
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|oauth[_-]?token|encryption[_-]?key)\s*[:=]\s*['"]?[A-Za-z0-9_./+=-]{12,}/gi,
];

export function checkSupabaseMigrationReadiness(options = {}) {
  const migrationsDir = path.resolve(
    options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR,
  );
  const includeSupabaseCli = options.withSupabaseCli === true;
  const files = existsSync(migrationsDir)
    ? readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort()
    : [];
  const migrations = files.map((fileName) => {
    const filePath = path.join(migrationsDir, fileName);
    const source = readFileSync(filePath, "utf8");
    return {
      fileName,
      version: parseMigrationVersion(fileName),
      source,
    };
  });

  const duplicateVersions = findDuplicateVersions(migrations);
  const revealMigration = migrations.find((migration) =>
    migration.source.includes("data_intelligence_v2_reveal_cards"),
  );
  const auditMigration = migrations.find((migration) =>
    migration.source.includes("data_intelligence_v2_audit_events"),
  );
  const forbiddenPatternFindings = countForbiddenPatternFindings(migrations);
  const requiredColumnChecks = {
    revealCards: checkRequiredColumns(revealMigration?.source, [
      "data_intelligence_v2_reveal_cards",
      ...REQUIRED_REVEAL_COLUMNS,
    ]),
    auditEvents: checkRequiredColumns(auditMigration?.source, [
      "data_intelligence_v2_audit_events",
      ...REQUIRED_AUDIT_COLUMNS,
    ]),
  };
  const recommendations = [];

  if (duplicateVersions.length > 0) {
    recommendations.push("Resolve duplicate local migration versions before deployment.");
  }
  if (!revealMigration) {
    recommendations.push("Add the V2 reveal-card migration before deployment.");
  }
  if (!auditMigration) {
    recommendations.push("Add the V2 audit-events migration before deployment.");
  }
  if (forbiddenPatternFindings.count > 0) {
    recommendations.push("Remove forbidden sensitive-looking literals from migrations.");
  }
  if (!allColumnChecksPassed(requiredColumnChecks)) {
    recommendations.push("Review required V2 migration table/column checks.");
  }

  const supabaseCli = includeSupabaseCli
    ? summarizeSupabaseMigrationList()
    : { checked: false };
  if (supabaseCli.checked && supabaseCli.hasRemoteHistoryMismatch) {
    recommendations.push("Review remote/local Supabase migration history mismatch before applying migrations.");
  } else if (supabaseCli.checked && supabaseCli.hasPendingLocalMigrations) {
    recommendations.push("Pending local migrations detected; verify expected order before applying them.");
  }
  const passed =
    duplicateVersions.length === 0 &&
    Boolean(revealMigration) &&
    Boolean(auditMigration) &&
    forbiddenPatternFindings.count === 0 &&
    allColumnChecksPassed(requiredColumnChecks) &&
    (!supabaseCli.checked ||
      (supabaseCli.available !== false && !supabaseCli.hasRemoteHistoryMismatch));

  return {
    passed,
    migrationDirectoryPresent: existsSync(migrationsDir),
    migrationCount: migrations.length,
    duplicateVersions,
    hasRevealCardsMigration: Boolean(revealMigration),
    hasAuditEventsMigration: Boolean(auditMigration),
    v2MigrationFiles: {
      revealCards: revealMigration?.fileName,
      auditEvents: auditMigration?.fileName,
    },
    migrationOrderSane: duplicateVersions.length === 0 && isSorted(files),
    filenameCollisionCount: duplicateVersions.length,
    requiredColumnChecks,
    forbiddenPatternFindings: {
      count: forbiddenPatternFindings.count,
      files: forbiddenPatternFindings.files,
    },
    supabaseCli,
    recommendations,
  };
}

export function printMigrationReadinessSummary(summary) {
  console.log("Supabase migration readiness");
  console.log(`- Passed: ${summary.passed}`);
  console.log(`- Migration count: ${summary.migrationCount}`);
  console.log(`- Duplicate version count: ${summary.duplicateVersions.length}`);
  console.log(`- V2 reveal migration present: ${summary.hasRevealCardsMigration}`);
  console.log(`- V2 audit migration present: ${summary.hasAuditEventsMigration}`);
  console.log(`- Forbidden pattern findings: ${summary.forbiddenPatternFindings.count}`);
  for (const recommendation of summary.recommendations) {
    console.log(`- Recommendation: ${recommendation}`);
  }
}

function parseArgs(argv) {
  return {
    json: argv.includes("--json"),
    withSupabaseCli: argv.includes("--with-supabase-cli"),
    migrationsDir:
      readOption(argv, "--migrations-dir") ?? DEFAULT_MIGRATIONS_DIR,
  };
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

function countForbiddenPatternFindings(migrations) {
  const files = [];
  let count = 0;

  for (const migration of migrations) {
    let fileCount = 0;
    for (const pattern of FORBIDDEN_PATTERNS) {
      pattern.lastIndex = 0;
      const matches = migration.source.match(pattern);
      if (matches) {
        fileCount += matches.length;
      }
    }
    if (fileCount > 0) {
      files.push(migration.fileName);
      count += fileCount;
    }
  }

  return { count, files };
}

function checkRequiredColumns(source, requiredTerms) {
  const lowerSource = source?.toLowerCase() ?? "";
  return Object.fromEntries(
    requiredTerms.map((term) => [term, lowerSource.includes(term.toLowerCase())]),
  );
}

function allColumnChecksPassed(requiredColumnChecks) {
  return Object.values(requiredColumnChecks).every((checks) =>
    Object.values(checks).every(Boolean),
  );
}

function isSorted(values) {
  return values.every((value, index) => index === 0 || values[index - 1] <= value);
}

function summarizeSupabaseMigrationList() {
  const supabase = spawnSync("supabase", ["migration", "list"], {
    encoding: "utf8",
    timeout: 30000,
    env: createSafeSupabaseCliEnv(process.env),
  });

  if (supabase.error || supabase.status !== 0) {
    return {
      checked: true,
      available: false,
      status: "unavailable_or_unlinked",
    };
  }

  const parsed = parseSupabaseMigrationListOutput(supabase.stdout);
  return {
    checked: true,
    available: true,
    status: parsed.hasRemoteHistoryMismatch
      ? "remote_history_mismatch"
      : parsed.hasPendingLocalMigrations
        ? "pending_local_migrations"
      : "read_only_list_available",
    nonEmptyLineCount: parsed.nonEmptyLineCount,
    parserConfidence: parsed.parserConfidence,
    localVersionCount: parsed.localVersions.length,
    remoteVersionCount: parsed.remoteVersions.length,
    matchedVersions: parsed.matchedVersions,
    localOnlyVersions: parsed.localOnlyVersions,
    remoteOnlyVersions: parsed.remoteOnlyVersions,
    mismatchedRows: parsed.mismatchedRows,
    unpairedSameVersions: parsed.unpairedSameVersions,
    hasUnmatchedMigrations: parsed.hasUnmatchedMigrations,
    hasPendingLocalMigrations: parsed.hasPendingLocalMigrations,
    hasRemoteHistoryMismatch: parsed.hasRemoteHistoryMismatch,
    v2MigrationVersionsPendingRemote: parsed.v2MigrationVersionsPendingRemote,
  };
}

export function parseSupabaseMigrationListOutput(output) {
  const rows = [];
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (!line.includes("|")) {
      continue;
    }
    const [localRaw = "", remoteRaw = ""] = line.split("|");
    const local = localRaw.match(/\b(20\d{6,14})\b/)?.[1] ?? "";
    const remote = remoteRaw.match(/\b(20\d{6,14})\b/)?.[1] ?? "";
    if (!local && !remote) {
      continue;
    }
    rows.push({ local, remote });
  }

  const matchedVersions = [];
  const localOnlyVersions = [];
  const remoteOnlyVersions = [];
  const mismatchedRows = [];

  for (const row of rows) {
    if (row.local && row.remote && row.local === row.remote) {
      matchedVersions.push(row.local);
    } else if (row.local && row.remote) {
      mismatchedRows.push(row);
    } else if (row.local) {
      localOnlyVersions.push(row.local);
    } else if (row.remote) {
      remoteOnlyVersions.push(row.remote);
    }
  }

  const localVersions = unique(rows.map((row) => row.local).filter(Boolean));
  const remoteVersions = unique(rows.map((row) => row.remote).filter(Boolean));
  const unpairedSameVersions = localOnlyVersions.filter((version) =>
    remoteOnlyVersions.includes(version),
  );
  const hasUnmatchedMigrations =
    localOnlyVersions.length > 0 ||
    remoteOnlyVersions.length > 0 ||
    mismatchedRows.length > 0;
  const hasPendingLocalMigrations = localOnlyVersions.length > 0;
  const hasRemoteHistoryMismatch =
    remoteOnlyVersions.length > 0 ||
    mismatchedRows.length > 0 ||
    unpairedSameVersions.length > 0;
  const v2MigrationVersionsPendingRemote = ["20260429", "20260430"].filter(
    (version) => localOnlyVersions.includes(version) || !remoteVersions.includes(version),
  );
  const parserConfidence = getMigrationListParserConfidence({
    lines,
    rows,
    unpairedSameVersions,
  });

  return {
    nonEmptyLineCount: lines.length,
    parserConfidence,
    localVersions,
    remoteVersions,
    matchedVersions: unique(matchedVersions),
    localOnlyVersions: unique(localOnlyVersions),
    remoteOnlyVersions: unique(remoteOnlyVersions),
    mismatchedRows,
    unpairedSameVersions: unique(unpairedSameVersions),
    hasUnmatchedMigrations,
    hasPendingLocalMigrations,
    hasRemoteHistoryMismatch,
    v2MigrationVersionsPendingRemote,
  };
}

function getMigrationListParserConfidence({ lines, rows, unpairedSameVersions }) {
  if (rows.length === 0) {
    return "low";
  }
  const hasTableShape = lines.some((line) => line.includes("|"));
  if (!hasTableShape) {
    return "low";
  }
  if (unpairedSameVersions.length > 0) {
    return "medium";
  }
  return "high";
}

function unique(values) {
  return [...new Set(values)];
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

function readOption(argv, name) {
  const prefix = `${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const summary = checkSupabaseMigrationReadiness(args);
  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printMigrationReadinessSummary(summary);
  }
  process.exit(summary.passed ? 0 : 1);
}
