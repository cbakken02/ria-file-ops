#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadDataIntelligenceV2LocalEnv,
} from "./data-intelligence-v2-local-env.mjs";

const TARGET = "preview";

export const V2_PREVIEW_FIXED_ENV_VALUES = {
  DATA_INTELLIGENCE_V2_ENABLED: "true",
  DATA_INTELLIGENCE_V2_CHAT_API_ENABLED: "true",
  DATA_INTELLIGENCE_V2_REVEAL_API_ENABLED: "true",
  DATA_INTELLIGENCE_V2_UI_ENABLED: "true",
  DATA_INTELLIGENCE_V2_ALLOW_SENSITIVE_REVEAL: "true",
  DATA_INTELLIGENCE_V2_DEV_MOCK_ENABLED: "false",
  DATA_INTELLIGENCE_V2_REVEAL_STORE_BACKEND: "postgres",
  DATA_INTELLIGENCE_V2_AUDIT_BACKEND: "postgres",
  DATA_INTELLIGENCE_V2_REVEAL_EXPIRES_MS: "600000",
  DATA_INTELLIGENCE_V2_OPENAI_ENABLED: "true",
  DATA_INTELLIGENCE_V2_MODEL: "gpt-5.5",
  DATA_INTELLIGENCE_V2_OPENAI_TIMEOUT_MS: "30000",
};

const V2_REQUIRED_GROUPS = [
  ["DATA_INTELLIGENCE_V2_ENABLED"],
  ["DATA_INTELLIGENCE_V2_CHAT_API_ENABLED"],
  ["DATA_INTELLIGENCE_V2_REVEAL_API_ENABLED"],
  ["DATA_INTELLIGENCE_V2_UI_ENABLED"],
  ["DATA_INTELLIGENCE_V2_ALLOW_SENSITIVE_REVEAL"],
  ["DATA_INTELLIGENCE_V2_DEV_MOCK_ENABLED"],
  ["DATA_INTELLIGENCE_V2_REVEAL_STORE_BACKEND"],
  ["DATA_INTELLIGENCE_V2_AUDIT_BACKEND"],
  ["DATA_INTELLIGENCE_V2_REVEAL_EXPIRES_MS"],
  ["DATA_INTELLIGENCE_V2_OPENAI_ENABLED"],
  ["DATA_INTELLIGENCE_V2_MODEL", "DATA_INTELLIGENCE_MODEL"],
  ["DATA_INTELLIGENCE_V2_OPENAI_API_KEY", "OPENAI_API_KEY"],
  ["DATA_INTELLIGENCE_V2_OPENAI_TIMEOUT_MS"],
];

const CORE_REQUIRED_GROUPS = [
  ["PERSISTENCE_BACKEND"],
  ["SUPABASE_DB_URL_POOLER", "SUPABASE_DB_URL"],
  ["APP_ENCRYPTION_KEY"],
  ["NEXTAUTH_SECRET"],
  ["NEXTAUTH_URL"],
  ["GOOGLE_CLIENT_ID"],
  ["GOOGLE_CLIENT_SECRET"],
];

const OPTIONAL_GROUPS = [
  ["DATA_INTELLIGENCE_V2_OPENAI_MAX_OUTPUT_TOKENS"],
  ["OPENAI_API_KEY"],
  ["AI_PRIMARY_PARSER_MODEL"],
  ["AI_PRIMARY_PARSER"],
  ["AI_PRIMARY_PARSER_TIMEOUT_MS"],
];

const ALL_GROUPS = [...V2_REQUIRED_GROUPS, ...CORE_REQUIRED_GROUPS, ...OPTIONAL_GROUPS];
const ALL_NAMES = [...new Set(ALL_GROUPS.flat())];

