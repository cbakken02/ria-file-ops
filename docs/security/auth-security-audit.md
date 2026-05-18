# Auth and Security Audit

This audit began read-only for application code, migrations, Supabase/Vercel settings, and environment settings. Later auth rate-limiting hardening added code-level protections only. No migrations, database settings, Supabase/Vercel settings, or environment values were modified. Secret values were not printed; local environment files were checked only for variable names.

## 1. Summary of risks found

No Critical issues were confirmed from the repository alone.

High risks:

- OAuth provider access tokens are copied into the NextAuth session object, which is available to browser session consumers.
- Supabase/Postgres row isolation is an application-layer assumption, not an effective Supabase Auth/RLS boundary in the current implementation.

Supabase auth configuration note:

- The app does not currently use `@supabase/supabase-js`, Supabase Auth helpers, anon keys, or browser Supabase clients. Runtime auth is NextAuth with Google OAuth; Supabase is used as server-side Postgres persistence through `pg`.

Medium risks:

- Any Google account can sign in unless the OAuth app itself is externally restricted.
- At audit time, production could silently fall back to SQLite if `PERSISTENCE_BACKEND` was missing; SQLite stores storage OAuth tokens in plaintext. Post-audit commit `6ca6753` mitigated the persistent production fallback.
- Data Intelligence V2 sensitive reveal authorization is owner-email scoped and globally enabled by config, without durable firm/client/role authorization.
- Local preview file snapshots are authenticated but not owner-bound.
- `.env.example` still documents `SUPABASE_SERVICE_ROLE_KEY` even though runtime code does not use it.
- No runtime `SUPABASE_SERVICE_ROLE_KEY` usage was found, but the template/env posture should still be cleaned up so the key is not provisioned unnecessarily.

Low risks:

- Some state-changing API routes rely on shared lower-level auth rather than route-local checks.
- `proxy.ts` performs host canonicalization only; it is not an auth prefilter.
- Google OAuth storage disconnect deletes local records but does not revoke the provider grant.
- One local Swift compile helper passes the full process environment to a child process.
- Auth rate limiting is currently in-memory per runtime instance. This is useful as a no-dependency guard, but not a durable distributed Vercel production limit.

Positive findings:

- No `NEXT_PUBLIC_` secrets or Supabase client-side env usage were found.
- No Supabase admin client, service-role client, or `@supabase/supabase-js` dependency was found in runtime code.
- Existing client components do not reference Supabase env vars, `process.env`, `@supabase`, `pg`, or server-only Supabase persistence modules.
- Existing `.next/static` client bundle artifacts did not contain matches for Supabase service-role, Supabase DB URL, `NEXT_PUBLIC_`, or Postgres URL indicators.
- `.env.local` is gitignored and not tracked; `.env.example` is the only tracked env file.
- Supabase persistence encrypts stored Google access and refresh tokens with `APP_ENCRYPTION_KEY`.
- Most App Router pages, Server Actions, and Route Handlers perform session checks directly or through shared helpers.
- NextAuth sign-in starts, NextAuth OAuth callbacks, and the custom Google Drive OAuth start/callback routes now have basic per-IP and/or per-user rate limiting.
- SQL access uses parameterized queries and is generally scoped by `owner_email`.

Post-audit update on 2026-05-18: PROD-001 was mitigated in commit `6ca6753` (`fix(persistence): fail closed for production SQLite fallback`). Production-like runtimes now fail closed unless Supabase/Postgres encrypted persistence is explicitly configured. Treat `docs/security/risk-register.md` and `docs/security/security-roadmap.md` as the canonical current status for PROD-001. The separate temporary projection SQLite bridge follow-up is tracked as PROD-007.

## 2. File-by-file findings

