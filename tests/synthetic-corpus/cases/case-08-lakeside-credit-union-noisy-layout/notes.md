# Lakeside Community Credit Union | Noisy disclosure-heavy checking statement

## What this case is testing

- Deliberately includes error-resolution language like 'Describe the error' to stress false-positive name extraction.
- Still has a clean owner/address block near the top, so ground truth remains unambiguous.
- Useful as a real-world hardening case for noisy retail-bank statement layouts.

## Document family

- Category: Messy / noisy statement layout
- Target document type: account_statement
- Target subtype truth: bank_statement

## Expected ambiguity

- None. This case is intended to have one clean semantic interpretation.

