import {
  getDataIntelligenceV2Config,
  getAuditBackendWarning,
  getRevealStoreBackendWarning,
  type DataIntelligenceV2Config,
} from "@/lib/data-intelligence-v2/config";
import {
  InMemoryV2AuditSink,
  NoopV2AuditSink,
  type V2AuditSink,
} from "@/lib/data-intelligence-v2/audit";
import type { ClientDataGateway } from "@/lib/data-intelligence-v2/data-gateway";
import {
  DevMockDataIntelligenceV2Gateway,
} from "@/lib/data-intelligence-v2/dev-mock-data-gateway";
import { DevMockV2ModelAdapter } from "@/lib/data-intelligence-v2/dev-mock-model-adapter";
import {
  DevMockSensitiveValueProvider,
} from "@/lib/data-intelligence-v2/dev-mock-sensitive-value-provider";
import {
  ExistingDataIntelligenceV2Gateway,
} from "@/lib/data-intelligence-v2/existing-data-gateway";
import { ExistingSensitiveValueProvider } from "@/lib/data-intelligence-v2/existing-sensitive-value-provider";
import {
  createOpenAIResponsesV2ModelAdapterFromConfig,
} from "@/lib/data-intelligence-v2/openai-model-adapter";
import {
  UnavailableV2ModelAdapter,
  type V2ModelAdapter,
} from "@/lib/data-intelligence-v2/model-adapter";
import {
  V2RevealAuditSinkAdapter,
  type RevealAuditSink,
} from "@/lib/data-intelligence-v2/reveal-audit";
import {
  PostgresV2AuditSink,
} from "@/lib/data-intelligence-v2/postgres-audit-sink";
import {
  PostgresRevealTokenStore,
} from "@/lib/data-intelligence-v2/postgres-reveal-token-store";
import {
  InMemoryRevealTokenStore,
  RevealTokenService,
  type RevealTokenStore,
} from "@/lib/data-intelligence-v2/reveal-token-service";
import type { SensitiveValueProvider } from "@/lib/data-intelligence-v2/sensitive-value-provider";
import {
  isSupabaseDatabaseConfigured,
  queryPostgres,
} from "@/lib/postgres/server";
import { isSupabasePersistence } from "@/lib/persistence/backend";

let defaultRevealTokenStore: RevealTokenStore | undefined;
let defaultRevealAuditSink: RevealAuditSink | undefined;
let defaultV2AuditSink: V2AuditSink | undefined;
let defaultSensitiveValueProvider: SensitiveValueProvider | undefined;
let defaultRevealTokenService: RevealTokenService | undefined;
let defaultV2ModelAdapter: V2ModelAdapter | undefined;
let defaultDataGateway: ClientDataGateway | undefined;

export function getDefaultRevealTokenStore(): RevealTokenStore {
  if (!defaultRevealTokenStore) {
    const config = getDataIntelligenceV2Config();
    const warning = getRevealStoreBackendWarning(config);
    if (warning) {
      throw new Error(warning);
    }

    if (shouldUsePostgresRevealStore(config)) {
      defaultRevealTokenStore = new PostgresRevealTokenStore({
        queryClient: {
          query: async (sql, params) => {
            const result = await queryPostgres(sql, params);
            return {
              rows: result.rows,
              rowCount: result.rowCount ?? undefined,
            };
          },
        },
      });
    } else {
      // This in-memory store is local scaffolding only. In serverless or
      // multi-instance production, reveal cards need a durable store. Reveal
      // card records must continue to exclude raw sensitive values.
      defaultRevealTokenStore = new InMemoryRevealTokenStore();
    }
  }
  return defaultRevealTokenStore;
}

export function getDefaultRevealAuditSink(): RevealAuditSink {
  if (!defaultRevealAuditSink) {
    defaultRevealAuditSink = new V2RevealAuditSinkAdapter(getDefaultV2AuditSink());
  }
  return defaultRevealAuditSink;
}

