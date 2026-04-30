-- Store extracted tax return lines and tax-form box values under tax_document v2.

create table if not exists public.document_tax_facts (
  document_tax_fact_id text primary key,
  document_id text not null references public.documents(document_id) on delete cascade,
  source_index integer not null,
  form text,
  field_id text not null,
  label text not null,
  line text,
  box text,
  value_type text not null,
  raw_value text,
  normalized_value text,
  amount text,
  currency text,
  unique(document_id, source_index)
);

create index if not exists idx_document_tax_facts_document_field
  on public.document_tax_facts(document_id, field_id);

alter table public.document_tax_facts enable row level security;
