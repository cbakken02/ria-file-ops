# Landing Page Production Diagnosis

## User-Reported Issue

Production at `https://ria-file-ops.vercel.app/` still showed the older starter
homepage. The expected release had a fuller marketing homepage with a guided
filing demo, FAQ, real waitlist form, and protected waitlist admin workflow.

## Current Production Homepage

The earlier browser check showed production serving the old main homepage:

- Eyebrow: `RIA document intake, cleaned up`
- Hero: `Turn messy client uploads into a clean, searchable client record.`
- Primary logged-out action: `Sign in to begin`
- Secondary action: `Open settings`

That production host returned the current `/` route implementation from main.

## Current Main Homepage Implementation

At the time of diagnosis, `origin/main` was
`e2bc54d6699e1694061b071174ef391bcd1c66af`. Main still contained the older
starter homepage in `app/page.tsx`, so production was not stale or misrouted.

## New Landing Page Source / Branch / Commit

The final release source was found in historical commit:

- `8e2b17e3a85ae439462cf65a25207ac216f688d1`
- Message: `Add landing page, guided demo, and waitlist flow`

That commit lived on `codex/cleanup-browser-polish` /
`origin/codex/cleanup-browser-polish` and was later reverted by:

- `4967450 Revert "Add landing page, guided demo, and waitlist flow"`

The reverted commit bundled:

- public landing UI
- guided filing demo
- FAQ
- `/join-waitlist`
- protected `/admin/waitlist`
- waitlist export route
- waitlist persistence helpers
- `.env.example` admin variables
- `supabase/migrations/20260516025839_create_waitlist_signups.sql`

## Vercel Deployment State

Vercel production was serving current main correctly. The issue was therefore
code absence from main, not a stale deployment, cache issue, redirect issue, or
Vercel production mismatch.

## Root Cause

The final landing/waitlist/demo release was not in current main. It had been
committed in `8e2b17e`, then reverted in the older polluted branch before the
security cleanup work was split into clean PRs.

## Recovery Implemented

The current branch restores the finalized release from `8e2b17e` rather than
the simplified recreated landing page.

Recovered:

- `app/page.tsx` and `app/page.module.css`
- `app/guided-filing-demo.tsx`
- `app/faq-accordion.tsx`
- `app/join-waitlist/*`
- `app/admin/waitlist/*`
- `lib/admin.ts`
- `lib/waitlist-signups.ts`
- `lib/waitlist-admin-view.ts`
- `docs/ria-file-ops-landing-page-brief.md`
- `supabase/migrations/20260516025839_create_waitlist_signups.sql`

Adapted for the current codebase:

- Added a small `lib/waitlist-store.ts` adapter so waitlist persistence follows
  the current central persistence backend boundary.
- Kept local SQLite support local-development only through the existing
  PROD-001 fail-closed backend rules.
- Sanitized waitlist action error logging.
- Updated copy toward the final product direction:
  `Document intelligence for RIA operations` and
  `Clean up files. Extract client data. Prep advisor workflows.`

## What Stayed Excluded

- Broad old persistence rewrites from `8e2b17e`
- The separate stashed `app/filing-demo.tsx` batch-demo experiment
- Duplicate/generated stash files
- Production env values
- Vercel, Supabase, Google Cloud, or production setting changes
- Production migration execution
- Unrelated auth, intake, or security work

## Risks

- Production waitlist submissions require the waitlist table migration to be
  applied through the normal reviewed database deployment path before use.
- Waitlist admin access requires `WAITLIST_ADMIN_EMAILS` or `ADMIN_EMAILS` to be
  configured in the intended deployment environment.
- The admin/export surfaces are server protected, but should still be reviewed
  in PR before enabling production admin usage.

## Verification Plan

1. Verify `/` renders the restored landing page with guided demo, FAQ, and final
   waitlist CTA.
2. Verify `/join-waitlist` renders the restored form.
3. Verify `/admin/waitlist` redirects or denies access for non-admin users.
4. Verify waitlist validation normalizes email and rejects invalid selections.
5. Verify the waitlist migration is additive and enables RLS.
6. Run `npm run lint`.
7. Run `npm run build`.
8. Run `git diff --check`.
9. Push/open PR only after review. Do not apply production migrations from this
   branch without explicit approval.