| File | Severity | Finding | Required follow-up type | Key rotation? |
| --- | --- | --- | --- | --- |
| `auth.ts` | High | The JWT callback stores `accessToken` and `refreshToken`, and the session callback copies `token.accessToken` to `session.accessToken`. NextAuth session data can be fetched by browser code, so provider access tokens should not be returned in the public session payload. | Code change | Rotate/revoke Google grants if Drive-scoped tokens were exposed in deployed sessions or if leakage is suspected. |
| `app/api/auth/[...nextauth]/route.ts` | Low | NextAuth route now rate-limits sign-in initiation paths and OAuth callback paths. Session, CSRF, provider metadata, and sign-out paths are not rate-limited to avoid breaking normal auth/session behavior. | Optional production Vercel Firewall or persistent store | No. |
| `lib/rate-limit.ts` | Low | Adds a small fixed-window in-memory limiter. Keys are SHA-256 hashed so raw IP/email identity values are not retained in the store. | Production hardening: replace/augment with Vercel Firewall, Upstash Redis, or another shared store | No. |
| `lib/auth-rate-limit.ts` | Low | Centralizes auth-specific limits: NextAuth sign-in per IP, NextAuth callback per IP, Google Drive OAuth start per IP/user, and Google Drive OAuth callback per IP/user. | Tune thresholds after real usage; add persistent backend for distributed limits | No. |
| `types/next-auth.d.ts` | High | Public `Session` type includes `accessToken`, encouraging client/server code to treat the access token as part of the session contract. | Code change | Same as `auth.ts`. |
| `components/google-drive-connect-button.tsx` | High | This older/unused component requests Drive scope through `next-auth/react` `signIn`. If used with current `auth.ts`, the resulting Drive access token would be copied into the browser-visible session. | Code change | Revoke Google grants if this flow was used in production. |
| `app/api/storage/google/start/route.ts` | Low | The preferred storage OAuth flow sets an HttpOnly, `sameSite: "lax"`, production-secure state cookie and redirects to Google. It now applies per-IP and per-user rate limiting before starting Drive OAuth. | Persistent production rate-limit store remains recommended | No. |
| `app/api/storage/google/callback/route.ts` | Medium | Stores Google access and refresh tokens for connected storage. Supabase storage encrypts them, but SQLite storage does not. The callback validates OAuth state, requires a signed-in user, and now applies per-IP and per-user rate limiting before token exchange. | PROD-001 fail-closed code is done; persistent rate-limit store remains recommended for production | Rotate/revoke Google grants if plaintext SQLite storage was used in a non-local or compromised environment. |
| `lib/storage-connections.ts` | Medium | Storage access uses encrypted persisted tokens or session tokens. It can sync a session Google connection if Drive scopes are present on the session, which reinforces the need to remove browser-visible `session.accessToken`. | Code change | Same as `auth.ts` if Drive-scoped session tokens were exposed. |
| `lib/persistence/supabase-app-state-store.ts` | Medium | Supabase storage token columns are encrypted/decrypted server-side. Queries are parameterized and scoped by `owner_email`. RLS is not the practical enforcement point because the app connects directly to Postgres. | Supabase dashboard/DB role review; possible code/migration change | Rotate DB credentials only if exposed. |
| `lib/persistence/sqlite-app-state-store.ts` | Medium | SQLite schema stores `access_token` and `refresh_token` plaintext. This is tolerable for local gitignored dev data, but unsafe as a production fallback. | Code change | Rotate/revoke Google grants if plaintext files were exposed. |
| `lib/persistence/backend.ts` | Medium | At audit time, production could silently fall back to plaintext local SQLite persistence. PROD-001 was subsequently mitigated in commit `6ca6753`: production-like runtimes now require explicit Supabase/Postgres encrypted persistence and do not fall back to persistent `data/*.sqlite` files. | Release env verification; separate PROD-007 temp projection bridge follow-up | No, unless fallback actually stored tokens in an exposed environment. |
| `lib/postgres/server.ts` | High | Supabase access uses `SUPABASE_DB_URL_POOLER` or `SUPABASE_DB_URL` with `pg`, not Supabase Auth/anon sessions. RLS policies based on `auth.uid()` cannot apply to this runtime path. | Supabase dashboard/DB role review plus possible code/migration change | Rotate DB credentials if exposed or overly shared. |
| `supabase/migrations/20260424_phase1_app_state_and_projection.sql` | High | Migration explicitly says server-only, enables RLS, and creates no anon/authenticated policies. Views are created without `security_invoker`. This is consistent with server-only Postgres, but not with any assumption that Supabase Auth/RLS isolates browser users. | Supabase migration/dashboard review | No, unless exposed roles/keys exist. |
| `supabase/migrations/20260425_phase1_review_and_preview_state.sql` | High | RLS is enabled on review/cache tables, but no policies are defined. Isolation depends on server queries filtering `owner_email`. | Supabase migration/dashboard review | No. |
| `supabase/migrations/20260426_phase1_cleanup_file_states.sql` | High | RLS is enabled with no policies; same server-only assumption. | Supabase migration/dashboard review | No. |
| `supabase/migrations/20260429_data_intelligence_v2_reveal_cards.sql` | High | Reveal-card metadata table has RLS enabled with no policies. The app expects server-side Postgres writes/reads only. | Supabase migration/dashboard review | No. |
| `supabase/migrations/20260430_data_intelligence_v2_audit_events.sql` | High | Audit table has RLS enabled with no policies. The app expects server-side Postgres writes only. | Supabase migration/dashboard review | No. |
| `.env.example` | Medium | Documents `SUPABASE_SERVICE_ROLE_KEY`, but runtime code does not use the service role key. Keeping it in the template increases the chance a high-privilege key is provisioned unnecessarily. | Code/docs change; Vercel/Supabase env cleanup if already configured | Rotate service role key only if it was copied into shared/deployed envs unnecessarily or exposed. |
| `scripts/map-supabase-20260426-migration-content.mjs`, `scripts/diagnose-supabase-migration-history.mjs`, `scripts/check-supabase-migration-readiness.mjs` | Low | These scripts reference `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY` only in a helper that deletes sensitive Supabase/Postgres variables from the child Supabase CLI environment. This is a defensive use, not a credential consumer. | No immediate change | No, unless real key values were exposed elsewhere. |
| `package.json`, `package-lock.json` | Low | No `@supabase/supabase-js`, `@supabase/ssr`, or Supabase admin-client dependency was found. Runtime Supabase access uses `pg` from server-side modules. | No immediate change | No. |
| Client components under `app/` and `components/` | Low | Client files containing `"use client"` did not reference `SUPABASE_*`, `NEXT_PUBLIC_*`, `process.env`, `@supabase`, `pg`, or server-only persistence imports. Some client components import `type` definitions from server modules, which are erased at build time. | Optional hardening: add explicit `server-only` markers to broader server facade modules such as `lib/db.ts`. | No. |
| `.gitignore` | Low | `.env*` is ignored and `.env.example` is explicitly allowed. This is good. | No change | No. |
| `next.config.ts` | Low | No `env`, `serverRuntimeConfig`, or `publicRuntimeConfig` exposure was found. | No change | No. |
| `proxy.ts` | Low | Proxy only redirects production aliases to the canonical host. It is not an auth guard. Current protected pages mostly call `requireSession`, but new routes could be missed. | Optional code change and route coverage tests | No. |
| `lib/session.ts` | Low | `requireSession()` centralizes page/action auth redirects. Good pattern. | No immediate change | No. |
| `app/page.tsx` | Low | Public landing page reads session to route CTA only; no sensitive data exposure found. | No change | No. |
| `app/login/page.tsx` | Low | Redirects authenticated users to dashboard and disables login button when Google OAuth env is missing. No secret values are printed. | No change | No. |
| `app/dashboard/page.tsx`, `app/setup/page.tsx`, `app/preview/intake-workspace-page.tsx`, `app/cleanup/clean-up-workspace-page.tsx`, `app/data-intelligence/page.tsx`, `app/history/page.tsx` | Low | Protected pages call `requireSession()` and scope reads by `session.user.email`. | No immediate change | No. |
| `app/setup/actions.ts`, `app/setup/google-drive/actions.ts`, `app/actions/set-active-storage.ts` | Low | Server Actions call `requireSession()` and scope mutations by `ownerEmail`. | No immediate change | No. |
| `app/review/actions.ts`, `app/preview/actions.ts` | Medium | Server Actions check the session and use owner email, but trust form-supplied file metadata for some review event fields. This is app-layer integrity rather than auth bypass. | Code hardening | No. |
| `app/api/cleanup/apply/route.ts`, `app/api/cleanup/run/route.ts`, `app/api/intake/approve/route.ts` | Low | Routes do not call `auth()` directly, but the shared `approveFileItems()` helper does. This is currently protected but less obvious during review. | Code cleanup/test coverage | No. |
| `lib/file-approval.ts` | Low | Shared approval helper enforces session, owner email, active storage, write scope, and owner-scoped settings before moving files. Good central guard. | No immediate change | No. |
| `app/api/drive/files/[fileId]/route.ts` | Medium | Requires a session and active storage token, but allows downloading any Drive file ID accessible to that token, not only files under configured source/destination roots. | Code change | No. |
| `app/api/preview/files/[snapshotId]/route.ts` | Medium | Requires a session, but local preview snapshots are looked up only by random snapshot ID, not owner email. The feature is disabled for Supabase persistence, but local/shared environments can leak if an ID is known. | Code change | No. |
| `lib/preview-file-snapshots.ts` | Medium | Snapshot metadata lacks `ownerEmail`; snapshots live in temp storage for 24 hours. | Code change | No. |
| `lib/processing-preview.ts` | Low | Disables preview file snapshots when Supabase persistence is active. This limits the previous issue to local/non-Supabase mode. | No immediate change | No. |
| `app/api/query-assistant/route.ts` | Medium | Requires session and scopes by owner email, but any signed-in Google user can consume the assistant if public sign-in is open. Debug logging is disabled in production. | Code change for admission/rate limits | No. |
| `app/api/data-intelligence/v2/chat/route.ts` | Medium | Requires auth context through handler logic and no-store headers. Risk is primarily the coarse owner-email authorization model. | Code change | No. |
| `app/api/data-intelligence/v2/reveal/route.ts` | Medium | Requires auth context and reveal-card ID validation. Sensitive values are returned to the browser when policy allows, so firm/client/role authorization must be stronger before broad rollout. | Code change and env rollout control | No. |
| `lib/data-intelligence-v2/auth-context.ts` | Medium | Defaults authenticated users to `csa` and sets `ownerEmail` to user email. Comment notes firm/client permission checks are future work. | Code change | No. |
| `lib/data-intelligence-v2/policy.ts` | Medium | Sensitive reveal authorization checks owner scope, readonly role, global reveal flag, and optional client IDs, but no durable role/client membership is populated today. | Code change | No. |
| `lib/data-intelligence-v2/reveal-token-service.ts` | Low | Reveal cards are short-lived, one-time by default, creator/admin bound, and do not store raw sensitive values. Audit failures fail open by design, so production monitoring is required. | Monitoring/code hardening | No. |
| `lib/data-intelligence-v2/postgres-reveal-token-store.ts`, `lib/data-intelligence-v2/postgres-audit-sink.ts` | Low | Parameterized Postgres access and sanitization are used. RLS still depends on server-only DB access assumptions. | Supabase dashboard/DB role review | No. |
| `app/api/data-intelligence/v2/qa/preview-smoke/route.ts` | Low | Preview-only endpoint is protected by `VERCEL_ENV === "preview"` and a timing-safe secret header compare. It intentionally does not use user session auth. | Keep env scoped to Preview only | Rotate preview QA secret if shared or logged. |
| `lib/document-intelligence.ts` | Low | Swift compile helper passes the full process environment to `swiftc`. This is a local trusted-toolchain risk, but least-privilege env passing is preferable. | Code change | Rotate secrets only if the toolchain/host was compromised. |
| `tests/auth-rate-limit.test.mjs` | Low | Covers fixed-window limiting, reset behavior, IP extraction, hashed identity keys, and NextAuth sign-in throttling behavior. | Keep as regression coverage | No. |

