import { isSupabasePersistence } from "@/lib/persistence/backend";
import type {
  CanonicalSqliteWriteInput,
  CanonicalSqliteWriteResult,
} from "@/lib/firm-document-sqlite";
import {
  writeCanonicalAccountStatementToSqlite,
  writeCanonicalIdentityDocumentToSqlite,
} from "@/lib/firm-document-sqlite";
import {
  writeCanonicalAccountStatementToSupabase,
  writeCanonicalIdentityDocumentToSupabase,
} from "@/lib/persistence/supabase-document-projection-store";

export async function writeCanonicalAccountStatement(
  input: CanonicalSqliteWriteInput,
): Promise<CanonicalSqliteWriteResult | null> {
  if (isSupabasePersistence()) {
    return writeCanonicalAccountStatementToSupabase(input);
  }

  return writeCanonicalAccountStatementToSqlite(input);
}

export async function writeCanonicalIdentityDocument(
  input: CanonicalSqliteWriteInput,
): Promise<CanonicalSqliteWriteResult | null> {
  if (isSupabasePersistence()) {
    return writeCanonicalIdentityDocumentToSupabase(input);
  }

  return writeCanonicalIdentityDocumentToSqlite(input);
}
