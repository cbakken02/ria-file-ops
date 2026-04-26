import "server-only";

import { runPostgresStatementsSync } from "@/lib/postgres/server";

const CLEANUP_FILE_STATE_SCHEMA_STATEMENTS = [
  {
    text: `
      CREATE TABLE IF NOT EXISTS public.cleanup_file_states (
        id text PRIMARY KEY,
        owner_email text NOT NULL,
        file_id text NOT NULL,
        source_name text NOT NULL,
        mime_type text NOT NULL,
        modified_time text,
        drive_size text,
        current_location text,
        proposed_filename text,
        proposed_location text,
        recognized_file_type text,
        document_type_id text,
        confidence_label text,
        reasons_json jsonb NOT NULL DEFAULT '[]'::jsonb,
        status text NOT NULL,
        analysis_profile text,
        analysis_version text,
        parser_version text,
        analyzed_at timestamptz,
        completed_at timestamptz,
        applied_filing_event_id text,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        CONSTRAINT cleanup_file_states_owner_file_unique UNIQUE (owner_email, file_id),
        CONSTRAINT cleanup_file_states_status_check CHECK (
          status IN ('needs_analysis', 'suggestion_ready', 'needs_review', 'complete')
        )
      )
    `,
  },
  {
    text: `
      CREATE INDEX IF NOT EXISTS cleanup_file_states_owner_email_idx
        ON public.cleanup_file_states (owner_email)
    `,
  },
  {
    text: `
      CREATE INDEX IF NOT EXISTS cleanup_file_states_owner_email_file_id_idx
        ON public.cleanup_file_states (owner_email, file_id)
    `,
  },
  {
    text: `
      CREATE INDEX IF NOT EXISTS cleanup_file_states_file_id_idx
        ON public.cleanup_file_states (file_id)
    `,
  },
  {
    text: `
      CREATE INDEX IF NOT EXISTS cleanup_file_states_status_idx
        ON public.cleanup_file_states (status)
    `,
  },
  {
    text: `
      CREATE INDEX IF NOT EXISTS cleanup_file_states_applied_filing_event_id_idx
        ON public.cleanup_file_states (applied_filing_event_id)
    `,
  },
  {
    text: "ALTER TABLE public.cleanup_file_states ENABLE ROW LEVEL SECURITY",
  },
];

let cleanupFileStateSchemaReady = false;

export function ensureCleanupFileStateSchema() {
  if (cleanupFileStateSchemaReady) {
    return;
  }

  runPostgresStatementsSync(CLEANUP_FILE_STATE_SCHEMA_STATEMENTS, {
    useTransaction: true,
  });
  cleanupFileStateSchemaReady = true;
}
