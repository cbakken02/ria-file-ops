# RIA File Ops Product Status

Last updated: 2026-05-12

## Current Baseline

- Production is deployed from `main` and responding at `https://ria-file-ops.vercel.app`.
- Supabase project `RIA File Ops Project` is `ACTIVE_HEALTHY`.
- Vercel production error logs were clear during the signed-in smoke test window.
- Local `main` was clean before this status document branch was created.

## Signed-In Smoke Test

Tested in Google Chrome with the signed-in production session for Christopher Bakken.

| Area | Status | Notes |
| --- | --- | --- |
| Dashboard | Working | Shows active Google Drive storage, 4 minutes estimated time saved, 1 ready item, 0 failed items. |
| Intake | Working | Shows active Google Drive storage and 1 unfiled ready item: `20220926-statements-5350-.pdf`. |
| Cleanup | Working | Browses Google Drive at `My Drive / Legacy Link / 2_Clients` and shows `Bakken_Christopher` plus `Client_Template`. |
| Data Intelligence | Loads | V2 copilot UI renders with prompt suggestions and input. No prompt was sent during this baseline check. |
| Filing History | Working | Audit page loads with filters and shows no filing history yet. |
| Setup | Working | Storage connected, upload source set to `1_Client Upload`, records destination set to `2_Clients`, and settings show all changes saved. |

## Not Covered In This Baseline

- Approving or filing intake items.
- Running cleanup actions.
- Exporting history CSV.
- Sending Data Intelligence prompts.
- Testing mobile layouts.
- Testing signed-out flows beyond prior redirect checks.

## Active Work

- Open PR: `#20` `[codex] Rescue Data Intelligence follow-up handling`
  - Branch: `codex/rescue-uncommitted-data-intelligence`
  - State: draft, mergeable, Vercel preview previously passed.
  - Recommended next action: update/retest against current `main`, then either merge, split, or close.

## Local Cleanup Queue

Local branches to triage:

- `codex/fix-cleanup-state-schema`
- `codex/fix-supabase-migration-history`
- `codex/rescue-uncommitted-data-intelligence`

Safety stashes to inspect before deleting:

- `stash@{0}`: safety snapshot hidden archive files before branch cleanup 2026-05-12
- `stash@{1}`: safety snapshot before branch cleanup 2026-05-12

## Recommended Next Chunk

1. Update PR `#20` on top of current `main`.
2. Run focused Data Intelligence tests plus `npx tsc --noEmit`, `npm run lint`, and `npm run build`.
3. Smoke-test the PR preview, including one safe Data Intelligence prompt if configured.
4. Decide whether PR `#20` should be merged as-is, split, or closed.
5. After PR `#20` is resolved, inspect and delete obsolete branches/stashes.
