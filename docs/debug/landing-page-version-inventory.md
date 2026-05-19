# Landing Page Version Inventory

## Current Problem

The branch `codex/deploy-new-landing-page` had one local commit,
`291d4f0 feat(landing): launch RIA File Ops marketing homepage`, that recreated
a simplified landing page. That page did not match the remembered final release:
it lacked the guided demo, FAQ, real waitlist form, protected admin view, and
centered final `Join Waitlist` CTA.

That commit was treated as the wrong recreated candidate and replaced locally
rather than used as the final source of truth.

## Current Recreated Candidate

Candidate label: current recreated landing candidate

- Commit: `291d4f0`
- Files: `app/page.tsx`, `app/page.module.css`, `app/layout.tsx`,
  `docs/debug/landing-page-production-diagnosis.md`
- Included: simplified hero, static workflow copy, mailto-style waitlist CTA,
  and a `See Workflow` action.
- Missing: guided demo, FAQ, real `/join-waitlist` flow, waitlist storage,
  admin waitlist view, export route, and waitlist migration.
- Result: not the final version and should not be pushed as-is.

## Historical Candidates Found

### Candidate A - Committed landing, guided demo, and waitlist release

- Commit: `8e2b17e3a85ae439462cf65a25207ac216f688d1`
- Message: `Add landing page, guided demo, and waitlist flow`
- Branch: `codex/cleanup-browser-polish` / `origin/codex/cleanup-browser-polish`
- Later reverted by: `4967450 Revert "Add landing page, guided demo, and waitlist flow"`
- Public UI files:
  - `app/page.tsx`
  - `app/page.module.css`
  - `app/guided-filing-demo.tsx`
  - `app/faq-accordion.tsx`
  - `docs/ria-file-ops-landing-page-brief.md`
- Waitlist files:
  - `app/join-waitlist/page.tsx`
  - `app/join-waitlist/waitlist-form.tsx`
  - `app/join-waitlist/actions.ts`
  - `lib/waitlist-signups.ts`
- Admin files:
  - `app/admin/waitlist/page.tsx`
  - `app/admin/waitlist/actions.ts`
  - `app/admin/waitlist/export/route.ts`
  - `lib/admin.ts`
  - `lib/waitlist-admin-view.ts`
- Schema/env files:
  - `supabase/migrations/20260516025839_create_waitlist_signups.sql`
  - `.env.example`
- Demo traits: `Drop sample file`, `Detect upload`, `Edit Details`,
  `Save Details`, editable suggested filename and destination, `Approve & File`,
  faux Schwab statement details, and the note that the team still approves the
  final move.
- Assessment: closest actual final release found.

### Candidate B - Stashed richer filing demo experiment

- Source: `stash@{0}^3:app/filing-demo.tsx`
- Traits: separate `Interactive filing preview` with multiple documents and a
  batch-style simulated flow.
- Assessment: useful context, but not the described finalized guided demo and
  not wired into a complete landing release. It was not restored.

## PR / Branch Candidates

- PR #40 contained `8e2b17e`, then the revert `4967450`, plus older unrelated
  history. It was closed as superseded and is not a clean branch source.
- No other local or remote branch contained a newer complete landing, FAQ, demo,
  waitlist, and admin release.

## Vercel Preview Candidates

- The direct historical deployment for `8e2b17e` showed the complete landing
  structure with guided demo, FAQ, and final waitlist CTA.
- The current production host was confirmed in the earlier diagnosis to be
  serving current main correctly, which still had the old starter homepage.

## Most Likely Final Version

The actual final release was recovered from `8e2b17e`. The stash demo was
inspected but excluded because it looked like a separate later experiment rather
than the final guided filing demo described by the user.

## Differences From The Wrong Current Candidate

- Restored guided filing demo instead of a static workflow section only.
- Restored FAQ.
- Restored `/join-waitlist` with a real form instead of mailto.
- Restored protected `/admin/waitlist` and CSV export.
- Removed the exact unwanted `See Workflow` button copy.
- Restored centered final `Join Waitlist` CTA.
- Adapted copy toward `Document intelligence for RIA operations` and
  `Clean up files. Extract client data. Prep advisor workflows.`

## What Was Recovered

- Public homepage, styles, guided demo, FAQ, and landing brief from `8e2b17e`.
- Real waitlist route and server action from `8e2b17e`.
- Protected admin waitlist view, status update action, and export route from
  `8e2b17e`.
- Additive waitlist Supabase migration from `8e2b17e`.
- Admin allowlist env names in `.env.example`.

## Security Adaptations

- Waitlist persistence now routes through a small current adapter instead of
  reintroducing old app-state persistence changes.
- Supabase/Postgres is used when the current persistence backend is Supabase.
- Local SQLite waitlist storage remains local-development behavior only, guarded
  by the existing PROD-001 fail-closed backend selection.
- Waitlist submission validation normalizes and lowercases email addresses.
- Waitlist action logging uses sanitized error metadata instead of raw errors.
- Admin pages and export route require a logged-in session plus
  `WAITLIST_ADMIN_EMAILS` or `ADMIN_EMAILS`.
- Public users can submit waitlist entries but cannot read the admin listing.

## What Stayed Excluded

- `stash@{0}^3:app/filing-demo.tsx`
- Duplicate/generated stash files such as `components/product-nav 2.tsx` and
  `next-env.d 2.ts`
- Old broad persistence rewrites from `8e2b17e`
- Production env values
- Vercel, Supabase, or Google Cloud setting changes
- Production migration application
- Unrelated auth, intake, or security changes

## Migration Review

`supabase/migrations/20260516025839_create_waitlist_signups.sql` is additive:
it creates `public.waitlist_signups`, indexes, an `updated_at` trigger, and
enables RLS. It does not include `DROP`, `TRUNCATE`, `DELETE`, or unrelated
schema changes. It was restored for review/deployment, but was not applied to
production in this pass.

## Recommended Recovery Plan

1. Replace/amend `291d4f0` with the recovered final release.
2. Keep this branch focused on landing, guided demo, waitlist, admin waitlist,
   and the additive waitlist migration.
3. Before production waitlist use, apply the waitlist migration through the
   normal reviewed database deployment path.
4. Set `WAITLIST_ADMIN_EMAILS` or `ADMIN_EMAILS` in the appropriate deployment
   environment before expecting admin access.
5. Push this branch only after the amended commit is verified and reviewed.
