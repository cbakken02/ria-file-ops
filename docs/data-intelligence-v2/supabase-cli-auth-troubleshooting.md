# Supabase CLI Auth Troubleshooting

This note is for making the read-only command `supabase migration list` pass reliably before any controlled preview migration apply for Data Intelligence V2.

## Why This Matters

`supabase migration list` verifies that the linked Supabase project can be reached through the same CLI database-auth path that a future migration apply will need. If the read-only list command fails with database authentication or circuit-breaker errors, stop before applying migrations.

Current expected migration state after the controlled V2 preview apply:

- Matched remotely and locally: `20260424`, `20260425`, `20260426`,
  `20260427`, `20260428`, `20260429`, `20260430`
- Pending locally: none expected
- V2 reveal-card migration applied to preview: `20260429`
- V2 audit-events migration applied to preview: `20260430`
- Remote-only migrations expected: none
- A Vercel Preview deployment has since completed for this V2 preview sequence.
- V1 fallback remains intact while V2 remains feature-flagged.

## Safe Checks

Run only read-only checks while diagnosing auth:

```sh
supabase --version
supabase projects list --help
supabase migration list --help
supabase migration list
node scripts/diagnose-supabase-migration-history.mjs --json --with-supabase-cli
node scripts/preflight-data-intelligence-v2-deployment.mjs --json --with-supabase-cli
```

Do not print secrets, database URLs, project refs, database passwords, access tokens, or environment values.

## Required Env Names

Check presence only, never values:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`
- `SUPABASE_PROJECT_ID` or equivalent project-ref metadata

The CLI may also see these app database env names in local shells or deployment environments, but they should not be printed:

- `SUPABASE_DB_URL`
- `SUPABASE_DB_URL_POOLER`

## Missing Password

If `SUPABASE_DB_PASSWORD` is missing and `supabase migration list` fails with a database-auth message, set `SUPABASE_DB_PASSWORD` for the command or shell session only. Do not commit it, paste it into docs, or print it in terminal output.

## Stale Or Wrong Password

If `SUPABASE_DB_PASSWORD` is present but `supabase migration list` still fails authentication, confirm or reset the database password in the Supabase dashboard, then update the local shell or secret manager only. Do not put the password in source-controlled files.

## Circuit Breaker

If the CLI reports a circuit breaker or too many failed authentication attempts, wait before retrying. Avoid repeated failed attempts, because they can extend the lockout window and make diagnosis noisier.

## After Recovery

Once `supabase migration list` passes directly and reports the expected state,
continue to Vercel Preview env verification and preview deployment planning.
If an unsanitized shell check fails authentication but the safe-env migration
diagnostic and deployment preflight pass, inspect local shell database env
configuration before attempting any future migration apply.

Do not run migration repair or migration apply commands unless a later prompt
explicitly approves them.

No destructive commands are part of this troubleshooting pass.
