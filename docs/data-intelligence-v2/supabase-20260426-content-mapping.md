# Supabase 20260426 Content Mapping

## Purpose

This document records the local `20260426` migration-content mapping and the
subsequent local duplicate-guard cleanup. It exists to explain why the
accidental duplicate migration was removed from the local migration path before
any Supabase repair or migration apply.

No remote repair or migration apply was performed. No deployment, push, pull
request, OpenAI call, or production-resource change was performed.

## Current Known State

- The tracked migration remains:
  `20260426_phase1_cleanup_file_states.sql`.
- The accidental local duplicate guard migration was removed after local
  verification:
  `20260426120000_phase1_cleanup_file_states_duplicate_guard.sql`.
- The removed duplicate guard file was untracked, byte-identical to the tracked
  `20260426` migration, and normalized-SQL-identical.
- Local migration versions are unique.
- The V2 reveal-card migration remains local and pending remotely:
  `20260429_data_intelligence_v2_reveal_cards.sql`.
- The V2 audit-event migration remains local and pending remotely:
  `20260430_data_intelligence_v2_audit_events.sql`.
- V1 fallback remains intact and V2 remains feature-flagged.

## Verification Before Deletion

The duplicate guard was deleted only after these local checks passed:

| Check | Result |
| --- | --- |
| Tracked `20260426_phase1_cleanup_file_states.sql` exists | true |
| Duplicate guard was untracked | true |
| Full SHA-256 hashes matched | true |
| Normalized SQL SHA-256 hashes matched | true |
| Byte comparison matched | true |
| No DML or destructive statements were detected in the cleanup DDL | true |

Shared hash evidence:

- Full SHA-256:
  `27fcaec52a294a83075725fbcc6ac6da0009f8574e98dace9c2480b1c5353716`
- Normalized SQL SHA-256:
  `c8813e55cb33623a78df835830242cea3be056c2351cef8ad15d9c5460857a77`

The cleanup migration affects `cleanup_file_states` and related indexes through
`create_table`, `alter_table`, and `create_index` operations.

## Post-Cleanup Local Diagnosis

After deletion:

- Local migration count is 7.
- Duplicate local migration versions are zero.
- `20260426120000` is no longer present locally.
- `20260426_phase1_cleanup_file_states.sql` remains present.
- `20260429_data_intelligence_v2_reveal_cards.sql` remains present.
- `20260430_data_intelligence_v2_audit_events.sql` remains present.
- Forbidden migration pattern findings are zero.

## Read-Only Remote Diagnosis

A read-only Supabase migration-list diagnosis completed after the local cleanup.
It reported:

- matched versions: `20260424`, `20260425`, `20260426`
- remote-only versions: none
- local-only versions: `20260427`, `20260428`, `20260429`, `20260430`
- pending V2 versions: `20260429`, `20260430`
- parser confidence: high

This means the local duplicate guard was the source of the earlier unpaired
`20260426` view. The remote history now appears clean for `20260426`, while
later local migrations are still pending.

One optional content-mapping remote check timed out, so the completed
`diagnose-supabase-migration-history` output is the authoritative read-only
signal from this cleanup pass.

## Mapping Conclusion

Updated category:
`clean_after_duplicate_removal`

Confidence:
high for local cleanup; high for the read-only remote-list parse that shows
`20260426` matched.

Evidence:

- The duplicate guard was untracked.
- The duplicate guard was byte-identical to the tracked `20260426` migration.
- The duplicate guard had the same normalized SQL hash as the tracked
  `20260426` migration.
- Removing it left a clean local migration path with no duplicate versions.
- The read-only remote migration list now shows `20260426` matched.

Unknowns:

- The later local migrations `20260427`, `20260428`, `20260429`, and
  `20260430` are still pending remotely.
- Preview migration apply still requires explicit approval and a controlled
  Supabase preview plan.

## Recommended Future Path

Next controlled sequence:

1. Keep the duplicate guard deleted from the local migration path.
2. Re-run local readiness before preview migration work.
3. Confirm read-only remote migration list still shows `20260426` matched.
4. Plan preview apply for pending local migrations only after approval.
5. Keep production untouched until preview proves the migration and rollback
   path.

## Candidate Future Commands

These are examples only. Do not run them until explicitly approved:

```bash
node scripts/diagnose-supabase-migration-history.mjs --json --with-supabase-cli
node scripts/preflight-data-intelligence-v2-deployment.mjs --json --with-supabase-cli
```

Do not run Supabase migration repair unless a separate future task explicitly
requires it.

## Rollback And Fallback Context

V1 fallback remains intact. V2 remains feature-flagged and should not become
the default deployment path until preview migration application, durable reveal
storage, audit logging, environment names, and rollback have been verified.

Do not remove V1 before preview succeeds and rollback is tested.
