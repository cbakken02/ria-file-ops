export type RevealStoreBackend = "memory" | "postgres" | "auto";
export type AuditBackend = "noop" | "memory" | "postgres" | "auto";

export type DataIntelligenceV2Config = {
  enabled: boolean;
  chatApiEnabled: boolean;
  uiEnabled: boolean;
  devMockEnabled: boolean;
  revealApiEnabled: boolean;
  allowSensitiveRevealForAuthenticatedUsers: boolean;
  defaultRevealExpiresInMs: number;
  revealStoreBackend: RevealStoreBackend;
  auditBackend: AuditBackend;
  openAiEnabled: boolean;
  openAiApiKey?: string;
  openAiBaseUrl: string;
  openAiModel?: string;
  openAiTimeoutMs: number;
  openAiMaxOutputTokens?: number;
  evalOpenAiEnabled: boolean;
  evalAllowNetwork: boolean;
  previewQaEnabled: boolean;
  previewQaSecretPresent: boolean;
};

export const DEFAULT_REVEAL_EXPIRES_IN_MS = 10 * 60 * 1000;
export const DEFAULT_OPENAI_TIMEOUT_MS = 30 * 1000;
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

export function getDataIntelligenceV2Config(
  env: NodeJS.ProcessEnv = process.env,
): DataIntelligenceV2Config {
  return {
    enabled: env.DATA_INTELLIGENCE_V2_ENABLED === "true",
    chatApiEnabled: env.DATA_INTELLIGENCE_V2_CHAT_API_ENABLED === "true",
    uiEnabled: env.DATA_INTELLIGENCE_V2_UI_ENABLED === "true",
    devMockEnabled:
      env.DATA_INTELLIGENCE_V2_DEV_MOCK_ENABLED === "true" &&
      env.NODE_ENV !== "production",
    revealApiEnabled: env.DATA_INTELLIGENCE_V2_REVEAL_API_ENABLED === "true",
    allowSensitiveRevealForAuthenticatedUsers:
      env.DATA_INTELLIGENCE_V2_ALLOW_SENSITIVE_REVEAL === "true",
    defaultRevealExpiresInMs:
      readPositiveInteger(env.DATA_INTELLIGENCE_V2_REVEAL_EXPIRES_MS) ??
      DEFAULT_REVEAL_EXPIRES_IN_MS,
    revealStoreBackend: readRevealStoreBackend(
      env.DATA_INTELLIGENCE_V2_REVEAL_STORE_BACKEND,
    ),
    auditBackend: readAuditBackend(env.DATA_INTELLIGENCE_V2_AUDIT_BACKEND),
    openAiEnabled: env.DATA_INTELLIGENCE_V2_OPENAI_ENABLED === "true",
    ...(readOptionalString(
      env.DATA_INTELLIGENCE_V2_OPENAI_API_KEY ?? env.OPENAI_API_KEY,
    )
      ? {
          openAiApiKey: readOptionalString(
            env.DATA_INTELLIGENCE_V2_OPENAI_API_KEY ?? env.OPENAI_API_KEY,
          ),
        }
      : {}),
    openAiBaseUrl:
      readOptionalString(env.DATA_INTELLIGENCE_V2_OPENAI_BASE_URL) ??
      DEFAULT_OPENAI_BASE_URL,
    ...(readOptionalString(
      env.DATA_INTELLIGENCE_V2_MODEL ?? env.DATA_INTELLIGENCE_MODEL,
    )
      ? {
          openAiModel: readOptionalString(
            env.DATA_INTELLIGENCE_V2_MODEL ?? env.DATA_INTELLIGENCE_MODEL,
          ),
        }
      : {}),
    openAiTimeoutMs:
      readPositiveInteger(env.DATA_INTELLIGENCE_V2_OPENAI_TIMEOUT_MS) ??
      DEFAULT_OPENAI_TIMEOUT_MS,
    ...(readPositiveInteger(env.DATA_INTELLIGENCE_V2_OPENAI_MAX_OUTPUT_TOKENS)
      ? {
          openAiMaxOutputTokens: readPositiveInteger(
            env.DATA_INTELLIGENCE_V2_OPENAI_MAX_OUTPUT_TOKENS,
          ),
        }
      : {}),
    evalOpenAiEnabled:
      env.DATA_INTELLIGENCE_V2_EVAL_OPENAI_ENABLED === "true" &&
      env.NODE_ENV !== "production",
    evalAllowNetwork:
      env.DATA_INTELLIGENCE_V2_EVAL_ALLOW_NETWORK === "true" &&
      env.NODE_ENV !== "production",
    previewQaEnabled:
      env.DATA_INTELLIGENCE_V2_PREVIEW_QA_ENABLED === "true",
    previewQaSecretPresent: Boolean(
      readOptionalString(env.DATA_INTELLIGENCE_V2_PREVIEW_QA_SECRET),
    ),
  };
}

export function isRevealStoreProductionSafe(
  config: DataIntelligenceV2Config,
  env: NodeJS.ProcessEnv = process.env,
) {
  return !getRevealStoreBackendWarning(config, env);
}

export function isAuditBackendProductionSafe(
  config: DataIntelligenceV2Config,
  env: NodeJS.ProcessEnv = process.env,
) {
  return !getAuditBackendWarning(config, env);
}

export function getAuditBackendWarning(
  config: DataIntelligenceV2Config,
  env: NodeJS.ProcessEnv = process.env,
) {
  const productionV2Endpoint =
    env.NODE_ENV === "production" &&
    config.enabled &&
    (config.chatApiEnabled || config.revealApiEnabled);

  if (!productionV2Endpoint) {
    return null;
  }

  if (config.auditBackend === "noop" || config.auditBackend === "memory") {
    return "Durable audit logging is required for production V2 endpoints.";
  }

  return null;
}

export function getRevealStoreBackendWarning(
  config: DataIntelligenceV2Config,
  env: NodeJS.ProcessEnv = process.env,
) {
  const productionSensitiveReveal =
    env.NODE_ENV === "production" &&
    config.enabled &&
    config.revealApiEnabled &&
    config.allowSensitiveRevealForAuthenticatedUsers;

  if (!productionSensitiveReveal) {
    return null;
  }

  if (config.revealStoreBackend === "memory") {
    return "In-memory reveal-card storage is not production-safe.";
  }

  return null;
}

function readPositiveInteger(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function readOptionalString(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function readRevealStoreBackend(
  value: string | undefined,
): RevealStoreBackend {
  return value === "memory" || value === "postgres" || value === "auto"
    ? value
    : "auto";
}

function readAuditBackend(value: string | undefined): AuditBackend {
  return value === "noop" ||
    value === "memory" ||
    value === "postgres" ||
    value === "auto"
    ? value
    : "auto";
}
