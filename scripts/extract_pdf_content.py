#!/usr/bin/env python3

import json
import re
import sys
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

from pypdf import PdfReader


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def digit_count(value: str) -> int:
    return len(re.sub(r"\D", "", value or ""))


def is_all_zero_numeric(value: str) -> bool:
    digits = re.sub(r"\D", "", value or "")
    return bool(digits) and set(digits) == {"0"}


def decode_pdf_literal(value: str) -> str:
    return (
        value.replace("\\(", "(")
        .replace("\\)", ")")
        .replace("\\\\", "\\")
        .replace("\\n", " ")
        .replace("\\r", " ")
        .replace("\\t", " ")
    )


def extract_text_candidates_from_stream(stream_object) -> List[str]:
    try:
        data = stream_object.get_data()
    except Exception:
        return []

    if isinstance(data, bytes):
        raw = data.decode("latin-1", errors="ignore")
    else:
        raw = str(data)

    candidates: List[str] = []

    for literal in re.findall(r"\(([^()]*)\)", raw):
        cleaned = clean_text(decode_pdf_literal(literal))
        if cleaned:
            candidates.append(cleaned)

    for hex_literal in re.findall(r"<([0-9A-Fa-f]{2,})>", raw):
        if len(hex_literal) % 2 != 0:
            continue
        try:
            decoded = bytes.fromhex(hex_literal).decode("utf-16-be")
        except Exception:
            try:
                decoded = bytes.fromhex(hex_literal).decode("latin-1", errors="ignore")
            except Exception:
                continue

        cleaned = clean_text(decoded)
        if cleaned:
            candidates.append(cleaned)

    return candidates


def collect_candidates_from_appearance_object(
    appearance_object, source_label: str
) -> List[Tuple[str, str]]:
    if appearance_object is None:
        return []

    try:
        appearance_object = appearance_object.get_object()
    except Exception:
        pass

    if hasattr(appearance_object, "get_data"):
        return [
            (source_label, candidate)
            for candidate in extract_text_candidates_from_stream(appearance_object)
        ]

    candidates: List[Tuple[str, str]] = []

    try:
        values = appearance_object.values()
    except Exception:
        values = []

    for value in values:
        candidates.extend(collect_candidates_from_appearance_object(value, source_label))

    return candidates


def collect_field_value_candidates(annotation, parent_object) -> List[Tuple[str, str]]:
    candidates: List[Tuple[str, str]] = []

    for container_label, container in [("widget", annotation), ("parent", parent_object)]:
        if container is None:
            continue

        for key in ["/V", "/DV"]:
            try:
                raw_value = container.get(key)
            except Exception:
                raw_value = None

            if raw_value not in (None, "", "()"):
                cleaned = clean_text(str(raw_value))
                if cleaned:
                    candidates.append((f"{container_label} {key}", cleaned))

        try:
            appearance = container.get("/AP")
        except Exception:
            appearance = None

        candidates.extend(
            collect_candidates_from_appearance_object(
                appearance,
                f"{container_label} /AP",
            )
        )

    return candidates


def summarize_widget(annotation, parent_object) -> str:
    parts: List[str] = []

    def get_value(key: str):
        for container in [annotation, parent_object]:
            if container is None:
                continue
            try:
                value = container.get(key)
            except Exception:
                value = None
            if value not in (None, ""):
                return value
        return None

    field_type = get_value("/FT")
    field_flags = get_value("/Ff")
    max_length = get_value("/MaxLen")

    if field_type is not None:
        parts.append(f"FT={field_type}")
    if field_flags is not None:
        parts.append(f"Ff={field_flags}")
    if max_length is not None:
        parts.append(f"MaxLen={max_length}")

    return ", ".join(parts)


def choose_preferred_field_value(
    field_name: str,
    existing: Optional[str],
    candidate: Optional[str],
) -> Optional[str]:
    existing = clean_text(existing or "")
    candidate = clean_text(candidate or "")

    if not candidate:
        return existing or None
    if not existing:
        return candidate

    lower_name = (field_name or "").lower()
    looks_numeric = (
        "account" in lower_name
        or "acct" in lower_name
        or "number" in lower_name
        or "routing" in lower_name
        or "gnum" in lower_name
    )

    if looks_numeric:
        existing_is_zero = is_all_zero_numeric(existing)
        candidate_is_zero = is_all_zero_numeric(candidate)

        if existing_is_zero and not candidate_is_zero:
            return candidate
        if candidate_is_zero and not existing_is_zero:
            return existing

        existing_digits = digit_count(existing)
        candidate_digits = digit_count(candidate)
        if candidate_digits > existing_digits:
            return candidate
        if existing_digits > candidate_digits:
            return existing

    if len(candidate) > len(existing):
        return candidate

    return existing