## 3. Severity list

Critical:

- None confirmed.

High:

- Browser-visible NextAuth session can include OAuth provider access token.
- Supabase RLS is not the active authorization boundary for the runtime database path.

Medium:

- Open Google sign-in has no app-level allowlist, invite, tenant, or domain gate.
- SQLite stores OAuth tokens plaintext in local development. Persistent production SQLite fallback was mitigated by commit `6ca6753`; keep release checks for Supabase/Postgres envs.
- Data Intelligence V2 reveal authorization lacks durable firm/client/role checks.
- Local preview file snapshots are not owner-bound.
- Service role key is documented in env template despite no runtime usage.
- Drive file proxy can fetch any file accessible to the active Drive token.

Low:

- Some route handlers rely on lower-level auth helpers.
- Proxy is not an auth guard.
- Disconnect does not revoke Google OAuth grant.
- Full process env is passed to local Swift compilation.
- Auth rate limiting is best-effort in-memory rather than distributed/persistent.

## 4. Exact recommended follow-up tasks

1. Remove `accessToken` from the public NextAuth session callback and `Session` type. Keep provider tokens only in server-only storage or the encrypted JWT, and use server-only retrieval paths for Drive/API calls.

2. Delete or rewrite `components/google-drive-connect-button.tsx` so Drive authorization always uses `/api/storage/google/start` and server-side encrypted storage, not NextAuth `signIn()` with Drive scopes.

