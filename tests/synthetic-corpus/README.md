# Synthetic Statement Corpus

This corpus is a practical starter set for preview/parser evaluation in RIA File Ops. It is optimized for known ground truth, deterministic regeneration, and text-extractable PDFs rather than visual perfection.

## Generation path

The easiest path is:

1. Author reusable HTML/CSS statement templates.
2. Keep case truth in code/data close to the generated artifacts.
3. Render the HTML to PDF with local headless Chrome.

Why this path is the best fit here:

- The source stays diff-friendly and easy to review.
- PDFs are reproducible from local source without extra npm dependencies.
- Chrome-generated PDFs keep text selectable, which makes them useful for parser testing.
- Case layout variants can stay realistic enough without introducing design-tool overhead.

## Command

Regenerate the corpus with:

```bash
node ./scripts/generate-synthetic-statement-corpus.mjs
```

The generator writes:

- `tests/synthetic-corpus/manifest.json`
- `tests/synthetic-corpus/cases/<case-id>/statement.html`
- `tests/synthetic-corpus/cases/<case-id>/statement.pdf` when local Chrome is available
- `tests/synthetic-corpus/cases/<case-id>/answer_key.json`
- `tests/synthetic-corpus/cases/<case-id>/notes.md`

## Initial 8 cases

| Case ID | Family | What it stresses | Expected ambiguity |
| --- | --- | --- | --- |
| `case-01-us-bank-smartly-checking-single` | Single-account bank | Raw institution normalization, branded checking label, clean owner block | None |
| `case-02-harbor-state-premier-savings-single` | Single-account bank | Simple savings statement, beginning/ending balances, straightforward contact extraction | None |
| `case-03-fidelity-summary-brokerage-roth-ira` | Multi-account summary | Two accounts, retirement + taxable mix, conservative primary facts | `normalized.primaryFacts.accountLast4`, `normalized.primaryFacts.accountType` |
| `case-04-schwab-household-joint-summary` | Multi-account summary | Joint ownership, multiple accounts, two named owners | `normalized.primaryFacts.accountLast4`, `normalized.primaryFacts.accountType` |
| `case-05-vanguard-rollover-ira-quarterly` | Retirement / rollover | Rollover IRA terminology, retirement framing, rollover support contact | None |
| `case-06-empower-401k-rollover-support` | Retirement / rollover | 401(k) retirement statement, rollover-support contact cues, plan language | None |
| `case-07-jackson-fixed-indexed-annuity-annual` | Annuity | Annuity product naming, cash value, insurer-style statement wording | None |
| `case-08-lakeside-credit-union-noisy-layout` | Messy / noisy | Disclosure-heavy layout, all-caps noise, competing footer/sidebar text | None |

## Notes on truth format

Each `answer_key.json` captures semantic ground truth for future parser assertions, including:

- `documentTypeId`
- `documentSubtype`
- `parties`
- `institutions`
- `contacts`
- `accounts`
- `accountParties`
- `dates`
- `normalized.primaryFacts`
- account-level values/balances
- `expectedAmbiguities`

The answer keys are meant to be the corpus truth source even if the current parser does not yet populate every field.
