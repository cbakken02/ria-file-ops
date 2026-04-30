#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkSupabaseMigrationReadiness,
} from "./check-supabase-migration-readiness.mjs";
import {
  loadDataIntelligenceV2LocalEnv,
} from "./data-intelligence-v2-local-env.mjs";

const REQUIRED_ENV_GROUPS = [
  ["DATA_INTELLIGENCE_V2_ENABLED"],
  ["DATA_INTELLIGENCE_V2_CHAT_API_ENABLED"],
  ["DATA_INTELLIGENCE_V2_REVEAL_API_ENABLED"],
  ["DATA_INTELLIGENCE_V2_UI_ENABLED"],
  ["DATA_INTELLIGENCE_V2_ALLOW_SENSITIVE_REVEAL"],
  ["DATA_INTELLIGENCE_V2_DEV_MOCK_ENABLED"],
  ["DATA_INTELLIGENCE_V2_REVEAL_EXPIRES_MS"],
  ["DATA_INTELLIGENCE_V2_REVEAL_STORE_BACKEND"],
  ["DATA_INTELLIGENCE_V2_AUDIT_BACKEND"],
  ["DATA_INTELLIGENCE_V2_OPENAI_ENABLED"],
  ["DATA_INTELLIGENCE_V2_MODEL", "DATA_INTELLIGENCE_MODEL"],
  ["DATA_INTELLIGENCE_V2_OPENAI_API_KEY", "OPENAI_API_KEY"],
  ["DATA_INTELLIGENCE_V2_OPENAI_TIMEOUT_MS"],
  ["SUPABASE_DB_URL_POOLER", "SUPABASE_DB_URL"],
  ["APP_ENCRYPTION_KEY"],
  ["NEXTAUTH_SECRET"],
  ["NEXTAUTH_URL"],
];

const VERCEL_ENV_GROUPS = [
  ...REQUIRED_ENV_GROUPS,
  ["GOOGLE_CLIENT_ID"],
  ["GOOGLE_CLIENT_SECRET"],
  ["PERSISTENCE_BACKEND"],
];

const TEST_COMMAND_SUGGESTIONS = [
  "node --experimental-strip-types --loader ./tests/ts-alias-loader.mjs --test tests/data-intelligence-v2/deployment-readiness.test.mjs",
  "node --experimental-strip-types --loader ./tests/ts-alias-loader.mjs --test tests/data-intelligence-v2/postgres-audit-sink.test.mjs tests/data-intelligence-v2/audit-integration.test.mjs",
  "node scripts/evaluate-data-intelligence-v2.mjs --json",
  "node scripts/smoke-data-intelligence-v2.mjs",
];

export async function runDataIntelligenceV2DeploymentPreflight(options = {}) {
  await loadDataIntelligenceV2LocalEnv({ silent: true });
  const migration = checkSupabaseMigrationReadiness({
    withSupabaseCli: options.withSupabaseCli === true,
  });
  const env = collectEnvReadiness(process.env);
  const safety = collectSafetyReadiness();
  const supabase = collectSupabaseReadiness(options, migration);
  const vercel = collectVercelReadiness(options);
  const git = collectGitReadiness();
  const localChecks =
    options.runLocalChecks === true ? runLocalChecks() : { checked: false };
  const blockers = [];

  if (options.withSupabaseCli === true && supabase.migrationListAvailable === false) {
    blockers.push("Supabase migration list was unavailable or timed out.");
  } else if (
    !migration.passed &&
    !(options.withSupabaseCli === true && supabase.hasRemoteHistoryMismatch)
  ) {
    blockers.push("Local Supabase migration readiness failed.");
  }
  if (options.withSupabaseCli === true && supabase.hasRemoteHistoryMismatch) {
    blockers.push("Supabase local/remote migration history mismatch detected.");
  }
  if (
    options.withVercelCli === true &&
    Array.isArray(vercel.previewMissingEnvNames) &&
    vercel.previewMissingEnvNames.length > 0
  ) {
    blockers.push("Vercel Preview env listing is missing required env names.");
  }
  if (!safety.configDefaults.v2DisabledByDefault) {
    blockers.push("V2 is not disabled by default.");
  }
  if (!safety.configSource.devMockDisabledInProduction) {
    blockers.push("Dev mock production guard was not detected.");
  }
  if (!safety.configSource.evalOpenAiDisabledInProduction) {
    blockers.push("Eval OpenAI production guard was not detected.");
  }
  if (!safety.envExample.hasAllRequiredNames) {
    blockers.push("Required deployment env names are missing from .env.example.");
  }
  if (localChecks.checked && !localChecks.passed) {
    blockers.push("Local preflight checks failed.");
  }

  return {
    status: blockers.length === 0 ? "ready_for_preview_preflight" : "blocked",
    passed: blockers.length === 0,
    blockers,
    git,
    supabase,
    vercel,
    env,
    safety,
    migration,
    localChecks,
    suggestedCommands: TEST_COMMAND_SUGGESTIONS,
  };
}

