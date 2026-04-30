-- Durable server-side audit trail for V2 Data Intelligence.
-- Audit records must never contain raw sensitive values, raw user prompts,
-- raw assistant/model text, raw tool payloads, raw OpenAI payloads, or raw
-- reveal values. Metadata is sanitized before insert and records are written
-- only from server-side code.

create table if not exists public.data_intelligence_v2_audit_events (
  audit_event_id text primary key,
  event_type text not null,
  event_category text not null,
  owner_email text,
  user_email text,
  user_id text,
  firm_id text,
  role text,
  conversation_id text,
  message_id text,
  reveal_card_id text,
  client_id text,
  account_id text,
  document_id text,
  source_id text,
  tool_name text,
  model_name text,
  status text,
  allowed boolean,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint data_intelligence_v2_audit_events_id_check
    check (audit_event_id <> ''),
  constraint data_intelligence_v2_audit_events_type_check
    check (event_type <> ''),
  constraint data_intelligence_v2_audit_events_category_check
    check (event_category in (
      'reveal',
      'chat',
      'tool',
      'model',
      'safety',
      'config',
      'system'
    )),
  constraint data_intelligence_v2_audit_events_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create index if not exists idx_di_v2_audit_events_created_at
  on public.data_intelligence_v2_audit_events(created_at);

create index if not exists idx_di_v2_audit_events_event_type
  on public.data_intelligence_v2_audit_events(event_type);

create index if not exists idx_di_v2_audit_events_event_category
  on public.data_intelligence_v2_audit_events(event_category);

create index if not exists idx_di_v2_audit_events_owner_email
  on public.data_intelligence_v2_audit_events(owner_email);

create index if not exists idx_di_v2_audit_events_user_email
  on public.data_intelligence_v2_audit_events(user_email);

create index if not exists idx_di_v2_audit_events_client_id
  on public.data_intelligence_v2_audit_events(client_id)
  where client_id is not null;

create index if not exists idx_di_v2_audit_events_reveal_card_id
  on public.data_intelligence_v2_audit_events(reveal_card_id)
  where reveal_card_id is not null;

create index if not exists idx_di_v2_audit_events_conversation_id
  on public.data_intelligence_v2_audit_events(conversation_id)
  where conversation_id is not null;

create index if not exists idx_di_v2_audit_events_tool_name
  on public.data_intelligence_v2_audit_events(tool_name)
  where tool_name is not null;

create index if not exists idx_di_v2_audit_events_status
  on public.data_intelligence_v2_audit_events(status)
  where status is not null;

alter table public.data_intelligence_v2_audit_events enable row level security;
