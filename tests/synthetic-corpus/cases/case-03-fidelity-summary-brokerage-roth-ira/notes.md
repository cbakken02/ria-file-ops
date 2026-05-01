# Fidelity multi-account summary | Brokerage and Roth IRA

## What this case is testing

- Multi-account truth should preserve both accounts independently instead of flattening one.
- The document still has a single unambiguous owner and a single custodian.
- This is a good baseline for future multi-account canonical population tests.

## Document family

- Category: Multi-account summary statement
- Target document type: account_statement
- Target subtype truth: multi_account_summary

## Expected ambiguity

- `normalized.primaryFacts.accountLast4`: Two accounts are equally primary in the same summary statement. Expected resolution: `null`.
- `normalized.primaryFacts.accountType`: Two distinct account types are present in the same summary statement. Expected resolution: `null`.
