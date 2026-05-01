import nextEnv from "@next/env";
import {
  evaluateSyntheticCorpus,
  formatSyntheticCorpusEvaluationReport,
} from "../lib/synthetic-corpus-evaluation.ts";
import { fileURLToPath } from "node:url";
import path from "node:path";

function parseArgs(argv) {
  const parsed = {
    caseIds: [],
    useCache: true,
    writeCache: true,
    outputJson: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--case" && argv[index + 1]) {
      parsed.caseIds.push(argv[index + 1]);
      index += 1;
      continue;
    }

    if (token === "--fresh") {
      parsed.useCache = false;
      parsed.writeCache = true;
      continue;
    }

    if (token === "--no-cache") {
      parsed.useCache = false;
      parsed.writeCache = false;
      continue;
    }

    if (token === "--json") {
      parsed.outputJson = true;
    }
  }

  return parsed;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const { loadEnvConfig } = nextEnv;

const loadedEnv = loadEnvConfig(repoRoot, false);
const envStatus = {
  aiPrimaryParser: process.env.AI_PRIMARY_PARSER ?? null,
  aiPrimaryAccountStatementOnly:
    process.env.AI_PRIMARY_ACCOUNT_STATEMENT_ONLY ?? null,
  aiPrimaryParserModel: process.env.AI_PRIMARY_PARSER_MODEL ?? null,
  openAIApiKeyPresent: Boolean(process.env.OPENAI_API_KEY),
  providerConfigured: Boolean(
    process.env.OPENAI_API_KEY && process.env.AI_PRIMARY_PARSER_MODEL,
  ),
  loadedEnvFiles:
    loadedEnv.loadedEnvFiles?.map((entry) => entry.path).filter(Boolean) ?? [],
};

console.error(
  [
    "[synthetic-corpus-eval] env loaded",
    `providerConfigured=${envStatus.providerConfigured ? "yes" : "no"}`,
    `AI_PRIMARY_PARSER=${envStatus.aiPrimaryParser ?? "unset"}`,
    `AI_PRIMARY_ACCOUNT_STATEMENT_ONLY=${envStatus.aiPrimaryAccountStatementOnly ?? "unset"}`,
    `AI_PRIMARY_PARSER_MODEL=${envStatus.aiPrimaryParserModel ?? "unset"}`,
    `OPENAI_API_KEY=${envStatus.openAIApiKeyPresent ? "present" : "missing"}`,
    `files=${envStatus.loadedEnvFiles.join(",") || "none"}`,
  ].join(" | "),
);

const args = parseArgs(process.argv.slice(2));
const report = await evaluateSyntheticCorpus({
  analysisProfile: "preview_ai_primary",
  useCache: args.useCache,
  writeCache: args.writeCache,
  caseIds: args.caseIds.length > 0 ? args.caseIds : undefined,
});

if (args.outputJson) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(formatSyntheticCorpusEvaluationReport(report));
}
