-- Phase 1 Supabase/Postgres schema for private staging.
-- This migration is intentionally server-only: RLS is enabled on all tables,
-- and no anon/authenticated policies are created yet.

create extension if not exists pgcrypto;

create table if not exists public.firm_settings (
  id text primary key,
  owner_email text not null unique,
  firm_name text,
  storage_provider text not null default 'google_drive',
  source_folder_id text,
  source_folder_name text,
  destination_folder_id text,
  destination_folder_name text,
  naming_convention text not null default 'Last_First_DocType_Date',
  naming_rules_json jsonb,
  folder_template text not null default 'Client Info
Accounts
Money Movement
Planning
Review',
  review_instruction text not null default 'Send uncertain files to a human review queue before moving anything.',
  created_at text not null,
  updated_at text not null
);

create table if not exists public.storage_connections (
  id text primary key,
  owner_email text not null,
  provider text not null,
  account_email text,
  account_name text,
  account_image text,
  external_account_id text,
  identity_key text not null,
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  expires_at bigint,
  granted_scopes jsonb not null default '[]'::jsonb,
  is_primary boolean not null default false,
  status text not null check (status in ('connected', 'needs_reauth')),
  created_at text not null,
  updated_at text not null,
  unique (owner_email, provider, identity_key)
);

create table if not exists public.filing_events (
  id text primary key,
  owner_email text not null,
  actor_email text not null,
  actor_type text not null default 'user',
  initiated_by_email text,
  batch_id text not null,
  event_type text not null default 'file_filed',
  storage_provider text not null default 'google_drive',
  review_decision_id text,
  file_id text not null,
  source_name text not null,
  source_mime_type text not null,
  source_modified_time text,
  source_drive_size text,
  download_byte_length integer,
  download_sha1 text,
  parser_version text,
  parser_conflict_summary text,
  original_client_folder text,
  original_top_level_folder text,
  original_filename text,
  original_path text,
  final_client_folder text,
  final_top_level_folder text,
  final_filename text,
  destination_path text,
  source_parent_ids jsonb,
  destination_root_id text,
  destination_root_name text,
  client_folder_id text,
  client_folder_name text,
  top_level_folder_id text,
  top_level_folder_name text,
  final_parent_id text,
  detected_document_type text,
  detected_client text,
  detected_client2 text,
  detected_ownership_type text,
  detected_account_last4 text,
  detected_account_type text,
  detected_custodian text,
  detected_tax_year text,
  detected_document_date text,
  detected_id_type text,
  detected_entity_name text,
  classifier_confidence double precision,
  classifier_content_source text,
  classifier_reasons jsonb,
  classifier_excerpt text,
  outcome text not null,
  error_message text,
  created_at text not null
);

create table if not exists public.bug_reports (
  id text primary key,
  owner_email text not null,
  reporter_name text,
  reporter_email text,
  current_path text,
  message text not null,
  created_at text not null
);

create table if not exists public.documents (
  document_id text primary key,
  owner_email text not null,
  source_file_id text not null,
  source_name text,
  mime_type text,
  modified_time text,
  download_sha1 text,
  download_byte_length integer,
  content_source text,
  analysis_profile text not null,
  analysis_version text not null,
  parser_version text,
  normalized_document_type_id text,
  normalized_document_subtype text,
  extracted_document_type_id text,
  extracted_document_subtype text,
  document_date text,
  parser_conflict_summary text,
  ai_used boolean not null default false,
  ai_model text,
  ai_prompt_version text,
  analyzed_at text not null,
  created_at text not null,
  updated_at text not null,
  unique (owner_email, source_file_id)
);

create table if not exists public.document_canonical_payloads (
  document_id text primary key references public.documents(document_id) on delete cascade,
  canonical_schema_version text not null,
  canonical_json jsonb not null,
  stored_at text not null
);

create table if not exists public.institutions (
  institution_id text primary key,
  owner_email text not null,
  resolver_key text not null,
  canonical_name text,
  resolution_basis text,
  first_seen_document_id text references public.documents(document_id),
  last_seen_document_id text references public.documents(document_id),
  created_at text not null,
  updated_at text not null,
  unique (owner_email, resolver_key)
);

create table if not exists public.parties (
  party_id text primary key,
  owner_email text not null,
  resolver_key text not null,
  kind text not null,
  canonical_display_name text,
  address_signature text,
  resolution_basis text,
  first_seen_document_id text references public.documents(document_id),
  last_seen_document_id text references public.documents(document_id),
  created_at text not null,
  updated_at text not null,
  unique (owner_email, resolver_key)
);

create table if not exists public.accounts (
  account_id text primary key,
  owner_email text not null,
  resolver_key text not null,
  primary_institution_id text references public.institutions(institution_id),
  account_number_hash text,
  masked_account_number text,
  account_last4 text,
  canonical_account_type text,
  resolution_basis text,
  is_provisional boolean not null default true,
  first_seen_document_id text references public.documents(document_id),
  last_seen_document_id text references public.documents(document_id),
  created_at text not null,
  updated_at text not null,
  unique (owner_email, resolver_key)
);