export async function configureVercelV2PreviewEnv(options = {}) {
  const target = options.target ?? TARGET;
  const applyRequested = options.applyPreview === true;
  const dryRun = options.dryRun === true || !applyRequested;
  const mode = applyRequested && !dryRun ? "apply" : "dry_run";
  const blockers = [];
  const actions = [];

  if (target !== TARGET) {
    blockers.push("Only the preview target is supported by this script.");
  }

  await loadDataIntelligenceV2LocalEnv({ silent: true });
  const project = readVercelProjectMetadata();
  const cli = getVercelCli(options);
  const envList = readVercelEnvList({ options, cli });
  const previewGitBranch = options.previewBranch ?? getCurrentGitBranch();
  const plan = buildPreviewPlan({
    envEntries: envList.entries,
    envNamesListable: envList.envNamesListable,
    env: process.env,
  });

  if (!project.projectLinked) {
    blockers.push("Local Vercel project metadata is missing.");
  }
  if (options.withVercelCli && !cli.available) {
    blockers.push("Vercel CLI is not available through global vercel or npx.");
  }
  if (applyRequested && !cli.available) {
    blockers.push("Vercel CLI is required for Preview env apply.");
  }
  if (options.withVercelCli && !envList.envNamesListable) {
    blockers.push("Vercel env names could not be listed safely.");
  }
  if (plan.coreMissingNames.length > 0) {
    blockers.push("Core app/database/auth env names are missing and must be configured separately.");
  }
  const confirmation = {
    targetIsPreview:
      process.env.CONFIRM_VERCEL_TARGET_IS_PREVIEW === "true",
    previewEnvApply:
      process.env.CONFIRM_DATA_INTELLIGENCE_V2_VERCEL_PREVIEW_ENV_APPLY ===
      "true",
    allowSetOpenAiKeyFromLocal:
      options.allowSetOpenAiKeyFromLocal === true ||
      process.env.ALLOW_SET_OPENAI_KEY_FROM_LOCAL_FOR_VERCEL_PREVIEW === "true",
  };

  if (
    plan.openAiKeyMissing &&
    !(plan.localOpenAiKeyAvailable && confirmation.allowSetOpenAiKeyFromLocal)
  ) {
    blockers.push("Preview OpenAI key group is missing and local-key apply was not explicitly allowed.");
  }

  if (applyRequested) {
    if (!confirmation.targetIsPreview) {
      blockers.push("CONFIRM_VERCEL_TARGET_IS_PREVIEW");
    }
    if (!confirmation.previewEnvApply) {
      blockers.push("CONFIRM_DATA_INTELLIGENCE_V2_VERCEL_PREVIEW_ENV_APPLY");
    }
  }

  let applyResult = {
    attempted: false,
    completed: false,
    addedNames: [],
    skippedExistingNames: [],
    failedNames: [],
  };

  if (applyRequested && blockers.length === 0) {
    applyResult = applyPreviewEnvNames({
      cli,
      plannedAdds: plan.plannedAdds,
      env: process.env,
      confirmation,
      dryRun,
      previewGitBranch,
    });
    actions.push(...applyResult.actions);
    if (applyResult.failedNames.length > 0) {
      blockers.push("One or more Vercel Preview env updates failed.");
    }
  }

  const exitCode = target !== TARGET
    ? 1
    : options.withVercelCli && !envList.envNamesListable
      ? 2
      : blockers.length > 0
        ? 1
        : 0;

  return {
    target,
    mode,
    projectLinked: project.projectLinked,
    projectName: project.projectName,
    projectIdsPresent: project.projectIdsPresent,
    previewGitBranch,
    envScope: previewGitBranch ? "preview_git_branch" : "preview",
    cli: {
      globalAvailable: cli.globalAvailable,
      npxAvailable: cli.npxAvailable,
      available: cli.available,
      mode: cli.mode,
    },
    envNamesListable: envList.envNamesListable,
    previewPresentNames: plan.previewPresentNames,
    previewMissingNames: plan.previewMissingNames,
    v2SpecificMissingNames: plan.v2SpecificMissingNames,
    v2NamesPlanned: plan.plannedAdds.map((item) => item.name),
    v2NamesAdded: applyResult.addedNames,
    v2NamesAddedCount: applyResult.addedNames.length,
    coreMissingNames: plan.coreMissingNames,
    databaseAuthEncryptionMissingNames: plan.databaseAuthEncryptionMissingNames,
    openAiKeyPresentInPreview: !plan.openAiKeyMissing,
    openAiKeyPresentLocally: plan.localOpenAiKeyAvailable,
    openAiKeyAdded: applyResult.addedNames.includes(
      "DATA_INTELLIGENCE_V2_OPENAI_API_KEY",
    ),
    confirmation,
    blockers: unique(blockers),
    actions,
    safety: {
      noDeploy: true,
      noProductionEnvModification: true,
      noValuesPrinted: true,
    },
    exitCode,
  };
}

