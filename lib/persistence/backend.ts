export type PersistenceBackend = "sqlite" | "supabase";

const DEFAULT_PERSISTENCE_BACKEND: PersistenceBackend = "sqlite";

export function getPersistenceBackend(): PersistenceBackend {
  const configured = process.env.PERSISTENCE_BACKEND?.trim().toLowerCase();

  if (!configured) {
    return DEFAULT_PERSISTENCE_BACKEND;
  }

  if (configured === "sqlite" || configured === "supabase") {
    return configured;
  }

  throw new Error(
    `Unsupported PERSISTENCE_BACKEND value "${configured}". Expected "sqlite" or "supabase".`,
  );
}

export function isSupabasePersistence() {
  return getPersistenceBackend() === "supabase";
}

export function isSqlitePersistence() {
  return getPersistenceBackend() === "sqlite";
}
