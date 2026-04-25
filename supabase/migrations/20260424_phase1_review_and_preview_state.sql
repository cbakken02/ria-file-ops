CREATE TABLE IF NOT EXISTS public.review_decisions (
  id text PRIMARY KEY,
  owner_email text NOT NULL,
  file_id text NOT NULL,
  source_name text NOT NULL,
  mime_type text NOT NULL,
  modified_time text,
  detected_document_type text,
  detected_document_subtype text,
  original_client_name text,
  original_client_name2 text,
  original_ownership_type text,
  original_client_folder text,
  original_top_level_folder text,
  original_filename text,
  reviewed_client_name text,
  reviewed_client_name2 text,
  reviewed_ownership_type text,
  reviewed_document_subtype text,
  reviewed_client_folder text,
  reviewed_top_level_folder text,
  reviewed_filename text,
  status text NOT NULL CHECK (status IN ('draft', 'approved', 'filed')),
  created_at text NOT NULL,
  updated_at text NOT NULL,
  UNIQUE (owner_email, file_id)
);

CREATE INDEX IF NOT EXISTS review_decisions_owner_email_idx
  ON public.review_decisions (owner_email);

CREATE INDEX IF NOT EXISTS review_decisions_owner_email_status_idx
  ON public.review_decisions (owner_email, status);

CREATE INDEX IF NOT EXISTS review_decisions_owner_email_file_id_idx
  ON public.review_decisions (owner_email, file_id);

ALTER TABLE public.review_decisions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.client_memory_rules (
  id text PRIMARY KEY,
  owner_email text NOT NULL,
  raw_client_name text NOT NULL,
  normalized_client_name text NOT NULL,
  learned_client_folder text NOT NULL,
  source text NOT NULL CHECK (source IN ('human_review')),
  usage_count integer NOT NULL DEFAULT 1,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  UNIQUE (owner_email, normalized_client_name)
);

CREATE INDEX IF NOT EXISTS client_memory_rules_owner_email_idx
  ON public.client_memory_rules (owner_email);

CREATE INDEX IF NOT EXISTS client_memory_rules_owner_email_normalized_client_name_idx
  ON public.client_memory_rules (owner_email, normalized_client_name);

ALTER TABLE public.client_memory_rules ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.preview_analysis_cache (
  id text PRIMARY KEY,
  owner_email text NOT NULL,
  analysis_profile text NOT NULL,
  analysis_version text NOT NULL,
  analysis_ran_at text NOT NULL,
  file_id text NOT NULL,
  source_name text NOT NULL,
  mime_type text NOT NULL,
  modified_time text,
  drive_size text,
  insight_json jsonb NOT NULL,
  canonical_json jsonb,
  canonical_debug_json jsonb,
  preview_snapshot_id text,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  UNIQUE (owner_email, analysis_profile, file_id)
);

CREATE INDEX IF NOT EXISTS preview_analysis_cache_owner_email_idx
  ON public.preview_analysis_cache (owner_email);

CREATE INDEX IF NOT EXISTS preview_analysis_cache_owner_email_file_id_idx
  ON public.preview_analysis_cache (owner_email, file_id);

CREATE INDEX IF NOT EXISTS preview_analysis_cache_owner_email_analysis_profile_idx
  ON public.preview_analysis_cache (owner_email, analysis_profile);

ALTER TABLE public.preview_analysis_cache ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.preview_snapshots (
  id text PRIMARY KEY,
  owner_email text NOT NULL UNIQUE,
  generated_at text NOT NULL,
  source_folder text,
  destination_root text,
  review_posture text NOT NULL,
  ready_count integer NOT NULL DEFAULT 0,
  review_count integer NOT NULL DEFAULT 0,
  snapshot_json jsonb NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS preview_snapshots_owner_email_idx
  ON public.preview_snapshots (owner_email);

ALTER TABLE public.preview_snapshots ENABLE ROW LEVEL SECURITY;
