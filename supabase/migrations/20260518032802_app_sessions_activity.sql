-- Server-side app session activity for idle timeout and logout invalidation.
-- This table is intentionally separate from Google Drive storage credentials.

create table if not exists public.app_session_activity (
  session_id_hash text primary key,
  owner_email text not null,
  user_id text not null,
  workspace_id text not null,
  created_at timestamptz not null,
  last_activity_at timestamptz not null,
  invalidated_at timestamptz,
  updated_at timestamptz not null,
  constraint app_session_activity_session_hash_check
    check (session_id_hash <> ''),
  constraint app_session_activity_owner_email_check
    check (owner_email <> ''),
  constraint app_session_activity_user_id_check
    check (user_id <> ''),
  constraint app_session_activity_workspace_id_check
    check (workspace_id <> '')
);

create index if not exists idx_app_session_activity_owner_email
  on public.app_session_activity(owner_email);

create index if not exists idx_app_session_activity_last_activity_at
  on public.app_session_activity(last_activity_at);

create index if not exists idx_app_session_activity_invalidated_at
  on public.app_session_activity(invalidated_at)
  where invalidated_at is not null;

alter table public.app_session_activity enable row level security;