export function buildPreviewPlan({ envEntries, envNamesListable, env = process.env }) {
  const previewPresentNames = envNamesListable
    ? ALL_NAMES.filter((name) => envEntries.get(name)?.preview)
    : [];
  const previewMissingNames = envNamesListable
    ? missingGroupsForTarget(envEntries, V2_REQUIRED_GROUPS, "preview")
    : V2_REQUIRED_GROUPS.map(formatGroup);
  const coreMissingNames = envNamesListable
    ? missingGroupsForTarget(envEntries, CORE_REQUIRED_GROUPS, "preview")
    : CORE_REQUIRED_GROUPS.map(formatGroup);
  const databaseAuthEncryptionMissingNames = coreMissingNames.filter((name) =>
    /SUPABASE_DB_URL|APP_ENCRYPTION_KEY|NEXTAUTH|GOOGLE_CLIENT/.test(name),
  );
  const v2SpecificMissingNames = previewMissingNames.filter((name) =>
    name.startsWith("DATA_INTELLIGENCE_V2_"),
  );
  const openAiKeyMissing = previewMissingNames.includes(
    "DATA_INTELLIGENCE_V2_OPENAI_API_KEY or OPENAI_API_KEY",
  );
  const localOpenAiKeyName = hasEnvValue(env, "DATA_INTELLIGENCE_V2_OPENAI_API_KEY")
    ? "DATA_INTELLIGENCE_V2_OPENAI_API_KEY"
    : hasEnvValue(env, "OPENAI_API_KEY")
      ? "OPENAI_API_KEY"
      : null;
  const canSetOpenAiKeyFromLocal = Boolean(localOpenAiKeyName);
  const plannedAdds = [];

  for (const missing of previewMissingNames) {
    if (missing === "DATA_INTELLIGENCE_V2_MODEL or DATA_INTELLIGENCE_MODEL") {
      plannedAdds.push({
        name: "DATA_INTELLIGENCE_V2_MODEL",
        source: "fixed",
      });
      continue;
    }

    if (missing === "DATA_INTELLIGENCE_V2_OPENAI_API_KEY or OPENAI_API_KEY") {
      if (canSetOpenAiKeyFromLocal) {
        plannedAdds.push({
          name: "DATA_INTELLIGENCE_V2_OPENAI_API_KEY",
          source: "local_secret",
          sourceName: localOpenAiKeyName,
        });
      }
      continue;
    }

    if (Object.hasOwn(V2_PREVIEW_FIXED_ENV_VALUES, missing)) {
      plannedAdds.push({ name: missing, source: "fixed" });
    }
  }

  return {
    previewPresentNames,
    previewMissingNames,
    coreMissingNames,
    databaseAuthEncryptionMissingNames,
    v2SpecificMissingNames,
    openAiKeyMissing,
    localOpenAiKeyAvailable: canSetOpenAiKeyFromLocal,
    canSetOpenAiKeyFromLocal,
    plannedAdds,
  };
}

export function parseVercelEnvListOutput(output, names = ALL_NAMES) {
  const entries = new Map(
    names.map((name) => [
      name,
      {
        name,
        present: false,
        preview: false,
        production: false,
        development: false,
      },
    ]),
  );

  for (const line of String(output ?? "").split(/\r?\n/)) {
    for (const name of names) {
      if (!line.includes(name)) {
        continue;
      }
      const entry = entries.get(name);
      entry.present = true;
      entry.preview ||= /Preview/i.test(line);
      entry.production ||= /Production/i.test(line);
      entry.development ||= /Development/i.test(line);
    }
  }

  return entries;
}

function applyPreviewEnvNames({
  cli,
  plannedAdds,
  env,
  confirmation,
  dryRun,
  previewGitBranch,
}) {
  const result = {
    attempted: true,
    completed: false,
    addedNames: [],
    skippedExistingNames: [],
    failedNames: [],
    actions: [],
  };

  if (dryRun) {
    result.completed = true;
    return result;
  }

  for (const item of plannedAdds) {
    if (item.source === "local_secret" && !confirmation.allowSetOpenAiKeyFromLocal) {
      result.failedNames.push(item.name);
      result.actions.push(`missing-allow-local-secret:${item.name}`);
      break;
    }

    const value = item.source === "local_secret"
      ? env[item.sourceName]
      : V2_PREVIEW_FIXED_ENV_VALUES[item.name];
    if (!hasEnvValue({ [item.name]: value }, item.name)) {
      result.failedNames.push(item.name);
      result.actions.push(`missing-value:${item.name}`);
      break;
    }

    const addArgs = [...cli.args, "env", "add", item.name, TARGET];
    if (previewGitBranch) {
      addArgs.push(previewGitBranch);
    }
    addArgs.push("--yes");
    const spawnOptions = {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 30000,
    };

    if (item.source === "local_secret") {
      spawnOptions.input = `${value}\n`;
    } else {
      addArgs.push("--value", value);
    }

    const add = spawnSync(cli.command, addArgs, spawnOptions);
    const output = `${add.stdout ?? ""}\n${add.stderr ?? ""}`;

    if (add.status === 0 || /already exists/i.test(output)) {
      if (/already exists/i.test(output)) {
        result.skippedExistingNames.push(item.name);
      } else {
        result.addedNames.push(item.name);
      }
      result.actions.push(`preview-env-present:${item.name}`);
      continue;
    }

    result.failedNames.push(item.name);
    result.actions.push(`preview-env-failed:${item.name}`);
    break;
  }

  result.completed = result.failedNames.length === 0;
  return result;
}

