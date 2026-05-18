import { getRuntimeSafetyClassification } from "@/lib/runtime-environment";

export type PersistenceBackend = "sqlite" | "supabase";

const LOCAL_DEFAULT_PERSISTENCE_BACKEND: PersistenceBackend = "sqlite";
const PRODUCTION_PERSISTENCE_BACKEND: PersistenceBackend = "supabase";
const REQUIRED_APP_ENCRYPTION_KEY_BYTES = 32;

export function getPersistenceBackend(
  env: NodeJS.ProcessEnv = process.env,
): PersistenceBackend {
  const configured = env.PERSISTENCE_BACKEND?.trim().toLowerCase();
  const runtime = getRuntimeSafetyClassification(env);

  if (!configured) {
    if (runtime.productionLike) {
      throw new Error(
        buildProductionPersistenceError(
          "PERSISTENCE_BACKEND is required in production-like runtimes.",
          runtime.reasons,
          getMissingSupabasePersistenceEnvNames(env),
        ),
      );
    }

    return LOCAL_DEFAULT_PERSISTENCE_BACKEND;
  }

  if (configured !== "sqlite" && configured !== "supabase") {
    throw new Error(
      "Unsupported PERSISTENCE_BACKEND value. Expected one of: supabase, sqlite.",
    );
  }

  if (
    runtime.productionLike &&
    configured !== PRODUCTION_PERSISTENCE_BACKEND
  ) {
    throw new Error(
      buildProductionPersistenceError(
        `PERSISTENCE_BACKEND="${configured}" is not allowed in production-like runtimes.`,
        runtime.reasons,
        getMissingSupabasePersistenceEnvNames(env),
      ),
    );
  }

  if (
    runtime.productionLike &&
    configured === PRODUCTION_PERSISTENCE_BACKEND
  ) {
    const missing = getMissingSupabasePersistenceEnvNames(env);
    if (missing.length > 0) {
      throw new Error(
        buildProductionPersistenceError(
          "Supabase/Postgres persistence is incomplete for a production-like runtime.",
          runtime.reasons,
          missing,
        ),
      );
    }

    validateAppEncryptionKey(env.APP_ENCRYPTION_KEY);
  }

  return configured;
}

export function isSupabasePersistence(env: NodeJS.ProcessEnv = process.env) {
  return getPersistenceBackend(env) === "supabase";
}

export function isSqlitePersistence(env: NodeJS.ProcessEnv = process.env) {
  return getPersistenceBackend(env) === "sqlite";
}

export function getMissingSupabasePersistenceEnvNames(
  env: NodeJS.ProcessEnv = process.env,
) {
  const missing: string[] = [];

  if (!hasEnvValue(env.SUPABASE_DB_URL_POOLER) && !hasEnvValue(env.SUPABASE_DB_URL)) {
    missing.push("SUPABASE_DB_URL_POOLER or SUPABASE_DB_URL");
  }

  if (!hasEnvValue(env.APP_ENCRYPTION_KEY)) {
    missing.push("APP_ENCRYPTION_KEY");
  }

  return missing;
}

function buildProductionPersistenceError(
  message: string,
  reasons: string[],
  missingEnvNames: string[],
) {
  const reasonText =
    reasons.length > 0 ? ` Detected: ${reasons.join(", ")}.` : "";
  const missingText =
    missingEnvNames.length > 0
      ? ` Missing: ${missingEnvNames.join(", ")}.`
      : "";

  return `${message}${reasonText} Configure PERSISTENCE_BACKEND="supabase" with Supabase/Postgres persistence for production-like runtimes.${missingText} SQLite persistence is local-dev/test only.`;
}

function validateAppEncryptionKey(value: string | undefined) {
  const raw = value?.trim();
  if (!raw) {
    return;
  }

  const key = parseKeyMaterial(raw);
  if (key.byteLength !== REQUIRED_APP_ENCRYPTION_KEY_BYTES) {
    throw new Error(
      "APP_ENCRYPTION_KEY must decode to exactly 32 bytes for aes-256-gcm encryption.",
    );
  }
}

function parseKeyMaterial(value: string) {
  if (/^[A-Fa-f0-9]{64}$/.test(value)) {
    return Buffer.from(value, "hex");
  }

  return Buffer.from(value, "base64");
}

function hasEnvValue(value: string | undefined) {
  return Boolean(value?.trim());
}
