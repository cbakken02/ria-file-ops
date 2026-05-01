# Synthetic Identity-Document Corpus

This corpus is the identity-document counterpart to the synthetic statement corpus. It is optimized for known ground truth, deterministic regeneration, and text-extractable PDFs rather than visual perfection.

## Generation path

1. Author reusable HTML/CSS ID-card templates.
2. Keep case truth in code/data close to the rendered artifacts.
3. Render HTML to PDF with local headless Chrome.

Why this path works well here:

- Source files stay diff-friendly and easy to review.
- PDFs are reproducible locally without introducing design-tool overhead.
- Chrome-generated PDFs keep text selectable, which is useful for OCR/PDF-text parser work.
- We can add front/back or noisy variants later without changing the answer-key contract.

## Command

```bash
node ./scripts/generate-synthetic-identity-corpus.mjs
```

The generator writes:

- `tests/synthetic-id-corpus/manifest.json`
- `tests/synthetic-id-corpus/cases/<case-id>/document.html`
- `tests/synthetic-id-corpus/cases/<case-id>/document.pdf` when local Chrome is available
- `tests/synthetic-id-corpus/cases/<case-id>/answer_key.json`
- `tests/synthetic-id-corpus/cases/<case-id>/notes.md`

## Initial 5 cases

| Case ID | Family | What it stresses | Expected ambiguity |
| --- | --- | --- | --- |
| `case-01-wi-driver-license-clean` | Clean driver’s license | Clean name, DOB, address, ID number, issue date, expiration date, and issuing state. | None |
| `case-02-co-state-id-clean` | Clean state ID | State ID should not be forced into Driver License while preserving the same core identity fields. | None |
| `case-05-alex-demo-driver-license-old-expired` | Older expired license for the same person | Older expired license for Alex Demo to support later latest-ID and expired-vs-current tests. | None |
| `case-06-alex-demo-driver-license-renewed-current` | Newer renewed/current license for the same person | Newer unexpired replacement license for the same person, suitable for latest-ID and latest-address tests. | None |
| `case-08-state-id-missing-expiration-or-unclear-id-number` | Incomplete / unclear ID | Conservative null-handling for a state ID with a clipped/unclear ID number and no reliable expiration date. | `parties[0].governmentIds[0].value`, `dates[expiration_date].value` |

## Notes on truth format

Each `answer_key.json` captures semantic ground truth for future parser and SQLite assertions, including:

- `documentTypeId`
- `documentSubtype`
- `parties`
- `governmentIds`
- `dates`
- `documentFacts.idType`
- `normalized.documentFacts`
- `normalized.primaryFacts`
- `expectedAmbiguities`

The answer keys are meant to be the identity-document truth source even before the evaluator and SQLite projection are implemented.

