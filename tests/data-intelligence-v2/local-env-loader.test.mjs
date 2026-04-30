import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  getDataIntelligenceV2EnvPresenceReport,
  loadDataIntelligenceV2LocalEnv,
} from "../../scripts/data-intelligence-v2-local-env.mjs";

const ENV_KEYS = [
  "NODE_ENV",
  "DATA_INTELLIGENCE_V2_OPENAI_ENABLED",
  "DATA_INTELLIGENCE_V2_EVAL_OPENAI_ENABLED",
  "DATA_INTELLIGENCE_V2_EVAL_ALLOW_NETWORK",
  "DATA_INTELLIGENCE_V2_OPENAI_API_KEY",
  "OPENAI_API_KEY",
  "DATA_INTELLIGENCE_V2_MODEL",
  "DATA_INTELLIGENCE_MODEL",
  "AI_PRIMARY_PARSER_MODEL",
  "__NEXT_PROCESSED_ENV",
];

test("presence report defaults to not runnable without relevant env", async () => {
  await withCleanEnv(() => {
    const report = getDataIntelligenceV2EnvPresenceReport({});

    assert.equal(report.hasOpenAiApiKey, false);
    assert.equal(report.hasV2Model, false);
    assert.equal(report.canRunOpenAiFakeDataEval, false);
    assert.ok(report.missing.includes("DATA_INTELLIGENCE_V2_OPENAI_ENABLED"));
    assert.ok(
      report.missing.includes(
        "DATA_INTELLIGENCE_V2_OPENAI_API_KEY or OPENAI_API_KEY",
      ),
    );
    assert.ok(
      report.missing.includes(
        "DATA_INTELLIGENCE_V2_MODEL or DATA_INTELLIGENCE_MODEL",
      ),
    );
  });
});

test("shared OpenAI key plus V2 model can satisfy non-production eval gates", () => {
  const report = getDataIntelligenceV2EnvPresenceReport({
    NODE_ENV: "development",
    OPENAI_API_KEY: "fake-shared-key",
    DATA_INTELLIGENCE_V2_MODEL: "fake-v2-model",
    DATA_INTELLIGENCE_V2_OPENAI_ENABLED: "true",
    DATA_INTELLIGENCE_V2_EVAL_OPENAI_ENABLED: "true",
    DATA_INTELLIGENCE_V2_EVAL_ALLOW_NETWORK: "true",
  });

  assert.equal(report.hasOpenAiApiKey, true);
  assert.equal(report.hasSharedOpenAiApiKey, true);
  assert.equal(report.hasV2Model, true);
  assert.equal(report.canRunOpenAiFakeDataEval, true);
  assert.equal(JSON.stringify(report).includes("fake-shared-key"), false);
  assert.equal(JSON.stringify(report).includes("fake-v2-model"), false);
});

test("V2-specific key plus shared data intelligence model can satisfy eval gates", () => {
  const report = getDataIntelligenceV2EnvPresenceReport({
    NODE_ENV: "development",
    DATA_INTELLIGENCE_V2_OPENAI_API_KEY: "fake-v2-key",
    DATA_INTELLIGENCE_MODEL: "fake-shared-model",
    DATA_INTELLIGENCE_V2_OPENAI_ENABLED: "true",
    DATA_INTELLIGENCE_V2_EVAL_OPENAI_ENABLED: "true",
    DATA_INTELLIGENCE_V2_EVAL_ALLOW_NETWORK: "true",
  });

  assert.equal(report.hasV2SpecificOpenAiApiKey, true);
  assert.equal(report.hasSharedDataIntelligenceModel, true);
  assert.equal(report.hasV2Model, true);
  assert.equal(report.canRunOpenAiFakeDataEval, true);
  assert.equal(JSON.stringify(report).includes("fake-v2-key"), false);
  assert.equal(JSON.stringify(report).includes("fake-shared-model"), false);
});