3. Add a `signIn` callback or equivalent admission check that restricts production access to approved users, domains, or tenant memberships.

4. Keep the PROD-001 release check from commit `6ca6753`: production-like runtimes must fail closed unless `PERSISTENCE_BACKEND=supabase`, a Supabase/Postgres URL, and `APP_ENCRYPTION_KEY` are configured.

5. Keep SQLite local-dev/test only. If SQLite ever needs broader use, encrypt storage tokens and define a separate risk acceptance.

6. Remove `SUPABASE_SERVICE_ROLE_KEY` from `.env.example` unless a current server-only runtime path truly needs it. If Vercel/Supabase envs contain an unused service role key, remove it.

7. Review Supabase project Data API exposure. Keep these tables unavailable to anon/authenticated clients until policies exist, or add explicit RLS policies and least-privileged roles before exposing anything.

8. Create a least-privileged Postgres role for the app instead of using owner/admin credentials, and evaluate `FORCE ROW LEVEL SECURITY` plus policies if RLS is meant to be a real database boundary.

9. Convert public views such as `latest_account_snapshot_v` and `latest_account_document_v` to `security_invoker` views or keep them inaccessible from exposed schemas.

10. Add route-level auth checks to `/api/cleanup/apply`, `/api/cleanup/run`, and `/api/intake/approve`, even though `approveFileItems()` currently protects them.

