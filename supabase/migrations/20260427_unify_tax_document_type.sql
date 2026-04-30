-- Collapse legacy tax_return rows into tax_document with stable return subtypes.

create or replace function public._ria_infer_tax_return_subtype(
  source_name text,
  existing_subtype text
) returns text
language sql
immutable
as $$
  select case
    when lower(coalesce(existing_subtype, '') || ' ' || coalesce(source_name, '')) ~ '\m1040x\M|amended'
      then 'amended_individual_return'
    when lower(coalesce(existing_subtype, '') || ' ' || coalesce(source_name, '')) like '%state%'
      then 'state_return'
    when lower(coalesce(existing_subtype, '') || ' ' || coalesce(source_name, '')) like '%extension%'
      then 'extension'
    when lower(coalesce(existing_subtype, '') || ' ' || coalesce(source_name, '')) like '%estimated%'
      then 'estimated_payment'
    else 'individual_return'
  end;
$$;

update public.documents
set
  normalized_document_subtype = case
    when normalized_document_type_id = 'tax_return'
      then public._ria_infer_tax_return_subtype(source_name, normalized_document_subtype)
    else normalized_document_subtype
  end,
  extracted_document_subtype = case
    when extracted_document_type_id = 'tax_return'
      then public._ria_infer_tax_return_subtype(source_name, extracted_document_subtype)
    else extracted_document_subtype
  end,
  normalized_document_type_id = case
    when normalized_document_type_id = 'tax_return' then 'tax_document'
    else normalized_document_type_id
  end,
  extracted_document_type_id = case
    when extracted_document_type_id = 'tax_return' then 'tax_document'
    else extracted_document_type_id
  end
where normalized_document_type_id = 'tax_return'
   or extracted_document_type_id = 'tax_return';

update public.cleanup_file_states
set
  document_type_id = case
    when document_type_id = 'tax_return' then 'tax_document'
    else document_type_id
  end,
  recognized_file_type = case
    when recognized_file_type = 'Tax return' then 'Tax document'
    else recognized_file_type
  end
where document_type_id = 'tax_return'
   or recognized_file_type = 'Tax return';

update public.review_decisions
set
  detected_document_type = case
    when detected_document_type = 'Tax return' then 'Tax document'
    else detected_document_type
  end,
  detected_document_subtype = case
    when detected_document_type = 'Tax return' and detected_document_subtype is null
      then public._ria_infer_tax_return_subtype(source_name, detected_document_subtype)
    else detected_document_subtype
  end,
  reviewed_document_subtype = case
    when detected_document_type = 'Tax return' and reviewed_document_subtype is null
      then public._ria_infer_tax_return_subtype(source_name, reviewed_document_subtype)
    else reviewed_document_subtype
  end
where detected_document_type = 'Tax return';

update public.preview_analysis_cache
set insight_json =
  jsonb_set(
    jsonb_set(
      jsonb_set(
        insight_json,
        '{documentTypeId}',
        '"tax_document"'::jsonb,
        true
      ),
      '{documentLabel}',
      '"Tax document"'::jsonb,
      true
    ),
    '{documentSubtype}',
    to_jsonb(public._ria_infer_tax_return_subtype(source_name, insight_json->>'documentSubtype')),
    true
  )
where insight_json->>'documentTypeId' = 'tax_return';

update public.document_canonical_payloads
set canonical_json = replace(
  replace(canonical_json::text, '"documentTypeId":"tax_return"', '"documentTypeId":"tax_document"'),
  '"documentLabel":"Tax return"',
  '"documentLabel":"Tax document"'
)::jsonb
where canonical_json::text like '%tax_return%';

drop function public._ria_infer_tax_return_subtype(text, text);
