import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);

if (
  !process.env.DATA_INTELLIGENCE_V2_EVAL_REEXEC &&
  !process.execArgv.includes("--experimental-strip-types")
) {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--loader",
      "./tests/ts-alias-loader.mjs",
      SCRIPT_PATH,
      ...process.argv.slice(2),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATA_INTELLIGENCE_V2_EVAL_REEXEC: "true",
      },
      stdio: "inherit",
    },
  );
  process.exit(result.status ?? 1);
}

try {
  const args = parseArgs(process.argv.slice(2));
  let envPreflight;
  let localEnvMetadata;

  if (args.loadLocalEnv) {
    const {
      loadDataIntelligenceV2LocalEnv,
      getDataIntelligenceV2EnvPresenceReport,
    } = await import("./data-intelligence-v2-local-env.mjs");
    localEnvMetadata = await loadDataIntelligenceV2LocalEnv({ silent: true });
    envPreflight = getDataIntelligenceV2EnvPresenceReport(process.env);
  }

  const { getDefaultV2EvalCases } = await import(
    "../lib/data-intelligence-v2/eval/cases.ts"
  );
  const { getDataIntelligenceV2Config } = await import(
    "../lib/data-intelligence-v2/config.ts"
  );
  const {
    assertNoSensitiveLeaksInEvalArtifact,
  } = await import("../lib/data-intelligence-v2/eval/graders.ts");
  const {
    runV2EvalSuite,
    printV2EvalSummary,
  } = await import("../lib/data-intelligence-v2/eval/runner.ts");

  const cases = getDefaultV2EvalCases();

  if (args.list) {
    for (const evalCase of cases) {
      console.log(`${evalCase.id}\t${evalCase.category}\t${evalCase.title}`);
    }
    process.exit(0);
  }

  const selectedCases = args.caseId
    ? cases.filter((evalCase) => evalCase.id === args.caseId)
    : cases;
  if (selectedCases.length === 0) {
    throw new Error("No eval case matched the requested case id.");
  }

  if (args.mode === "openai_fake_data") {
    if (envPreflight && !envPreflight.canRunOpenAiFakeDataEval) {
      throw new Error(
        `OpenAI fake-data eval prerequisites missing: ${envPreflight.missing.join(", ")}`,
      );
    }
    console.log("Running V2 OpenAI fake-data eval mode with fake data only.");
  } else if (args.loadLocalEnv && !args.json) {
    printEnvPreflight(envPreflight, localEnvMetadata);
  }

  const summary = await runV2EvalSuite({
    mode: args.mode,
    cases: selectedCases,
    config: getDataIntelligenceV2Config(process.env),
  });

  const leaks = assertNoSensitiveLeaksInEvalArtifact(summary);
  if (leaks.length > 0) {
    throw new Error("Eval summary failed safety validation.");
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        args.loadLocalEnv
          ? {
              envPreflight,
              localEnv: localEnvMetadata,
              ...summary,
            }
          : summary,
        null,
        2,
      ),
    );
  } else {
    printV2EvalSummary(summary);
  }

  process.exit(summary.passed ? 0 : 1);
} catch (error) {
  console.error(
    `V2 eval failed: ${error instanceof Error ? error.message : "unknown failure"}`,
  );
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {
    mode: "mock",
    list: false,
    json: false,
    loadLocalEnv: false,
    caseId: undefined,
  };

  for (const arg of argv) {
    if (arg === "--list") {
      parsed.list = true;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--load-local-env") {
      parsed.loadLocalEnv = true;
    } else if (arg.startsWith("--case=")) {
      parsed.caseId = arg.slice("--case=".length);
    } else if (arg === "--mode=mock") {
      parsed.mode = "mock";
    } else if (arg === "--mode=openai-fake-data") {
      parsed.mode = "openai_fake_data";
    } else {
      throw new Error("Unsupported eval argument.");
    }
  }

  return parsed;
}

function printEnvPreflight(report, metadata) {
  if (!report || !metadata) {
    return;
  }

  console.log("V2 local env preflight:");
  console.log(`- loaded file names: ${metadata.loadedFileNames.join(", ") || "none"}`);
  console.log(`- nodeEnvProduction: ${report.nodeEnvProduction}`);
  console.log(`- hasOpenAiApiKey: ${report.hasOpenAiApiKey}`);
  console.log(`- hasV2Model: ${report.hasV2Model}`);
  console.log(`- hasParserOnlyModel: ${report.hasParserOnlyModel}`);
  console.log(`- v2OpenAiEnabled: ${report.v2OpenAiEnabled}`);
  console.log(`- evalOpenAiEnabled: ${report.evalOpenAiEnabled}`);
  console.log(`- evalAllowNetwork: ${report.evalAllowNetwork}`);
  console.log(`- canRunOpenAiFakeDataEval: ${report.canRunOpenAiFakeDataEval}`);
  console.log(`- missing: ${report.missing.join(", ") || "none"}`);
}
