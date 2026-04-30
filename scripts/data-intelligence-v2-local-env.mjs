import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const REQUIRED_V2_OPENAI_EVAL_ENV_NAMES = [
  "DATA_INTELLIGENCE_V2_OPENAI_ENABLED",
  "DATA_INTELLIGENCE_V2_EVAL_OPENAI_ENABLED",
  "DATA_INTELLIGENCE_V2_EVAL_ALLOW_NETWORK",
  "DATA_INTELLIGENCE_V2_OPENAI_API_KEY or OPENAI_API_KEY",
  "DATA_INTELLIGENCE_V2_MODEL or DATA_INTELLIGENCE_MODEL",
];

export const OPTIONAL_V2_OPENAI_EVAL_ENV_NAMES = [
  "DATA_INTELLIGENCE_V2_ENABLED",
  "DATA_INTELLIGENCE_V2_OPENAI_BASE_URL",
  "DATA_INTELLIGENCE_V2_OPENAI_TIMEOUT_MS",
  "DATA_INTELLIGENCE_V2_OPENAI_MAX_OUTPUT_TOKENS",
  "AI_PRIMARY_PARSER_MODEL",
];

const LOCAL_ENV_FILE_NAMES = [
  ".env.development.local",
  ".env.local",
  ".env.development",
  ".env",
];

const REPORT_ENV_NAMES = [
  "NODE_ENV",
  "DATA_INTELLIGENCE_V2_OPENAI_ENABLED",
  "DATA_INTELLIGENCE_V2_EVAL_OPENAI_ENABLED",
  "DATA_INTELLIGENCE_V2_EVAL_ALLOW_NETWORK",
  "DATA_INTELLIGENCE_V2_OPENAI_API_KEY",
  "OPENAI_API_KEY",
  "DATA_INTELLIGENCE_V2_MODEL",
  "DATA_INTELLIGENCE_MODEL",
  "AI_PRIMARY_PARSER_MODEL",
  ...OPTIONAL_V2_OPENAI_EVAL_ENV_NAMES,
];

export async function loadDataIntelligenceV2LocalEnv(options = {}) {
  const projectDir = path.resolve(options.projectDir ?? process.cwd());
  const silent = options.silent !== false;
  const overrideExisting = options.overrideExisting === true;
  const envFiles = readLocalEnvFiles(projectDir);
  let nextEnvLoaded = false;

  try {
    const nextEnv = await import("@next/env");
    if (typeof nextEnv.loadEnvConfig === "function") {
      const before = snapshotProcessEnv();
      const logger = silent ? { info() {}, error() {} } : undefined;
      nextEnv.loadEnvConfig(
        projectDir,
        process.env.NODE_ENV !== "production",
        logger,
        true,
      );
      nextEnvLoaded = true;

      if (!overrideExisting) {
        restoreExistingEnvValues(before);
      }
    }
  } catch {
    nextEnvLoaded = false;
  }

  applyParsedEnvFiles(envFiles, { overrideExisting });

  const presenceReport = getDataIntelligenceV2EnvPresenceReport(process.env);
  return {
    loader: nextEnvLoaded ? "@next/env+safe-fallback" : "safe-fallback",
    loadedFileNames: envFiles.map((file) => file.fileName),
    expectedVariableNamesPresent: REPORT_ENV_NAMES.filter((name) =>
      hasEnvValue(process.env, name),
    ),
    presenceReport,
  };
}