create table if not exists public.account_parties (
  account_party_id text primary key,
  owner_email text not null,
  account_id text not null references public.accounts(account_id),
  party_id text not null references public.parties(party_id),
  role text not null,
  relationship_label text,
  first_seen_document_id text references public.documents(document_id),
  last_seen_document_id text references public.documents(document_id),
  created_at text not null,
  updated_at text not null,
  unique (owner_email, account_id, party_id, role)
);

create table if not exists public.document_institutions (
  document_institution_id text primary key,
  document_id text not null references public.documents(document_id) on delete cascade,
  institution_id text references public.institutions(institution_id),
  source_index integer not null,
  raw_name text,
  normalized_name text,
  address_json jsonb,
  is_primary boolean not null default false,
  unique (document_id, source_index)
);

create table if not exists public.document_parties (
  document_party_id text primary key,
  document_id text not null references public.documents(document_id) on delete cascade,
  party_id text references public.parties(party_id),
  source_index integer not null,
  kind text,
  raw_name text,
  normalized_display_name text,
  address_json jsonb,
  unique (document_id, source_index)
);

create table if not exists public.document_party_facts (
  document_party_fact_id text primary key,
  document_id text not null references public.documents(document_id) on delete cascade,
  document_party_id text references public.document_parties(document_party_id) on delete cascade,
  party_id text references public.parties(party_id),
  source_index integer not null,
  id_kind text,
  id_type text,
  raw_id_value_ciphertext text,
  masked_id_value text,
  issuing_authority text,
  birth_date text,
  issue_date text,
  expiration_date text,
  unique (document_id, source_index)
);

create table if not exists public.document_account_snapshots (
  document_account_snapshot_id text primary key,
  document_id text not null references public.documents(document_id) on delete cascade,
  account_id text references public.accounts(account_id),
  document_institution_id text references public.document_institutions(document_institution_id),
  source_index integer not null,
  observed_account_number_ciphertext text,
  observed_masked_account_number text,
  observed_account_last4 text,
  observed_account_type_raw text,
  normalized_account_type text,
  registration_type text,
  statement_start_date text,
  statement_end_date text,
  opened_date text,
  closed_date text,
  is_primary_account boolean not null default false,
  resolver_basis text,
  unique (document_id, source_index)
);

create table if not exists public.document_account_parties (
  document_account_party_id text primary key,
  document_id text not null references public.documents(document_id) on delete cascade,
  document_account_snapshot_id text not null references public.document_account_snapshots(document_account_snapshot_id) on delete cascade,
  account_party_id text references public.account_parties(account_party_id),
  account_id text references public.accounts(account_id),
  document_party_id text references public.document_parties(document_party_id),
  party_id text references public.parties(party_id),
  source_index integer not null,
  role text not null,
  relationship_label text,
  allocation_percent text,
  unique (document_id, source_index)
);

create table if not exists public.document_contacts (
  document_contact_id text primary key,
  document_id text not null references public.documents(document_id) on delete cascade,
  document_account_snapshot_id text references public.document_account_snapshots(document_account_snapshot_id) on delete cascade,
  document_institution_id text references public.document_institutions(document_institution_id),
  institution_id text references public.institutions(institution_id),
  document_party_id text references public.document_parties(document_party_id),
  party_id text references public.parties(party_id),
  source_index integer not null,
  method text not null,
  purpose text not null,
  label text,
  raw_value text,
  normalized_value text,
  hours_text text,
  unique (document_id, source_index)
);

create table if not exists public.account_values (
  account_value_id text primary key,
  document_account_snapshot_id text not null references public.document_account_snapshots(document_account_snapshot_id) on delete cascade,
  account_id text references public.accounts(account_id),
  source_index integer not null,
  kind text not null,
  label text,
  amount text,
  currency text,
  unique (document_account_snapshot_id, source_index)
);

create table if not exists public.document_primary_facts (
  document_id text primary key references public.documents(document_id) on delete cascade,
  owner_email text not null,
  primary_party_id text references public.parties(party_id),
  secondary_party_id text references public.parties(party_id),
  detected_client text,
  detected_client2 text,
  ownership_type text,
  primary_account_id text references public.accounts(account_id),
  account_last4 text,
  account_type text,
  custodian_institution_id text references public.institutions(institution_id),
  custodian_name text,
  document_date text,
  entity_name text,
  id_type text,
  tax_year text,
  derived_from_version text not null,
  updated_at text not null
);

create index if not exists idx_firm_settings_owner_email
  on public.firm_settings(owner_email);
create index if not exists idx_storage_connections_owner_primary
  on public.storage_connections(owner_email, is_primary desc, updated_at desc);
create index if not exists idx_storage_connections_owner_provider_identity
  on public.storage_connections(owner_email, provider, identity_key);
create index if not exists idx_filing_events_owner_created
  on public.filing_events(owner_email, created_at desc);
