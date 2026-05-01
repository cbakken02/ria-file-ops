# U.S. Bank Smartly Checking | Single-owner retail bank statement

## What this case is testing

- Owner name and mailing address are isolated in a clean header block.
- Institution truth intentionally uses a raw long-form bank name plus a shorter normalized custodian.
- Account type truth is canonical Checking even though the visible label is branded.

## Document family

- Category: Simple single-account bank statement
- Target document type: account_statement
- Target subtype truth: bank_statement

## Expected ambiguity

- None. This case is intended to have one clean semantic interpretation.

