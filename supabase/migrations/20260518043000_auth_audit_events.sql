-- Durable auth/session/storage audit trail.
-- Records must be written only from server-side code and must not contain
-- OAuth tokens, raw session tokens, raw session hashes, secrets, or file contents.

create table if not exists public.auth_audit_events (
  id text primary key,
  created_at timestamptz not null default now(),
  event_type text not null,
  actor_owner_key text,
  actor_workspace_id text,
  actor_email_hash text,
  resource_type text,
  resource_id_hash text,
  provider text,
  status text,
  reason text,
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  constraint auth_audit_events_id_check
    check (id <> ''),
  constraint auth_audit_events_event_type_check
    check (event_type <> ''),
  constraint auth_audit_events_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create index if not exists idx_auth_audit_events_owner_created
  on public.auth_audit_events(actor_owner_key, created_at desc);

create index if not exists idx_auth_audit_events_workspace_created
  on public.auth_audit_events(actor_workspace_id, created_at desc);

create index if not exists idx_auth_audit_events_type_created
  on public.auth_audit_events(event_type, created_at desc);

alter table public.auth_audit_events enable row level security;
