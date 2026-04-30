-- Durable metadata store for V2 secure reveal cards.
-- Raw sensitive values are never stored here. The table contains only
-- authorization, expiry, one-time-use, and lookup metadata for server-side
-- reveal flows.

create table if not exists public.data_intelligence_v2_reveal_cards (
  reveal_card_id text primary key,
  owner_email text not null,
  user_email text not null,
  user_id text,
  firm_id text,
  role text,
  client_id text,
  account_id text,
  document_id text,
  source_id text,
  field_key text not null,
  field_label text not null,
  label text not null,
  purpose text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  one_time_use boolean not null default true,
  consumed_at timestamptz,
  revoked_at timestamptz,
  actual_value_was_not_shown_to_model boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint data_intelligence_v2_reveal_cards_model_safe_check
    check (actual_value_was_not_shown_to_model = true),
  constraint data_intelligence_v2_reveal_cards_id_check
    check (reveal_card_id <> ''),
  constraint data_intelligence_v2_reveal_cards_owner_check
    check (owner_email <> ''),
  constraint data_intelligence_v2_reveal_cards_user_check
    check (user_email <> ''),
  constraint data_intelligence_v2_reveal_cards_field_check
    check (field_key <> ''),
  constraint data_intelligence_v2_reveal_cards_purpose_check
    check (purpose <> '')
);

create index if not exists idx_di_v2_reveal_cards_owner_email
  on public.data_intelligence_v2_reveal_cards(owner_email);

create index if not exists idx_di_v2_reveal_cards_user_email
  on public.data_intelligence_v2_reveal_cards(user_email);

create index if not exists idx_di_v2_reveal_cards_client_id
  on public.data_intelligence_v2_reveal_cards(client_id)
  where client_id is not null;

create index if not exists idx_di_v2_reveal_cards_expires_at
  on public.data_intelligence_v2_reveal_cards(expires_at);

create index if not exists idx_di_v2_reveal_cards_active
  on public.data_intelligence_v2_reveal_cards(expires_at, owner_email, user_email)
  where consumed_at is null and revoked_at is null;

create index if not exists idx_di_v2_reveal_cards_owner_user_expires
  on public.data_intelligence_v2_reveal_cards(owner_email, user_email, expires_at);

alter table public.data_intelligence_v2_reveal_cards enable row level security;