export function getDataIntelligenceV2EnvPresenceReport(env = process.env) {
  const hasV2SpecificOpenAiApiKey = hasEnvValue(
    env,
    "DATA_INTELLIGENCE_V2_OPENAI_API_KEY",
  );
  const hasSharedOpenAiApiKey = hasEnvValue(env, "OPENAI_API_KEY");
  const hasOpenAiApiKey = hasV2SpecificOpenAiApiKey || hasSharedOpenAiApiKey;
  const hasSharedDataIntelligenceModel = hasEnvValue(
    env,
    "DATA_INTELLIGENCE_MODEL",
  );
  const hasV2SpecificModel = hasEnvValue(env, "DATA_INTELLIGENCE_V2_MODEL");
  const hasV2Model = hasV2SpecificModel || hasSharedDataIntelligenceModel;
  const hasParserOnlyModel = hasEnvValue(env, "AI_PRIMARY_PARSER_MODEL") && !hasV2Model;
  const nodeEnvProduction = env.NODE_ENV === "production";
  const v2OpenAiEnabled = env.DATA_INTELLIGENCE_V2_OPENAI_ENABLED === "true";
  const evalOpenAiEnabled =
    env.DATA_INTELLIGENCE_V2_EVAL_OPENAI_ENABLED === "true";
  const evalAllowNetwork =
    env.DATA_INTELLIGENCE_V2_EVAL_ALLOW_NETWORK === "true";
  const missing = [];

  if (nodeEnvProduction) {
    missing.push("NODE_ENV must not be production");
  }
  if (!v2OpenAiEnabled) {
    missing.push("DATA_INTELLIGENCE_V2_OPENAI_ENABLED");
  }
  if (!evalOpenAiEnabled) {
    missing.push("DATA_INTELLIGENCE_V2_EVAL_OPENAI_ENABLED");
  }
  if (!evalAllowNetwork) {
    missing.push("DATA_INTELLIGENCE_V2_EVAL_ALLOW_NETWORK");
  }
  if (!hasOpenAiApiKey) {
    missing.push("DATA_INTELLIGENCE_V2_OPENAI_API_KEY or OPENAI_API_KEY");
  }
  if (!hasV2Model) {
    missing.push("DATA_INTELLIGENCE_V2_MODEL or DATA_INTELLIGENCE_MODEL");
  }

  return {
    nodeEnvProduction,
    hasOpenAiApiKey,
    hasV2SpecificOpenAiApiKey,
    hasSharedOpenAiApiKey,
    hasV2Model,
    hasSharedDataIntelligenceModel,
    hasParserOnlyModel,
    v2OpenAiEnabled,
    evalOpenAiEnabled,
    evalAllowNetwork,
    canRunOpenAiFakeDataEval:
      !nodeEnvProduction &&
      hasOpenAiApiKey &&
      hasV2Model &&
      v2OpenAiEnabled &&
      evalOpenAiEnabled &&
      evalAllowNetwork,
    missing,
  };
}

function readLocalEnvFiles(projectDir) {
  return LOCAL_ENV_FILE_NAMES.flatMap((fileName) => {
    const filePath = path.join(projectDir, fileName);
    if (!existsSync(filePath)) {
      return [];
    }

    return [
      {
        fileName,
        parsed: parseEnvFile(readFileSync(filePath, "utf8")),
      },
    ];
  });
}

function parseEnvFile(source) {
  const parsed = {};

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const equalsIndex = normalized.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const key = normalized.slice(0, equalsIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }

    parsed[key] = parseEnvValue(normalized.slice(equalsIndex + 1).trim());
  }

  return parsed;
}

function parseEnvValue(rawValue) {
  if (
    (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
    (rawValue.startsWith("'") && rawValue.endsWith("'"))
  ) {
    const inner = rawValue.slice(1, -1);
    return rawValue.startsWith('"')
      ? inner.replace(/\\n/g, "\n").replace(/\\r/g, "\r")
      : inner;
  }

  const hashIndex = rawValue.indexOf(" #");
  return (hashIndex >= 0 ? rawValue.slice(0, hashIndex) : rawValue).trim();
}

function applyParsedEnvFiles(envFiles, options) {
  const loadedKeys = new Set();

  for (const envFile of envFiles) {
    for (const [key, value] of Object.entries(envFile.parsed)) {
      if (loadedKeys.has(key)) {
        continue;
      }

      if (options.overrideExisting || process.env[key] === undefined) {
        process.env[key] = value;
      }
      loadedKeys.add(key);
    }
  }
}

function snapshotProcessEnv() {
  return Object.fromEntries(
    Object.entries(process.env).map(([key, value]) => [key, value]),
  );
}

function restoreExistingEnvValues(before) {
  for (const [key, value] of Object.entries(before)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
}

function hasEnvValue(env, name) {
  if (name.includes(" or ")) {
    return name.split(" or ").some((candidate) => hasEnvValue(env, candidate));
  }

  return typeof env[name] === "string" && env[name].trim().length > 0;
}
