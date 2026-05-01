# State ID | Missing expiration and unclear ID number

## What this case is testing

- Designed to prove conservative handling of missing or partial ID facts.
- Issue date, name, DOB, and address remain readable even though the card is incomplete.
- Useful for later evaluator support around expected ambiguities.

## Document family

- Category: Incomplete / unclear ID
- Target document type: identity_document
- Target subtype truth: state_id
- Expected ID type: State ID

## Expected ambiguity

- `parties[0].governmentIds[0].value`: The visible ID number is intentionally clipped and should stay unresolved.. Expected resolution: `null`.
- `dates[expiration_date].value`: The expiration field is intentionally missing or unreadable.. Expected resolution: `null`.
