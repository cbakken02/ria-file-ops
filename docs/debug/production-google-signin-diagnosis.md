# Production Google Sign-In Diagnosis

## Current Symptom

Production Google sign-in previously started from the app login page, completed enough of the Google OAuth leg to return to the app, then bounced back to `/login?reason=verification_failed`.

The production database fix has now been applied. Browser verification after the fix reaches `/dashboard` successfully.

This diagnosis covers app login through NextAuth/Auth.js. The separate Google Drive storage OAuth connection is only relevant where it shares host, callback, or environment assumptions.

## Browser Reproduction Notes

- Production site opened at `https://ria-file-ops.vercel.app`.
- Landing page "Sign in to begin" navigated to `/login`.
- `/login` rendered the enabled "Sign in with Google" button, which means the production deployment sees Google OAuth env names at render time.
- Before the database fix, clicking "Sign in with Google" returned to `https://ria-file-ops.vercel.app/login?reason=verification_failed`.
- After the database fix, the same production app session reaches `https://ria-file-ops.vercel.app/dashboard` and renders the dashboard.
- Chrome likely reused an existing Google session, so the interactive Google account screen was not captured in this pass.
- No OAuth codes, state values, cookie values, tokens, secrets, database URLs, or private env values were recorded.

Sanitized endpoint checks on the same production host:

- `/api/auth/providers` returns the Google provider.
- `/api/auth/csrf` returns 200 and sets secure NextAuth cookie names.
- Posting to `/api/auth/signin/google` returns a Google OAuth authorization URL.
- The generated Google authorization request targets `accounts.google.com` and includes the expected OAuth parameter names.
- The generated `redirect_uri` host/path is `ria-file-ops.vercel.app` and `/api/auth/callback/google`.

## Exact Failure Point

The failure is after the Google OAuth start route and after a successful enough callback to produce an app session. The app then redirects to `/dashboard`, where `requireSession()` calls `getAppPrincipalResultFromSession()` and `enforceSessionActivity()`.

`/login?reason=verification_failed` is produced when session activity verification fails. A missing or unreadable session would redirect to `/login` without this reason, so the observed URL points at the app's server-side session activity persistence path rather than a pre-Google sign-in button problem.

## Intended Production Host

Vercel project metadata lists these project domains:

- `ria-file-ops.vercel.app`
- `ria-file-ops-cbakken02-1285s-projects.vercel.app`
- `ria-file-ops-git-main-cbakken02-1285s-projects.vercel.app`

No custom domain was surfaced by the Vercel project metadata checked in this pass. The code also defines `ria-file-ops.vercel.app` as the canonical production host in `lib/vercel-canonical-host.ts`.

Current intended user-facing production host:

- `https://ria-file-ops.vercel.app`

## Observed Redirect Hosts

- Browser reproduction stayed on `ria-file-ops.vercel.app` for the visible app pages.
- Production app-login starts create a Google OAuth authorization request on `accounts.google.com`.
- The expected callback host from the generated OAuth request is `ria-file-ops.vercel.app`.
- Direct unauthenticated fetches to the non-canonical Vercel project aliases returned 401 rather than public app content, so they do not appear to be the user-facing production entry point in this check.

## Expected Google OAuth Redirect URI

For app login, Google Cloud should allow exactly:

```text
https://ria-file-ops.vercel.app/api/auth/callback/google
```

If a custom domain becomes the actual production host, `NEXTAUTH_URL`/`AUTH_URL`, the Google OAuth redirect URI, and any canonical-host redirect logic must all move to that same origin.

The separate Google Drive storage connection callback is:

```text
https://ria-file-ops.vercel.app/api/storage/google/callback
```

## Required Vercel Production Env Vars

Production Vercel env names verified through the Vercel CLI without exposing values:

- `NEXTAUTH_URL` or `AUTH_URL`
- `NEXTAUTH_SECRET` or `AUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `PERSISTENCE_BACKEND`
- `SUPABASE_DB_URL_POOLER` or `SUPABASE_DB_URL`
- `APP_ENCRYPTION_KEY`

Observed production env-name status:

- `PERSISTENCE_BACKEND`: present
- `SUPABASE_DB_URL_POOLER`: present
- `SUPABASE_DB_URL`: present
- `APP_ENCRYPTION_KEY`: present
- `GOOGLE_CLIENT_ID`: present
- `GOOGLE_CLIENT_SECRET`: present
- `NEXTAUTH_SECRET`: present
- `NEXTAUTH_URL`: present
- `AUTH_SECRET`: not present, but not required because `NEXTAUTH_SECRET` exists
- `AUTH_URL`: not present, but not required because `NEXTAUTH_URL` exists

Vercel marks these variables as sensitive, so the CLI did not expose values. Runtime browser verification now confirms the values are sufficient for the sign-in and post-callback session verification path.

Expected production posture:

- `NEXTAUTH_URL`/`AUTH_URL` matches the canonical production origin.
- `PERSISTENCE_BACKEND` is `supabase`.
- `APP_ENCRYPTION_KEY` decodes to exactly 32 bytes.
- Supabase/Postgres URL envs point at the database where the app migrations have been applied.

## Required Google Cloud OAuth Settings

In the Google Cloud OAuth client used by Production:

- Authorized JavaScript origin includes `https://ria-file-ops.vercel.app`.
- Authorized redirect URI includes `https://ria-file-ops.vercel.app/api/auth/callback/google`.
- If OAuth consent is still in testing mode, the signing-in account is an allowed test user.
- If a custom production host is adopted, add the matching custom-domain origin and callback before sending users there.