export function printDeploymentPreflightSummary(summary) {
  console.log("V2 deployment preflight");
  console.log(`- Status: ${summary.status}`);
  console.log(`- Blockers: ${summary.blockers.length}`);
  console.log(`- Git dirty: ${summary.git.workingTreeDirty}`);
  console.log(`- Migration readiness: ${summary.migration.passed}`);
  console.log(`- Supabase CLI present: ${summary.supabase.cliPresent}`);
  console.log(`- Vercel linked locally: ${summary.vercel.projectLinked}`);
  console.log(`- Required env names listed in .env.example: ${summary.safety.envExample.hasAllRequiredNames}`);
}

function parseArgs(argv) {
  return {
    json: argv.includes("--json"),
    withSupabaseCli: argv.includes("--with-supabase-cli"),
    withVercelCli: argv.includes("--with-vercel-cli"),
    runLocalChecks: argv.includes("--run-local-checks"),
  };
}

function collectGitReadiness() {
  const branch = safeCommand("git", ["branch", "--show-current"]);
  const status = safeCommand("git", ["status", "--porcelain"]);
  const staged = safeCommand("git", ["diff", "--cached", "--name-only"]);
  const remotes = safeCommand("git", ["remote"]);

  return {
    gitCliPresent: commandExists("git"),
    currentBranch: branch.ok ? branch.stdout.trim() || null : null,
    workingTreeDirty: status.ok ? status.stdout.trim().length > 0 : null,
    stagedChanges: staged.ok ? staged.stdout.trim().length > 0 : null,
    githubRemotePresent: remotes.ok
      ? remotes.stdout.split(/\r?\n/).some((remote) => remote.trim() === "origin")
      : false,
  };
}

function collectSupabaseReadiness(options, migration) {
  const cliPresent = commandExists("supabase");
  const linkedProjectMetadataPresent =
    existsSync("supabase/.temp/project-ref") ||
    existsSync("supabase/.temp/linked-project.json");
  const cliStatus = migration.supabaseCli;

  return {
    cliPresent,
    projectLinkedMetadataPresent: linkedProjectMetadataPresent,
    projectLinked: linkedProjectMetadataPresent,
    migrationListChecked: options.withSupabaseCli === true,
    migrationListAvailable: cliStatus?.checked ? cliStatus.available : null,
    migrationListStatus: cliStatus?.checked ? cliStatus.status : null,
    localOnlyMigrationVersions: cliStatus?.localOnlyVersions ?? [],
    remoteOnlyMigrationVersions: cliStatus?.remoteOnlyVersions ?? [],
    unpairedSameVersions: cliStatus?.unpairedSameVersions ?? [],
    v2MigrationVersionsPendingRemote:
      cliStatus?.v2MigrationVersionsPendingRemote ?? [],
    hasUnmatchedMigrations: Boolean(cliStatus?.hasUnmatchedMigrations),
    hasPendingLocalMigrations: Boolean(cliStatus?.hasPendingLocalMigrations),
    hasRemoteHistoryMismatch: Boolean(cliStatus?.hasRemoteHistoryMismatch),
    parserConfidence: cliStatus?.parserConfidence ?? null,
    localV2RevealMigrationPresent: migrationFilesContain(
      "data_intelligence_v2_reveal_cards",
    ),
    localV2AuditMigrationPresent: migrationFilesContain(
      "data_intelligence_v2_audit_events",
    ),
  };
}

