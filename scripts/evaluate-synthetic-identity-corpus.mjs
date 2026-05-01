import {
  evaluateSyntheticIdentityCorpus,
  formatSyntheticIdentityCorpusEvaluationReport,
} from "../lib/synthetic-identity-corpus-evaluation.ts";

function parseArgs(argv) {
  const options = {
    analysisProfile: "legacy",
    useCache: true,
    writeCache: true,
    json: false,
    caseIds: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fresh") {
      options.useCache = false;
      options.writeCache = false;
      continue;
    }

    if (arg === "--read-only-cache") {
      options.useCache = true;
      options.writeCache = false;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--profile" && argv[index + 1]) {
      options.analysisProfile = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--case" && argv[index + 1]) {
      options.caseIds.push(argv[index + 1]);
      index += 1;
    }
  }

  return options;
}

const options = parseArgs(process.argv.slice(2));
const report = await evaluateSyntheticIdentityCorpus({
  analysisProfile: options.analysisProfile,
  useCache: options.useCache,
  writeCache: options.writeCache,
  caseIds: options.caseIds,
});

if (options.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(formatSyntheticIdentityCorpusEvaluationReport(report));
}