function readVercelEnvList({ options, cli }) {
  if (options.fixtureEnvListPath) {
    const source = readFileSync(path.resolve(options.fixtureEnvListPath), "utf8");
    return {
      envNamesListable: true,
      entries: parseVercelEnvListOutput(source),
    };
  }

  if (!options.withVercelCli) {
    return {
      envNamesListable: false,
      entries: parseVercelEnvListOutput(""),
    };
  }

  if (!cli.available) {
    return {
      envNamesListable: false,
      entries: parseVercelEnvListOutput(""),
    };
  }

  const list = spawnSync(cli.command, [...cli.args, "env", "ls"], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 30000,
  });
  return {
    envNamesListable: list.status === 0,
    entries: list.status === 0
      ? parseVercelEnvListOutput(list.stdout)
      : parseVercelEnvListOutput(""),
  };
}

function getVercelCli(options) {
  const globalAvailable = commandExists("vercel");
  const npxAvailable = commandExists("npx");

  if (!options.withVercelCli) {
    return {
      globalAvailable,
      npxAvailable,
      available: false,
      command: null,
      args: [],
      mode: null,
    };
  }

  if (globalAvailable) {
    return {
      globalAvailable,
      npxAvailable,
      available: true,
      command: "vercel",
      args: [],
      mode: "global",
    };
  }

  if (npxAvailable) {
    return {
      globalAvailable,
      npxAvailable,
      available: true,
      command: "npx",
      args: ["--yes", "vercel"],
      mode: "npx",
    };
  }

  return {
    globalAvailable,
    npxAvailable,
    available: false,
    command: null,
    args: [],
    mode: null,
  };
}

function readVercelProjectMetadata() {
  const filePath = ".vercel/project.json";
  if (!existsSync(filePath)) {
    return {
      projectLinked: false,
      projectName: null,
      projectIdsPresent: false,
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return {
      projectLinked: true,
      projectName:
        typeof parsed.projectName === "string" && parsed.projectName.trim()
          ? parsed.projectName
          : null,
      projectIdsPresent: Boolean(parsed.projectId || parsed.orgId),
    };
  } catch {
    return {
      projectLinked: true,
      projectName: null,
      projectIdsPresent: false,
    };
  }
}

function missingGroupsForTarget(entries, groups, target) {
  return groups
    .filter((group) => !group.some((name) => entries.get(name)?.[target]))
    .map(formatGroup);
}

function formatGroup(group) {
  return group.join(" or ");
}

function hasEnvValue(env, name) {
  return typeof env[name] === "string" && env[name].trim().length > 0;
}

function commandExists(command) {
  const result = spawnSync("sh", [
    "-c",
    `command -v '${String(command).replaceAll("'", "'\\''")}' >/dev/null 2>&1`,
  ]);
  return !result.error && result.status === 0;
}

function getCurrentGitBranch() {
  const branch = spawnSync("git", ["branch", "--show-current"], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 5000,
  });
  return branch.status === 0 && branch.stdout.trim()
    ? branch.stdout.trim()
    : null;
}

function unique(values) {
  return [...new Set(values)];
}

function parseArgs(argv) {
  return {
    json: argv.includes("--json"),
    applyPreview: argv.includes("--apply-preview"),
    dryRun: argv.includes("--dry-run"),
    withVercelCli: argv.includes("--with-vercel-cli"),
    allowSetOpenAiKeyFromLocal:
      argv.includes("--allow-set-openai-key-from-local"),
    target: readOption(argv, "--target") ?? TARGET,
    previewBranch: readOption(argv, "--preview-branch"),
    fixtureEnvListPath: readOption(argv, "--fixture-env-list"),
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

function printSummary(summary) {
  console.log("Vercel V2 Preview env plan");
  console.log(`- Target: ${summary.target}`);
  console.log(`- Mode: ${summary.mode}`);
  console.log(`- Project linked: ${summary.projectLinked}`);
  console.log(`- Env names listable: ${summary.envNamesListable}`);
  console.log(`- V2 missing names: ${summary.v2SpecificMissingNames.length}`);
  console.log(`- Core missing names: ${summary.coreMissingNames.length}`);
  console.log(`- Planned V2 adds: ${summary.v2NamesPlanned.length}`);
  console.log(`- Blockers: ${summary.blockers.length}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const summary = await configureVercelV2PreviewEnv(args);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    printSummary(summary);
  }
  process.exitCode = summary.exitCode;
}
