# Supabase Migration Reconciliation Plan

This is a migration-history planning document for reconciling Supabase
migration history around the V2 preview apply. No migration repair, deployment,
push, or production-resource change was performed while preparing or updating
this plan.

## Current Known State

- Local migration readiness is clean: duplicate local migration versions are
  currently zero.
- The former duplicate local cleanup migration was removed from the local
  migration path after it was verified as untracked and byte-identical to the
  tracked `20260426` migration.
- A local `20260426_phase1_cleanup_file_states.sql` migration still exists.
- A dedicated local content-mapping pass has been documented in
  `docs/data-intelligence-v2/supabase-20260426-content-mapping.md`.
- The remote/local migration list previously showed a mismatch around
  `20260426`, but the post-cleanup read-only diagnosis now shows `20260426`
  matched.
- The V2 reveal-card migration exists locally:
  `20260429_data_intelligence_v2_reveal_cards.sql`.
- The V2 audit-event migration exists locally:
  `20260430_data_intelligence_v2_audit_events.sql`.
- Preview Supabase migrations were applied in a controlled run on
  April 29, 2026 after the linked project was confirmed outside this shell as
  preview/staging/dev/non-production.
- A Vercel Preview deployment has since completed for this V2 preview sequence.
- Post-apply read-only diagnostics verified matched local/remote migration
  history through `20260430`, with no local-only or remote-only versions in the
  safe verification path.
- The V2 reveal/audit migrations are applied to preview.

## Why This Matters

Applying pending migrations on top of unclear migration history can make
Supabase migration tracking harder to reason about. The accidental local
duplicate is now removed, and `20260426` appears matched in the read-only
remote list. The V2 reveal/audit tables have now been applied to preview after
the remaining pending migrations, tests, evals, confirmation gates, and
rollback context were verified.

## Non-Destructive Checks

Run these checks only for diagnosis; they do not apply migrations:

```bash
node scripts/map-supabase-20260426-migration-content.mjs --json
node scripts/diagnose-supabase-migration-history.mjs --json
node scripts/diagnose-supabase-migration-history.mjs --json --with-supabase-cli
node scripts/check-supabase-migration-readiness.mjs --json
node scripts/preflight-data-intelligence-v2-deployment.mjs --json --with-supabase-cli
```

If the remote check times out or is unavailable before a future migration
apply, treat the result as unknown and do not apply pending migrations.

## Possible Reconciliation Paths

### Path 1: Duplicate Removed, 20260426 Matched

If the diagnostic shows `20260426` matched and only later local migrations
pending, the earlier mismatch was caused by the accidental duplicate local
guard file.

Current controlled state:
- keep the duplicate guard deleted,
- rerun readiness before any future migration apply,
- expect all migrations through `20260430` to be matched in preview.

### Path 2: Remote 20260426 Corresponds To An Existing Local File

If the remote applied `20260426` corresponds to the current local cleanup SQL,
verify the mapping through safe means before applying anything.

Current local content evidence points to
`20260426_phase1_cleanup_file_states.sql`, and the post-cleanup remote list
shows `20260426` matched.

Future controlled steps:
- compare migration names/content from git history or Supabase metadata without
  printing secrets,
- decide whether the history table needs alignment,
- use a future controlled repair only with explicit approval.

Do not run `supabase migration repair` during diagnosis.

### Path 3: Remote 20260426 Has No Local Equivalent

If the remote applied `20260426` does not correspond to any current local file,
recover the missing local migration from git history or Supabase metadata if
possible.

Future controlled steps:
- add back the exact missing migration version locally,
- rerun readiness,
- only then plan preview migration apply.

### Path 4: The Renamed Duplicate Should Remain Pending

This path is no longer the current recommendation. The duplicate guard was
removed locally after byte-identical/untracked verification.

Future controlled steps:
- only revisit this path if new evidence shows the duplicate guard was
  intentional.

## Future Commands

These examples are future read-only checks:

```bash
node scripts/diagnose-supabase-migration-history.mjs --json --with-supabase-cli
node scripts/preflight-data-intelligence-v2-deployment.mjs --json --with-supabase-cli
```

A future controlled repair may involve Supabase migration repair, but only
after the exact remote/local mapping is known and approved. This plan does not
recommend running repair as part of readiness discovery.

## Preview Apply Gate

Future preview migration apply is allowed only after:

- local duplicate versions are zero,
- the read-only remote list still shows `20260426` matched,
- any new V2 migrations show as pending local-only in expected order,
- Vercel Preview env names are configured,
- tests and evals pass,
- rollback flags and V1 fallback are documented.

## Rollback And Fallback Context

V1 fallback remains intact. V2 can be disabled with feature flags if preview
reveals an issue:

- `DATA_INTELLIGENCE_V2_UI_ENABLED`
- `DATA_INTELLIGENCE_V2_CHAT_API_ENABLED`
- `DATA_INTELLIGENCE_V2_REVEAL_API_ENABLED`
- `DATA_INTELLIGENCE_V2_ENABLED`

Do not remove V1 before preview succeeds and rollback has been tested.