export function getDefaultV2AuditSink(): V2AuditSink {
  if (!defaultV2AuditSink) {
    const config = getDataIntelligenceV2Config();
    const warning = getAuditBackendWarning(config);
    if (warning) {
      throw new Error(warning);
    }

    if (shouldUsePostgresAuditSink(config)) {
      defaultV2AuditSink = new PostgresV2AuditSink({
        queryClient: {
          query: async (sql, params) => {
            const result = await queryPostgres(sql, params);
            return {
              rows: result.rows,
              rowCount: result.rowCount ?? undefined,
            };
          },
        },
      });
    } else if (config.auditBackend === "noop" && !config.devMockEnabled) {
      defaultV2AuditSink = new NoopV2AuditSink();
    } else {
      defaultV2AuditSink = new InMemoryV2AuditSink();
    }
  }
  return defaultV2AuditSink;
}

export function getDefaultSensitiveValueProvider(): SensitiveValueProvider {
  if (!defaultSensitiveValueProvider) {
    defaultSensitiveValueProvider = getDataIntelligenceV2Config().devMockEnabled
      ? new DevMockSensitiveValueProvider()
      : new ExistingSensitiveValueProvider();
  }
  return defaultSensitiveValueProvider;
}

export function getDefaultDataGateway(): ClientDataGateway {
  if (!defaultDataGateway) {
    defaultDataGateway = getDataIntelligenceV2Config().devMockEnabled
      ? new DevMockDataIntelligenceV2Gateway()
      : new ExistingDataIntelligenceV2Gateway();
  }
  return defaultDataGateway;
}

export function getDefaultRevealTokenService(): RevealTokenService {
  if (!defaultRevealTokenService) {
    defaultRevealTokenService = new RevealTokenService({
      store: getDefaultRevealTokenStore(),
      sensitiveValueProvider: getDefaultSensitiveValueProvider(),
      auditSink: getDefaultRevealAuditSink(),
      defaultExpiresInMs:
        getDataIntelligenceV2Config().defaultRevealExpiresInMs,
    });
  }
  return defaultRevealTokenService;
}

export function getDefaultV2ModelAdapter(): V2ModelAdapter {
  if (!defaultV2ModelAdapter) {
    const config = getDataIntelligenceV2Config();
    if (config.devMockEnabled) {
      defaultV2ModelAdapter = new DevMockV2ModelAdapter();
    } else if (config.openAiEnabled && config.openAiApiKey && config.openAiModel) {
      defaultV2ModelAdapter = createOpenAIResponsesV2ModelAdapterFromConfig(config);
    } else {
      defaultV2ModelAdapter = new UnavailableV2ModelAdapter();
    }
  }
  return defaultV2ModelAdapter;
}

export function resetDataIntelligenceV2ServiceFactoryForTests(): void {
  defaultRevealTokenStore = undefined;
  defaultRevealAuditSink = undefined;
  defaultV2AuditSink = undefined;
  defaultSensitiveValueProvider = undefined;
  defaultRevealTokenService = undefined;
  defaultV2ModelAdapter = undefined;
  defaultDataGateway = undefined;
}

function shouldUsePostgresAuditSink(config: DataIntelligenceV2Config) {
  if (config.devMockEnabled) {
    return false;
  }

  if (config.auditBackend === "postgres") {
    return true;
  }

  const productionV2Endpoint =
    process.env.NODE_ENV === "production" &&
    config.enabled &&
    (config.chatApiEnabled || config.revealApiEnabled);

  if (!productionV2Endpoint) {
    return false;
  }

  if (config.auditBackend === "auto") {
    if (isSupabasePersistence() && isSupabaseDatabaseConfigured()) {
      return true;
    }
    throw new Error(
      "Postgres audit logging is required for production V2 endpoints.",
    );
  }

  return false;
}

function shouldUsePostgresRevealStore(config: DataIntelligenceV2Config) {
  if (config.devMockEnabled) {
    return false;
  }

  if (config.revealStoreBackend === "postgres") {
    return true;
  }

  const productionSensitiveReveal =
    process.env.NODE_ENV === "production" &&
    config.enabled &&
    config.revealApiEnabled &&
    config.allowSensitiveRevealForAuthenticatedUsers;

  if (!productionSensitiveReveal) {
    return false;
  }

  if (config.revealStoreBackend === "auto") {
    if (isSupabasePersistence() && isSupabaseDatabaseConfigured()) {
      return true;
    }
    throw new Error(
      "Postgres reveal-card storage is required for production sensitive reveal.",
    );
  }

  return false;
}
