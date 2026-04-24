const DEFAULT_DATA_INTELLIGENCE_API_URL =
  "https://api.openai.com/v1/chat/completions";

export type DataIntelligenceAssistantConfig = {
  aiEnabled: boolean;
  model: string | null;
  apiUrl: string;
  apiKeyConfigured: boolean;
  providerConfigured: boolean;
  answeringMode: "retrieval_only" | "hybrid_ai";
  diagnostics: DataIntelligenceConfigDiagnostics;
};

export type DataIntelligenceAssistantRuntimeConfig =
  DataIntelligenceAssistantConfig & {
    apiKey: string | null;
  };

export type DataIntelligenceConfigDiagnostics = {
  aiEnabled: boolean;
  modelConfigured: boolean;
  modelSource:
    | "DATA_INTELLIGENCE_MODEL"
    | "AI_PRIMARY_PARSER_MODEL"
    | "unset";
  model: string | null;
  apiKeyConfigured: boolean;
  apiKeySource:
    | "DATA_INTELLIGENCE_API_KEY"
    | "OPENAI_API_KEY"
    | "unset";
  apiUrlSource:
    | "DATA_INTELLIGENCE_API_URL"
    | "AI_PRIMARY_PARSER_API_URL"
    | "default";
  apiUrl: string;
  providerConfigured: boolean;
  answeringMode: "retrieval_only" | "hybrid_ai";
};

export function getDataIntelligenceAssistantConfig(): DataIntelligenceAssistantConfig {
  const runtimeConfig = getDataIntelligenceAssistantRuntimeConfig();

  return {
    aiEnabled: runtimeConfig.aiEnabled,
    model: runtimeConfig.model,
    apiUrl: runtimeConfig.apiUrl,
    apiKeyConfigured: runtimeConfig.apiKeyConfigured,
    providerConfigured: runtimeConfig.providerConfigured,
    answeringMode: runtimeConfig.answeringMode,
    diagnostics: runtimeConfig.diagnostics,
  };
}

export function getDataIntelligenceAssistantRuntimeConfig(): DataIntelligenceAssistantRuntimeConfig {
  const modelEnv = readEnvWithSource("DATA_INTELLIGENCE_MODEL");
  const fallbackModelEnv = readEnvWithSource("AI_PRIMARY_PARSER_MODEL");
  const model = modelEnv.value ?? fallbackModelEnv.value;
  const modelSource = modelEnv.value
    ? "DATA_INTELLIGENCE_MODEL"
    : fallbackModelEnv.value
      ? "AI_PRIMARY_PARSER_MODEL"
      : "unset";
  const apiKeyEnv = readEnvWithSource("DATA_INTELLIGENCE_API_KEY");
  const fallbackApiKeyEnv = readEnvWithSource("OPENAI_API_KEY");
  const apiKey = apiKeyEnv.value ?? fallbackApiKeyEnv.value;
  const apiKeySource = apiKeyEnv.value
    ? "DATA_INTELLIGENCE_API_KEY"
    : fallbackApiKeyEnv.value
      ? "OPENAI_API_KEY"
      : "unset";
  const apiUrlEnv = readEnvWithSource("DATA_INTELLIGENCE_API_URL");
  const fallbackApiUrlEnv = readEnvWithSource("AI_PRIMARY_PARSER_API_URL");
  const apiUrl =
    apiUrlEnv.value ?? fallbackApiUrlEnv.value ?? DEFAULT_DATA_INTELLIGENCE_API_URL;
  const apiUrlSource = apiUrlEnv.value
    ? "DATA_INTELLIGENCE_API_URL"
    : fallbackApiUrlEnv.value
      ? "AI_PRIMARY_PARSER_API_URL"
      : "default";
  const providerConfigured = Boolean(apiKey && model);
  const aiEnabled = envFlag("DATA_INTELLIGENCE_AI_ENABLED");
  const answeringMode =
    aiEnabled && providerConfigured ? "hybrid_ai" : "retrieval_only";
  const diagnostics: DataIntelligenceConfigDiagnostics = {
    aiEnabled,
    modelConfigured: Boolean(model),
    modelSource,
    model,
    apiKeyConfigured: Boolean(apiKey),
    apiKeySource,
    apiUrlSource,
    apiUrl,
    providerConfigured,
    answeringMode,
  };

  return {
    aiEnabled,
    model,
    apiUrl,
    apiKeyConfigured: Boolean(apiKey),
    providerConfigured,
    answeringMode,
    diagnostics,
    apiKey,
  };
}

function readEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function readEnvWithSource(name: string) {
  return {
    name,
    value: readEnv(name),
  };
}

function envFlag(name: string) {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}