test("parser-only model is reported but insufficient for V2 eval", () => {
  const report = getDataIntelligenceV2EnvPresenceReport({
    NODE_ENV: "development",
    OPENAI_API_KEY: "fake-shared-key",
    AI_PRIMARY_PARSER_MODEL: "fake-parser-model",
    DATA_INTELLIGENCE_V2_OPENAI_ENABLED: "true",
    DATA_INTELLIGENCE_V2_EVAL_OPENAI_ENABLED: "true",
    DATA_INTELLIGENCE_V2_EVAL_ALLOW_NETWORK: "true",
  });

  assert.equal(report.hasOpenAiApiKey, true);
  assert.equal(report.hasParserOnlyModel, true);
  assert.equal(report.hasV2Model, false);
  assert.equal(report.canRunOpenAiFakeDataEval, false);
  assert.ok(
    report.missing.includes(
      "DATA_INTELLIGENCE_V2_MODEL or DATA_INTELLIGENCE_MODEL",
    ),
  );
});

test("production NODE_ENV blocks fake-data eval even with all gates", () => {
  const report = getDataIntelligenceV2EnvPresenceReport({
    NODE_ENV: "production",
    OPENAI_API_KEY: "fake-shared-key",
    DATA_INTELLIGENCE_V2_MODEL: "fake-v2-model",
    DATA_INTELLIGENCE_V2_OPENAI_ENABLED: "true",
    DATA_INTELLIGENCE_V2_EVAL_OPENAI_ENABLED: "true",
    DATA_INTELLIGENCE_V2_EVAL_ALLOW_NETWORK: "true",
  });

  assert.equal(report.nodeEnvProduction, true);
  assert.equal(report.canRunOpenAiFakeDataEval, false);
  assert.ok(report.missing.includes("NODE_ENV must not be production"));
});

test("loader reads temp .env.local and returns metadata without values", async () => {
  await withTempProject(async (projectDir) => {
    await writeFile(
      path.join(projectDir, ".env.local"),
      [
        "OPENAI_API_KEY=fake-local-key",
        'DATA_INTELLIGENCE_V2_MODEL="fake-local-model"',
        "DATA_INTELLIGENCE_V2_OPENAI_ENABLED=true",
        "DATA_INTELLIGENCE_V2_EVAL_OPENAI_ENABLED=true",
        "DATA_INTELLIGENCE_V2_EVAL_ALLOW_NETWORK=true",
      ].join("\n"),
    );

    await withCleanEnv(async () => {
      const metadata = await loadDataIntelligenceV2LocalEnv({ projectDir });

      assert.equal(Boolean(process.env.OPENAI_API_KEY), true);
      assert.equal(Boolean(process.env.DATA_INTELLIGENCE_V2_MODEL), true);
      assert.equal(metadata.loadedFileNames.includes(".env.local"), true);
      assert.equal(metadata.presenceReport.canRunOpenAiFakeDataEval, true);
      assert.equal(JSON.stringify(metadata).includes("fake-local-key"), false);
      assert.equal(JSON.stringify(metadata).includes("fake-local-model"), false);
    });
  });
});

test("loader does not override existing values by default", async () => {
  await withTempProject(async (projectDir) => {
    await writeFile(path.join(projectDir, ".env.local"), "OPENAI_API_KEY=fake-new-key\n");

    await withCleanEnv(async () => {
      process.env.OPENAI_API_KEY = "existing";
      const metadata = await loadDataIntelligenceV2LocalEnv({ projectDir });

      assert.equal(process.env.OPENAI_API_KEY, "existing");
      assert.equal(JSON.stringify(metadata).includes("fake-new-key"), false);
      assert.equal(JSON.stringify(metadata).includes("existing"), false);
    });
  });
});

test("loader overrides existing values only when explicitly requested", async () => {
  await withTempProject(async (projectDir) => {
    await writeFile(path.join(projectDir, ".env.local"), "OPENAI_API_KEY=fake-new-key\n");

    await withCleanEnv(async () => {
      process.env.OPENAI_API_KEY = "existing";
      const metadata = await loadDataIntelligenceV2LocalEnv({
        projectDir,
        overrideExisting: true,
      });

      assert.equal(process.env.OPENAI_API_KEY, "fake-new-key");
      assert.equal(JSON.stringify(metadata).includes("fake-new-key"), false);
      assert.equal(JSON.stringify(metadata).includes("existing"), false);
    });
  });
});

async function withTempProject(fn) {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "di-v2-env-"));
  try {
    await fn(projectDir);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
}

async function withCleanEnv(fn) {
  const snapshot = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }

  try {
    await fn();
  } finally {
    for (const key of ENV_KEYS) {
      if (snapshot[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = snapshot[key];
      }
    }
  }
}