11. Add automated route coverage that fails when new `app/api/**/route.ts` files lack either direct auth, explicit public designation, or a documented shared auth helper.

12. Bind preview file snapshots to `ownerEmail` and verify the session owner before returning file bytes.

13. Restrict `/api/drive/files/[fileId]` to configured source/destination folders or to file IDs present in the current owner-scoped preview/history state.

14. Add Google token revocation when a storage connection is removed, and document whether sign-out should revoke only the app session or also storage grants.

15. Implement durable Data Intelligence V2 role and client permissions from trusted server-side data, then wire `allowedClientIds`, roles, and firm IDs into `buildDataIntelligenceV2AuthContext()`.

16. Keep `DATA_INTELLIGENCE_V2_ALLOW_SENSITIVE_REVEAL=false` in production until the durable authorization model and audit sink health checks are in place.

17. Pass a minimal environment to the Swift compile helper instead of spreading `process.env`.

18. Move auth rate limiting to a distributed production control before real users: preferably Vercel Firewall rate limiting for `/api/auth/signin*`, `/api/auth/callback/*`, `/api/storage/google/start`, and `/api/storage/google/callback`, or a small shared store such as Upstash Redis/Vercel KV if app-level counters are needed.

## Auth endpoint rate limiting review

Endpoints checked:

- Login: Google OAuth through NextAuth at `/api/auth/signin*`.
- Signup: none found.
- Password reset: none found.
- Magic link: none found.
- Custom auth/OAuth: Google Drive storage OAuth at `/api/storage/google/start` and `/api/storage/google/callback`.
- Middleware/proxy: `proxy.ts` still performs host canonicalization only and is not used as a durable auth/rate-limit layer.

Implemented protections:

- `/api/auth/signin*`: fixed-window per-IP limit of 10 attempts per 5 minutes.
- `/api/auth/callback/*`: fixed-window per-IP limit of 30 attempts per 10 minutes.
- `/api/storage/google/start`: fixed-window per-IP and per-user limits of 10 attempts per 5 minutes.
- `/api/storage/google/callback`: fixed-window per-IP limit of 30 attempts per 10 minutes and per-user limit of 20 attempts per 10 minutes.
- Rate-limit responses return `429`, `Retry-After`, `X-RateLimit-*`, `Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`.
- Rate-limit keys are hashed before storage; raw IP/email values are not retained in the in-memory bucket map.
- NextAuth session, CSRF, providers, and sign-out endpoints are intentionally not rate-limited to avoid breaking normal session checks and OAuth mechanics.

Remaining concerns:

- The current limiter is in-memory per Node runtime instance. It is safe to run on Vercel, but it is not globally consistent across instances, regions, cold starts, or redeploys.
- OAuth login has no local password to brute-force, so Google handles the primary credential attack surface. App-side limits mostly reduce callback/sign-in abuse and accidental loops.
- There is no per-email limit for initial Google sign-in because the app does not know the email until after the provider callback. Add an admission allowlist/tenant gate separately.
- Production should add Vercel Firewall rate limiting or a small shared counter store before broader demos/users.

Manual test checklist:

1. Visit `/login` and click Google sign-in once; verify the normal Google OAuth redirect still starts.
2. Repeat `/api/auth/signin/google` from the same IP more than 10 times in 5 minutes; expect `429`.
3. Complete a normal Google sign-in after waiting for the window to reset; expect success.
4. Connect Drive from setup once; verify `/api/storage/google/start` redirects to Google and callback saves the connection.
5. Repeat Drive connect starts more than 10 times in 5 minutes for the same signed-in user; expect `429`.
6. Confirm `/api/auth/session`, `/api/auth/csrf`, and `/api/auth/providers` still respond normally.

## Supabase service-role and public env exposure review

Scope completed:

- Searched runtime code, scripts, tests, docs, env templates, package metadata, client components, and existing `.next/static` client artifacts for `SUPABASE_SERVICE_ROLE_KEY`, service-role naming, Supabase anon/public keys, `NEXT_PUBLIC_*`, Supabase client imports, `createClient()`, and Supabase/Postgres env references.
- Checked current env-like files by variable name only. `.env.local` values were not printed. No Supabase variable names were present in the current local `.env.local` during this review.
- Confirmed `.env.example` is the only tracked env-like file found by `git ls-files`.

Findings:

- **Medium:** `.env.example` includes `SUPABASE_SERVICE_ROLE_KEY` even though no runtime code uses it. This should be removed from the template unless there is a specific server-only admin workflow that truly requires it.
- **Low:** Three Supabase migration/readiness scripts mention `SUPABASE_SERVICE_ROLE_KEY`, but only to remove it from inherited CLI environments before spawning Supabase CLI processes. This is intentionally safer than passing the key through.
- **Low:** Runtime Supabase access is server-side direct Postgres through `lib/postgres/server.ts`, guarded by `import "server-only"` and a `typeof window` runtime check. This avoids service-role client bundling, but it also means RLS is not the primary runtime authorization boundary.
- **Low:** No `NEXT_PUBLIC_*` variable was found in application code, env templates, or current local env variable names.
- **Low:** No Supabase admin client, Supabase browser client, `@supabase/supabase-js`, or `@supabase/ssr` package was found.
- **Low:** No client component imports the server Postgres/Supabase persistence modules at runtime. Type-only imports from server modules remain acceptable because they are erased from browser bundles.
- **Low:** Existing `.next/static` client artifacts did not contain matches for service-role, Supabase DB URL, `NEXT_PUBLIC_`, or Postgres URL indicators. Re-check after any production build that changes env handling.

Code changes made in this review:

- None. No obvious service-role runtime exposure or unsafe client import required a code-level boundary fix.

## Required manual actions

Supabase:

1. Confirm whether the project service-role key has ever been pasted into `.env.local`, Vercel env vars, shell profiles, CI variables, shared docs, logs, screenshots, or preview tooling.
2. Rotate the Supabase service-role key if it was ever committed, shared, logged, placed in a browser-visible variable, or added to any deployed environment without a current server-only need.
3. Review the Supabase Data API exposure settings. Keep app tables unavailable to anon/authenticated clients until a deliberate RLS policy model exists.

Vercel:

1. Remove `SUPABASE_SERVICE_ROLE_KEY` from Production, Preview, and Development env vars unless a documented server-only code path requires it.
2. Ensure no Supabase secret, Postgres URL, Google secret, OpenAI key, encryption key, or NextAuth secret is configured with a `NEXT_PUBLIC_` prefix.
3. Keep `SUPABASE_DB_URL_POOLER` or `SUPABASE_DB_URL` server-only and scoped to the least-privileged database role available for the app.
4. After the next production build, search the emitted client assets for privileged env names as a release checklist item.

## 5. Code change vs dashboard change vs key rotation

| Issue | Code change | Supabase/dashboard/env change | Key rotation |
| --- | --- | --- | --- |
| Public session includes OAuth access token | Yes | No | Only if exposed/leaked or Drive-scoped session flow was used |
| Legacy Drive `signIn()` component | Yes | No | Only if used in production |
| No admission/tenant allowlist | Yes | Possibly Google OAuth app/domain settings | No |
| RLS not active runtime boundary | Possibly | Yes, review DB role/Data API/RLS policy posture | Rotate DB credentials if exposed or over-shared |
| `SUPABASE_SERVICE_ROLE_KEY` in env template | Yes/docs | Remove unused deployed env value if present | Rotate if exposed or unnecessarily shared |
| SQLite plaintext token storage/default | PROD-001 code done in `6ca6753`; monitor | Ensure deployed env explicitly sets Supabase backend | Revoke Google grants if plaintext store was exposed |
| Local preview snapshots not owner-bound | Yes | No | No |
| Drive file route not folder/state constrained | Yes | No | No |
| Indirect route auth | Yes/tests | No | No |
| Auth endpoint rate limiting | Yes | Add Vercel Firewall/shared-store rate limiting before real users | No |
| Data Intelligence V2 coarse reveal auth | Yes | Keep reveal flag disabled until fixed | No |
| OAuth disconnect without revoke | Yes | Google OAuth grant management | Revoke affected Google grants if needed |
| Full env passed to child process | Yes | No | Only if host/toolchain compromise is suspected |
