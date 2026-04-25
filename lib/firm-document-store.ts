import { createRequire } from "node:module";
import { isSupabasePersistence } from "@/lib/persistence/backend";
import type {
  CanonicalSqliteWriteInput,
  CanonicalSqliteWriteResult,
} from "@/lib/firm-document-sqlite";
import {
  writeCanonicalAccountStatementToSqlite,
  writeCanonicalIdentityDocumentToSqlite,
} from "@/lib/firm-document-sqlite";

const require = createRequire(import.meta.url);

type SupabaseProjectionStoreModule = typeof import("@/lib/persistence/supabase-document-projection-store");

let supabaseProjectionStore: SupabaseProjectionStoreModule | null = null;

function getSupabaseProjectionStore() {
  if (!supabaseProjectionStore) {
    supabaseProjectionStore = require("./persistence/supabase-document-projection-store.ts") as SupabaseProjectionStoreModule;
  }

  return supabaseProjectionStore;
}

export async function writeCanonicalAccountStatement(
  input: CanonicalSqliteWriteInput,
): Promise<CanonicalSqliteWriteResult | null> {
  if (isSupabasePersistence()) {
    return getSupabaseProjectionStore().writeCanonicalAccountStatementToSupabase(
      input,
    );
  }

  return writeCanonicalAccountStatementToSqlite(input);
}

export async function writeCanonicalIdentityDocument(
  input: CanonicalSqliteWriteInput,
): Promise<CanonicalSqliteWriteResult | null> {
  if (isSupabasePersistence()) {
    return getSupabaseProjectionStore().writeCanonicalIdentityDocumentToSupabase(
      input,
    );
  }

  return writeCanonicalIdentityDocumentToSqlite(input);
}