function collectVercelReadiness(options) {
  const globalCliPresent = commandExists("vercel");
  const npxPresent = commandExists("npx");
  const projectJsonPresent = existsSync(".vercel/project.json");
  const projectJson = readVercelProjectMetadata();
  const cliCommand =
    options.withVercelCli === true
      ? getVercelCliCommand({ globalCliPresent, npxPresent })
      : null;
  const version = cliCommand
    ? safeCommand(cliCommand.command, [...cliCommand.args, "--version"], {
        timeout: 30000,
      })
    : undefined;
  const whoami = cliCommand
    ? safeCommand(cliCommand.command, [...cliCommand.args, "whoami"], {
        timeout: 30000,
      })
    : undefined;
  const envList = cliCommand
    ? safeCommand(cliCommand.command, [...cliCommand.args, "env", "ls"], {
        timeout: 30000,
      })
    : undefined;
  const envNames = envList?.ok
    ? summarizeVercelEnvNames(envList.stdout)
    : {
        envNamesListable: envList ? false : null,
        previewMissing: null,
        productionMissing: null,
        detectedRequiredNameCount: null,
      };

  return {
    cliPresent: globalCliPresent,
    cliAvailableViaNpx: options.withVercelCli === true ? Boolean(cliCommand) : null,
    cliMode: cliCommand?.mode ?? (globalCliPresent ? "global" : null),
    projectJsonPresent,
    projectLinked: projectJsonPresent,
    projectName: projectJson.projectName,
    projectIdsPresent: projectJson.projectIdsPresent,
    cliVersionChecked: options.withVercelCli === true,
    cliVersionAvailable: version ? version.ok : null,
    authChecked: Boolean(whoami),
    authConfigured: whoami ? whoami.ok : null,
    envNamesListChecked: Boolean(envList),
    envNamesListable: envNames.envNamesListable,
    detectedRequiredEnvNameCount: envNames.detectedRequiredNameCount,
    previewMissingEnvNames: envNames.previewMissing,
    productionMissingEnvNames: envNames.productionMissing,
  };
}

function getVercelCliCommand({ globalCliPresent, npxPresent }) {
  if (globalCliPresent) {
    return { command: "vercel", args: [], mode: "global" };
  }
  if (npxPresent) {
    return { command: "npx", args: ["--yes", "vercel"], mode: "npx" };
  }
  return null;
}

function readVercelProjectMetadata() {
  const source = readOptionalFile(".vercel/project.json");
  if (!source) {
    return { projectName: null, projectIdsPresent: false };
  }
  try {
    const parsed = JSON.parse(source);
    return {
      projectName:
        typeof parsed.projectName === "string" && parsed.projectName.trim()
          ? parsed.projectName
          : null,
      projectIdsPresent: Boolean(parsed.projectId || parsed.orgId),
    };
  } catch {
    return { projectName: null, projectIdsPresent: false };
  }
}

function summarizeVercelEnvNames(output) {
  const detected = new Map();
  for (const group of VERCEL_ENV_GROUPS) {
    for (const name of group) {
      detected.set(name, {
        name,
        present: false,
        preview: false,
        production: false,
        development: false,
      });
    }
  }

  for (const line of output.split(/\r?\n/)) {
    for (const name of detected.keys()) {
      if (!line.includes(name)) {
        continue;
      }
      const entry = detected.get(name);
      entry.present = true;
      entry.preview ||= /Preview/i.test(line);
      entry.production ||= /Production/i.test(line);
      entry.development ||= /Development/i.test(line);
    }
  }

  return {
    envNamesListable: true,
    detectedRequiredNameCount: [...detected.values()].filter((entry) => entry.present).length,
    previewMissing: missingEnvGroupsForTarget(detected, "preview"),
    productionMissing: missingEnvGroupsForTarget(detected, "production"),
  };
}

function missingEnvGroupsForTarget(detected, target) {
  return VERCEL_ENV_GROUPS.filter((group) =>
    !group.some((name) => detected.get(name)?.[target]),
  ).map((group) => group.join(" or "));
}