def collect_widget_fields(reader: PdfReader) -> Tuple[Dict[str, str], List[Dict[str, str]]]:
    fields: dict[str, str] = {}
    entries: List[Dict[str, str]] = []

    for page_index, page in enumerate(reader.pages, start=1):
        annotations = page.get("/Annots") or []
        for annotation_index, annotation_ref in enumerate(annotations, start=1):
            try:
                annotation = annotation_ref.get_object()
            except Exception:
                continue

            if str(annotation.get("/Subtype")) != "/Widget":
                continue

            value = annotation.get("/V")
            field_name = annotation.get("/T")
            parent = annotation.get("/Parent")
            parent_object = None

            if (field_name is None or str(field_name).strip() == "") and parent is not None:
                try:
                    parent_object = parent.get_object()
                    field_name = parent_object.get("/T") or field_name
                except Exception:
                    field_name = field_name
            elif parent is not None:
                try:
                    parent_object = parent.get_object()
                except Exception:
                    parent_object = None

            cleaned_name = clean_text(str(field_name or "unnamed_field"))

            if not cleaned_name:
                continue

            widget_meta = summarize_widget(annotation, parent_object)
            if widget_meta:
                entries.append(
                    {
                        "name": f"{cleaned_name} [p{page_index} #{annotation_index} meta]",
                        "value": widget_meta,
                    }
                )

            raw_candidates = collect_field_value_candidates(annotation, parent_object)
            ordered_candidates: List[Tuple[str, str]] = []

            for source_label, candidate in raw_candidates:
                cleaned_candidate = clean_text(candidate)
                if not cleaned_candidate:
                    continue
                ordered_candidates.append((source_label, cleaned_candidate))

            if not ordered_candidates and value not in (None, "", "()"):
                cleaned_value = clean_text(str(value))
                if cleaned_value:
                    ordered_candidates.append(("widget /V", cleaned_value))

            if not ordered_candidates:
                entries.append(
                    {
                        "name": f"{cleaned_name} [p{page_index} #{annotation_index} empty]",
                        "value": "(no /V, /DV, or /AP text)",
                    }
                )

            for source_label, candidate in ordered_candidates:
                fields[cleaned_name] = (
                    choose_preferred_field_value(
                        cleaned_name,
                        fields.get(cleaned_name),
                        candidate,
                    )
                    or candidate
                )
                entries.append(
                    {
                        "name": f"{cleaned_name} [p{page_index} #{annotation_index} {source_label}]",
                        "value": candidate,
                    }
                )

    return fields, entries


def main() -> int:
    if len(sys.argv) != 2:
        print(json.dumps({"error": "Expected a single PDF file path argument."}))
        return 1

    pdf_path = Path(sys.argv[1])
    if not pdf_path.exists():
      print(json.dumps({"error": f"File not found: {pdf_path}"}))
      return 1

    try:
        reader = PdfReader(str(pdf_path))
        text_parts = []
        field_entries: List[Dict[str, str]] = []

        for page in reader.pages:
            try:
                text_parts.append(page.extract_text() or "")
            except Exception:
                text_parts.append("")

        text = clean_text("\n".join(text_parts))

        try:
            acro_form = reader.trailer.get("/Root", {}).get("/AcroForm")
            if acro_form is not None:
                try:
                    acro_form = acro_form.get_object()
                except Exception:
                    pass

                field_count = 0
                need_appearances = None
                has_xfa = False
                sig_flags = None

                try:
                    raw_fields = acro_form.get("/Fields") or []
                    field_count = len(raw_fields)
                except Exception:
                    field_count = 0

                try:
                    need_appearances = acro_form.get("/NeedAppearances")
                except Exception:
                    need_appearances = None

                try:
                    has_xfa = acro_form.get("/XFA") is not None
                except Exception:
                    has_xfa = False

                try:
                    sig_flags = acro_form.get("/SigFlags")
                except Exception:
                    sig_flags = None

                meta_parts = [f"fieldCount={field_count}", f"hasXFA={'yes' if has_xfa else 'no'}"]
                if need_appearances is not None:
                    meta_parts.append(f"NeedAppearances={need_appearances}")
                if sig_flags is not None:
                    meta_parts.append(f"SigFlags={sig_flags}")

                field_entries.append(
                    {
                        "name": "PDF Form [meta]",
                        "value": ", ".join(meta_parts),
                    }
                )
        except Exception:
            pass

        fields = {}
        try:
            raw_fields = reader.get_fields() or {}
            for field_name, field_info in raw_fields.items():
                if isinstance(field_info, dict):
                    value = field_info.get("/V")
                    default_value = field_info.get("/DV")
                else:
                    value = None
                    default_value = None

                if value is None and default_value is None:
                    continue

                for source_label, raw_candidate in [("form /V", value), ("form /DV", default_value)]:
                    if raw_candidate is None:
                        continue

                    cleaned_value = clean_text(str(raw_candidate))
                    if not cleaned_value:
                        continue

                    cleaned_name = str(field_name)
                    fields[cleaned_name] = (
                        choose_preferred_field_value(
                            cleaned_name,
                            fields.get(cleaned_name),
                            cleaned_value,
                        )
                        or cleaned_value
                    )
                    field_entries.append(
                        {
                            "name": f"{cleaned_name} [{source_label}]",
                            "value": cleaned_value,
                        }
                    )
        except Exception:
            fields = {}
            field_entries = []

        try:
            widget_fields, widget_entries = collect_widget_fields(reader)
            for field_name, value in widget_fields.items():
                if value:
                    fields[field_name] = (
                        choose_preferred_field_value(
                            field_name,
                            fields.get(field_name),
                            value,
                        )
                        or value
                    )
            field_entries.extend(widget_entries)
        except Exception:
            pass

        print(
            json.dumps(
                {
                    "text": text,
                    "fields": fields,
                    "field_entries": field_entries,
                }
            )
        )
        return 0
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