## Required Supabase Migration/Table Checks

The production database used by Vercel must have:

- `public.app_session_activity` from `supabase/migrations/20260518032802_app_sessions_activity.sql`
- `public.auth_audit_events` from `supabase/migrations/20260518043000_auth_audit_events.sql`

Safe table-existence check:

```sql
select
  to_regclass('public.app_session_activity') is not null as app_session_activity_exists,
  to_regclass('public.auth_audit_events') is not null as auth_audit_events_exists;
```

Result from the Supabase CLI linked database before the fix:

- `app_session_activity_exists`: false
- `auth_audit_events_exists`: false

Confirmed production Supabase target:

- Supabase project: `RIA File Ops Project`
- Project ref: `vcwyzktzqjdyojlcutkw`

Applied/reconciled migrations, in order:

1. `20260518032802_app_sessions_activity.sql`
2. `20260518043000_auth_audit_events.sql`

The two SQL files were inspected before execution. They only create the expected tables, indexes, check constraints, and enable RLS on those same tables. They do not contain `DROP`, `TRUNCATE`, `DELETE`, or unrelated schema changes.

Result after the fix:

- `app_session_activity_exists`: true
- `auth_audit_events_exists`: true
- Expected `app_session_activity` indexes: 4 of 4 present
- Expected `auth_audit_events` indexes: 4 of 4 present
- Expected `app_session_activity` check constraints: 4 of 4 present
- Expected `auth_audit_events` check constraints: 3 of 3 present
- RLS enabled on both tables
- Policies: none, matching the migration files
- Migration history repaired only for `20260518032802` and `20260518043000`

## Findings

### Confirmed

- The production app-login button still calls `signIn("google", { callbackUrl: "/dashboard" })`.
- The production NextAuth Google provider is exposed and the sign-in start route returns a Google authorization request.
- The production-generated app-login redirect URI is `https://ria-file-ops.vercel.app/api/auth/callback/google`.
- Before the fix, browser reproduction reached `/login?reason=verification_failed`, which mapped to server-side app session activity verification, not a missing Google provider or disabled sign-in button.
- The linked production Supabase database did not have the required app session activity or auth audit tables.
- After applying the two missing migrations, both tables and their expected schema objects exist.
- After the database fix, production browser verification reaches `/dashboard` successfully.

### Likely

- The original root cause was the missing production session activity table. `/dashboard` tried to read/upsert session activity and failed closed.
- A future missing production `PERSISTENCE_BACKEND=supabase`, missing Supabase DB URL, or invalid/missing `APP_ENCRYPTION_KEY` could produce the same `verification_failed` symptom after the PROD-001 fail-closed change.

### Ruled Out

- AUTH-001 did not break basic app login: the provider still requests `openid email profile`, and OAuth tokens are not needed in the browser session for app sign-in.
- The separate Google Drive storage OAuth flow is not the button used for app login.
- The auth rate limiter is not the observed root cause. A limiter block would return a throttling response on the auth route, not a post-callback `/login?reason=verification_failed` session verification bounce.
- A Google redirect URI mismatch is not the finding for the canonical host because production generates the expected callback URI and the browser reached the app's post-callback verification path.
- A missing or rotating Auth.js secret is not the leading finding because the observed reason requires a session object to exist before session activity enforcement fails.

## Recommended Fix Plan

### Manual Vercel Actions

No Vercel changes were made. Production env names were verified without exposing values, and production browser verification now succeeds.

Keep as release checks:

1. `NEXTAUTH_URL` or `AUTH_URL` should remain the exact canonical origin users open before sign-in.
2. `PERSISTENCE_BACKEND` should remain `supabase`.
3. One Supabase/Postgres URL env var should remain configured for the migrated database.
4. `APP_ENCRYPTION_KEY` should remain valid 32-byte key material.

### Manual Google Cloud Actions

No Google Cloud changes were made. The production-generated callback URI is `https://ria-file-ops.vercel.app/api/auth/callback/google`, and the browser reached the app after Google sign-in.

Keep as release checks:

1. The Production OAuth client should allow `https://ria-file-ops.vercel.app/api/auth/callback/google`.
2. The Production OAuth client should have the matching authorized JavaScript origin.
3. If a custom domain is introduced, add the custom-domain callback and origin, then update Vercel `NEXTAUTH_URL`/`AUTH_URL` to the same origin.

### Manual Supabase Actions

Completed through the Supabase CLI:

1. Confirmed the linked production project.
2. Applied only the two expected migration SQL files.
3. Repaired migration history only for those two versions.
4. Re-ran schema-only checks and confirmed both tables and expected schema objects exist.
5. Did not inspect or print table contents.

### Code Changes, If Any

No root-cause code change was needed. The local change is documentation-only.

Optional follow-up after production is fixed:

- Add a safe, generic login-page notice for `verification_failed` so users see "Session verification failed; try again or contact support" instead of a silent-looking login page.
- Add a custom-domain canonicalization rule if a custom production host becomes the actual user-facing origin.

## Verification After Fix

Completed:

1. Opened `https://ria-file-ops.vercel.app`.
2. Confirmed the browser remained on the canonical host.
3. Confirmed the app now recognizes the signed-in session.
4. Opened `/dashboard`.
5. Confirmed `/dashboard` renders successfully and does not bounce back to `/login`, `/api/auth/error`, or `/login?reason=verification_failed`.

If the issue recurs, check only sanitized status/error categories in runtime logs. Do not copy OAuth codes, state values, cookies, session tokens, database URLs, secret values, or user/client document data.