function collectEnvReadiness(env) {
  const groups = REQUIRED_ENV_GROUPS.map((names) => ({
    names,
    presentInProcessEnv: names.some((name) => hasEnvValue(env, name)),
    listedInEnvExample: names.some((name) => envExampleHasName(name)),
  }));

  return {
    requiredGroups: groups,
    missingFromLocalEnv: groups
      .filter((group) => !group.presentInProcessEnv)
      .map((group) => group.names.join(" or ")),
    missingFromEnvExample: groups
      .filter((group) => !group.listedInEnvExample)
      .map((group) => group.names.join(" or ")),
  };
}

function collectSafetyReadiness() {
  const configSource = readOptionalFile("lib/data-intelligence-v2/config.ts");
  const envExample = readOptionalFile(".env.example");

  return {
    configDefaults: {
      v2DisabledByDefault: envExampleHasAssignment(envExample, "DATA_INTELLIGENCE_V2_ENABLED", "false"),
      chatApiDisabledByDefault: envExampleHasAssignment(envExample, "DATA_INTELLIGENCE_V2_CHAT_API_ENABLED", "false"),
      revealApiDisabledByDefault: envExampleHasAssignment(envExample, "DATA_INTELLIGENCE_V2_REVEAL_API_ENABLED", "false"),
      uiDisabledByDefault: envExampleHasAssignment(envExample, "DATA_INTELLIGENCE_V2_UI_ENABLED", "false"),
    },
    configSource: {
      devMockDisabledInProduction:
        configSource.includes("DATA_INTELLIGENCE_V2_DEV_MOCK_ENABLED") &&
        configSource.includes('env.NODE_ENV !== "production"'),
      evalOpenAiDisabledInProduction:
        configSource.includes("DATA_INTELLIGENCE_V2_EVAL_OPENAI_ENABLED") &&
        configSource.includes('env.NODE_ENV !== "production"'),
      revealStoreBackendPresent:
        configSource.includes("DATA_INTELLIGENCE_V2_REVEAL_STORE_BACKEND"),
      auditBackendPresent:
        configSource.includes("DATA_INTELLIGENCE_V2_AUDIT_BACKEND"),
    },
    envExample: {
      hasAllRequiredNames: REQUIRED_ENV_GROUPS.every((group) =>
        group.some((name) => envExampleHasName(name)),
      ),
    },
  };
}

function runLocalChecks() {
  const evalResult = safeCommand("node", [
    "scripts/evaluate-data-intelligence-v2.mjs",
    "--json",
  ], { timeout: 120000 });
  const smokeResult = safeCommand("node", [
    "scripts/smoke-data-intelligence-v2.mjs",
  ], { timeout: 120000 });

  return {
    checked: true,
    mockEvalPassed: evalResult.ok,
    smokePassed: smokeResult.ok,
    passed: evalResult.ok && smokeResult.ok,
  };
}

function safeCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: options.timeout ?? 10000,
  });
  return {
    ok: !result.error && result.status === 0,
    stdout: result.stdout ?? "",
  };
}

function commandExists(command) {
  return safeCommand("sh", ["-c", `command -v ${shellQuote(command)} >/dev/null 2>&1`]).ok;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function hasEnvValue(env, name) {
  return typeof env[name] === "string" && env[name].trim().length > 0;
}

function envExampleHasName(name) {
  return new RegExp(`^${escapeRegExp(name)}\\s*=`, "m").test(
    readOptionalFile(".env.example"),
  );
}

function envExampleHasAssignment(source, name, expectedValue) {
  return new RegExp(
    `^${escapeRegExp(name)}\\s*=\\s*${escapeRegExp(expectedValue)}\\s*$`,
    "m",
  ).test(source);
}

function readOptionalFile(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function migrationFilesContain(term) {
  const migrationsDir = path.resolve("supabase/migrations");
  if (!existsSync(migrationsDir)) {
    return false;
  }
  return readdirSyncSafe(migrationsDir).some((fileName) => {
    if (!fileName.endsWith(".sql")) {
      return false;
    }
    return readOptionalFile(path.join(migrationsDir, fileName)).includes(term);
  });
}

function readdirSyncSafe(directory) {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const summary = await runDataIntelligenceV2DeploymentPreflight(args);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    printDeploymentPreflightSummary(summary);
  }
  process.exitCode = summary.passed ? 0 : 1;
}
