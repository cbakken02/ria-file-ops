# Charles Schwab household summary | Joint brokerage and investor checking

## What this case is testing

- Tests joint-owner detection and stable owner ordering.
- Each account should link to both parties via accountParties.
- Good case for guarding against flattening a joint summary into one primary account.

## Document family

- Category: Multi-account summary statement
- Target document type: account_statement
- Target subtype truth: multi_account_summary

## Expected ambiguity

- `normalized.primaryFacts.accountLast4`: Two joint-owned accounts are shown in the same household summary. Expected resolution: `null`.
- `normalized.primaryFacts.accountType`: The document contains both brokerage and checking account types. Expected resolution: `null`.