create index if not exists idx_filing_events_owner_file_id
  on public.filing_events(owner_email, file_id);
create index if not exists idx_bug_reports_owner_created
  on public.bug_reports(owner_email, created_at desc);
create index if not exists idx_documents_owner_source_file
  on public.documents(owner_email, source_file_id);
create index if not exists idx_documents_owner_type_date
  on public.documents(owner_email, normalized_document_type_id, document_date desc);
create index if not exists idx_documents_document_id
  on public.documents(document_id);
create index if not exists idx_institutions_owner_resolver
  on public.institutions(owner_email, resolver_key);
create index if not exists idx_institutions_owner_name
  on public.institutions(owner_email, canonical_name);
create index if not exists idx_parties_owner_resolver
  on public.parties(owner_email, resolver_key);
create index if not exists idx_parties_owner_name
  on public.parties(owner_email, canonical_display_name);
create index if not exists idx_accounts_owner_resolver
  on public.accounts(owner_email, resolver_key);
create index if not exists idx_accounts_owner_last4
  on public.accounts(owner_email, primary_institution_id, account_last4);
create index if not exists idx_account_parties_party_account
  on public.account_parties(party_id, account_id);
create index if not exists idx_document_parties_document
  on public.document_parties(document_id);
create index if not exists idx_document_parties_party
  on public.document_parties(party_id);
create index if not exists idx_document_party_facts_party_expiration
  on public.document_party_facts(party_id, expiration_date);
create index if not exists idx_document_account_snapshots_account_latest
  on public.document_account_snapshots(account_id, statement_end_date desc, document_id);
create index if not exists idx_document_account_parties_snapshot
  on public.document_account_parties(document_account_snapshot_id);
create index if not exists idx_document_contacts_institution_purpose_method
  on public.document_contacts(institution_id, purpose, method);
create index if not exists idx_document_contacts_party
  on public.document_contacts(party_id);
create index if not exists idx_account_values_account_kind
  on public.account_values(account_id, kind);
create index if not exists idx_document_primary_facts_owner_primary_party
  on public.document_primary_facts(owner_email, primary_party_id);

create or replace view public.latest_account_snapshot_v as
with ranked as (
  select
    snapshots.document_account_snapshot_id,
    snapshots.document_id,
    snapshots.account_id,
    snapshots.document_institution_id,
    snapshots.source_index,
    snapshots.observed_account_number_ciphertext,
    snapshots.observed_masked_account_number,
    snapshots.observed_account_last4,
    snapshots.observed_account_type_raw,
    snapshots.normalized_account_type,
    snapshots.registration_type,
    snapshots.statement_start_date,
    snapshots.statement_end_date,
    snapshots.opened_date,
    snapshots.closed_date,
    snapshots.is_primary_account,
    snapshots.resolver_basis,
    documents.owner_email,
    documents.source_file_id,
    documents.source_name,
    documents.document_date,
    documents.analyzed_at,
    row_number() over (
      partition by snapshots.account_id
      order by
        coalesce(snapshots.statement_end_date, documents.document_date, documents.analyzed_at) desc,
        documents.analyzed_at desc,
        documents.updated_at desc,
        documents.document_id desc
    ) as row_num
  from public.document_account_snapshots as snapshots
  inner join public.documents
    on documents.document_id = snapshots.document_id
  where snapshots.account_id is not null
)
select
  document_account_snapshot_id,
  document_id,
  account_id,
  document_institution_id,
  source_index,
  observed_account_number_ciphertext,
  observed_masked_account_number,
  observed_account_last4,
  observed_account_type_raw,
  normalized_account_type,
  registration_type,
  statement_start_date,
  statement_end_date,
  opened_date,
  closed_date,
  is_primary_account,
  resolver_basis,
  owner_email,
  source_file_id,
  source_name,
  document_date,
  analyzed_at
from ranked
where row_num = 1;

create or replace view public.latest_account_document_v as
select
  latest.account_id,
  latest.document_account_snapshot_id,
  latest.document_id,
  latest.owner_email,
  latest.source_file_id,
  latest.source_name,
  latest.document_date,
  latest.analyzed_at,
  latest.statement_start_date,
  latest.statement_end_date,
  latest.normalized_account_type,
  latest.observed_account_last4
from public.latest_account_snapshot_v as latest;

alter table public.firm_settings enable row level security;
alter table public.storage_connections enable row level security;
alter table public.filing_events enable row level security;
alter table public.bug_reports enable row level security;
alter table public.documents enable row level security;
alter table public.document_canonical_payloads enable row level security;
alter table public.institutions enable row level security;
alter table public.parties enable row level security;
alter table public.accounts enable row level security;
alter table public.account_parties enable row level security;
alter table public.document_institutions enable row level security;
alter table public.document_parties enable row level security;
alter table public.document_party_facts enable row level security;
alter table public.document_account_snapshots enable row level security;
alter table public.document_account_parties enable row level security;
alter table public.document_contacts enable row level security;
alter table public.account_values enable row level security;
alter table public.document_primary_facts enable row level security;
