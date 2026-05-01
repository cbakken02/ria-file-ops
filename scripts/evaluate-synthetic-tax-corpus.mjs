import {
  evaluateSyntheticTaxCorpus,
  formatSyntheticTaxCorpusEvaluationReport,
} from "../lib/synthetic-tax-corpus-evaluation.ts";

function parseArgs(argv) {
  const options = {
    analysisProfile: "legacy",
    json: false,
    caseIds: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
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
const report = await evaluateSyntheticTaxCorpus({
  analysisProfile: options.analysisProfile,
  caseIds: options.caseIds,
});

if (options.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(formatSyntheticTaxCorpusEvaluationReport(report));
}
