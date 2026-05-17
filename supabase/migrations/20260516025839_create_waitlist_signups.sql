create extension if not exists pgcrypto;

create table if not exists public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  email text not null,
  firm text not null,
  phone text,
  file_systems text[] not null default '{}'::text[],
  file_system_other text,
  pain_points text[] not null default '{}'::text[],
  notes text,
  status text not null default 'new',
  source text not null default 'join_waitlist_page',
  constraint waitlist_signups_name_length
    check (char_length(trim(name)) between 1 and 120),
  constraint waitlist_signups_email_length
    check (email = lower(email) and char_length(email) between 3 and 254),
  constraint waitlist_signups_firm_length
    check (char_length(trim(firm)) between 1 and 160),
  constraint waitlist_signups_phone_length
    check (phone is null or char_length(phone) <= 40),
  constraint waitlist_signups_file_system_other_length
    check (file_system_other is null or char_length(file_system_other) <= 120),
  constraint waitlist_signups_notes_length
    check (notes is null or char_length(notes) <= 1000),
  constraint waitlist_signups_file_systems_required
    check (cardinality(file_systems) > 0),
  constraint waitlist_signups_file_systems_allowed
    check (
      file_systems <@ array[
        'sharepoint_onedrive',
        'google_drive',
        'box',
        'dropbox',
        'egnyte',
        'sharefile',
        'network_drive',
        'redtail_crm',
        'smartvault',
        'other',
        'not_sure'
      ]::text[]
    ),
  constraint waitlist_signups_pain_points_allowed
    check (
      pain_points <@ array[
        'new_client_onboarding_uploads',
        'inconsistent_file_names',
        'wrong_folders',
        'finding_documents_later',
        'missing_document_tracking',
        'preparing_service_tasks',
        'other'
      ]::text[]
    ),
  constraint waitlist_signups_status_check
    check (status in ('new', 'contacted', 'demo_scheduled', 'onboarded', 'closed')),
  constraint waitlist_signups_source_length
    check (char_length(source) between 1 and 80)
);

create unique index if not exists waitlist_signups_email_idx
  on public.waitlist_signups (email);

create index if not exists waitlist_signups_created_at_idx
  on public.waitlist_signups (created_at desc);

create index if not exists waitlist_signups_status_idx
  on public.waitlist_signups (status);

alter table public.waitlist_signups enable row level security;
