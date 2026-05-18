export type RuntimeSafetyClassification = {
  explicitLocalOrTest: boolean;
  productionLike: boolean;
  reasons: string[];
};

const LOCAL_APP_ENV_VALUES = new Set(["local", "test", "dev", "development"]);
const PRODUCTION_APP_ENV_VALUES = new Set(["prod", "production"]);
const REAL_DATA_PREVIEW_APP_ENV_VALUES = new Set([
  "preview-real-data",
  "real-data-preview",
  "real_data_preview",
]);

export function getRuntimeSafetyClassification(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeSafetyClassification {
  const reasons: string[] = [];
  const appEnv = normalizeEnvValue(env.APP_ENV);
  const vercelEnv = normalizeEnvValue(env.VERCEL_ENV);
  const nodeEnv = normalizeEnvValue(env.NODE_ENV);
  const explicitLocalOrTest = isExplicitLocalOrTestRuntime(env);

  if (PRODUCTION_APP_ENV_VALUES.has(appEnv)) {
    reasons.push("APP_ENV=production");
  }

  if (vercelEnv === "production") {
    reasons.push("VERCEL_ENV=production");
  }

  if (isRealDataPreviewRuntime(env)) {
    reasons.push("real-data preview");
  }

  if (nodeEnv === "production" && !explicitLocalOrTest) {
    reasons.push("NODE_ENV=production");
  }

  return {
    explicitLocalOrTest,
    productionLike: reasons.length > 0,
    reasons,
  };
}

export function isProductionLikeRuntime(env: NodeJS.ProcessEnv = process.env) {
  return getRuntimeSafetyClassification(env).productionLike;
}

export function isExplicitLocalOrTestRuntime(
  env: NodeJS.ProcessEnv = process.env,
) {
  const appEnv = normalizeEnvValue(env.APP_ENV);
  const nodeEnv = normalizeEnvValue(env.NODE_ENV);
  const vercelEnv = normalizeEnvValue(env.VERCEL_ENV);

  return (
    LOCAL_APP_ENV_VALUES.has(appEnv) ||
    nodeEnv === "test" ||
    vercelEnv === "development"
  );
}

export function isRealDataPreviewRuntime(env: NodeJS.ProcessEnv = process.env) {
  const appEnv = normalizeEnvValue(env.APP_ENV);
  const vercelEnv = normalizeEnvValue(env.VERCEL_ENV);

  if (REAL_DATA_PREVIEW_APP_ENV_VALUES.has(appEnv)) {
    return true;
  }

  if (vercelEnv !== "preview") {
    return false;
  }

  return (
    env.DATA_INTELLIGENCE_V2_DEV_MOCK_ENABLED !== "true" &&
    (env.DATA_INTELLIGENCE_V2_ALLOW_SENSITIVE_REVEAL === "true" ||
      env.DATA_INTELLIGENCE_V2_OPENAI_ENABLED === "true" ||
      env.DATA_INTELLIGENCE_AI_ENABLED === "true" ||
      env.AI_PRIMARY_PARSER === "true")
  );
}

function normalizeEnvValue(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}
